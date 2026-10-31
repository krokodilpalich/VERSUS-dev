import Link from "next/link";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getActor } from "@/modules/auth/policy";
import { sql } from "@/modules/db";
import { myInquiries, inquiryDetail } from "@/modules/commerce/service";
import { applications } from "@/modules/calls/service";
import { ActionForm, MfaSetup, type Field } from "@/components/forms";
import { Empty, Money, date } from "@/components/catalog";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Личный кабинет",
  robots: { index: false, follow: false },
};
export default async function Dashboard({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const actor = await getActor(await headers());
  if (!actor) redirect("/sign-in");
  const section = (await params).section ?? [],
    key = section[0] ?? "home";
  const menu = [
    ["", "Сводка"],
    ["profile", "Профиль автора"],
    ["portfolio", "Портфолио"],
    ["listings", "Предложения"],
    ["inquiries", "Запросы"],
    ["applications", "Заявки"],
    ["favorites", "Избранное"],
    ["organizations", "Организации"],
    ["privacy", "Приватность"],
    ["settings", "Настройки"],
  ];
  let body: React.ReactNode;
  if (key === "home") {
    const notes =
      await sql`SELECT type,message,read_at,created_at FROM notifications WHERE recipient_id=${actor.id} ORDER BY created_at DESC LIMIT 20`;
    body = (
      <>
        <h1>Здравствуйте, {actor.name}</h1>
        <p>
          Ваши роли: {actor.roles.join(", ") || "ещё не выбраны"}.{" "}
          <Link href="/onboarding">Изменить роли</Link>
        </p>
        <div className="panel">
          <h3>Следующий шаг</h3>
          <p>
            Фотографу — заполнить профиль и первую серию. Покупателю —
            исследовать каталог и уточнить условия произведения.
          </p>
          <Link href="/dashboard/portfolio" className="link-arrow">
            Открыть портфолио
          </Link>
        </div>
        <h2>Уведомления</h2>
        {notes.map((n, i) => (
          <div key={i} className="record">
            <p>{n.message}</p>
            <small>{date(n.created_at)}</small>
          </div>
        ))}
        {!notes.length && <Empty>Новых уведомлений нет.</Empty>}
        {!!notes.length && (
          <ActionForm
            endpoint="/api/v1/notifications/read"
            label="Отметить прочитанными"
          />
        )}
      </>
    );
  } else if (key === "profile") {
    const [a] = await sql`SELECT * FROM artists WHERE user_id=${actor.id}`;
    body = (
      <>
        <h1>Профиль автора</h1>
        <p>
          Биография и statement публикуются вместе с одобренными работами. Имя
          аккаунта коллекционера публично не выводится.
        </p>
        <ActionForm
          endpoint="/api/v1/artists"
          fields={[
            {
              name: "name",
              label: "Имя автора / псевдоним",
              required: true,
              value: a?.name ?? actor.name,
            },
            { name: "city", label: "Город", value: a?.city ?? "" },
            {
              name: "biography",
              label: "Биография",
              type: "textarea",
              value: a?.biography ?? "",
            },
            {
              name: "statement",
              label: "Авторский statement",
              type: "textarea",
              value: a?.statement ?? "",
            },
          ]}
        />
      </>
    );
  } else if (key === "portfolio" || key === "series" || key === "artworks") {
    const works =
      await sql`SELECT w.* FROM artworks w JOIN artists a ON a.id=w.artist_id WHERE a.user_id=${actor.id} ORDER BY w.created_at DESC`;
    const series =
      await sql`SELECT s.* FROM series s JOIN artists a ON a.id=s.artist_id WHERE a.user_id=${actor.id} ORDER BY s.created_at DESC`;
    if (key === "series" && section[1] && section[1] !== "new") {
      const item = series.find((s) => s.id === section[1]);
      if (!item) notFound();
      body = (
        <>
          <h1>Редактирование серии</h1>
          <p>Изменения опубликованной серии проходят модерацию.</p>
          <ActionForm
            endpoint={`/api/v1/series/${item.id}/edit`}
            fields={[
              {
                name: "title",
                label: "Название серии",
                required: true,
                value: item.title,
              },
              {
                name: "statement",
                label: "Описание серии",
                type: "textarea",
                required: true,
                value: item.statement,
              },
              {
                name: "yearStart",
                label: "Год начала",
                type: "number",
                required: true,
                value: item.year_start,
              },
            ]}
            label="Сохранить изменения серии"
          />
        </>
      );
    } else if (key === "artworks" && section[1] && section[1] !== "new") {
      const w = works.find((w) => w.id === section[1]);
      if (!w) notFound();
      body = (
        <>
          <h1>{w.title}</h1>
          <p>Статус: {w.editorial_status}</p>
          {["DRAFT", "NEEDS_CHANGES", "REJECTED"].includes(
            w.editorial_status,
          ) && (
            <>
              <ActionForm
                endpoint={`/api/v1/artworks/${w.id}/edit`}
                defaults={{ version: w.version }}
                fields={[
                  {
                    name: "title",
                    label: "Название",
                    value: w.title,
                    required: true,
                  },
                  {
                    name: "description",
                    label: "Описание",
                    type: "textarea",
                    value: w.description,
                    required: true,
                  },
                ]}
              />
              <details>
                <summary>Добавить вариант отпечатка / AP</summary>
                <ActionForm
                  endpoint={`/api/v1/artworks/${w.id}/variants`}
                  fields={[
                    {
                      name: "technique",
                      label: "Техника варианта",
                      required: true,
                      value: "Пигментная печать",
                    },
                    {
                      name: "paper",
                      label: "Бумага варианта",
                      required: true,
                      value: "Хлопковая бумага",
                    },
                    {
                      name: "width",
                      label: "Ширина изображения, мм",
                      type: "number",
                      value: 400,
                      min: 10,
                      max: 10000,
                      required: true,
                    },
                    {
                      name: "height",
                      label: "Высота изображения, мм",
                      type: "number",
                      value: 600,
                      min: 10,
                      max: 10000,
                      required: true,
                    },
                    {
                      name: "sheetWidth",
                      label: "Ширина листа, мм",
                      type: "number",
                      value: 450,
                      min: 10,
                      max: 10000,
                      required: true,
                    },
                    {
                      name: "sheetHeight",
                      label: "Высота листа, мм",
                      type: "number",
                      value: 650,
                      min: 10,
                      max: 10000,
                      required: true,
                    },
                    {
                      name: "editionType",
                      label: "Тип нового тиража",
                      type: "select",
                      options: [
                        { value: "LIMITED", label: "Лимитированный" },
                        { value: "OPEN", label: "Открытый" },
                      ],
                    },
                    {
                      name: "editionTotal",
                      label: "Новый тираж (очистить для OPEN)",
                      type: "number",
                      value: 5,
                      nullable: true,
                      min: 1,
                      max: 1000,
                    },
                    {
                      name: "apTotal",
                      label: "AP (для OPEN — 0)",
                      type: "number",
                      value: 0,
                      min: 0,
                      max: 100,
                      required: true,
                    },
                    {
                      name: "printYear",
                      label: "Год печати варианта",
                      type: "number",
                      value: 2026,
                      min: 1800,
                      max: 2200,
                      required: true,
                    },
                    {
                      name: "signed",
                      label: "Подпись на варианте",
                      type: "checkbox",
                    },
                    {
                      name: "condition",
                      label: "Состояние экземпляров",
                      type: "select",
                      options: [
                        { value: "NEW", label: "Новые" },
                        { value: "EXCELLENT", label: "Прекрасное" },
                        { value: "GOOD", label: "Хорошее" },
                        { value: "FAIR", label: "Требует уточнения" },
                      ],
                    },
                  ]}
                  label="Создать вариант и экземпляры"
                />
              </details>
              <h2>Изображения</h2>
              <ActionForm
                endpoint={`/api/v1/artworks/${w.id}/media`}
                fields={[
                  {
                    name: "file",
                    label: "Изображение JPEG / PNG / WebP (до 15 МБ)",
                    type: "file",
                    required: true,
                  },
                  {
                    name: "alt",
                    label: "Описание для доступности",
                    required: true,
                  },
                  {
                    name: "rightsHolder",
                    label: "Правообладатель",
                    required: true,
                  },
                ]}
                label="Загрузить изображение"
              />
              <ActionForm
                endpoint={`/api/v1/artworks/${w.id}/submit`}
                label="Отправить на модерацию"
                redirect="/dashboard/portfolio"
              />
            </>
          )}
          {w.editorial_status === "PUBLISHED" && (
            <details>
              <summary>Отправить работу на повторную редакцию</summary>
              <p>
                Публичная карточка и предложения будут скрыты до повторного
                одобрения. При активном резерве или продаже исправления проводит
                сотрудник отдельной процедурой.
              </p>
              <ActionForm
                endpoint={`/api/v1/artworks/${w.id}/revise`}
                fields={[
                  {
                    name: "reason",
                    label: "Причина повторной редакции",
                    required: true,
                  },
                ]}
                label="Вернуть в черновик"
              />
            </details>
          )}
          <Link href="/dashboard/portfolio">Вернуться к портфолио</Link>
        </>
      );
    } else {
      const fields: Field[] = [
        { name: "title", label: "Название работы", required: true },
        {
          name: "seriesId",
          label: "Серия",
          type: "select",
          required: true,
          options: series.map((s) => ({ value: s.id, label: s.title })),
        },
        {
          name: "captureYear",
          label: "Год съёмки",
          type: "number",
          value: 2026,
          min: 1800,
          max: 2200,
          required: true,
        },
        {
          name: "printYear",
          label: "Год печати",
          type: "number",
          value: 2026,
          min: 1800,
          max: 2200,
          required: true,
        },
        {
          name: "description",
          label: "Контекст и описание (от 20 символов)",
          type: "textarea",
          required: true,
        },
        { name: "genre", label: "Тема / жанр", required: true },
        {
          name: "colorMode",
          label: "Цвет",
          type: "select",
          options: [
            { value: "BW", label: "Чёрно-белая" },
            { value: "COLOR", label: "Цветная" },
          ],
        },
        {
          name: "visibility",
          label: "Видимость после одобрения",
          type: "select",
          options: [
            { value: "PUBLIC", label: "Публичная" },
            { value: "INVITED_ONLY", label: "Только Private Circle" },
            { value: "UNLISTED", label: "Только по ссылке" },
          ],
        },
        {
          name: "technique",
          label: "Техника печати",
          value: "Пигментная печать",
          required: true,
        },
        {
          name: "paper",
          label: "Бумага",
          value: "Хлопковая бумага",
          required: true,
        },
        {
          name: "width",
          label: "Ширина изображения и листа, мм",
          type: "number",
          value: 400,
          min: 10,
          max: 10000,
          required: true,
        },
        {
          name: "height",
          label: "Высота изображения и листа, мм",
          type: "number",
          value: 600,
          min: 10,
          max: 10000,
          required: true,
        },
        {
          name: "editionType",
          label: "Тип тиража",
          type: "select",
          options: [
            { value: "LIMITED", label: "Лимитированный" },
            { value: "OPEN", label: "Открытый" },
          ],
        },
        {
          name: "editionTotal",
          label: "Размер тиража (очистите для OPEN)",
          type: "number",
          value: 5,
          nullable: true,
          min: 1,
          max: 1000,
        },
        { name: "signed", label: "Отпечаток подписан", type: "checkbox" },
        {
          name: "rightsAccepted",
          label: "Я обладаю правами и разрешаю публикацию изображения",
          type: "checkbox",
          required: true,
        },
      ];
      body = (
        <>
          <h1>Портфолио</h1>
          <h2>Серии</h2>
          {series.map((item) => (
            <Link
              className="row-item"
              href={`/dashboard/series/${item.id}/edit`}
              key={item.id}
            >
              <h3>{item.title}</h3>
              <span>Редактировать ↗</span>
            </Link>
          ))}
          <h2>Работы</h2>
          {works.map((w) => (
            <Link
              className="row-item"
              href={`/dashboard/artworks/${w.id}/edit`}
              key={w.id}
            >
              <div>
                <h3>{w.title}</h3>
                <span className="badge">{w.editorial_status}</span>
              </div>
              <span>Редактировать ↗</span>
            </Link>
          ))}
          {!works.length && (
            <Empty>Создайте профиль автора, затем серию и первую работу.</Empty>
          )}
          <section>
            <h2>Новая серия</h2>
            <ActionForm
              endpoint="/api/v1/series"
              fields={[
                { name: "title", label: "Название серии", required: true },
                {
                  name: "statement",
                  label: "Описание серии",
                  type: "textarea",
                  required: true,
                },
                {
                  name: "yearStart",
                  label: "Год начала",
                  type: "number",
                  value: 2026,
                  min: 1800,
                  max: 2200,
                },
              ]}
              label="Создать серию"
            />
          </section>
          <section>
            <h2>Новая работа</h2>
            {series.length ? (
              <ActionForm
                endpoint="/api/v1/artworks"
                fields={fields}
                label="Создать черновик"
                redirect="/dashboard/portfolio"
              />
            ) : (
              <p>Сначала создайте серию.</p>
            )}
          </section>
        </>
      );
    }
  } else if (key === "listings") {
    const copies =
      await sql`SELECT c.id,c.number,c.proof_type,c.status,w.title,v.edition_total,v.image_width_mm,v.image_height_mm FROM edition_copies c JOIN edition_variants v ON v.id=c.variant_id JOIN artworks w ON w.id=v.artwork_id JOIN artists a ON a.id=w.artist_id WHERE (a.user_id=${actor.id} OR EXISTS(SELECT 1 FROM representation_mandates m JOIN organization_members om ON om.organization_id=m.organization_id WHERE m.artist_id=w.artist_id AND (m.artwork_id IS NULL OR m.artwork_id=w.id) AND m.status='APPROVED' AND m.starts_at<=now() AND m.ends_at>now() AND om.user_id=${actor.id} AND om.invitation_status='ACCEPTED')) AND w.editorial_status='PUBLISHED' AND c.status='AVAILABLE'`;
    const organizations =
      await sql`SELECT o.id,o.name FROM organizations o JOIN organization_members m ON m.organization_id=o.id WHERE m.user_id=${actor.id} AND m.invitation_status='ACCEPTED'`;
    const listings =
      await sql`SELECT l.id,l.price_mode,l.price_minor,l.status,w.title FROM listings l JOIN edition_variants v ON v.id=l.edition_variant_id JOIN artworks w ON w.id=v.artwork_id WHERE l.seller_id=${actor.id}`;
    body = (
      <>
        <h1>Предложения и экземпляры</h1>
        {listings.map((l) => (
          <div className="record" key={l.id}>
            <h3>{l.title}</h3>
            <p>
              {l.status} ·{" "}
              {l.price_mode === "FIXED_PRICE" ? (
                <Money minor={l.price_minor} />
              ) : l.price_mode === "NOT_FOR_SALE" ? (
                "Не продаётся"
              ) : (
                "Цена по запросу"
              )}
            </p>
          </div>
        ))}
        <h2>Опубликовать предложение</h2>
        <p>
          Без одобрения работы предложение не публикуется. При действующем
          эксклюзивном мандате необходимо действовать через представителя.
        </p>
        {copies.length ? (
          <ActionForm
            endpoint="/api/v1/listings"
            fields={[
              {
                name: "representativeOrgId",
                label: "Представляющая организация",
                type: "select",
                nullable: true,
                options: [
                  { value: "", label: "Автор самостоятельно" },
                  ...organizations.map((o) => ({ value: o.id, label: o.name })),
                ],
              },
              {
                name: "copyId",
                label: "Физический экземпляр",
                type: "select",
                options: copies.map((c) => ({
                  value: c.id,
                  label: `${c.title} — ${c.proof_type === "AP" ? "AP " : ""}${c.number ?? "OPEN"}/${c.edition_total ?? "OPEN"}, ${c.image_width_mm}×${c.image_height_mm} мм`,
                })),
              },
              {
                name: "priceMode",
                label: "Тип цены",
                type: "select",
                options: [
                  { value: "FIXED_PRICE", label: "Фиксированная" },
                  { value: "PRICE_ON_REQUEST", label: "По запросу" },
                  { value: "NOT_FOR_SALE", label: "Не продаётся" },
                ],
              },
              {
                name: "priceMinor",
                label: "Цена в копейках (очистите для цены по запросу)",
                type: "number",
                nullable: true,
                min: 1,
                max: 9000000000000,
              },
              {
                name: "rightsEvidence",
                label: "Основание права размещения (от 20 символов)",
                type: "textarea",
                required: true,
              },
            ]}
            label="Опубликовать предложение"
          />
        ) : (
          <Empty>Нет доступных одобренных экземпляров.</Empty>
        )}
      </>
    );
  } else if (key === "inquiries") {
    if (section[1]) {
      let inquiry;
      try {
        inquiry = await inquiryDetail(actor, section[1]);
      } catch {
        notFound();
      }
      const policies =
        await sql`SELECT id,name,version FROM commission_policies WHERE status='ACTIVE'`;
      body = (
        <>
          <Link href="/dashboard/inquiries">← Запросы</Link>
          <h1>Переговоры</h1>
          <span className="badge">{inquiry.status}</span>
          <p>
            Сообщения доступны участникам и уполномоченному оператору. Контакты
            аккаунтов публично не раскрываются.
          </p>
          {inquiry.messages.map((m) => (
            <div className="panel" key={m.id}>
              <span className="eyebrow">
                {m.is_mine ? "Вы" : "Участник запроса"}
              </span>
              <p className="prose">{m.body}</p>
              <small>{date(m.created_at)}</small>
            </div>
          ))}
          <ActionForm
            endpoint={`/api/v1/inquiries/${inquiry.id}/messages`}
            fields={[
              {
                name: "message",
                label: "Сообщение",
                type: "textarea",
                required: true,
              },
            ]}
            label="Отправить сообщение"
          />
          {inquiry.canManage && (
            <details>
              <summary>Сформировать оферту</summary>
              <ActionForm
                endpoint={`/api/v1/inquiries/${inquiry.id}/offers`}
                fields={[
                  {
                    name: "amountMinor",
                    label: "Цена, копейки",
                    type: "number",
                    min: 1,
                    max: 9000000000000,
                    required: true,
                  },
                  {
                    name: "validUntil",
                    label: "Действует до (ваше локальное время)",
                    type: "datetime-local",
                    required: true,
                  },
                  {
                    name: "terms",
                    label: "Условия, доставка, документы и комиссии",
                    type: "textarea",
                    required: true,
                  },
                  {
                    name: "commissionPolicyId",
                    label: "Версия политики комиссии",
                    type: "select",
                    options: policies.map((p) => ({
                      value: p.id,
                      label: `${p.name} / v${p.version}`,
                    })),
                  },
                ]}
                label="Отправить оферту"
              />
            </details>
          )}
          {inquiry.offers.map((o) => (
            <section className="panel" key={o.id}>
              <h3>
                Оферта · <Money minor={o.amount_minor} />
              </h3>
              <p>{o.terms}</p>
              <p>
                До {date(o.valid_until)} · {o.status}
              </p>
              <p>
                Комиссия: <Money minor={o.commission_snapshot.feeMinor} /> (
                {o.commission_snapshot.basisPoints / 100}%,{" "}
                {o.commission_snapshot.policyName}, v
                {o.commission_snapshot.version})
                {o.commission_snapshot.isDemo ? " · DEMO" : ""}
              </p>
              {inquiry.isBuyer && o.status === "OFFERED" && (
                <ActionForm
                  endpoint={`/api/v1/offers/${o.id}/accept`}
                  label="Принять оферту и зарезервировать"
                  idempotent
                />
              )}
            </section>
          ))}
          {inquiry.deals.map((d) => (
            <section className="panel" key={d.id}>
              <h3>Офлайн-сделка</h3>
              <p>
                {d.status} · <Money minor={d.amount_minor} />
              </p>
              <p>
                Это офлайн-согласование. Банковская оплата в VERSUS не
                производится.
              </p>
              {inquiry.canManage && d.status === "OFFLINE_AGREED" && (
                <ActionForm
                  endpoint={`/api/v1/deals/${d.id}/request-completion`}
                  fields={[
                    {
                      name: "evidence",
                      label:
                        "Ссылка/идентификатор закрытого документа и основание завершения",
                      type: "textarea",
                      required: true,
                    },
                  ]}
                  label="Передать на проверку завершения"
                />
              )}
            </section>
          ))}
        </>
      );
    } else {
      const rows = await myInquiries(actor);
      body = (
        <>
          <h1>Ваши запросы</h1>
          {rows.map((r) => (
            <Link
              className="row-item"
              key={r.id}
              href={`/dashboard/inquiries/${r.id}`}
            >
              <div>
                <h3>{r.title}</h3>
                <span className="badge">{r.status}</span>
              </div>
              <span>{date(r.created_at)} ↗</span>
            </Link>
          ))}
          {!rows.length && (
            <Empty>
              Пока нет запросов. Откройте работу в каталоге и уточните условия.
            </Empty>
          )}
        </>
      );
    }
  } else if (key === "applications") {
    const rows = await applications(actor);
    const ownWorks =
      await sql`SELECT w.id,w.title FROM artworks w JOIN artists a ON a.id=w.artist_id WHERE a.user_id=${actor.id}`;
    body = (
      <>
        <h1>Заявки на open calls</h1>
        {rows.map((a) => (
          <section className="record" key={a.id}>
            <h3>{a.title}</h3>
            <p>{a.status}</p>
            <p className="break">Квитанция: {a.receipt}</p>
            {a.status === "SUBMITTED" &&
              new Date(a.deadline_at) > new Date() && (
                <details>
                  <summary>Редактировать до дедлайна</summary>
                  <ActionForm
                    endpoint={`/api/v1/applications/${a.id}/edit`}
                    defaults={{ rulesAccepted: true, dataConsent: true }}
                    fields={[
                      {
                        name: "statement",
                        label: "Обновлённое описание проекта",
                        type: "textarea",
                        required: true,
                        value: a.statement,
                      },
                      {
                        name: "workIds",
                        label: "Работы в заявке",
                        type: "multi",
                        selectedValues: a.work_ids,
                        required: true,
                        options: ownWorks.map((w) => ({
                          value: w.id,
                          label: w.title,
                        })),
                      },
                    ]}
                    label="Сохранить заявку"
                  />
                </details>
              )}
            {new Date(a.deadline_at) > new Date() &&
              a.status !== "WITHDRAWN" && (
                <ActionForm
                  endpoint={`/api/v1/applications/${a.id}/withdraw`}
                  label="Отозвать заявку"
                />
              )}
          </section>
        ))}
        {!rows.length && (
          <Empty>
            Заявок пока нет. <Link href="/open-calls">Найти open call</Link>
          </Empty>
        )}
      </>
    );
  } else if (key === "favorites") {
    const saved =
      await sql`SELECT subject_id,subject_type FROM saved_items WHERE user_id=${actor.id} ORDER BY created_at DESC`;
    const items: { id: string; type: string; url: string; title: string }[] =
      [];
    for (const s of saved) {
      if (s.subject_type === "ARTWORK") {
        const [w] =
          await sql`SELECT slug,title FROM artworks WHERE id=${s.subject_id} AND editorial_status='PUBLISHED' AND visibility='PUBLIC'`;
        if (w)
          items.push({
            title: w.title,
            id: s.subject_id,
            type: s.subject_type,
            url: `/works/${w.slug}`,
          });
      } else {
        const [c] =
          await sql`SELECT slug,title FROM open_calls WHERE id=${s.subject_id} AND status='PUBLISHED'`;
        if (c)
          items.push({
            title: c.title,
            id: s.subject_id,
            type: s.subject_type,
            url: `/open-calls/${c.slug}`,
          });
      }
    }
    body = (
      <>
        <h1>Избранное</h1>
        <p>Список доступен только вам.</p>
        {items.map((i) => (
          <section className="record" key={i.id}>
            <Link href={i.url}>
              <h3>{i.title}</h3>
            </Link>
            <ActionForm
              endpoint="/api/v1/favorites"
              defaults={{ subjectId: i.id, subjectType: i.type, saved: false }}
              label="Убрать из избранного"
            />
          </section>
        ))}
        {!items.length && <Empty>Сохранённых записей нет.</Empty>}
      </>
    );
  } else if (key === "organizations") {
    const orgs =
      await sql`SELECT o.name,o.verification_status,m.role FROM organizations o JOIN organization_members m ON m.organization_id=o.id WHERE m.user_id=${actor.id}`;
    body = (
      <>
        <h1>Организации</h1>
        {orgs.map((o, i) => (
          <div className="record" key={i}>
            <h3>{o.name}</h3>
            <p>
              {o.verification_status} · {o.role}
            </p>
          </div>
        ))}
        <h2>Создать и отправить на проверку</h2>
        <ActionForm
          endpoint="/api/v1/organizations"
          fields={[
            { name: "name", label: "Название", required: true },
            {
              name: "type",
              label: "Тип",
              type: "select",
              options: [
                { value: "GALLERY", label: "Галерея" },
                { value: "AGENCY", label: "Агентство" },
                { value: "MUSEUM", label: "Музей" },
                { value: "FOUNDATION", label: "Фонд" },
              ],
            },
            {
              name: "description",
              label: "Описание и основание верификации",
              type: "textarea",
              required: true,
            },
          ]}
        />
      </>
    );
  } else if (key === "privacy") {
    body = (
      <>
        <h1>Приватность</h1>
        <p>
          Владение, переписка и условия сделок всегда закрыты. Публичный профиль
          не открывает данные коллекции.
        </p>
        <ActionForm
          endpoint="/api/v1/privacy"
          defaults={{ collectionVisibility: "OWNER_AND_STAFF" }}
          fields={[
            {
              name: "visibility",
              label: "Профиль",
              type: "select",
              options: [
                {
                  value: "OWNER_AND_STAFF",
                  label: "Только я и уполномоченные сотрудники",
                },
                { value: "PUBLIC", label: "Публичное отображаемое имя" },
              ],
            },
            {
              name: "contactAccess",
              label: "Контакты",
              type: "select",
              options: [
                { value: "PRIVATE", label: "Закрыты" },
                { value: "REQUEST_ONLY", label: "Только через запрос VERSUS" },
              ],
            },
          ]}
        />
      </>
    );
  } else if (key === "settings")
    body = (
      <>
        <h1>Настройки аккаунта</h1>
        <MfaSetup />
        <Link href="/forgot-password">Сбросить пароль через email</Link>
      </>
    );
  else notFound();
  return (
    <div className="workspace">
      <aside className="sidebar">
        <span className="eyebrow">Личный кабинет</span>
        <nav aria-label="Кабинет">
          {menu.map(([url, label]) => (
            <Link
              aria-current={key === (url || "home") ? "page" : undefined}
              href={`/dashboard${url ? "/" + url : ""}`}
              key={url}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div>{body}</div>
    </div>
  );
}
