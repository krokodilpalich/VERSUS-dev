import { sql, audit } from "../src/modules/db";
import { hash } from "@node-rs/argon2";
import { symmetricEncrypt } from "better-auth/crypto";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { env } from "../src/modules/config/env";
import { ensureBuckets, put } from "../src/modules/integrations/storage";
const e = env();
if (process.env.NODE_ENV === "production" || e.DEMO_MODE !== "true")
  throw new Error("DEMO seed forbidden outside local DEMO_MODE");
export function seedId(key: string) {
  const h = createHash("sha256")
    .update("VERSUS_DEMO_" + key)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const password = "Versus-Demo-2026!";
const totpSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
try {
  await ensureBuckets();
  const passwordHash = await hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const encryptedSecret = await symmetricEncrypt({
    key: e.SESSION_SECRET,
    data: totpSecret,
  });
  const encryptedCodes = await symmetricEncrypt({
    key: e.SESSION_SECRET,
    data: JSON.stringify(["demo-backup-001", "demo-backup-002"]),
  });
  const people = [
    ...Array.from({ length: 10 }, (_, i) => ({
      key: `artist${i + 1}`,
      name: `Демо Автор ${String(i + 1).padStart(2, "0")}`,
      role: "ARTIST",
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      key: `collector${i + 1}`,
      name: `Демо Покупатель ${i + 1}`,
      role: "COLLECTOR",
    })),
    { key: "admin", name: "Демо Администратор", role: "ADMIN" },
    { key: "moderator", name: "Демо Модератор", role: "MODERATOR" },
    { key: "operator", name: "Демо Оператор", role: "OPERATIONS" },
    ...[
      "agent1",
      "agent2",
      "adviser1",
      "adviser2",
      "gallery1",
      "gallery2",
      "gallery3",
      "institution1",
      "institution2",
    ].map((key) => ({
      key,
      name: `Демо ${key}`,
      role: key.startsWith("agent")
        ? "AGENT"
        : key.startsWith("adviser")
          ? "ADVISER"
          : key.startsWith("gallery")
            ? "GALLERY_MEMBER"
            : "INSTITUTION_MEMBER",
    })),
  ];
  await sql.begin(async (tx) => {
    for (const p of people) {
      const id = seedId(p.key),
        mfa = ["ADMIN", "MODERATOR", "OPERATIONS"].includes(p.role);
      await tx`INSERT INTO "user"(id,name,email,email_verified,two_factor_enabled) VALUES(${id},${p.name},${p.key + "@versus.local"},true,${mfa}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO account(id,account_id,provider_id,user_id,password) VALUES(${seedId("account-" + p.key)},${id},'credential',${id},${passwordHash}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO user_roles(user_id,role) VALUES(${id},${p.role}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO profiles(user_id,public_display_name) VALUES(${id},${p.name}) ON CONFLICT DO NOTHING`;
      if (mfa)
        await tx`INSERT INTO two_factor(id,secret,backup_codes,user_id,verified) VALUES(${seedId("totp-" + p.key)},${encryptedSecret},${encryptedCodes},${id},true) ON CONFLICT DO NOTHING`;
    }
    for (let i = 1; i <= 10; i++) {
      await tx`INSERT INTO artists(id,user_id,name,slug,biography,statement,city) VALUES(${seedId("author" + i)},${seedId("artist" + i)},${`Демо Автор ${String(i).padStart(2, "0")}`},${"demo-author-" + i},'Вымышленный автор для проверки платформы. Биография не относится к реальному человеку.','Абстрактные исследования света, пространства и формы. DEMO.','Демонстрационный город') ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO series(id,artist_id,title,slug,statement,year_start) VALUES(${seedId("series" + i)},${seedId("author" + i)},${"DEMO · Исследование " + i},${"demo-series-" + i},'Демонстрационная серия из оригинальных геометрических композиций.',2024) ON CONFLICT DO NOTHING`;
    }
    for (let i = 1; i <= 7; i++) {
      const key =
        i <= 3
          ? "gallery" + i
          : i <= 5
            ? "agent" + (i - 3)
            : "institution" + (i - 5);
      await tx`INSERT INTO organizations(id,name,slug,type,description,verification_status) VALUES(${seedId("org" + i)},${"DEMO · Институция " + i},${"demo-organization-" + i},${i <= 3 ? "GALLERY" : i <= 5 ? "AGENCY" : "MUSEUM"},'Вымышленная организация для проверки профессиональных сценариев.','APPROVED') ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO organization_members(organization_id,user_id,role) VALUES(${seedId("org" + i)},${seedId(key)},'OWNER') ON CONFLICT DO NOTHING`;
    }
    await tx`INSERT INTO commission_policies(id,name,version,basis_points,is_demo,status) VALUES(${seedId("policy")},'DEMO — не коммерческая ставка',1,1000,true,'ACTIVE') ON CONFLICT DO NOTHING`;
  });
  const titles = [
    "Тихий горизонт",
    "Свет между стен",
    "Форма отсутствия",
    "Линия берега",
    "Серый полдень",
    "Память пространства",
    "Окно на север",
    "Пауза",
    "След света",
    "Отражение",
  ];
  for (let i = 1; i <= 30; i++) {
    const author = ((i - 1) % 10) + 1,
      privateWork = i === 30,
      work = seedId("work" + i),
      media = seedId("media" + i);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1250" viewBox="0 0 1000 1250"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="${i % 2 ? "#6b716c" : "#a8a18e"}"/><stop offset="1" stop-color="#dbd6c9"/></linearGradient><filter id="n"><feTurbulence baseFrequency=".45" numOctaves="2" seed="${i}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".07"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs><g filter="url(#n)"><rect width="1000" height="1250" fill="url(#g)"/><path d="M0 ${650 + i * 8} L1000 ${580 + i * 5} V1250 H0Z" fill="#8e8b7c"/><rect x="${100 + i * 8}" y="200" width="${160 + i * 2}" height="780" fill="#393e39" opacity=".85"/><rect x="${290 + i * 6}" y="300" width="280" height="500" fill="#d4ccb6"/><path d="M0 1100 L1000 850 L1000 1250 H0Z" fill="#3a3d36" opacity=".55"/></g><text x="45" y="1205" font-size="16" fill="#f4f0e7" letter-spacing="5">VERSUS · DEMO ${String(i).padStart(2, "0")}</text></svg>`;
    if (i === 1) await writeFile("public/demo/composition.svg", svg);
    const original = await sharp(Buffer.from(svg)).png().toBuffer();
    const full = await sharp(original).webp({ quality: 85 }).toBuffer(),
      thumb = await sharp(original)
        .resize(640)
        .webp({ quality: 80 })
        .toBuffer();
    const key = `demo/${media}`;
    await put(
      e.S3_BUCKET_PRIVATE,
      key + "/original.png",
      original,
      "image/png",
    );
    await put(e.S3_BUCKET_PUBLIC, key + "/1600.webp", full, "image/webp");
    await put(e.S3_BUCKET_PUBLIC, key + "/640.webp", thumb, "image/webp");
    await sql.begin(async (tx) => {
      await tx`INSERT INTO artworks(id,artist_id,series_id,title,slug,capture_year,description,genre,color_mode,editorial_status,visibility,is_curated) VALUES(${work},${seedId("author" + author)},${seedId("series" + author)},${"DEMO · " + titles[(i - 1) % 10] + " " + i},${"demo-work-" + i},${2020 + (i % 6)},'Оригинальная демонстрационная абстрактная композиция VERSUS. Это не фотография реального автора и не подлинное рыночное предложение.','Абстракция',${i % 2 ? "BW" : "COLOR"},${i === 29 ? "DRAFT" : "PUBLISHED"},${privateWork ? "INVITED_ONLY" : "PUBLIC"},${i % 3 === 0}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO edition_variants(id,artwork_id,print_technique,paper,image_width_mm,image_height_mm,sheet_width_mm,sheet_height_mm,edition_type,edition_total,signed) VALUES(${seedId("variant" + i)},${work},'Пигментная печать','Хлопковая бумага',400,500,450,550,${i % 7 === 0 ? "OPEN" : "LIMITED"},${i % 7 === 0 ? null : 5},true) ON CONFLICT DO NOTHING`;
      for (let n = 1; n <= (i % 7 === 0 ? 1 : 5); n++)
        await tx`INSERT INTO edition_copies(id,variant_id,number,print_year) VALUES(${seedId(`copy${i}-${n}`)},${seedId("variant" + i)},${i % 7 === 0 ? null : n},2026) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO artwork_media(id,artwork_id,storage_key_original,derivative_key,thumbnail_key,alt_text,rights_holder,mime_type) VALUES(${media},${work},${key + "/original.png"},${key + "/1600.webp"},${key + "/640.webp"},${"DEMO · Абстрактная композиция " + i},'VERSUS demo generator','image/png') ON CONFLICT DO NOTHING`;
      if (i !== 29)
        await tx`INSERT INTO listings(id,edition_copy_id,edition_variant_id,seller_id,price_mode,price_minor,visibility,status,rights_evidence) VALUES(${seedId("listing" + i)},${seedId(`copy${i}-1`)},${seedId("variant" + i)},${seedId("artist" + author)},${i % 3 === 0 ? "PRICE_ON_REQUEST" : "FIXED_PRICE"},${i % 3 === 0 ? null : 1500000 + i * 175000},${privateWork ? "INVITED_ONLY" : "PUBLIC"},'PUBLISHED','DEMO — право на оригинальную синтетическую композицию') ON CONFLICT DO NOTHING`;
    });
  }
  await sql.begin(async (tx) => {
    for (let i = 1; i <= 6; i++)
      await tx`INSERT INTO open_calls(id,title,slug,organizer_name,source_type,source_url,description,requirements,starts_at,deadline_at,timezone,is_demo,last_checked_at) VALUES(${seedId("call" + i)},${i === 1 ? "DEMO · Новая оптика" : i === 2 ? "DEMO · Завершённый отбор" : "DEMO · Внешняя возможность " + i},${"demo-call-" + i},'Демонстрационная редакция',${i <= 2 ? "VERSUS_HOSTED" : "EXTERNAL"},${i <= 2 ? null : "https://example.com"},'Демонстрационный конкурс для проверки подачи. Не является настоящим конкурсом.','От одной до десяти собственных работ. Права должны принадлежать заявителю.',now()-interval '10 days',${i === 2 ? new Date(Date.now() - 86400000).toISOString() : new Date(Date.now() + 45 * 86400000).toISOString()},'Europe/Moscow',true,now()) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO private_memberships(user_id,status,approved_by) VALUES(${seedId("collector1")},'APPROVED',${seedId("admin")}) ON CONFLICT DO NOTHING`;
    for (let i = 1; i <= 3; i++) {
      await tx`INSERT INTO curated_collections(id,title,slug,description,visibility,curator_id) VALUES(${seedId("collection" + i)},${i === 3 ? "DEMO · Private preview" : "DEMO · Выбор редакции " + i},${"demo-collection-" + i},'Кураторская демонстрационная подборка. Все произведения и предложения вымышлены.',${i === 3 ? "INVITED_ONLY" : "PUBLIC"},${seedId("admin")}) ON CONFLICT DO NOTHING`;
      for (const n of i === 3 ? [30] : i === 1 ? [1, 3, 5] : [2, 4, 6])
        await tx`INSERT INTO curated_collection_items(collection_id,artwork_id) VALUES(${seedId("collection" + i)},${seedId("work" + n)}) ON CONFLICT DO NOTHING`;
    }
    const pages: Record<string, [string, string]> = {
      about: [
        "О VERSUS",
        "VERSUS объединяет авторов, галереи, коллекционеров и институции. Discover / Connect / Collect.\n\nМы создаём профессиональную среду с точными сведениями об отпечатках и уважением к правам представительства.",
      ],
      "how-it-works": [
        "Как это работает",
        "Откройте каталог, изучите тираж и условия работы, отправьте приватный запрос. Продавец или оператор подготовит оферту.\n\nРезерв относится к конкретному экземпляру и не является покупкой. В P0 договорённости и расчёты происходят вне платформы; завершение подтверждает сотрудник.",
      ],
      trust: [
        "Доверие и права",
        "Модерация публикации не является экспертизой подлинности. Мы различаем авторские заявления, предоставленные документы и экспертные подтверждения.\n\nПрава на изображение не переходят вместе с отпечатком автоматически. Проверяйте условия оферты, состояние, сертификат, провенанс и полномочия продавца.",
      ],
      contact: [
        "Контакты",
        "В демонстрационной среде внешняя связь не настроена. Запрос по произведению отправляется из его карточки после входа и сохраняется в кабинете.\n\nОперационный сотрудник отвечает через приватный запрос. Контактные данные команды будут опубликованы после утверждения владельцем.",
      ],
      "legal/privacy": [
        "Конфиденциальность",
        "Проект документа для локального пилота. Требует утверждения юристом.\n\nСессии необходимы для входа. Владение, запросы и переписка закрыты. В тестовой среде не размещайте реальные персональные документы. Production-хостинг и сроки хранения требуют отдельного решения.",
      ],
      "legal/terms": [
        "Условия платформы",
        "Проект условий. Не утверждено юристом.\n\nДемонстрационные записи вымышлены. Публикация требует прав на изображения. Модерация не подтверждает подлинность. VERSUS не принимает банковские платежи и ставки в P0.",
      ],
      "legal/cookies": [
        "Cookies",
        "Для авторизации используются необходимые HttpOnly session cookies. Сторонние рекламные трекеры не подключены.\n\nЭто проект уведомления, требующий утверждения перед production.",
      ],
      "legal/sales": [
        "Условия продажи",
        "Коммерческие условия не утверждены. Запрос, оферта и резерв не означают оплаты.\n\nСрок резерва задаётся настройками (локально 48 часов). Доставка, страхование и переход прав согласуются письменно. Комиссия показывается из версии политики; DEMO ставка не является реальным тарифом.",
      ],
    };
    for (const [slug, [title, body]] of Object.entries(pages))
      await tx`INSERT INTO content(id,type,title,slug,body,status,updated_by) VALUES(${seedId("page-" + slug)},'PAGE',${title},${slug},${body},'PUBLISHED',${seedId("admin")}) ON CONFLICT DO NOTHING`;
    for (let i = 1; i <= 5; i++)
      await tx`INSERT INTO content(id,type,title,slug,body,excerpt,status,updated_by) VALUES(${seedId("article" + i)},'ARTICLE',${["Как читать тираж", "Первый коллекционный отпечаток", "Свет как материал", "Роль галереи", "Частное собрание"][i - 1]},${"demo-article-" + i},'DEMO · Редакционный материал.\n\nЛимитированный тираж, техника печати, подпись, состояние и документы — отдельные характеристики произведения. Изучайте их перед приобретением.\n\nВладение отпечатком само по себе не передаёт права на воспроизведение изображения. Условия передачи и использования фиксируются отдельно. Это демонстрационный материал, а не юридическая консультация.','DEMO · Заметки о внимательном подходе к коллекционированию.','PUBLISHED',${seedId("admin")}) ON CONFLICT DO NOTHING`;
    for (let i = 1; i <= 2; i++)
      await tx`INSERT INTO content(id,type,title,slug,body,excerpt,visibility,status,event_at,event_address,capacity,updated_by) VALUES(${seedId("event" + i)},'EVENT',${i === 1 ? "DEMO · Разговор об отпечатке" : "DEMO · Collector’s Salon"},${"demo-event-" + i},'Демонстрационный анонс, реального мероприятия не запланировано. RSVP создаёт запрос на участие, а не подтверждает место.','Демонстрационное событие',${i === 1 ? "PUBLIC" : "INVITED_ONLY"},'PUBLISHED',now()+interval '30 days',${i === 1 ? "Демонстрационное пространство" : "Закрытый демонстрационный адрес"},20,${seedId("admin")}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO content(id,type,title,slug,body,excerpt,source_url,status,updated_by) VALUES(${seedId("auction")},'AUCTION','DEMO · Внешний аукцион','demo-external-auction','Информационная демонстрационная запись. Настоящих торгов не проводится. VERSUS не принимает ставки.','DEMO, ссылка демонстрационная','https://example.com','PUBLISHED',${seedId("admin")}) ON CONFLICT DO NOTHING`;
    await audit(tx, seedId("admin"), "System", "seed", "DEMO_SEED_VERIFIED");
  });
  console.log(
    "DEMO seed complete. Local accounts and MFA setup: README. No production credentials created.",
  );
} finally {
  await sql.end();
}
