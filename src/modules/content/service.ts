import { z } from "zod";
import { sql, audit } from "../db";
import {
  staff,
  signed,
  requireThat,
  slug,
  hasRole,
  type Actor,
} from "../auth/policy";
import { idSchema, memberAccess, visibleArtwork } from "../catalog/service";
export const contentInput = z
  .object({
    type: z.enum([
      "ARTICLE",
      "PAGE",
      "EVENT",
      "AUCTION",
      "ARCHIVE",
      "FAQ",
      "ANNOUNCEMENT",
    ]),
    title: z.string().min(3).max(250),
    slug: z
      .string()
      .regex(/^[a-z0-9/-]+$/)
      .min(2)
      .max(150),
    body: z.string().min(20).max(50000),
    excerpt: z.string().max(500),
    seoTitle: z.string().max(200).default(""),
    seoDescription: z.string().max(500).default(""),
    visibility: z.enum(["PUBLIC", "INVITED_ONLY"]),
    status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
    sourceUrl: z.url().nullable(),
    eventAt: z.iso.datetime({ offset: true }).nullable(),
    eventAddress: z.string().max(1000).nullable(),
    capacity: z.number().int().positive().max(10000).nullable(),
    priority: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export async function saveContent(
  actor: Actor | null,
  input: unknown,
  id?: string,
) {
  staff(actor, "EDITOR");
  const d = contentInput.parse(input);
  if (d.sourceUrl)
    requireThat(
      d.sourceUrl.startsWith("https://"),
      422,
      "HTTPS_REQUIRED",
      "Источник должен использовать HTTPS",
    );
  if (d.type === "AUCTION")
    requireThat(
      d.sourceUrl?.startsWith("https://"),
      422,
      "SOURCE_REQUIRED",
      "Внешний аукцион требует HTTPS-ссылку на организатора",
    );
  return sql.begin(async (tx) => {
    const [row] = id
      ? await tx`UPDATE content SET type=${d.type},slug=${d.slug},seo_title=${d.seoTitle},seo_description=${d.seoDescription},title=${d.title},body=${d.body},excerpt=${d.excerpt},visibility=${d.visibility},status=${d.status},source_url=${d.sourceUrl},event_at=${d.eventAt},event_address=${d.eventAddress},capacity=${d.capacity},priority=${d.priority},updated_by=${actor.id},updated_at=now() WHERE id=${id} RETURNING id`
      : await tx`INSERT INTO content(type,title,slug,body,excerpt,seo_title,seo_description,visibility,status,source_url,event_at,event_address,capacity,priority,updated_by) VALUES(${d.type},${d.title},${d.slug},${d.body},${d.excerpt},${d.seoTitle},${d.seoDescription},${d.visibility},${d.status},${d.sourceUrl},${d.eventAt},${d.eventAddress},${d.capacity},${d.priority},${actor.id}) RETURNING id`;
    requireThat(row, 404, "NOT_FOUND", "Материал не найден");
    await audit(tx, actor.id, "Content", row.id, "CONTENT_SAVED");
    return row;
  });
}
export async function rsvp(actor: Actor | null, id: string) {
  signed(actor);
  return sql.begin(async (tx) => {
    const [e] =
      await tx`SELECT * FROM content WHERE id=${id} AND type='EVENT' AND status='PUBLISHED' FOR UPDATE`;
    requireThat(
      e && (e.visibility === "PUBLIC" || (await memberAccess(actor, tx))),
      404,
      "NOT_FOUND",
      "Событие не найдено",
    );
    requireThat(
      e.event_at && new Date(e.event_at) > new Date(),
      409,
      "EVENT_CLOSED",
      "Событие уже завершилось",
    );
    const [row] =
      await tx`INSERT INTO event_rsvps(event_id,user_id) VALUES(${id},${actor.id}) ON CONFLICT(event_id,user_id) DO UPDATE SET user_id=excluded.user_id RETURNING id,status`;
    await audit(tx, actor.id, "RSVP", row.id, "RSVP_REQUESTED");
    return row;
  });
}
export async function saveFavorite(actor: Actor | null, input: unknown) {
  signed(actor);
  const d = z
    .object({
      subjectId: idSchema,
      subjectType: z.enum(["ARTWORK", "OPEN_CALL"]),
      saved: z.boolean(),
    })
    .strict()
    .parse(input);
  if (d.subjectType === "ARTWORK") await visibleArtwork(d.subjectId, actor);
  else {
    const [c] =
      await sql`SELECT id FROM open_calls WHERE id=${d.subjectId} AND status='PUBLISHED'`;
    requireThat(c, 404, "NOT_FOUND", "Конкурс не найден");
  }
  if (d.saved)
    await sql`INSERT INTO saved_items(user_id,subject_type,subject_id) VALUES(${actor.id},${d.subjectType},${d.subjectId}) ON CONFLICT DO NOTHING`;
  else
    await sql`DELETE FROM saved_items WHERE user_id=${actor.id} AND subject_type=${d.subjectType} AND subject_id=${d.subjectId}`;
  return { saved: d.saved };
}
export async function onboard(actor: Actor | null, input: unknown) {
  signed(actor);
  const d = z
    .object({
      roles: z
        .array(
          z.enum([
            "ARTIST",
            "COLLECTOR",
            "AGENT",
            "GALLERY_MEMBER",
            "ADVISER",
            "INSTITUTION_MEMBER",
          ]),
        )
        .min(1)
        .max(6),
      displayName: z.string().min(2).max(150),
    })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    for (const role of d.roles)
      await tx`INSERT INTO user_roles(user_id,role) VALUES(${actor.id},${role}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO profiles(user_id,public_display_name) VALUES(${actor.id},${d.displayName}) ON CONFLICT(user_id) DO UPDATE SET public_display_name=excluded.public_display_name`;
    await audit(tx, actor.id, "User", actor.id, "ROLES_SELECTED", {
      roles: d.roles,
    });
    return { roles: d.roles };
  });
}
export async function savePrivacy(actor: Actor | null, input: unknown) {
  signed(actor);
  const d = z
    .object({
      visibility: z.enum(["PUBLIC", "OWNER_AND_STAFF"]),
      collectionVisibility: z.literal("OWNER_AND_STAFF"),
      contactAccess: z.enum(["PRIVATE", "REQUEST_ONLY"]),
    })
    .strict()
    .parse(input);
  await sql`INSERT INTO profiles(user_id,visibility,collection_visibility,contact_access) VALUES(${actor.id},${d.visibility},${d.collectionVisibility},${d.contactAccess}) ON CONFLICT(user_id) DO UPDATE SET visibility=excluded.visibility,collection_visibility=excluded.collection_visibility,contact_access=excluded.contact_access`;
  return { saved: true };
}
export async function createOrganization(actor: Actor | null, input: unknown) {
  signed(actor);
  const d = z
    .object({
      name: z.string().min(3).max(200),
      type: z.enum(["GALLERY", "AGENCY", "MUSEUM", "FOUNDATION"]),
      description: z.string().min(20).max(5000),
    })
    .strict()
    .parse(input);
  requireThat(
    hasRole(actor, "GALLERY_MEMBER", "INSTITUTION_MEMBER", "AGENT"),
    403,
    "ROLE_REQUIRED",
    "Выберите профессиональную роль",
  );
  return sql.begin(async (tx) => {
    const [o] =
      await tx`INSERT INTO organizations(name,slug,type,description) VALUES(${d.name},${slug(d.name)},${d.type},${d.description}) RETURNING id`;
    await tx`INSERT INTO organization_members(organization_id,user_id,role) VALUES(${o.id},${actor.id},'OWNER')`;
    await tx`INSERT INTO verification_requests(subject_type,subject_id,requested_by) VALUES('Organization',${o.id},${actor.id})`;
    await audit(tx, actor.id, "Organization", o.id, "VERIFICATION_SUBMITTED");
    return o;
  });
}
export async function reviewVerification(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  staff(actor, "OPERATIONS");
  const d = z
    .object({
      decision: z.enum(["APPROVED", "REJECTED"]),
      reason: z.string().min(10).max(2000),
    })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const [r] =
      await tx`SELECT * FROM verification_requests WHERE id=${id} FOR UPDATE`;
    requireThat(
      r && r.status === "SUBMITTED",
      409,
      "STATE_CONFLICT",
      "Заявка уже рассмотрена",
    );
    await tx`UPDATE verification_requests SET status=${d.decision},reviewed_by=${actor.id},notes_private=${d.reason},reviewed_at=now() WHERE id=${id}`;
    if (r.subject_type === "Organization")
      await tx`UPDATE organizations SET verification_status=${d.decision} WHERE id=${r.subject_id}`;
    await audit(tx, actor.id, "Verification", id, "VERIFICATION_REVIEWED", {
      decision: d.decision,
    });
    return { id };
  });
}
export async function assignRole(actor: Actor | null, input: unknown) {
  staff(actor);
  const d = z
    .object({
      userId: z.string().min(1).max(100),
      role: z.enum([
        "MODERATOR",
        "CURATOR",
        "EDITOR",
        "OPERATIONS",
        "ADMIN",
        "ARTIST",
        "COLLECTOR",
      ]),
      reason: z.string().min(10).max(2000),
    })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const [u] =
      await tx`SELECT two_factor_enabled FROM "user" WHERE id=${d.userId}`;
    requireThat(u, 404, "NOT_FOUND", "Пользователь не найден");
    if (
      ["MODERATOR", "CURATOR", "EDITOR", "OPERATIONS", "ADMIN"].includes(d.role)
    )
      requireThat(
        u.two_factor_enabled,
        409,
        "MFA_REQUIRED",
        "Сотрудник сначала должен включить 2FA",
      );
    await tx`INSERT INTO user_roles(user_id,role,assigned_by) VALUES(${d.userId},${d.role},${actor.id}) ON CONFLICT DO NOTHING`;
    await tx`DELETE FROM session WHERE user_id=${d.userId}`;
    await audit(tx, actor.id, "User", d.userId, "ROLE_ASSIGNED", {
      role: d.role,
      reason: d.reason,
    });
    return { saved: true };
  });
}
