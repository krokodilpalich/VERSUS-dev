import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { sql } from "@/modules/db";
import { getActor, DomainError } from "@/modules/auth/policy";
import {
  publicCatalog,
  workDossier,
  memberAccess,
} from "@/modules/catalog/service";
import {
  WorkCard,
  Empty,
  Money,
  date,
  type WorkCardData,
} from "@/components/catalog";
import { ActionForm, AuthForm, type Field } from "@/components/forms";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
};
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const path = ((await params).path ?? []).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (path.length === 0) return {};
  if (
    [
      "sign-in",
      "sign-up",
      "verify-email",
      "forgot-password",
      "reset-password",
      "onboarding",
      "private",
    ].includes(path[0])
  )
    return { title: "Личный кабинет", robots: { index: false, follow: false } };
  if (path[0] === "works" && path[1]) {
    const [w] =
      await sql`SELECT title,description FROM artworks WHERE slug=${path[1]} AND editorial_status='PUBLISHED' AND visibility='PUBLIC'`;
    if (w)
      return {
        title: w.title,
        description: w.description.slice(0, 160),
        alternates: { canonical: `/works/${path[1]}` },
      };
    return {
      title: "Страница недоступна",
      robots: { index: false, follow: false },
    };
  }
  const contentSlug = ["journal", "events", "auctions"].includes(path[0])
    ? path[1]
    : path.join("/");
  if (contentSlug) {
    const [c] =
      await sql`SELECT title,seo_title,seo_description,excerpt FROM content WHERE slug=${contentSlug} AND visibility='PUBLIC' AND status='PUBLISHED'`;
    if (c)
      return {
        title: c.seo_title || c.title,
        description: c.seo_description || c.excerpt,
        alternates: { canonical: "/" + path.join("/") },
      };
  }
  const names: Record<string, string> = {
    works: "Произведения",
    artists: "Авторы",
    galleries: "Галереи",
    "open-calls": "Open calls",
    journal: "Журнал",
    events: "События",
    auctions: "Аукционы",
    about: "О платформе",
    discover: "Редакционный выбор",
  };
  return { title: names[path[0]] ?? "VERSUS" };
}
export default async function PublicPage({ params, searchParams }: Props) {
  const path = ((await params).path ?? []).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    }),
    query = await searchParams,
    key = path[0] ?? "",
    actor = await getActor(await headers());
  if (!key) {
    const works = await publicCatalog(new URLSearchParams());
    const [featured] =
      await sql`SELECT w.slug,w.title,a.name,(SELECT id FROM artwork_media WHERE artwork_id=w.id ORDER BY sort_order LIMIT 1) AS media_id FROM artworks w JOIN artists a ON a.id=w.artist_id WHERE w.editorial_status='PUBLISHED' AND w.visibility='PUBLIC' ORDER BY w.is_curated DESC,w.created_at DESC LIMIT 1`;
    const calls =
      await sql`SELECT title,slug,deadline_at,timezone,source_type FROM open_calls WHERE status='PUBLISHED' AND deadline_at>now() ORDER BY deadline_at LIMIT 3`;
    const articles =
      await sql`SELECT title,slug,excerpt FROM content WHERE type='ARTICLE' AND status='PUBLISHED' AND visibility='PUBLIC' ORDER BY priority DESC,created_at DESC LIMIT 2`;
    const [announcement] =
      await sql`SELECT title,body FROM content WHERE type='ANNOUNCEMENT' AND status='PUBLISHED' AND visibility='PUBLIC' ORDER BY priority DESC LIMIT 1`;
    return (
      <>
        <section className="hero">
          <div>
            <span className="eyebrow">Discover / Connect / Collect</span>
            <h1>
              Фотография.
              <br />
              Искусство видеть
              <br />и собирать.
            </h1>
            <p className="lead">
              VERSUS — единая точка входа в мир коллекционной фотографии.
              Открывайте авторов, знакомьтесь с галереями и находите
              произведения для своей коллекции.
            </p>
            <Link className="link-arrow" href="/works">
              Исследовать произведения
            </Link>
          </div>
          {featured && (
            <figure className="hero-figure">
              <Link href={`/works/${featured.slug}`}>
                {featured.media_id ? (
                  <img
                    src={`/api/media/${featured.media_id}`}
                    alt={featured.title}
                    fetchPriority="high"
                  />
                ) : (
                  <div className="placeholder-art">Произведение</div>
                )}
              </Link>
              <figcaption>
                <span>
                  {featured.name} · {featured.title}
                </span>
                <span>DEMO / VERSUS</span>
              </figcaption>
            </figure>
          )}
        </section>
        {announcement && (
          <aside className="panel">
            <span className="eyebrow">Объявление</span>
            <h3>{announcement.title}</h3>
            <p>{announcement.body}</p>
          </aside>
        )}
        <div className="section-head">
          <h2>Произведения для открытия</h2>
          <Link href="/works">Весь каталог ↗</Link>
        </div>
        <div className="grid">
          {(works.slice(0, 6) as unknown as WorkCardData[]).map((w) => (
            <WorkCard key={w.id} work={w} />
          ))}
        </div>
        {!works.length && (
          <Empty>
            Каталог ещё не опубликован. Авторы могут отправить первую работу
            через кабинет.
          </Empty>
        )}
        <div className="section-head">
          <h2>Возможности для авторов</h2>
          <Link href="/open-calls">Все open calls ↗</Link>
        </div>
        <div className="row-list">
          {calls.map((c) => (
            <Link
              className="row-item"
              key={c.slug}
              href={`/open-calls/${c.slug}`}
            >
              <div>
                <span className="eyebrow">
                  {c.source_type === "VERSUS_HOSTED"
                    ? "Заявка в VERSUS"
                    : "Внешний конкурс"}
                </span>
                <h3>{c.title}</h3>
              </div>
              <span className="muted">
                До {date(c.deadline_at, c.timezone)} ↗
              </span>
            </Link>
          ))}
        </div>
        <div className="section-head">
          <h2>Взгляд и контекст</h2>
          <Link href="/journal">Журнал ↗</Link>
        </div>
        {articles.map((a) => (
          <Link className="row-item" href={`/journal/${a.slug}`} key={a.slug}>
            <div>
              <h3>{a.title}</h3>
              <p className="muted">{a.excerpt}</p>
            </div>
            <span>↗</span>
          </Link>
        ))}
        <section className="panel">
          <span className="eyebrow">Private Circle</span>
          <h2>Искусство доверительного разговора</h2>
          <p>
            Закрытые подборки и частные просмотры для приглашённых участников.
            Ваши интересы, коллекции и переписка остаются конфиденциальными.
          </p>
          <Link href="/private" className="link-arrow">
            Войти по приглашению
          </Link>
        </section>
      </>
    );
  }
  if (
    [
      "sign-in",
      "sign-up",
      "forgot-password",
      "reset-password",
      "verify-email",
    ].includes(key)
  ) {
    const titles: Record<string, string> = {
      "sign-in": "Добро пожаловать",
      "sign-up": "Присоединиться к VERSUS",
      "forgot-password": "Восстановить доступ",
      "reset-password": "Новый пароль",
      "verify-email": "Подтвердите email",
    };
    return (
      <div className="narrow">
        <span className="eyebrow">Личное пространство</span>
        <h1>{titles[key]}</h1>
        {key === "verify-email" ? (
          <p>
            Перейдите по ссылке в письме. В локальной демонстрационной среде
            письма сохраняются в Mailpit.
          </p>
        ) : (
          <AuthForm mode={key} token={query.token} />
        )}
        <div className="auth-links">
          <Link href="/sign-in">Вход</Link>
          <Link href="/sign-up">Регистрация</Link>
          <Link href="/forgot-password">Забыли пароль?</Link>
        </div>
      </div>
    );
  }
  if (key === "onboarding") {
    if (!actor) redirect("/sign-in");
    return (
      <div className="narrow">
        <h1>Ваше место в VERSUS</h1>
        <p>
          Можно совмещать несколько ролей. Профессиональная верификация
          проводится отдельно.
        </p>
        <ActionForm
          endpoint="/api/v1/onboarding"
          redirect="/dashboard"
          fields={[
            {
              name: "displayName",
              label: "Отображаемое имя",
              value: actor.name,
              required: true,
            },
            {
              name: "roles",
              label: "Ваши роли (можно выбрать несколько)",
              type: "multi",
              required: true,
              options: [
                { value: "ARTIST", label: "Фотограф" },
                {
                  value: "COLLECTOR",
                  label: "Коллекционер / новый покупатель",
                },
                { value: "GALLERY_MEMBER", label: "Галерея" },
                { value: "AGENT", label: "Фотоагент" },
                { value: "ADVISER", label: "Арт-консультант" },
                { value: "INSTITUTION_MEMBER", label: "Музей / фонд" },
              ],
            },
          ]}
        />
      </div>
    );
  }
  if (key === "works" && path.length === 1) {
    const data = await publicCatalog(
        new URLSearchParams(
          Object.entries(query).filter(
            (v): v is [string, string] => v[1] !== undefined,
          ),
        ),
      ),
      page = Math.max(1, Number(query.page) || 1);
    const next = new URLSearchParams(
      Object.entries(query).filter(
        (v): v is [string, string] => v[1] !== undefined,
      ),
    );
    next.set("page", String(page + 1));
    return (
      <>
        <span className="eyebrow">Коллекционная фотография</span>
        <h1>Произведения</h1>
        <p className="lead">Точный взгляд. Собственный выбор.</p>
        <form className="filters" action="/works">
          <label>
            Поиск
            <input
              name="q"
              placeholder="Автор, название, серия"
              defaultValue={query.q}
            />
          </label>
          <label>
            Цвет
            <select name="color" defaultValue={query.color ?? ""}>
              <option value="">Любой</option>
              <option value="BW">Чёрно-белая</option>
              <option value="COLOR">Цветная</option>
            </select>
          </label>
          <label>
            Цена
            <select name="priceMode" defaultValue={query.priceMode ?? ""}>
              <option value="">Любая</option>
              <option value="FIXED_PRICE">Фиксированная</option>
              <option value="PRICE_ON_REQUEST">По запросу</option>
            </select>
          </label>
          <label>
            От, ₽
            <input type="number" name="min" min="0" defaultValue={query.min} />
          </label>
          <label>
            До, ₽
            <input type="number" name="max" min="0" defaultValue={query.max} />
          </label>
          <label>
            Порядок
            <select name="sort" defaultValue={query.sort ?? "new"}>
              <option value="new">Новые поступления</option>
              <option value="year">Год съёмки</option>
              <option value="curated">Выбор редакции</option>
              <option value="relevance">Релевантность</option>
              <option value="price-asc">Цена по возрастанию</option>
              <option value="price-desc">Цена по убыванию</option>
            </select>
          </label>
          <label>
            Год от
            <input
              name="yearMin"
              type="number"
              min="1800"
              max="2200"
              defaultValue={query.yearMin}
            />
          </label>
          <label>
            Год до
            <input
              name="yearMax"
              type="number"
              min="1800"
              max="2200"
              defaultValue={query.yearMax}
            />
          </label>
          <label>
            Техника
            <input name="technique" defaultValue={query.technique} />
          </label>
          <label>
            Галерея
            <input name="gallery" defaultValue={query.gallery} />
          </label>
          <label>
            Город автора
            <input name="city" defaultValue={query.city} />
          </label>
          <label>
            Ширина до, мм
            <input
              name="width"
              type="number"
              min="10"
              max="10000"
              defaultValue={query.width}
            />
          </label>
          <label>
            Тираж
            <select name="edition" defaultValue={query.edition ?? ""}>
              <option value="">Любой</option>
              <option value="LIMITED">Лимитированный</option>
              <option value="OPEN">Открытый</option>
            </select>
          </label>
          <label>
            Рынок
            <select name="market" defaultValue={query.market ?? ""}>
              <option value="">Любой</option>
              <option value="PRIMARY_MARKET">Первичный</option>
              <option value="SECONDARY_MARKET">Вторичный</option>
            </select>
          </label>
          <label>
            Наличие
            <select name="available" defaultValue={query.available ?? ""}>
              <option value="">Любое</option>
              <option value="true">Есть доступный экземпляр</option>
            </select>
          </label>
          <button>Найти</button>
        </form>
        <p className="label">Найдено: {data[0]?.total ?? 0}</p>
        <div className="grid">
          {(data as unknown as WorkCardData[]).map((w) => (
            <WorkCard key={w.id} work={w} />
          ))}
        </div>
        {!data.length && (
          <Empty>По этим условиям работ нет. Измените фильтры.</Empty>
        )}
        <div className="pagination">
          {page > 1 && <Link href={`/works?page=${page - 1}`}>← Назад</Link>}
          {(data[0]?.total ?? 0) > page * 12 && (
            <Link href={`/works?${next}`}>Следующая страница →</Link>
          )}
        </div>
      </>
    );
  }
  if (key === "works" && path.length === 2) {
    let d;
    try {
      d = await workDossier(path[1], actor);
    } catch (e) {
      if (e instanceof DomainError) notFound();
      throw e;
    }
    const listing = d.listings.find((l) =>
      d.copies.some((c) => c.id === l.edition_copy_id && c.status !== "SOLD"),
    );
    return (
      <>
        <div className="breadcrumbs">
          <Link href="/works">Произведения</Link> / {d.title}
        </div>
        <div className="two-col">
          <div>
            <div className="dossier-image">
              {d.media[0] ? (
                <img
                  src={`/api/media/${d.media[0].id}`}
                  alt={d.media[0].alt_text}
                />
              ) : (
                <span>Изображение не загружено</span>
              )}
            </div>
            {d.media.slice(1).map((m) => (
              <img
                key={m.id}
                src={`/api/media/${m.id}`}
                alt={m.alt_text}
                loading="lazy"
              />
            ))}
          </div>
          <div>
            <span className="eyebrow">
              {d.visibility === "INVITED_ONLY"
                ? "Private Circle"
                : "Произведение"}
            </span>
            <h1>{d.title}</h1>
            <Link href={`/artists/${d.artistSlug}`}>{d.artist}</Link>
            <p className="lead">{d.description}</p>
            {d.series && (
              <Link href={`/series/${d.seriesSlug}`}>Серия «{d.series}» ↗</Link>
            )}
            <dl className="details">
              <div className="detail">
                <dt>Год съёмки</dt>
                <dd>{d.captureYear}</dd>
              </div>
              <div className="detail">
                <dt>Подлинность</dt>
                <dd>Не подтверждена экспертизой</dd>
              </div>
              {d.variants.map((v) => (
                <div key={v.id}>
                  <div className="detail">
                    <dt>Техника и бумага</dt>
                    <dd>
                      {v.print_technique} / {v.paper}
                    </dd>
                  </div>
                  <div className="detail">
                    <dt>Изображение / лист</dt>
                    <dd>
                      {v.image_width_mm} × {v.image_height_mm} /{" "}
                      {v.sheet_width_mm} × {v.sheet_height_mm} мм
                    </dd>
                  </div>
                  <div className="detail">
                    <dt>Тираж</dt>
                    <dd>
                      {v.edition_type === "OPEN"
                        ? "Открытый"
                        : `${v.edition_total} + ${v.ap_total} AP`}
                    </dd>
                  </div>
                  <div className="detail">
                    <dt>Подпись</dt>
                    <dd>{v.signed ? "Заявлена автором" : "Не заявлена"}</dd>
                  </div>
                </div>
              ))}
            </dl>
            <p className="label">
              Сертификат и провенанс: запрашивайте документы у продавца.
              Публикация не означает проверку документов или подлинности.
            </p>
            {d.copies.map((c) => (
              <p className="label" key={c.id}>
                Экземпляр {c.number ?? "OPEN"}
                {c.proof_type === "AP" ? " AP" : ""} · печать {c.print_year} ·{" "}
                {c.status === "AVAILABLE"
                  ? "доступен"
                  : c.status === "RESERVED"
                    ? "в резерве"
                    : c.status === "SOLD"
                      ? "недоступен"
                      : "проверка"}{" "}
                · состояние: {c.condition}
              </p>
            ))}
            {listing ? (
              <section className="panel">
                <h3>
                  <Money
                    minor={
                      listing.price_mode === "FIXED_PRICE"
                        ? listing.price_minor
                        : null
                    }
                  />
                </h3>
                <p>
                  Доставка и страхование согласуются отдельно. Изображение не
                  передаёт авторские права. Проверка документов и условий — до
                  сделки.
                </p>
                {actor ? (
                  <>
                    <ActionForm
                      endpoint="/api/v1/inquiries"
                      defaults={{
                        listingId: listing.id,
                        contactPreference: "IN_PLATFORM",
                      }}
                      fields={[
                        {
                          name: "type",
                          label: "Цель запроса",
                          type: "select",
                          options: [
                            { value: "BUY", label: "Приобретение" },
                            { value: "PRICE", label: "Цена" },
                            { value: "AVAILABILITY", label: "Наличие" },
                            {
                              value: "INSTITUTIONAL",
                              label: "Музейный запрос",
                            },
                            {
                              value: "LICENSING",
                              label: "Права использования",
                            },
                          ],
                        },
                        {
                          name: "message",
                          label: "Ваш запрос",
                          type: "textarea",
                          required: true,
                        },
                      ]}
                      label="Уточнить условия"
                    />
                    <ActionForm
                      endpoint="/api/v1/reservations"
                      defaults={{ listingId: listing.id }}
                      label="Запросить резерв экземпляра"
                      idempotent
                    />
                  </>
                ) : (
                  <Link href="/sign-in" className="button">
                    Войти и уточнить условия
                  </Link>
                )}
              </section>
            ) : (
              <p className="panel">Предложений к приобретению сейчас нет.</p>
            )}
            {actor && (
              <ActionForm
                endpoint="/api/v1/favorites"
                defaults={{
                  subjectId: d.id,
                  subjectType: "ARTWORK",
                  saved: true,
                }}
                label="Сохранить в избранное"
              />
            )}
          </div>
        </div>
      </>
    );
  }
  if (key === "artists" || key === "galleries" || key === "series") {
    if (key === "artists" && path.length === 1) {
      const artists =
        await sql`SELECT a.id,a.name,a.slug,a.city FROM artists a WHERE EXISTS(SELECT 1 FROM artworks w WHERE w.artist_id=a.id AND w.editorial_status='PUBLISHED' AND w.visibility='PUBLIC') ORDER BY a.name`;
      return (
        <>
          <span className="eyebrow">Новые имена, разные взгляды</span>
          <h1>Авторы</h1>
          <div className="row-list">
            {artists.map((a) => (
              <Link className="row-item" href={`/artists/${a.slug}`} key={a.id}>
                <h3>{a.name}</h3>
                <span>{a.city} ↗</span>
              </Link>
            ))}
          </div>
          {!artists.length && (
            <Empty>Профили появятся после публикации первых работ.</Empty>
          )}
        </>
      );
    }
    if (key === "galleries" && path.length === 1) {
      const orgs =
        await sql`SELECT id,name,slug,description,type FROM organizations WHERE verification_status='APPROVED' ORDER BY name`;
      return (
        <>
          <h1>Галереи и институции</h1>
          {orgs.map((o) => (
            <Link className="row-item" href={`/galleries/${o.slug}`} key={o.id}>
              <div>
                <span className="eyebrow">{o.type}</span>
                <h3>{o.name}</h3>
                <p>{o.description}</p>
              </div>
              <span>↗</span>
            </Link>
          ))}
        </>
      );
    }
    if (path.length !== 2) notFound();
    if (key === "galleries") {
      const [org] =
        await sql`SELECT name,description,website FROM organizations WHERE slug=${path[1]} AND verification_status='APPROVED'`;
      if (!org) notFound();
      return (
        <>
          <span className="eyebrow">Галерея / институция</span>
          <h1>{org.name}</h1>
          <p className="lead">{org.description}</p>
          <p>
            Представительство работ проверяется отдельно для каждого мандата.
            Контакты клиентов остаются закрытыми.
          </p>
        </>
      );
    }
    const [subject] =
      key === "artists"
        ? await sql`SELECT id,name AS title,biography AS description FROM artists WHERE slug=${path[1]} AND EXISTS(SELECT 1 FROM artworks WHERE artist_id=artists.id AND visibility='PUBLIC' AND editorial_status='PUBLISHED')`
        : await sql`SELECT id,title,statement AS description FROM series WHERE slug=${path[1]} AND visibility='PUBLIC' AND EXISTS(SELECT 1 FROM artworks WHERE series_id=series.id AND visibility='PUBLIC' AND editorial_status='PUBLISHED')`;
    if (!subject) notFound();
    const works =
      await sql`SELECT w.id,w.title,w.slug,w.capture_year,a.name AS artist_name,(SELECT id FROM artwork_media WHERE artwork_id=w.id LIMIT 1) AS media_id FROM artworks w JOIN artists a ON a.id=w.artist_id WHERE w.editorial_status='PUBLISHED' AND w.visibility='PUBLIC' AND (${key === "artists"} AND w.artist_id=${subject.id} OR ${key === "series"} AND w.series_id=${subject.id})`;
    return (
      <>
        <span className="eyebrow">{key === "artists" ? "Автор" : "Серия"}</span>
        <h1>{subject.title}</h1>
        <p className="lead">{subject.description}</p>
        <div className="grid">
          {(works as unknown as WorkCardData[]).map((w) => (
            <WorkCard key={w.id} work={w} />
          ))}
        </div>
      </>
    );
  }
  if (key === "open-calls") {
    if (path.length === 1) {
      const openOnly = query.open === "true";
      const rows =
        await sql`SELECT * FROM open_calls WHERE status='PUBLISHED' AND (NOT ${openOnly} OR (starts_at<=now() AND deadline_at>now())) ORDER BY deadline_at DESC`;
      return (
        <>
          <span className="eyebrow">
            Возможности для профессионального роста
          </span>
          <h1>Open calls</h1>
          <div className="auth-links">
            <Link href="/open-calls?open=true">Приём открыт</Link>
            <Link href="/open-calls">Все, включая архив</Link>
          </div>
          {rows.map((c) => (
            <Link
              href={`/open-calls/${c.slug}`}
              key={c.id}
              className="row-item"
            >
              <div>
                <span className="badge">
                  {c.source_type === "EXTERNAL"
                    ? "Внешний конкурс"
                    : "Заявка в VERSUS"}
                  {c.is_demo ? " · DEMO" : ""}
                </span>
                <h3>{c.title}</h3>
                <p>
                  {c.organizer_name} · <Money minor={c.fee_minor} />
                </p>
              </div>
              <span className="muted">
                До {date(c.deadline_at, c.timezone)} ↗
              </span>
            </Link>
          ))}
        </>
      );
    }
    const [c] =
      await sql`SELECT * FROM open_calls WHERE slug=${path[1]} AND status='PUBLISHED'`;
    if (!c) notFound();
    const works = actor
      ? await sql`SELECT w.id,w.title FROM artworks w JOIN artists a ON a.id=w.artist_id WHERE a.user_id=${actor.id}`
      : [];
    const fields: Field[] = [
      {
        name: "statement",
        label: "Описание проекта / statement",
        type: "textarea",
        required: true,
      },
      {
        name: "workIds",
        label: `Ваши работы (до ${c.max_works})`,
        type: "multi",
        required: true,
        options: works.map((w) => ({ value: w.id, label: w.title })),
      },
      {
        name: "rulesAccepted",
        label: "Принимаю правила конкурса",
        type: "checkbox",
        required: true,
      },
      {
        name: "dataConsent",
        label: "Согласен на передачу данных организатору",
        type: "checkbox",
        required: true,
      },
    ];
    return (
      <div className="narrow">
        <span className="eyebrow">
          {c.source_type === "EXTERNAL"
            ? "Внешний open call"
            : "Внутренний open call"}
          {c.is_demo ? " / DEMO" : ""}
        </span>
        <h1>{c.title}</h1>
        <p className="lead">{c.description}</p>
        <dl className="details">
          <div className="detail">
            <dt>Организатор</dt>
            <dd>{c.organizer_name}</dd>
          </div>
          <div className="detail">
            <dt>Дедлайн</dt>
            <dd>
              {date(c.deadline_at, c.timezone)} ({c.timezone})
            </dd>
          </div>
          <div className="detail">
            <dt>Участие</dt>
            <dd>
              {Number(c.fee_minor) === 0 ? (
                "Без взноса"
              ) : (
                <Money minor={c.fee_minor} />
              )}
            </dd>
          </div>
        </dl>
        <h2>Условия</h2>
        <p className="prose">{c.requirements}</p>
        <p>{c.eligibility}</p>
        {c.source_type === "EXTERNAL" ? (
          <>
            <p>
              Условия уточняйте у организатора. VERSUS не принимает заявки на
              этот конкурс.
            </p>
            <a
              className="button"
              href={c.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Перейти к организатору ↗
            </a>
          </>
        ) : new Date(c.deadline_at) < new Date() ? (
          <p className="panel">Приём заявок завершён.</p>
        ) : actor ? (
          works.length ? (
            <ActionForm
              endpoint={`/api/v1/open-calls/${c.id}/applications`}
              fields={fields}
              label="Подать заявку"
            />
          ) : (
            <p>
              Сначала создайте работы в{" "}
              <Link href="/dashboard/portfolio">своём портфолио</Link>.
            </p>
          )
        ) : (
          <Link href="/sign-in" className="button">
            Войти и подать заявку
          </Link>
        )}
        {actor && (
          <ActionForm
            endpoint="/api/v1/favorites"
            defaults={{
              subjectId: c.id,
              subjectType: "OPEN_CALL",
              saved: true,
            }}
            label="Сохранить open call"
          />
        )}
      </div>
    );
  }
  if (key === "discover") {
    const rows =
      await sql`SELECT id,title,description,slug FROM curated_collections WHERE visibility='PUBLIC' AND status='PUBLISHED'`;
    return (
      <>
        <h1>Редакционный выбор</h1>
        {rows.map((c) => (
          <section key={c.id} className="panel">
            <h2>{c.title}</h2>
            <p>{c.description}</p>
            <Link href={`/works?sort=curated`}>Смотреть произведения ↗</Link>
          </section>
        ))}
      </>
    );
  }
  if (["journal", "events", "auctions"].includes(key)) {
    const type =
      key === "journal" ? "ARTICLE" : key === "events" ? "EVENT" : "AUCTION";
    if (path.length === 1) {
      const rows =
        await sql`SELECT id,title,slug,excerpt,event_at,source_url FROM content WHERE type=${type} AND status='PUBLISHED' AND visibility='PUBLIC' ORDER BY priority DESC,created_at DESC`;
      return (
        <>
          <span className="eyebrow">Контекст / VERSUS</span>
          <h1>
            {key === "journal"
              ? "Журнал"
              : key === "events"
                ? "События"
                : "Аукционные анонсы"}
          </h1>
          {key === "auctions" && (
            <p>
              Информационная витрина внешних аукционов. VERSUS не принимает
              ставки и не гарантирует допуск к участию.
            </p>
          )}
          {rows.map((r) => (
            <Link className="row-item" href={`/${key}/${r.slug}`} key={r.id}>
              <div>
                <h3>{r.title}</h3>
                <p>{r.excerpt}</p>
                {r.event_at && <small>{date(r.event_at)}</small>}
              </div>
              <span>↗</span>
            </Link>
          ))}
          {!rows.length && <Empty>Пока нет опубликованных материалов.</Empty>}
        </>
      );
    }
    const [c] =
      await sql`SELECT id,title,body,event_at,event_address,source_url FROM content WHERE type=${type} AND slug=${path[1]} AND status='PUBLISHED' AND visibility='PUBLIC'`;
    if (!c) notFound();
    return (
      <article className="narrow">
        <span className="eyebrow">
          {type === "AUCTION"
            ? "Внешний аукцион"
            : type === "EVENT"
              ? "Событие"
              : "Журнал"}
        </span>
        <h1>{c.title}</h1>
        {c.event_at && (
          <p>
            {date(c.event_at)} · {c.event_address}
          </p>
        )}
        <div className="prose">{c.body}</div>
        {c.source_url && (
          <a
            href={c.source_url}
            rel="noopener noreferrer"
            target="_blank"
            className="link-arrow"
          >
            Официальный источник
          </a>
        )}
        {type === "EVENT" &&
          (actor ? (
            <ActionForm
              endpoint={`/api/v1/events/${c.id}/rsvp`}
              label="Запросить участие"
            />
          ) : (
            <Link href="/sign-in">Войдите, чтобы запросить участие</Link>
          ))}
      </article>
    );
  }
  if (key === "private") {
    if (path[1] === "invitations")
      return (
        <div className="narrow">
          <h1>Ваше приглашение</h1>
          {actor ? (
            <ActionForm
              endpoint="/api/v1/private/invites/accept"
              defaults={{ token: query.token }}
              label="Принять приглашение"
              redirect="/private"
            />
          ) : (
            <>
              <p>
                Войдите именно с email, на который направлено приглашение. Затем
                снова откройте эту ссылку.
              </p>
              <Link href="/sign-in" className="button">
                Войти
              </Link>
            </>
          )}
        </div>
      );
    if (!actor)
      return (
        <div className="narrow">
          <span className="eyebrow">Пригласительная программа</span>
          <h1>Private Circle</h1>
          <p className="lead">
            Закрытые предложения и разговор о коллекции в кругу доверия. Доступ
            открывается по адресному приглашению.
          </p>
          <Link href="/sign-in" className="button">
            Войти
          </Link>
        </div>
      );
    if (!(await memberAccess(actor))) notFound();
    if (path[1] === "collections" && path[2]) {
      const { privateCollections } = await import("@/modules/private/service");
      let c;
      try {
        c = await privateCollections(actor, path[2]);
      } catch {
        notFound();
      }
      if (Array.isArray(c)) notFound();
      return (
        <>
          <span className="eyebrow">
            Private Circle · только для участников
          </span>
          <h1>{c.title}</h1>
          <p>{c.description}</p>
          <div className="grid">
            {(c.works as unknown as WorkCardData[]).map((w) => (
              <WorkCard key={w.id} work={w} />
            ))}
          </div>
        </>
      );
    }
    const rows =
      await sql`SELECT id,title,description FROM curated_collections WHERE visibility='INVITED_ONLY' AND status='PUBLISHED'`;
    const events =
      await sql`SELECT id,slug,title,event_at,event_address FROM content WHERE type='EVENT' AND visibility='INVITED_ONLY' AND status='PUBLISHED'`;
    return (
      <>
        <span className="eyebrow">Личное пространство коллекционера</span>
        <h1>Private Circle</h1>
        <p>
          Эти подборки доступны только участникам. Мы не публикуем список членов
          клуба или историю их интересов.
        </p>
        {rows.map((c) => (
          <Link
            key={c.id}
            className="row-item"
            href={`/private/collections/${c.id}`}
          >
            <div>
              <h3>{c.title}</h3>
              <p>{c.description}</p>
            </div>
            <span>↗</span>
          </Link>
        ))}
        {!rows.length && <Empty>Закрытые подборки пока не опубликованы.</Empty>}
        {events.map((e) => (
          <section key={e.id} className="panel">
            <h3>{e.title}</h3>
            <p>
              {date(e.event_at)} · {e.event_address}
            </p>
            <ActionForm
              endpoint={`/api/v1/events/${e.id}/rsvp`}
              label="Запросить участие"
            />
          </section>
        ))}
      </>
    );
  }
  const slug = path.join("/");
  const [page] =
    await sql`SELECT title,body FROM content WHERE type='PAGE' AND slug=${slug} AND status='PUBLISHED' AND visibility='PUBLIC'`;
  if (page)
    return (
      <article className="narrow">
        <span className="eyebrow">VERSUS</span>
        <h1>{page.title}</h1>
        {key === "legal" && (
          <p className="badge">
            Проект документа · требует юридического утверждения
          </p>
        )}
        <div className="prose">{page.body}</div>
      </article>
    );
  notFound();
}
