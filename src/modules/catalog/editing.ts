import { z } from "zod";
import { sql, audit } from "../db";
import { signed, staff, requireThat, type Actor } from "../auth/policy";
import { ownedWork } from "./service";
const seriesInput = z
  .object({
    title: z.string().min(2).max(200),
    statement: z.string().min(10).max(5000),
    yearStart: z.number().int().min(1800).max(2200),
  })
  .strict();
export async function editSeries(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  signed(actor);
  const d = seriesInput.parse(input);
  return sql.begin(async (tx) => {
    const [s] =
      await tx`SELECT s.* FROM series s JOIN artists a ON a.id=s.artist_id WHERE s.id=${id} AND a.user_id=${actor.id} FOR UPDATE OF s`;
    requireThat(s, 404, "NOT_FOUND", "Серия не найдена");
    const [published] =
      await tx`SELECT id FROM artworks WHERE series_id=${id} AND editorial_status='PUBLISHED' LIMIT 1`;
    if (published)
      await tx`UPDATE series SET pending_revision=${tx.json(d)} WHERE id=${id}`;
    else
      await tx`UPDATE series SET title=${d.title},statement=${d.statement},year_start=${d.yearStart} WHERE id=${id}`;
    await audit(
      tx,
      actor.id,
      "Series",
      id,
      published ? "SERIES_REVISION_SUBMITTED" : "SERIES_EDITED",
      { before: { title: s.title, statement: s.statement }, after: d },
    );
    return { id, status: published ? "PENDING_REVIEW" : "SAVED" };
  });
}
export async function reviewSeries(
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
    const [s] = await tx`SELECT * FROM series WHERE id=${id} FOR UPDATE`;
    requireThat(
      s?.pending_revision,
      409,
      "NOT_PENDING",
      "Нет изменений на рассмотрении",
    );
    if (d.approve) {
      const p = seriesInput.parse(s.pending_revision);
      await tx`UPDATE series SET title=${p.title},statement=${p.statement},year_start=${p.yearStart},pending_revision=NULL WHERE id=${id}`;
    } else await tx`UPDATE series SET pending_revision=NULL WHERE id=${id}`;
    await audit(tx, actor.id, "Series", id, "SERIES_REVISION_REVIEWED", {
      approved: d.approve,
      reason: d.reason,
    });
    return { id };
  });
}
const variantInput = z
  .object({
    technique: z.string().min(2).max(150),
    paper: z.string().min(2).max(150),
    width: z.number().int().min(10).max(10000),
    height: z.number().int().min(10).max(10000),
    sheetWidth: z.number().int().min(10).max(10000),
    sheetHeight: z.number().int().min(10).max(10000),
    editionType: z.enum(["LIMITED", "OPEN"]),
    editionTotal: z.number().int().min(1).max(1000).nullable(),
    apTotal: z.number().int().min(0).max(100),
    printYear: z.number().int().min(1800).max(2200),
    signed: z.boolean(),
    condition: z.enum(["NEW", "EXCELLENT", "GOOD", "FAIR"]),
  })
  .strict()
  .refine((d) => d.sheetWidth >= d.width && d.sheetHeight >= d.height, {
    message: "Лист не может быть меньше изображения",
  })
  .refine(
    (d) =>
      d.editionType === "OPEN"
        ? d.editionTotal === null && d.apTotal === 0
        : d.editionTotal !== null,
    { message: "OPEN не имеет нумерации и AP; LIMITED требует тираж" },
  );
export async function createVariant(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  signed(actor);
  const d = variantInput.parse(input);
  return sql.begin(async (tx) => {
    const w = await ownedWork(tx, actor, id);
    requireThat(
      ["DRAFT", "NEEDS_CHANGES", "REJECTED"].includes(w.editorial_status),
      409,
      "STATE_CONFLICT",
      "Варианты добавляются в черновике до модерации",
    );
    const [count] =
      await tx`SELECT count(*)::int AS n FROM edition_variants WHERE artwork_id=${id}`;
    requireThat(count.n < 10, 422, "VARIANT_LIMIT", "Не более 10 вариантов");
    const [v] =
      await tx`INSERT INTO edition_variants(artwork_id,print_technique,paper,image_width_mm,image_height_mm,sheet_width_mm,sheet_height_mm,edition_type,edition_total,ap_total,signed) VALUES(${id},${d.technique},${d.paper},${d.width},${d.height},${d.sheetWidth},${d.sheetHeight},${d.editionType},${d.editionTotal},${d.apTotal},${d.signed}) RETURNING id`;
    for (let n = 1; n <= (d.editionTotal ?? 1); n++)
      await tx`INSERT INTO edition_copies(variant_id,number,print_year,condition) VALUES(${v.id},${d.editionType === "LIMITED" ? n : null},${d.printYear},${d.condition})`;
    for (let n = 1; n <= d.apTotal; n++)
      await tx`INSERT INTO edition_copies(variant_id,number,proof_type,print_year,condition) VALUES(${v.id},${n},'AP',${d.printYear},${d.condition})`;
    await audit(
      tx,
      actor.id,
      "EditionVariant",
      v.id,
      "EDITION_VARIANT_CREATED",
      { editionTotal: d.editionTotal, apTotal: d.apTotal },
    );
    return v;
  });
}
export async function reviseArtwork(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  signed(actor);
  const d = z
    .object({ reason: z.string().min(10).max(2000) })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const w = await ownedWork(tx, actor, id);
    requireThat(
      w.editorial_status === "PUBLISHED",
      409,
      "STATE_CONFLICT",
      "Работа не опубликована",
    );
    const copies =
      await tx`SELECT c.id,c.status FROM edition_copies c JOIN edition_variants v ON v.id=c.variant_id WHERE v.artwork_id=${id} FOR UPDATE OF c`;
    requireThat(
      copies.every((c) => c.status === "AVAILABLE"),
      409,
      "ACTIVE_HISTORY",
      "У работы есть резерв или проданный экземпляр. Исправления требуют отдельной процедуры сотрудника.",
    );
    await tx`UPDATE artworks SET editorial_status='DRAFT',version=version+1,updated_at=now() WHERE id=${id}`;
    await tx`UPDATE listings SET status='ON_HOLD' WHERE edition_variant_id IN(SELECT id FROM edition_variants WHERE artwork_id=${id}) AND status='PUBLISHED'`;
    await audit(tx, actor.id, "Artwork", id, "ARTWORK_REVISION_STARTED", {
      reason: d.reason,
    });
    return { id };
  });
}
