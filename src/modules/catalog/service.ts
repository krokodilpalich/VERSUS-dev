import { z } from "zod";
import { sql, audit, notify, type Tx } from "../db";
import {
  requireThat,
  signed,
  staff,
  isStaff,
  hasRole,
  slug,
  type Actor,
} from "../auth/policy";
export const idSchema = z.string().uuid();
export const money = z.number().int().positive().max(9_000_000_000_000);
export const visibility = z.enum([
  "PUBLIC",
  "UNLISTED",
  "VERIFIED_ONLY",
  "INVITED_ONLY",
  "OWNER_AND_STAFF",
]);
export async function memberAccess(
  actor: Actor | null,
  tx: Tx | typeof sql = sql,
) {
  if (!actor) return false;
  const [row] =
    await tx`SELECT status FROM private_memberships WHERE user_id=${actor.id}`;
  return row?.status === "APPROVED";
}
export async function visibleArtwork(
  id: string,
  actor: Actor | null,
  tx: Tx | typeof sql = sql,
) {
  const [work] =
    await tx`SELECT w.*,a.user_id AS owner_id,a.name AS artist_name,a.slug AS artist_slug,s.title AS series_title,s.slug AS series_slug FROM artworks w JOIN artists a ON a.id=w.artist_id LEFT JOIN series s ON s.id=w.series_id WHERE w.id::text=${id} OR w.slug=${id}`;
  requireThat(work, 404, "NOT_FOUND", "Работа не найдена");
  if (
    actor?.id === work.owner_id ||
    (isStaff(actor) &&
      hasRole(actor, "MODERATOR", "CURATOR", "ADMIN", "SUPERADMIN"))
  )
    return work;
  requireThat(
    work.editorial_status === "PUBLISHED",
    404,
    "NOT_FOUND",
    "Работа не найдена",
  );
  const allowed =
    work.visibility === "PUBLIC" ||
    work.visibility === "UNLISTED" ||
    (work.visibility === "INVITED_ONLY" && (await memberAccess(actor, tx)));
  requireThat(allowed, 404, "NOT_FOUND", "Работа не найдена");
  return work;
}
export const artistInput = z
  .object({
    name: z.string().min(2).max(150),
    biography: z.string().max(5000),
    statement: z.string().max(5000),
    city: z.string().max(150),
  })
  .strict();
export async function saveArtist(actor: Actor | null, input: unknown) {
  signed(actor);
  requireThat(
    hasRole(actor, "ARTIST"),
    403,
    "ROLE_REQUIRED",
    "Выберите роль фотографа",
  );
  const data = artistInput.parse(input);
  return sql.begin(async (tx) => {
    const [existing] =
      await tx`SELECT a.id FROM artists a WHERE a.user_id=${actor.id} AND EXISTS(SELECT 1 FROM artworks w WHERE w.artist_id=a.id AND w.editorial_status='PUBLISHED') FOR UPDATE`;
    if (existing) {
      await tx`UPDATE artists SET pending_profile=${tx.json(data)} WHERE id=${existing.id}`;
      await audit(
        tx,
        actor.id,
        "Artist",
        existing.id,
        "ARTIST_PROFILE_SUBMITTED",
      );
      return { id: existing.id };
    }
    const [row] =
      await tx`INSERT INTO artists(user_id,name,slug,biography,statement,city) VALUES(${actor.id},${data.name},${slug(data.name)},${data.biography},${data.statement},${data.city}) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,biography=excluded.biography,statement=excluded.statement,city=excluded.city RETURNING id`;
    await audit(tx, actor.id, "Artist", row.id, "ARTIST_SAVED");
    return row;
  });
}
const seriesInput = z
  .object({
    title: z.string().min(2).max(200),
    statement: z.string().min(10).max(5000),
    yearStart: z.number().int().min(1800).max(2200),
  })
  .strict();
