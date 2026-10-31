import { z } from "zod";
import { sql, audit, notify } from "../db";
import {
  signed,
  staff,
  requireThat,
  slug,
  isOperator,
  type Actor,
} from "../auth/policy";
import { idSchema, money } from "../catalog/service";
export const callInput = z
  .object({
    title: z.string().min(3).max(200),
    organizerName: z.string().min(2).max(200),
    sourceType: z.enum(["EXTERNAL", "VERSUS_HOSTED"]),
    sourceUrl: z.url().nullable(),
    description: z.string().min(20).max(10000),
    requirements: z.string().min(10).max(5000),
    eligibility: z.string().max(3000),
    startsAt: z.iso.datetime({ offset: true }),
    deadlineAt: z.iso.datetime({ offset: true }),
    timezone: z.string().min(3).max(100),
    maxWorks: z.number().int().min(1).max(20),
    feeMinor: money.or(z.literal(0)),
    isDemo: z.boolean().default(false),
  })
  .strict()
  .refine((d) => new Date(d.deadlineAt) > new Date(d.startsAt), {
    message: "Дедлайн должен быть позже открытия",
  })
  .refine((d) => d.sourceType !== "EXTERNAL" || !!d.sourceUrl, {
    message: "Укажите источник внешнего конкурса",
  });
export async function createCall(actor: Actor | null, input: unknown) {
  staff(actor, "EDITOR", "OPERATIONS");
  const d = callInput.parse(input);
  new Intl.DateTimeFormat("ru", { timeZone: d.timezone });
  if (d.sourceUrl)
    requireThat(
      new URL(d.sourceUrl).protocol === "https:",
      422,
      "HTTPS_REQUIRED",
      "Источник должен использовать HTTPS",
    );
  return sql.begin(async (tx) => {
    const [row] =
      await tx`INSERT INTO open_calls(title,slug,organizer_name,source_type,source_url,description,requirements,eligibility,starts_at,deadline_at,timezone,max_works,fee_minor,is_demo,last_checked_at) VALUES(${d.title},${slug(d.title)},${d.organizerName},${d.sourceType},${d.sourceUrl},${d.description},${d.requirements},${d.eligibility},${d.startsAt},${d.deadlineAt},${d.timezone},${d.maxWorks},${d.feeMinor},${d.isDemo},now()) RETURNING id,slug`;
    await audit(tx, actor.id, "OpenCall", row.id, "OPEN_CALL_CREATED");
    return row;
  });
}
export async function submitApplication(
  actor: Actor | null,
  callId: string,
  input: unknown,
) {
  signed(actor);
  const d = z
    .object({
      statement: z.string().min(30).max(10000),
      workIds: z.array(idSchema).min(1).max(20),
      rulesAccepted: z.literal(true),
      dataConsent: z.literal(true),
    })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const [c] =
      await tx`SELECT * FROM open_calls WHERE id=${callId} FOR UPDATE`;
    requireThat(
      c && c.status === "PUBLISHED",
      404,
      "NOT_FOUND",
      "Конкурс не найден",
    );
    requireThat(
      c.source_type === "VERSUS_HOSTED",
      409,
      "EXTERNAL_CALL",
      "Заявка подаётся на сайте организатора",
    );
    const [clock] = await tx`SELECT clock_timestamp() AS now`;
    requireThat(
      new Date(c.starts_at) <= new Date(clock.now) &&
        new Date(c.deadline_at) > new Date(clock.now),
      409,
      "DEADLINE",
      "Приём заявок закрыт",
    );
    requireThat(
      d.workIds.length <= c.max_works &&
        new Set(d.workIds).size === d.workIds.length,
      422,
      "WORK_LIMIT",
      "Неверное количество работ",
    );
    const [count] =
      await tx`SELECT count(*)::int AS count FROM applications WHERE open_call_id=${callId} AND applicant_id=${actor.id} AND status!='WITHDRAWN'`;
    requireThat(
      count.count < c.max_applications,
      409,
      "APPLICATION_LIMIT",
      "Лимит заявок исчерпан",
    );
    const works =
      await tx`SELECT w.id FROM artworks w JOIN artists a ON a.id=w.artist_id WHERE w.id IN ${tx(d.workIds)} AND a.user_id=${actor.id}`;
    requireThat(
      works.length === d.workIds.length,
      403,
      "NOT_OWNER",
      "Можно подать только свои работы",
    );
    const [row] =
      await tx`INSERT INTO applications(applicant_id,open_call_id,statement,work_ids,rules_accepted,data_consent) VALUES(${actor.id},${callId},${d.statement},${d.workIds},true,true) RETURNING id,receipt,status`;
    await audit(tx, actor.id, "Application", row.id, "APPLICATION_SUBMITTED");
    await notify(
      tx,
      actor.id,
      "ApplicationSubmitted",
      `Заявка принята. Квитанция ${row.receipt}`,
    );
    return row;
  });
}
export async function withdrawApplication(actor: Actor | null, id: string) {
  signed(actor);
  return sql.begin(async (tx) => {
    const [a] =
      await tx`SELECT a.*,c.deadline_at FROM applications a JOIN open_calls c ON c.id=a.open_call_id WHERE a.id=${id} AND a.applicant_id=${actor.id} FOR UPDATE OF a`;
    requireThat(a, 404, "NOT_FOUND", "Заявка не найдена");
    requireThat(
      new Date(a.deadline_at) > new Date() && a.status !== "WITHDRAWN",
      409,
      "DEADLINE",
      "Отозвать заявку нельзя",
    );
    await tx`UPDATE applications SET status='WITHDRAWN' WHERE id=${id}`;
    await audit(tx, actor.id, "Application", id, "APPLICATION_WITHDRAWN");
    return { id };
  });
}
export async function reviewApplication(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  staff(actor, "OPERATIONS", "CURATOR");
  const d = z
    .object({
      status: z.enum([
        "ELIGIBILITY_REVIEW",
        "UNDER_REVIEW",
        "SHORTLISTED",
        "NOT_SELECTED",
        "WINNER",
        "CLOSED",
      ]),
      reason: z.string().min(10).max(2000),
    })
    .strict()
    .parse(input);
  const graph: Record<string, string[]> = {
    SUBMITTED: ["ELIGIBILITY_REVIEW"],
    ELIGIBILITY_REVIEW: ["UNDER_REVIEW", "NOT_SELECTED"],
    UNDER_REVIEW: ["SHORTLISTED", "NOT_SELECTED"],
    SHORTLISTED: ["WINNER", "CLOSED"],
    WINNER: ["CLOSED"],
    NOT_SELECTED: ["CLOSED"],
  };
  return sql.begin(async (tx) => {
    const [a] = await tx`SELECT * FROM applications WHERE id=${id} FOR UPDATE`;
    requireThat(a, 404, "NOT_FOUND", "Заявка не найдена");
    requireThat(
      graph[a.status]?.includes(d.status),
      409,
      "STATE_CONFLICT",
      "Недопустимый переход",
    );
    await tx`UPDATE applications SET status=${d.status} WHERE id=${id}`;
    await audit(tx, actor.id, "Application", id, "APPLICATION_REVIEWED", {
      status: d.status,
      reason: d.reason,
    });
    await notify(
      tx,
      a.applicant_id,
      "ApplicationReviewed",
      `Статус заявки: ${d.status}`,
    );
    return { id };
  });
}
export async function applications(actor: Actor | null) {
  signed(actor);
  return sql`SELECT a.id,a.receipt,a.status,a.statement,a.work_ids,a.submitted_at,c.title,c.deadline_at FROM applications a JOIN open_calls c ON c.id=a.open_call_id WHERE a.applicant_id=${actor.id} OR ${isOperator(actor)} ORDER BY a.submitted_at DESC`;
}

