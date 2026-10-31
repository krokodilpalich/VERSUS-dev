import Link from "next/link";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getActor, staff, DomainError, hasRole } from "@/modules/auth/policy";
import { sql } from "@/modules/db";
import { ActionForm, type Field } from "@/components/forms";
import { Empty, Money, date } from "@/components/catalog";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Управление",
  robots: { index: false, follow: false },
};
const sections: [string, string, string[]][] = [
  ["", "Сводка", ["MODERATOR", "EDITOR", "OPERATIONS", "CURATOR"]],
  ["artworks", "Модерация", ["MODERATOR"]],
  ["verification", "Верификация", ["OPERATIONS"]],
  ["organizations", "Организации", ["OPERATIONS"]],
  ["listings", "Предложения", ["OPERATIONS"]],
  ["inquiries", "Запросы", ["OPERATIONS"]],
  ["deals", "Офлайн-сделки", ["OPERATIONS"]],
  ["open-calls", "Open calls", ["EDITOR", "OPERATIONS"]],
  ["applications", "Заявки", ["OPERATIONS", "CURATOR"]],
  ["editorial", "Редакция и страницы", ["EDITOR"]],
  ["events", "События", ["EDITOR"]],
  ["collections", "Подборки", ["CURATOR"]],
  ["invitations", "Private Circle", []],
  ["users", "Пользователи", []],
  ["commission-policies", "Комиссии", ["OPERATIONS"]],
  ["audit", "Аудит", []],
  ["settings", "Настройки", []],
];
export default async function Admin({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const actor = await getActor(await headers());
  if (!actor) redirect("/sign-in");
  const key = (await params).section?.[0] ?? "";
  const info = sections.find((s) => s[0] === key);
  if (!info) notFound();
  try {
    staff(actor, ...info[2]);
  } catch (e) {
    if (e instanceof DomainError)
      return (
        <div className="panel">
          <h1>Доступ ограничен</h1>
          <p>{e.message}</p>
          <Link href="/dashboard/settings">Настройки двухфакторной защиты</Link>
        </div>
      );
    throw e;
  }
  let body: React.ReactNode;
  if (key === "") {
    const [counts] =
      await sql`SELECT (SELECT count(*)::int FROM artworks WHERE editorial_status='SUBMITTED') AS moderation,(SELECT count(*)::int FROM inquiries WHERE status='NEW') AS inquiries,(SELECT count(*)::int FROM deals WHERE status='OFFLINE_COMPLETION_PENDING_VERIFICATION') AS deals`;
    body = (
      <>
        <h1>Управление VERSUS</h1>
        <div className="grid">
          <div className="panel">
            <h3>{counts.moderation}</h3>
            <p>работ ожидают модерации</p>
          </div>
          <div className="panel">
            <h3>{counts.inquiries}</h3>
            <p>новых запросов</p>
          </div>
          <div className="panel">
            <h3>{counts.deals}</h3>
            <p>офлайн-подтверждений</p>
          </div>
        </div>
        <p>
          Метрики отражают записи БД. Ни один запрос или резерв не считается
          оплатой.
        </p>
      </>
    );
  } else if (key === "artworks") {
    const rows =
      await sql`SELECT w.*,a.name AS artist_name,(SELECT id FROM artwork_media WHERE artwork_id=w.id LIMIT 1) AS media_id FROM artworks w JOIN artists a ON a.id=w.artist_id ORDER BY w.updated_at DESC LIMIT 100`;
    const revisions =
      await sql`SELECT id,title,pending_revision FROM series WHERE pending_revision IS NOT NULL`;
    const edits =
      await sql`SELECT subject_id,details,at FROM audit_events WHERE action='ARTWORK_EDITED' ORDER BY at DESC LIMIT 100`;
    const profiles =
      await sql`SELECT id,name,pending_profile FROM artists WHERE pending_profile IS NOT NULL`;
    body = (
      <>
        {profiles.map((a) => (
          <section className="panel" key={a.id}>
            <h3>Изменения профиля: {a.name}</h3>
            <p>{a.pending_profile.name}</p>
            <p>{a.pending_profile.biography}</p>
            <ActionForm
              endpoint={`/api/v1/admin/artists/${a.id}/review`}
              fields={[
                {
                  name: "approve",
                  label: "Одобрить изменения",
                  type: "checkbox",
                },
                {
                  name: "reason",
                  label: "Обоснование решения",
                  required: true,
                },
              ]}
              label="Рассмотреть профиль"
            />
          </section>
        ))}
        {revisions.map((s) => (
          <section className="panel" key={s.id}>
            <h3>Серия: {s.title}</h3>
            <p>Новая редакция: {s.pending_revision.title}</p>
            <p>{s.pending_revision.statement}</p>
            <ActionForm
              endpoint={`/api/v1/admin/series/${s.id}/review`}
              fields={[
                {
                  name: "approve",
                  label: "Одобрить редакцию серии",
                  type: "checkbox",
                },
                {
                  name: "reason",
                  label: "Основание решения по серии",
                  required: true,
                },
              ]}
              label="Рассмотреть серию"
            />
          </section>
        ))}
        <h1>Модерация работ</h1>
        <p>
          Одобрение публикации не подтверждает подлинность и не заменяет
          экспертизу.
        </p>
        {rows.map((w) => (
          <section key={w.id} className="record">
            <h3>{w.title}</h3>
            <p>
              {w.artist_name} · {w.editorial_status} · версия {w.version}
            </p>
            <p>{w.description}</p>
            {edits
              .filter((e) => e.subject_id === w.id)
              .slice(0, 3)
              .map((e, i) => (
                <details key={i}>
                  <summary>Изменения версии {e.details.version ?? ""}</summary>
                  <p>
                    Было: {e.details.before?.title} —{" "}
                    {e.details.before?.description}
                  </p>
                  <p>
                    Стало: {e.details.after?.title} —{" "}
                    {e.details.after?.description}
                  </p>
                </details>
              ))}
            {w.media_id && (
              <img
                src={`/api/media/${w.media_id}?size=small`}
                alt={w.title}
                width="200"
              />
            )}
            {w.editorial_status === "SUBMITTED" && (
              <ActionForm
                endpoint={`/api/v1/admin/artworks/${w.id}/moderate`}
                fields={[
                  {
                    name: "decision",
                    label: "Решение",
                    type: "select",
                    options: [
                      { value: "APPROVE", label: "Одобрить и опубликовать" },
                      { value: "NEEDS_CHANGES", label: "Запросить изменения" },
                      { value: "REJECT", label: "Отклонить" },
                    ],
                  },
                  {
                    name: "reason",
                    label: "Обоснование решения",
                    type: "textarea",
                    required: true,
                  },
                ]}
                label="Зафиксировать решение"
              />
            )}
          </section>
        ))}
      </>
    );
  } else if (key === "inquiries") {
    const { myInquiries } = await import("@/modules/commerce/service");
    const rows = await myInquiries(actor);
    body = (
      <>
        <h1>Запросы</h1>
        {rows.map((r) => (
          <Link
            href={`/dashboard/inquiries/${r.id}`}
            key={r.id}
            className="row-item"
          >
            <h3>{r.title}</h3>
            <span>{r.status} ↗</span>
          </Link>
        ))}
      </>
    );
  } else if (key === "deals") {
    const rows =
      await sql`SELECT id,status,amount_minor,commission_snapshot,created_at FROM deals ORDER BY created_at DESC LIMIT 100`;
    body = (
      <>
        <h1>Офлайн-сделки</h1>
        {rows.map((d) => (
          <section className="record" key={d.id}>
            <h3>
              <Money minor={d.amount_minor} />
            </h3>
            <p>
              {d.status} · {date(d.created_at)}
            </p>
            <p>
              Комиссия: <Money minor={d.commission_snapshot.feeMinor} /> · v
              {d.commission_snapshot.version}
              {d.commission_snapshot.isDemo ? " · DEMO" : ""}
            </p>
            {d.status === "OFFLINE_COMPLETION_PENDING_VERIFICATION" && (
              <ActionForm
                endpoint={`/api/v1/admin/deals/${d.id}/confirm-offline`}
                fields={[
                  {
                    name: "evidence",
                    label:
                      "Основание подтверждения / ID проверенного закрытого документа",
                    type: "textarea",
                    required: true,
                  },
                ]}
                label="Подтвердить офлайн-завершение"
              />
            )}
          </section>
        ))}
      </>
    );
  } else if (key === "open-calls") {
    const rows = await sql`SELECT * FROM open_calls ORDER BY deadline_at DESC`;
    const fields: Field[] = [
      { name: "title", label: "Название", required: true },
      { name: "organizerName", label: "Организатор", required: true },
      {
        name: "sourceType",
        label: "Тип источника",
        type: "select",
        options: [
          { value: "VERSUS_HOSTED", label: "Внутренний конкурс" },
          { value: "EXTERNAL", label: "Внешний конкурс" },
        ],
      },
      {
        name: "sourceUrl",
        label: "Источник HTTPS (для внешнего)",
        nullable: true,
      },
      {
        name: "description",
        label: "Описание",
        type: "textarea",
        required: true,
      },
      {
        name: "requirements",
        label: "Правила и требования",
        type: "textarea",
        required: true,
      },
      { name: "eligibility", label: "Допуск участников", type: "textarea" },
      {
        name: "startsAt",
        label: "Открытие (ваше локальное время)",
        type: "datetime-local",
        required: true,
      },
      {
        name: "deadlineAt",
        label: "Дедлайн (ваше локальное время)",
        type: "datetime-local",
        required: true,
      },
      {
        name: "timezone",
        label: "Зона отображения IANA",
        value: "Europe/Moscow",
        required: true,
      },
      {
        name: "maxWorks",
        label: "Максимум работ",
        type: "number",
        value: 10,
        min: 1,
        max: 20,
      },
      {
        name: "feeMinor",
        label: "Взнос, копейки (0 — бесплатно)",
        type: "number",
        value: 0,
        min: 0,
      },
      { name: "isDemo", label: "Демонстрационный конкурс", type: "checkbox" },
    ];
    body = (
      <>
        <h1>Open calls</h1>
        {rows.map((c) => (
          <Link className="row-item" key={c.id} href={`/open-calls/${c.slug}`}>
            <h3>{c.title}</h3>
            <span>{date(c.deadline_at, c.timezone)} ↗</span>
          </Link>
        ))}
        {rows.map((c) => (
          <details className="record" key={c.id}>
            <summary>Редактировать: {c.title}</summary>
            <ActionForm
              endpoint={`/api/v1/admin/open-calls/${c.id}`}
              fields={[
                {
                  name: "title",
                  label: "Название конкурса",
                  value: c.title,
                  required: true,
                },
                {
                  name: "description",
                  label: "Описание конкурса",
                  type: "textarea",
                  value: c.description,
                  required: true,
                },
                {
                  name: "requirements",
                  label: "Условия конкурса",
                  type: "textarea",
                  value: c.requirements,
                  required: true,
                },
                {
                  name: "deadlineAt",
                  label: "Новый дедлайн (ваше локальное время)",
                  type: "datetime-local",
                  value: new Date(c.deadline_at).toISOString(),
                  required: true,
                },
                {
                  name: "sourceUrl",
                  label: "Источник внешнего конкурса",
                  nullable: true,
                  value: c.source_url ?? "",
                },
                {
                  name: "status",
                  label: "Публикация",
                  type: "select",
                  value: c.status,
                  options: [
                    { value: "PUBLISHED", label: "Опубликован" },
                    { value: "ARCHIVED", label: "В архиве" },
                  ],
                },
                {
                  name: "reason",
                  label: "Основание изменения условий",
                  required: true,
                },
              ]}
              label="Сохранить условия конкурса"
            />
          </details>
        ))}
        <h2>Создать конкурс</h2>
        <ActionForm
          endpoint="/api/v1/admin/open-calls"
          fields={fields}
          label="Опубликовать конкурс"
        />
      </>
    );
  } else if (key === "applications") {
    const rows =
      await sql`SELECT a.id,a.status,a.receipt,a.statement,c.title FROM applications a JOIN open_calls c ON c.id=a.open_call_id ORDER BY submitted_at DESC LIMIT 100`;
    const next: Record<string, string[]> = {
      SUBMITTED: ["ELIGIBILITY_REVIEW"],
      ELIGIBILITY_REVIEW: ["UNDER_REVIEW", "NOT_SELECTED"],
      UNDER_REVIEW: ["SHORTLISTED", "NOT_SELECTED"],
      SHORTLISTED: ["WINNER", "CLOSED"],
      WINNER: ["CLOSED"],
      NOT_SELECTED: ["CLOSED"],
    };
    body = (
      <>
        <h1>Заявки на конкурсы</h1>
        {rows.map((a) => (
          <section className="record" key={a.id}>
            <h3>{a.title}</h3>
            <p className="break">
              {a.status} · Квитанция {a.receipt}
            </p>
            <p>{a.statement}</p>
            {next[a.status] && (
              <ActionForm
                endpoint={`/api/v1/admin/applications/${a.id}/review`}
                fields={[
                  {
                    name: "status",
                    label: "Следующий этап",
                    type: "select",
                    options: next[a.status].map((value) => ({
                      value,
                      label: value,
                    })),
                  },
                  {
                    name: "reason",
                    label: "Основание решения",
                    type: "textarea",
                    required: true,
                  },
                ]}
                label="Изменить статус"
              />
            )}
          </section>
        ))}
      </>
    );
  } else if (key === "collections") {
    const rows =
      await sql`SELECT id,title,visibility FROM curated_collections ORDER BY created_at DESC`;
    const works =
      await sql`SELECT id,title,visibility FROM artworks WHERE editorial_status='PUBLISHED'`;
    body = (
      <>
        <h1>Кураторские подборки</h1>
        {rows.map((r) => (
          <div className="record" key={r.id}>
            <h3>{r.title}</h3>
            <p>{r.visibility}</p>
          </div>
        ))}
        <ActionForm
          endpoint="/api/v1/admin/collections"
          fields={[
            { name: "title", label: "Название", required: true },
            {
              name: "description",
              label: "Описание",
              type: "textarea",
              required: true,
            },
            {
              name: "visibility",
              label: "Доступ",
              type: "select",
              options: [
                { value: "INVITED_ONLY", label: "Только Private Circle" },
                { value: "PUBLIC", label: "Публичная" },
              ],
            },
            {
              name: "workIds",
              label: "Работы",
              type: "multi",
              required: true,
              options: works.map((w) => ({
                value: w.id,
                label: `${w.title} (${w.visibility})`,
              })),
            },
          ]}
          label="Создать подборку"
        />
      </>
    );
  } else if (key === "invitations") {
    const members =
      await sql`SELECT u.id,u.name,m.status FROM private_memberships m JOIN "user" u ON u.id=m.user_id ORDER BY m.updated_at DESC`;
    body = (
      <>
        <h1>Private Circle</h1>
        <h2>Адресное приглашение</h2>
        <ActionForm
          endpoint="/api/v1/admin/invitations"
          defaults={{ expiresInDays: 7 }}
          fields={[
            {
              name: "email",
              label: "Email приглашённого",
              type: "email",
              required: true,
            },
          ]}
          label="Пригласить через локальный email"
        />
        {members.map((m) => (
          <section className="record" key={m.id}>
            <h3>{m.name}</h3>
            <p>{m.status}</p>
            {m.status === "APPROVED" && (
              <ActionForm
                endpoint="/api/v1/admin/memberships/revoke"
                defaults={{ userId: m.id }}
                fields={[
                  {
                    name: "reason",
                    label: "Причина отзыва",
                    type: "textarea",
                    required: true,
                  },
                ]}
                label="Отозвать доступ"
              />
            )}
          </section>
        ))}
      </>
    );
  } else if (key === "editorial" || key === "events") {
    const rows =
      key === "events"
        ? await sql`SELECT * FROM content WHERE type='EVENT' ORDER BY updated_at DESC`
        : await sql`SELECT * FROM content ORDER BY updated_at DESC`;
    const fields = (row?: (typeof rows)[number]): Field[] => [
      {
        name: "type",
        label: "Тип",
        type: "select",
        value: row?.type ?? (key === "events" ? "EVENT" : "ARTICLE"),
        options: [
          "ARTICLE",
          "PAGE",
          "EVENT",
          "AUCTION",
          "ARCHIVE",
          "FAQ",
          "ANNOUNCEMENT",
        ].map((value) => ({ value, label: value })),
      },
      { name: "title", label: "Заголовок", required: true, value: row?.title },
      {
        name: "slug",
        label: "URL-имя (латиница, / и дефис)",
        required: true,
        value: row?.slug,
      },
      { name: "seoTitle", label: "SEO заголовок", value: row?.seo_title ?? "" },
      {
        name: "seoDescription",
        label: "SEO описание",
        type: "textarea",
        value: row?.seo_description ?? "",
      },
      {
        name: "excerpt",
        label: "Краткое описание",
        type: "textarea",
        value: row?.excerpt,
      },
      {
        name: "body",
        label: "Текст (HTML выводится безопасным текстом)",
        type: "textarea",
        required: true,
        value: row?.body,
      },
      {
        name: "visibility",
        label: "Доступ",
        type: "select",
        value: row?.visibility ?? "PUBLIC",
        options: [
          { value: "PUBLIC", label: "Публичный" },
          { value: "INVITED_ONLY", label: "Private Circle" },
        ],
      },
      {
        name: "status",
        label: "Статус",
        type: "select",
        value: row?.status ?? "DRAFT",
        options: [
          { value: "DRAFT", label: "Черновик" },
          { value: "PUBLISHED", label: "Опубликован" },
          { value: "ARCHIVED", label: "В архиве" },
        ],
      },
      {
        name: "sourceUrl",
        label: "Официальный источник HTTPS",
        nullable: true,
        value: row?.source_url ?? "",
      },
      {
        name: "eventAt",
        value: row?.event_at ? new Date(row.event_at).toISOString() : "",
        label: "Дата события (ваше локальное время)",
        type: "datetime-local",
        nullable: true,
      },
      {
        name: "eventAddress",
        label: "Адрес (закрытый при private-доступе)",
        nullable: true,
        value: row?.event_address ?? "",
      },
      {
        name: "capacity",
        label: "Вместимость",
        type: "number",
        nullable: true,
        value: row?.capacity ?? "",
      },
      {
        name: "priority",
        label: "Приоритет на главной",
        type: "number",
        value: row?.priority ?? 0,
        min: 0,
        max: 1000,
      },
    ];
    body = (
      <>
        <h1>{key === "events" ? "События" : "Редакция"}</h1>
        <details>
          <summary>Создать материал</summary>
          <ActionForm
            endpoint="/api/v1/admin/editorial"
            fields={fields()}
            label="Сохранить материал"
          />
        </details>
        {rows.map((r) => (
          <details key={r.id} className="record">
            <summary>
              {r.title} · {r.status} · {r.type}
            </summary>
            <ActionForm
              endpoint={`/api/v1/admin/editorial/${r.id}`}
              fields={fields(r)}
              label="Сохранить изменения"
            />
          </details>
        ))}
      </>
    );
  } else if (key === "users") {
    const users =
      await sql`SELECT id,name,email,two_factor_enabled FROM "user" ORDER BY created_at DESC LIMIT 100`;
    body = (
      <>
        <h1>Пользователи</h1>
        {users.map((u) => (
          <section className="record" key={u.id}>
            <h3>{u.name}</h3>
            <p>
              {u.email} · MFA{" "}
              {u.two_factor_enabled ? "включена" : "не включена"}
            </p>
            <ActionForm
              endpoint="/api/v1/admin/roles"
              defaults={{ userId: u.id }}
              fields={[
                {
                  name: "role",
                  label: "Назначить роль",
                  type: "select",
                  options: [
                    "ARTIST",
                    "COLLECTOR",
                    "MODERATOR",
                    "EDITOR",
                    "CURATOR",
                    "OPERATIONS",
                    "ADMIN",
                  ].map((value) => ({ value, label: value })),
                },
                { name: "reason", label: "Обоснование", required: true },
              ]}
              label="Назначить и отозвать прежние сессии"
            />
          </section>
        ))}
      </>
    );
  } else if (key === "verification") {
    const rows =
      await sql`SELECT id,subject_type,status,created_at FROM verification_requests ORDER BY created_at DESC`;
    body = (
      <>
        <h1>Заявки на верификацию</h1>
        {rows.map((r) => (
          <section className="record" key={r.id}>
            <h3>{r.subject_type}</h3>
            <p>{r.status}</p>
            {r.status === "SUBMITTED" && (
              <ActionForm
                endpoint={`/api/v1/admin/verification/${r.id}`}
                fields={[
                  {
                    name: "decision",
                    label: "Решение",
                    type: "select",
                    options: [
                      { value: "APPROVED", label: "Подтверждено" },
                      { value: "REJECTED", label: "Отклонено" },
                    ],
                  },
                  {
                    name: "reason",
                    label: "Закрытое основание решения",
                    required: true,
                    type: "textarea",
                  },
                ]}
                label="Зафиксировать"
              />
            )}
          </section>
        ))}
      </>
    );
  } else if (key === "organizations") {
    const rows =
      await sql`SELECT id,name,type,verification_status FROM organizations ORDER BY name`;
    const artists = await sql`SELECT id,name FROM artists ORDER BY name`;
    body = (
      <>
        <h1>Организации</h1>
        {rows.map((r) => (
          <div className="record" key={r.id}>
            <h3>{r.name}</h3>
            <p>
              {r.type} · {r.verification_status}
            </p>
          </div>
        ))}
        <h2>Проверенное представительство</h2>
        <p>
          Фиксируйте только вручную проверенные полномочия. Конфликт
          эксклюзивных мандатов блокирует предложения.
        </p>
        <ActionForm
          endpoint="/api/v1/admin/mandates"
          defaults={{ artworkId: null }}
          fields={[
            {
              name: "artistId",
              label: "Автор",
              type: "select",
              options: artists.map((a) => ({ value: a.id, label: a.name })),
            },
            {
              name: "organizationId",
              label: "Организация",
              type: "select",
              options: rows.map((o) => ({ value: o.id, label: o.name })),
            },
            {
              name: "exclusive",
              label: "Эксклюзивное представительство",
              type: "checkbox",
            },
            {
              name: "startsAt",
              label: "Начало полномочий",
              type: "datetime-local",
              required: true,
            },
            {
              name: "endsAt",
              label: "Окончание полномочий",
              type: "datetime-local",
              required: true,
            },
            {
              name: "evidence",
              label: "Основание проверенных прав / ID документа",
              type: "textarea",
              required: true,
            },
          ]}
          label="Зафиксировать мандат"
        />
      </>
    );
  } else if (key === "listings") {
    const rows =
      await sql`SELECT l.id,l.price_mode,l.price_minor,l.status,l.rights_evidence,w.title FROM listings l JOIN edition_variants v ON v.id=l.edition_variant_id JOIN artworks w ON w.id=v.artwork_id ORDER BY l.created_at DESC LIMIT 100`;
    body = (
      <>
        <h1>Предложения</h1>
        {rows.map((l) => (
          <div className="record" key={l.id}>
            <h3>{l.title}</h3>
            <p>
              {l.status} ·{" "}
              {l.price_mode === "FIXED_PRICE" ? (
                <Money minor={l.price_minor} />
              ) : (
                l.price_mode
              )}
            </p>
            <p>Основание: {l.rights_evidence}</p>
          </div>
        ))}
      </>
    );
  } else if (key === "commission-policies") {
    const rows =
      await sql`SELECT * FROM commission_policies ORDER BY created_at DESC`;
    body = (
      <>
        <h1>Версии комиссий</h1>
        <p>
          История не редактируется. Новая политика действует на новые оферты;
          существующие снимки сохраняются.
        </p>
        {rows.map((p) => (
          <div className="record" key={p.id}>
            <h3>
              {p.name} / v{p.version}
            </h3>
            <p>
              {p.basis_points / 100}% · {p.status}
              {p.is_demo ? " · DEMO" : ""}
            </p>
          </div>
        ))}
        {hasRole(actor, "ADMIN", "SUPERADMIN") && (
          <ActionForm
            endpoint="/api/v1/admin/commission-policies"
            fields={[
              { name: "name", label: "Название политики", required: true },
              {
                name: "version",
                label: "Версия",
                type: "number",
                min: 1,
                required: true,
              },
              {
                name: "basisPoints",
                label: "Ставка в basis points (100 = 1%)",
                type: "number",
                min: 0,
                max: 10000,
                required: true,
              },
              {
                name: "isDemo",
                label: "Только демонстрационная политика",
                type: "checkbox",
              },
            ]}
            label="Создать неизменяемую версию"
          />
        )}
      </>
    );
  } else if (key === "audit") {
    const rows =
      await sql`SELECT id,action,subject_type,subject_id,at FROM audit_events ORDER BY at DESC LIMIT 100`;
    body = (
      <>
        <h1>Аудит</h1>
        <a download href="/api/v1/admin/export" className="button">
          Скачать сводку CSV без персональных данных
        </a>
        <p>
          Последние 100 событий. Сводка не включает персональные сведения и
          содержимое переписки.
        </p>
        {rows.map((r) => (
          <div className="record" key={r.id}>
            <span className="badge">{r.action}</span>
            <p className="break">
              {r.subject_type} · {r.subject_id}
            </p>
            <small>{date(r.at)}</small>
          </div>
        ))}
      </>
    );
  } else
    body = (
      <>
        <h1>Настройки запуска</h1>
        <p>
          Реальные платежи, checkout и внутренние ставки отключены. Email
          направляется только в локальный Mailpit. Production-интеграции требуют
          отдельной реализации и утверждения.
        </p>
      </>
    );
  return (
    <div className="workspace">
      <aside className="sidebar">
        <span className="eyebrow">Управление</span>
        <nav aria-label="Управление">
          {sections
            .filter((s) => hasRole(actor, ...s[2], "ADMIN", "SUPERADMIN"))
            .map(([url, label]) => (
              <Link
                key={url}
                href={`/admin${url ? "/" + url : ""}`}
                aria-current={key === url ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
        </nav>
      </aside>
      <div>{body ?? <Empty>Нет записей.</Empty>}</div>
    </div>
  );
}