export async function createSeries(actor: Actor | null, input: unknown) {
  signed(actor);
  const data = seriesInput.parse(input);
  return sql.begin(async (tx) => {
    const [artist] = await tx`SELECT id FROM artists WHERE user_id=${actor.id}`;
    requireThat(
      artist,
      422,
      "ARTIST_REQUIRED",
      "Сначала создайте профиль автора",
    );
    const [row] =
      await tx`INSERT INTO series(artist_id,title,slug,statement,year_start) VALUES(${artist.id},${data.title},${slug(data.title)},${data.statement},${data.yearStart}) RETURNING id,slug`;
    await audit(tx, actor.id, "Series", row.id, "SERIES_CREATED");
    return row;
  });
}
export const artworkInput = z
  .object({
    title: z.string().min(2).max(200),
    seriesId: idSchema,
    captureYear: z.number().int().min(1800).max(2200),
    description: z.string().min(20).max(10000),
    genre: z.string().min(2).max(150),
    colorMode: z.enum(["COLOR", "BW"]),
    visibility: visibility.default("PUBLIC"),
    technique: z.string().min(2).max(150),
    paper: z.string().min(2).max(150),
    width: z.number().int().min(10).max(10000),
    height: z.number().int().min(10).max(10000),
    editionType: z.enum(["LIMITED", "OPEN"]),
    editionTotal: z.number().int().min(1).max(1000).nullable(),
    printYear: z.number().int().min(1800).max(2200),
    signed: z.boolean(),
    rightsAccepted: z.literal(true),
  })
  .strict()
  .refine(
    (d) =>
      d.editionType === "OPEN"
        ? d.editionTotal === null
        : d.editionTotal !== null,
    { message: "Укажите тираж LIMITED или null для OPEN" },
  );
