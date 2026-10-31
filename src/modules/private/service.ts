import { z } from "zod";
import { symmetricEncrypt } from "better-auth/crypto";
import { env } from "../config/env";
import { randomBytes, createHash } from "node:crypto";
import { sql, audit, notify } from "../db";
import {
  signed,
  staff,
  requireThat,
  type Actor,
  slug,
  isStaff,
  hasRole,
} from "../auth/policy";
import { memberAccess, idSchema } from "../catalog/service";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function invitePrivateMember(actor: Actor | null, input: unknown) {
  staff(actor);
  const d = z
    .object({
      email: z.email().transform((x) => x.toLowerCase()),
      expiresInDays: z.number().int().min(1).max(30).default(7),
    })
    .strict()
    .parse(input);
  const token = randomBytes(32).toString("base64url");
  const encryptedToken = await symmetricEncrypt({
    key: env().SESSION_SECRET,
    data: token,
  });
  return sql.begin(async (tx) => {
    const [row] =
      await tx`INSERT INTO private_invites(email,token_hash,expires_at,invited_by) VALUES(${d.email},${digest(token)},now()+${d.expiresInDays}*interval '1 day',${actor.id}) RETURNING id`;
    // Delivery payload is encrypted and scrubbed after SMTP acceptance. Invite lookup stores only the hash.
    await tx`INSERT INTO outbox_events(type,payload) VALUES('PrivateInvite',${tx.json({ email: d.email, encryptedToken })})`;
    await audit(
      tx,
      actor.id,
      "PrivateInvite",
      row.id,
      "PRIVATE_INVITE_CREATED",
    );
    return { id: row.id, delivery: "QUEUED_LOCAL_EMAIL" };
  });
}
export async function verifyPrivateInvite(actor: Actor | null, input: unknown) {
  signed(actor);
  const d = z
    .object({ token: z.string().min(20).max(200) })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const [i] =
      await tx`SELECT * FROM private_invites WHERE token_hash=${digest(d.token)} FOR UPDATE`;
    requireThat(
      i &&
        !i.used_at &&
        !i.revoked_at &&
        new Date(i.expires_at) > new Date() &&
        i.email === actor.email.toLowerCase(),
      404,
      "INVITE_INVALID",
      "Приглашение недействительно для этого аккаунта",
    );
    await tx`UPDATE private_invites SET used_at=now() WHERE id=${i.id}`;
    await tx`INSERT INTO private_memberships(user_id,status,approved_by) VALUES(${actor.id},'APPROVED',${i.invited_by}) ON CONFLICT(user_id) DO UPDATE SET status='APPROVED',approved_by=excluded.approved_by,updated_at=now()`;
    await audit(
      tx,
      actor.id,
      "PrivateMembership",
      actor.id,
      "PRIVATE_INVITE_ACCEPTED",
    );
    await notify(
      tx,
      actor.id,
      "InviteAccepted",
      "Доступ к Private Circle открыт",
    );
    return { status: "APPROVED" };
  });
}
export async function revokeMember(actor: Actor | null, input: unknown) {
  staff(actor);
  const d = z
    .object({
      userId: z.string().min(1).max(100),
      reason: z.string().min(10).max(2000),
    })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const [user] = await tx`SELECT email FROM "user" WHERE id=${d.userId}`;
    requireThat(user, 404, "NOT_FOUND", "Пользователь не найден");
    await tx`INSERT INTO private_memberships(user_id,status,approved_by) VALUES(${d.userId},'REVOKED',${actor.id}) ON CONFLICT(user_id) DO UPDATE SET status='REVOKED',updated_at=now()`;
    await tx`UPDATE private_invites SET revoked_at=now() WHERE email=${user.email} AND revoked_at IS NULL`;
    await audit(
      tx,
      actor.id,
      "PrivateMembership",
      d.userId,
      "PRIVATE_ACCESS_REVOKED",
      { reason: d.reason },
    );
    return { status: "REVOKED" };
  });
}
export async function createCollection(actor: Actor | null, input: unknown) {
  staff(actor, "CURATOR");
  const d = z
    .object({
      title: z.string().min(3).max(200),
      description: z.string().min(20).max(5000),
      visibility: z.enum(["PUBLIC", "INVITED_ONLY"]),
      workIds: z.array(idSchema).min(1).max(50),
    })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const works =
      await tx`SELECT id,visibility FROM artworks WHERE id IN ${tx(d.workIds)} AND editorial_status='PUBLISHED'`;
    requireThat(
      works.length === new Set(d.workIds).size,
      422,
      "UNPUBLISHED_WORK",
      "В подборку можно добавить только опубликованные работы",
    );
    requireThat(
      d.visibility !== "PUBLIC" ||
        works.every((w) => w.visibility === "PUBLIC"),
      422,
      "PRIVATE_WORK",
      "Приватную работу нельзя поместить в публичную подборку",
    );
    const [c] =
      await tx`INSERT INTO curated_collections(title,slug,description,visibility,curator_id) VALUES(${d.title},${slug(d.title)},${d.description},${d.visibility},${actor.id}) RETURNING id`;
    for (const [n, id] of d.workIds.entries())
      await tx`INSERT INTO curated_collection_items(collection_id,artwork_id,sort_order) VALUES(${c.id},${id},${n})`;
    await audit(tx, actor.id, "Collection", c.id, "COLLECTION_CREATED");
    return c;
  });
}
export async function privateCollections(actor: Actor | null, id?: string) {
  signed(actor);
  requireThat(
    (await memberAccess(actor)) ||
      (isStaff(actor) && hasRole(actor, "CURATOR", "ADMIN", "SUPERADMIN")),
    404,
    "NOT_FOUND",
    "Раздел недоступен",
  );
  const rows = id
    ? await sql`SELECT id,title,description FROM curated_collections WHERE id=${id} AND visibility='INVITED_ONLY' AND status='PUBLISHED'`
    : await sql`SELECT id,title,description FROM curated_collections WHERE visibility='INVITED_ONLY' AND status='PUBLISHED'`;
  if (id) {
    requireThat(rows.length, 404, "NOT_FOUND", "Подборка не найдена");
    const works =
      await sql`SELECT w.id,w.title,w.slug,a.name AS artist_name,(SELECT id FROM artwork_media WHERE artwork_id=w.id ORDER BY sort_order LIMIT 1) AS media_id FROM curated_collection_items i JOIN artworks w ON w.id=i.artwork_id JOIN artists a ON a.id=w.artist_id WHERE i.collection_id=${id} AND w.editorial_status='PUBLISHED' AND w.visibility IN ('PUBLIC','INVITED_ONLY') ORDER BY i.sort_order`;
    await sql.begin((tx) =>
      audit(tx, actor.id, "Collection", id, "PRIVATE_COLLECTION_VIEWED"),
    );
    return {
      id: rows[0].id as string,
      title: rows[0].title as string,
      description: rows[0].description as string,
      works,
    };
  }
  return rows;
}