export async function editApplication(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  signed(actor);
  const d = z
    .object({
      statement: z.string().min(30).max(10000),
      workIds: z.array(idSchema).min(1).max(20),
      rulesAccepted: z.literal(true),
      dataConsent: z.literal(true),
    })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const [a] =
      await tx`SELECT a.*,c.deadline_at,c.max_works FROM applications a JOIN open_calls c ON c.id=a.open_call_id WHERE a.id=${id} AND a.applicant_id=${actor.id} FOR UPDATE OF a,c`;
    requireThat(a, 404, "NOT_FOUND", "Заявка не найдена");
    requireThat(
      a.status === "SUBMITTED" && new Date(a.deadline_at) > new Date(),
      409,
      "APPLICATION_LOCKED",
      "Заявку можно изменить до дедлайна и начала рассмотрения",
    );
    requireThat(
      d.workIds.length <= a.max_works &&
        new Set(d.workIds).size === d.workIds.length,
      422,
      "WORK_LIMIT",
      "Неверное количество работ",
    );
    const works =
      await tx`SELECT w.id FROM artworks w JOIN artists ar ON ar.id=w.artist_id WHERE w.id IN ${tx(d.workIds)} AND ar.user_id=${actor.id}`;
    requireThat(
      works.length === d.workIds.length,
      403,
      "NOT_OWNER",
      "Можно подать только свои работы",
    );
    await tx`UPDATE applications SET statement=${d.statement},work_ids=${d.workIds} WHERE id=${id}`;
    await audit(tx, actor.id, "Application", id, "APPLICATION_EDITED", {
      receipt: a.receipt,
    });
    return { id, receipt: a.receipt };
  });
}

export async function editCall(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  staff(actor, "EDITOR", "OPERATIONS");
  const d = z
    .object({
      title: z.string().min(3).max(200),
      description: z.string().min(20).max(10000),
      requirements: z.string().min(10).max(5000),
      deadlineAt: z.iso.datetime({ offset: true }),
      status: z.enum(["PUBLISHED", "ARCHIVED"]),
      sourceUrl: z.url().nullable(),
      reason: z.string().min(10).max(2000),
    })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const [c] = await tx`SELECT * FROM open_calls WHERE id=${id} FOR UPDATE`;
    requireThat(c, 404, "NOT_FOUND", "Конкурс не найден");
    requireThat(
      new Date(d.deadlineAt) > new Date(c.starts_at),
      422,
      "INVALID_DEADLINE",
      "Дедлайн должен быть позже открытия",
    );
    requireThat(
      c.source_type !== "EXTERNAL" || d.sourceUrl?.startsWith("https://"),
      422,
      "SOURCE_REQUIRED",
      "Укажите HTTPS-источник внешнего конкурса",
    );
    requireThat(
      c.source_type !== "VERSUS_HOSTED" || d.sourceUrl === null,
      422,
      "SOURCE_TYPE",
      "Тип источника существующего конкурса не меняется",
    );
    await tx`UPDATE open_calls SET title=${d.title},description=${d.description},requirements=${d.requirements},deadline_at=${d.deadlineAt},source_url=${d.sourceUrl},status=${d.status},last_checked_at=now() WHERE id=${id}`;
    await audit(tx, actor.id, "OpenCall", id, "OPEN_CALL_EDITED", {
      beforeDeadline: new Date(c.deadline_at).toISOString(),
      afterDeadline: d.deadlineAt,
      status: d.status,
      reason: d.reason,
    });
    return { id };
  });
}