export async function createArtwork(actor: Actor | null, input: unknown) {
  signed(actor);
  const d = artworkInput.parse(input);
  return sql.begin(async (tx) => {
    const [series] =
      await tx`SELECT s.id,s.artist_id FROM series s JOIN artists a ON a.id=s.artist_id WHERE s.id=${d.seriesId} AND a.user_id=${actor.id}`;
    requireThat(series, 404, "NOT_FOUND", "Серия не найдена");
    const [w] =
      await tx`INSERT INTO artworks(artist_id,series_id,title,slug,capture_year,description,genre,color_mode,visibility) VALUES(${series.artist_id},${series.id},${d.title},${slug(d.title)},${d.captureYear},${d.description},${d.genre},${d.colorMode},${d.visibility}) RETURNING id,slug`;
    const [v] =
      await tx`INSERT INTO edition_variants(artwork_id,print_technique,paper,image_width_mm,image_height_mm,sheet_width_mm,sheet_height_mm,edition_type,edition_total,signed) VALUES(${w.id},${d.technique},${d.paper},${d.width},${d.height},${d.width},${d.height},${d.editionType},${d.editionTotal},${d.signed}) RETURNING id`;
    // Physical copies exist independently of listings. Open editions start with one confirmed physical copy.
    for (let n = 1; n <= (d.editionTotal ?? 1); n++)
      await tx`INSERT INTO edition_copies(variant_id,number,print_year) VALUES(${v.id},${d.editionType === "LIMITED" ? n : null},${d.printYear})`;
    await audit(tx, actor.id, "Artwork", w.id, "ARTWORK_CREATED", {
      rightsDeclared: true,
    });
    return w;
  });
}
export async function ownedWork(tx: Tx | typeof sql, actor: Actor, id: string) {
  const [w] =
    await tx`SELECT w.* FROM artworks w JOIN artists a ON a.id=w.artist_id WHERE w.id=${id} AND a.user_id=${actor.id} FOR UPDATE OF w`;
  requireThat(w, 404, "NOT_FOUND", "Работа не найдена");
  return w;
}
export async function updateArtwork(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  signed(actor);
  const d = z
    .object({
      title: z.string().min(2).max(200),
      description: z.string().min(20).max(10000),
      version: z.number().int().positive(),
    })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const w = await ownedWork(tx, actor, id);
    requireThat(
      ["DRAFT", "NEEDS_CHANGES", "REJECTED"].includes(w.editorial_status),
      409,
      "STATE_CONFLICT",
      "Опубликованную работу нельзя менять без повторной модерации",
    );
    requireThat(
      w.version === d.version,
      409,
      "VERSION_CONFLICT",
      "Работа уже изменена",
    );
    await tx`UPDATE artworks SET title=${d.title},description=${d.description},editorial_status='DRAFT',version=version+1,updated_at=now() WHERE id=${id}`;
    await audit(tx, actor.id, "Artwork", id, "ARTWORK_EDITED", {
      before: { title: w.title, description: w.description },
      after: { title: d.title, description: d.description },
      version: w.version + 1,
    });
    return { id };
  });
}
export async function submitArtwork(actor: Actor | null, id: string) {
  signed(actor);
  return sql.begin(async (tx) => {
    const w = await ownedWork(tx, actor, id);
    requireThat(
      ["DRAFT", "NEEDS_CHANGES", "REJECTED"].includes(w.editorial_status),
      409,
      "STATE_CONFLICT",
      "Работа уже отправлена",
    );
    const [media] =
      await tx`SELECT id FROM artwork_media WHERE artwork_id=${id}`;
    requireThat(media, 422, "MEDIA_REQUIRED", "Загрузите изображение");
    await tx`UPDATE artworks SET editorial_status='SUBMITTED',version=version+1,updated_at=now() WHERE id=${id}`;
    await audit(tx, actor.id, "Artwork", id, "ARTWORK_SUBMITTED");
    const mods =
      await tx`SELECT user_id FROM user_roles WHERE role IN ('MODERATOR','ADMIN')`;
    for (const m of mods)
      await notify(
        tx,
        m.user_id,
        "ArtworkSubmitted",
        "Поступила работа на модерацию",
      );
    return { id, status: "SUBMITTED" };
  });
}
export async function moderateArtwork(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  staff(actor, "MODERATOR");
  const d = z
    .object({
      decision: z.enum(["APPROVE", "NEEDS_CHANGES", "REJECT"]),
      reason: z.string().min(10).max(2000),
    })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const [w] =
      await tx`SELECT w.*,a.user_id FROM artworks w JOIN artists a ON a.id=w.artist_id WHERE w.id=${id} FOR UPDATE OF w`;
    requireThat(w, 404, "NOT_FOUND", "Работа не найдена");
    requireThat(
      w.editorial_status === "SUBMITTED",
      409,
      "STATE_CONFLICT",
      "Работа не ожидает модерации",
    );
    const state =
      d.decision === "APPROVE"
        ? "PUBLISHED"
        : d.decision === "REJECT"
          ? "REJECTED"
          : "NEEDS_CHANGES";
    await tx`UPDATE artworks SET editorial_status=${state},version=version+1,updated_at=now() WHERE id=${id}`;
    await audit(tx, actor.id, "Artwork", id, "ARTWORK_MODERATED", {
      from: w.editorial_status,
      to: state,
      reason: d.reason,
      authenticity: "UNVERIFIED",
    });
    if (w.user_id)
      await notify(
        tx,
        w.user_id,
        "ArtworkModerated",
        `Решение по работе: ${state}. ${d.reason}`,
      );
    return { id, status: state };
  });
}
export async function publishListing(actor: Actor | null, input: unknown) {
  signed(actor);
  const d = z
    .object({
      copyId: idSchema,
      priceMode: z.enum(["FIXED_PRICE", "PRICE_ON_REQUEST", "NOT_FOR_SALE"]),
      priceMinor: money.nullable(),
      representativeOrgId: idSchema.nullable().default(null),
      rightsEvidence: z.string().min(20).max(2000),
    })
    .strict()
    .parse(input);
  requireThat(
    d.priceMode !== "FIXED_PRICE" || d.priceMinor !== null,
    422,
    "PRICE_REQUIRED",
    "Укажите цену",
  );
  return sql.begin(async (tx) => {
    const [w] =
      await tx`SELECT c.id,c.variant_id,c.status,w.id AS artwork_id,w.artist_id,w.editorial_status,w.visibility,a.user_id AS author_id FROM edition_copies c JOIN edition_variants v ON v.id=c.variant_id JOIN artworks w ON w.id=v.artwork_id JOIN artists a ON a.id=w.artist_id WHERE c.id=${d.copyId}`;
    requireThat(w, 404, "NOT_FOUND", "Экземпляр не найден");
    await tx`SELECT id FROM artists WHERE id=${w.artist_id} FOR SHARE`;
    const [locked] =
      await tx`SELECT status FROM edition_copies WHERE id=${d.copyId} FOR UPDATE`;
    w.status = locked.status;
    requireThat(
      w.editorial_status === "PUBLISHED" && w.status === "AVAILABLE",
      409,
      "STATE_CONFLICT",
      "Работа должна пройти модерацию, экземпляр должен быть доступен",
    );
    const mandates =
      await tx`SELECT * FROM representation_mandates WHERE artist_id=${w.artist_id} AND status='APPROVED' AND starts_at<=now() AND ends_at>now() AND (artwork_id IS NULL OR artwork_id=${w.artwork_id})`;
    const exclusive = mandates.filter((m) => m.exclusive);
    requireThat(
      new Set(exclusive.map((m) => m.organization_id)).size <= 1,
      409,
      "MANDATE_CONFLICT",
      "Конфликт эксклюзивных мандатов: требуется ручное разрешение",
    );
    if (d.representativeOrgId) {
      const [member] =
        await tx`SELECT id FROM organization_members WHERE organization_id=${d.representativeOrgId} AND user_id=${actor.id} AND invitation_status='ACCEPTED' AND role IN ('OWNER','MANAGER','SALES','CATALOG_EDITOR')`;
      requireThat(
        member &&
          mandates.some(
            (m) =>
              m.organization_id === d.representativeOrgId &&
              m.scope === "SALE" &&
              m.geography === "RU",
          ),
        403,
        "MANDATE_REQUIRED",
        "Требуется действующий проверенный мандат и полномочия организации",
      );
    } else
      requireThat(
        w.author_id === actor.id && exclusive.length === 0,
        403,
        "MANDATE_REQUIRED",
        "Предложение должно идти через уполномоченного представителя",
      );
    const [existing] =
      await tx`SELECT id FROM listings WHERE edition_copy_id=${d.copyId} AND status='PUBLISHED'`;
    requireThat(
      !existing,
      409,
      "LISTING_EXISTS",
      "У экземпляра уже есть активное предложение",
    );
    const [row] =
      await tx`INSERT INTO listings(edition_copy_id,edition_variant_id,seller_id,representative_org_id,price_mode,price_minor,visibility,status,rights_evidence,verified_rights_at) VALUES(${d.copyId},${w.variant_id},${actor.id},${d.representativeOrgId},${d.priceMode},${d.priceMinor},${w.visibility},'PUBLISHED',${d.rightsEvidence},${d.representativeOrgId ? new Date().toISOString() : null}) RETURNING id`;
    await audit(tx, actor.id, "Listing", row.id, "LISTING_PUBLISHED", {
      rightsDeclared: true,
      mandateChecked: !!d.representativeOrgId,
    });
    return row;
  });
}
export async function publicCatalog(params: URLSearchParams) {
  const page = Math.max(1, Math.min(1000, Number(params.get("page")) || 1));
  const q = (params.get("q") ?? "").slice(0, 200);
  const color = params.get("color") ?? "";
  const mode = params.get("priceMode") ?? "";
  const artist = params.get("artist") ?? "";
  const min = Math.max(0, Math.min(9e12, Number(params.get("min")) * 100 || 0));
  const max = Math.max(
    min,
    Math.min(9e12, Number(params.get("max")) * 100 || 9e12),
  );
  const sort = params.get("sort") ?? "new";
  const available = params.get("available") === "true";
  const yearMin = Math.max(
      1800,
      Math.min(2200, Number(params.get("yearMin")) || 1800),
    ),
    yearMax = Math.max(
      yearMin,
      Math.min(2200, Number(params.get("yearMax")) || 2200),
    );
  const technique = (params.get("technique") ?? "").slice(0, 100),
    gallery = (params.get("gallery") ?? "").slice(0, 100),
    city = (params.get("city") ?? "").slice(0, 100),
    market = params.get("market") ?? "",
    edition = params.get("edition") ?? "";
  const maxWidth = Math.max(
    10,
    Math.min(10000, Number(params.get("width")) || 10000),
  );
  return sql`SELECT w.id,w.slug,w.title,w.capture_year,w.color_mode,w.genre,w.is_curated,a.name AS artist_name,a.slug AS artist_slug,(SELECT id FROM artwork_media WHERE artwork_id=w.id ORDER BY sort_order LIMIT 1) AS media_id, count(*) OVER()::int AS total FROM artworks w JOIN artists a ON a.id=w.artist_id WHERE w.editorial_status='PUBLISHED' AND w.visibility='PUBLIC' AND EXISTS(SELECT 1 FROM artwork_media WHERE artwork_id=w.id)
 AND (${q}='' OR w.search_vector @@ websearch_to_tsquery('russian',${q}) OR a.name ILIKE ${"%" + q + "%"} OR EXISTS(SELECT 1 FROM series s WHERE s.id=w.series_id AND s.title ILIKE ${"%" + q + "%"}))
 AND w.capture_year BETWEEN ${yearMin} AND ${yearMax}
 AND (${city}='' OR a.city ILIKE ${"%" + city + "%"})
 AND EXISTS(SELECT 1 FROM edition_variants v WHERE v.artwork_id=w.id AND v.image_width_mm<=${maxWidth} AND (${technique}='' OR v.print_technique ILIKE ${"%" + technique + "%"}) AND (${edition}='' OR v.edition_type=${edition}))
 AND (${gallery}='' OR EXISTS(SELECT 1 FROM listings l JOIN edition_variants v ON v.id=l.edition_variant_id JOIN organizations o ON o.id=l.representative_org_id WHERE v.artwork_id=w.id AND l.status='PUBLISHED' AND l.visibility='PUBLIC' AND o.name ILIKE ${"%" + gallery + "%"}))
 AND (${market}='' OR EXISTS(SELECT 1 FROM listings l JOIN edition_variants v ON v.id=l.edition_variant_id WHERE v.artwork_id=w.id AND l.status='PUBLISHED' AND l.visibility='PUBLIC' AND l.market_type=${market}))
 AND (${color}='' OR w.color_mode=${color}) AND (${artist}='' OR a.slug=${artist})
 AND (${mode}='' OR EXISTS(SELECT 1 FROM listings l JOIN edition_variants v ON v.id=l.edition_variant_id WHERE v.artwork_id=w.id AND l.status='PUBLISHED' AND l.visibility='PUBLIC' AND l.price_mode=${mode}))
 AND ((${min}=0 AND ${max}=9000000000000) OR EXISTS(SELECT 1 FROM listings l JOIN edition_variants v ON v.id=l.edition_variant_id WHERE v.artwork_id=w.id AND l.status='PUBLISHED' AND l.visibility='PUBLIC' AND l.price_mode='FIXED_PRICE' AND l.price_minor BETWEEN ${min} AND ${max}))
 AND (NOT ${available} OR EXISTS(SELECT 1 FROM edition_variants v JOIN edition_copies c ON c.variant_id=v.id WHERE v.artwork_id=w.id AND c.status='AVAILABLE'))
 ORDER BY CASE WHEN ${sort}='price-asc' THEN (SELECT min(l.price_minor) FROM listings l JOIN edition_variants v ON v.id=l.edition_variant_id WHERE v.artwork_id=w.id AND l.status='PUBLISHED' AND l.price_mode='FIXED_PRICE' AND l.visibility='PUBLIC') END ASC NULLS LAST,
 CASE WHEN ${sort}='price-desc' THEN (SELECT min(l.price_minor) FROM listings l JOIN edition_variants v ON v.id=l.edition_variant_id WHERE v.artwork_id=w.id AND l.status='PUBLISHED' AND l.price_mode='FIXED_PRICE' AND l.visibility='PUBLIC') END DESC NULLS LAST,
 CASE WHEN ${sort}='relevance' THEN ts_rank(w.search_vector,websearch_to_tsquery('russian',${q})) END DESC,
 CASE WHEN ${sort}='year' THEN w.capture_year END DESC,CASE WHEN ${sort}='curated' THEN w.is_curated END DESC,w.created_at DESC LIMIT 12 OFFSET ${(page - 1) * 12}`;
}
export async function workDossier(id: string, actor: Actor | null) {
  const w = await visibleArtwork(id, actor);
  const variants =
    await sql`SELECT * FROM edition_variants WHERE artwork_id=${w.id}`;
  const copies =
    await sql`SELECT c.id,c.variant_id,c.number,c.proof_type,c.condition,c.print_year,c.status FROM edition_copies c JOIN edition_variants v ON v.id=c.variant_id WHERE v.artwork_id=${w.id} ORDER BY c.number`;
  const listings =
    await sql`SELECT l.id,l.edition_copy_id,l.price_mode,CASE WHEN l.price_mode='FIXED_PRICE' THEN l.price_minor::float8 ELSE NULL END AS price_minor,l.currency,l.status,l.market_type FROM listings l JOIN edition_variants v ON v.id=l.edition_variant_id WHERE v.artwork_id=${w.id} AND l.status='PUBLISHED'`;
  const media =
    await sql`SELECT id,alt_text FROM artwork_media WHERE artwork_id=${w.id} ORDER BY sort_order`;
  return {
    id: w.id,
    slug: w.slug,
    title: w.title,
    description: w.description,
    captureYear: w.capture_year,
    artist: w.artist_name,
    artistSlug: w.artist_slug,
    series: w.series_title,
    seriesSlug: w.series_slug,
    visibility: w.visibility,
    editorialStatus: w.editorial_status,
    authenticityStatus: w.authenticity_status,
    variants,
    copies,
    listings,
    media,
  };
}

export async function reviewArtistProfile(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  staff(actor, "MODERATOR");
  const d = z
    .object({ approve: z.boolean(), reason: z.string().min(10).max(2000) })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const [a] =
      await tx`SELECT pending_profile FROM artists WHERE id=${id} FOR UPDATE`;
    requireThat(
      a?.pending_profile,
      409,
      "NOT_PENDING",
      "Нет изменений на рассмотрении",
    );
    if (d.approve) {
      const p = artistInput.parse(a.pending_profile);
      await tx`UPDATE artists SET name=${p.name},biography=${p.biography},statement=${p.statement},city=${p.city},pending_profile=NULL WHERE id=${id}`;
    } else await tx`UPDATE artists SET pending_profile=NULL WHERE id=${id}`;
    await audit(tx, actor.id, "Artist", id, "ARTIST_PROFILE_REVIEWED", {
      approved: d.approve,
      reason: d.reason,
    });
    return { id };
  });
}
