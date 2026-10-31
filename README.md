# VERSUS

Профессиональная платформа коллекционной фотографии. Русский интерфейс, modular monolith на Next.js App Router / TypeScript, PostgreSQL и Drizzle. Требования: [мастер-ТЗ](specs/VERSUS_MASTER_SPEC.md). Фактический статус — [FEATURE_MATRIX](FEATURE_MATRIX.md) и [результаты проверки](docs/VALIDATION.md).

## Локальный запуск

Node.js 22+ (проверяется на Node 24), npm, Docker Engine и Compose v2. Используйте существующий checkout: каждая облачная задача уже изолирована, создавать worktree для установки не нужно.

```sh
./scripts/setup-local.sh
npm run dev
# во втором терминале
npm run worker
```

Setup сохраняет существующую `.env.local`; при её отсутствии создаёт случайные локальные секреты (не выводит их). Затем frozen install, инфраструктура, миграции, проверка записи S3, идемпотентный demo seed. PostgreSQL, Redis, S3 и SMTP слушают только loopback. Приложение — порт 3000, Mailpit UI — 8025. Облачная onboarding UI не предоставляет web preview; эти порты предназначены для локальных проверок.

S3 provider: SeaweedFS 3.97 с закреплённым digest. MinIO Docker Hub/Quay недоступны в текущей среде, поэтому выбран реальный S3-compatible backend (не файловый mock). Внешний доступ/ACL bucket не открыт; даже производные выдаёт проверяющий права сервер. Для MinIO измените S3_ENDPOINT и credentials, API приложения тот же.

## Docker-запуск приложения и worker

После `./scripts/setup-local.sh`:

```sh
docker compose --env-file .env.local --profile app up -d --build
```

Web и worker используют DNS имена сервисов вместо loopback. Не запускайте одновременно host web и Docker web на 3000. Для seed в чистом Docker-only окружении сначала выполнить setup; production seed намеренно запрещён. Тестовые данные не должны переноситься в production.

В managed cloud Docker build использует BuildKit secret `proxy_ca` из CODEX_PROXY_CERT. Для обычного Docker на macOS/Linux setup создаёт `.local/build-ca.pem` из доверенных корневых сертификатов Node.js. Если нужен собственный CA bundle, его путь можно передать через `PROXY_CA_FILE`. Проверка TLS сохраняется; локальные сертификаты и секреты не включаются в Git. Внутренний Docker DNS добавлен в NO_PROXY, внешний трафик продолжает идти через прокси.

## Скачать и запустить на Mac

Установите Node.js 24 и Docker Desktop, затем запустите Docker Desktop. Исходники можно скачать на GitHub: **Code → Download ZIP**. Распакуйте проект в `~/Desktop/VERSUS`, откройте Терминал и выполните:

```sh
cd ~/Desktop/VERSUS
./scripts/setup-local.sh
docker compose --env-file .env.local --profile app up -d --build
```

После готовности контейнеров откройте на этом же Mac `http://localhost:3000`. Этот адрес относится к локально запущенной копии, а не к облачной workspace. Настоящие ключи и содержимое `.env.local` скачивать из облака не нужно: setup создаст новые локальные значения.

## Демо-аккаунты — только локально

Общий временный пароль: `Versus-Demo-2026!`. Данные и произведения вымышлены, `DEMO_MODE=true`. Seed отклоняется при NODE_ENV=production или DEMO_MODE=false.

| Email                                                | Права                                            |
| ---------------------------------------------------- | ------------------------------------------------ |
| artist1@versus.local … artist10@versus.local         | фотограф                                         |
| collector1@versus.local … collector10@versus.local   | коллекционер; collector1 — приглашённый участник |
| admin@versus.local                                   | администратор                                    |
| moderator@versus.local                               | модератор                                        |
| operator@versus.local                                | операционный сотрудник                           |
| gallery1@versus.local … gallery3@versus.local        | галереи                                          |
| agent1@versus.local, agent2@versus.local             | агенты                                           |
| adviser1@versus.local, adviser2@versus.local         | консультанты                                     |
| institution1@versus.local, institution2@versus.local | музей/фонд                                       |

Staff accounts требуют TOTP. Для локального seed секрет-байты равны строке `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`. Это **не** готовый base32 ключ приложения; URI для настройки выдаёт команда ниже (явно публичные DEMO данные):

```sh
node --input-type=module -e "import { createOTP } from '@better-auth/utils/otp'; console.log(createOTP('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP').url('VERSUS','admin@versus.local'))"
```

Для нового реального сотрудника: создать обычный аккаунт → подтвердить email → включить 2FA в настройках → отдельным доверенным оператором назначить роль (старые сессии удаляются). Начальный production admin создаётся офлайн DBA по [runbook](docs/RUNBOOK.md), не seed.

## Проверки

```sh
npm run db:migrate
npm run db:seed
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run test:e2e  # нужен запущенный web + worker; Chromium /usr/bin/chromium
```

Для иной установки Chromium: CHROMIUM_PATH=/path/to/chromium. Playwright API/browser тесты проходят настоящие HTTP, PostgreSQL, S3 и SMTP, без mock банковских операций. Интеграционные тесты создают уникальные тестовые сущности, повторяемы без уничтожения пользовательских данных. Запускайте только в isolated DEMO environment. В CI поднимается отдельная инфраструктура.

Production build использует поддерживаемый `next build --webpack`: Turbopack build в этой managed sandbox не может открыть необходимый IPC socket. Проверки типов при сборке не отключены. `npm run start` запускает собранное приложение.

## Рабочие операции

- `/onboarding`: несколько профессиональных ролей, не автоматическая верификация.
- `/dashboard/profile`, `/dashboard/portfolio`: профиль → серия → работа/тираж → изображение → submit.
- `/admin/artworks`: мотивированная модерация → публикация. Затем автор публикует предложение конкретного экземпляра в `/dashboard/listings`.
- `/works`: URL-фильтры и поиск → досье → приватный запрос. `/dashboard/inquiries`: сообщения, оферта с ценой и immutable commission policy, принятие с резервом.
- Продавец/оператор передаёт офлайн-завершение на проверку; OPERATIONS подтверждает по документу. Нет статуса «Оплачено» от локального клика.
- `/admin/open-calls`: внутренний или внешний конкурс. Внешний ведёт на источник; внутренний сохраняет заявку и receipt, сервер проверяет срок/владение/лимиты.
- `/admin/collections`, `/admin/invitations`: private подборка → приглашение по email → одноразовое принятие → закрытый доступ; revoke проверяется немедленно при каждом запросе.
- `/admin/editorial`: безопасный текст CMS; `/admin/events`: события; RSVP — запрос, не подтверждение места.
- `/health/live`, `/health/ready`: процесс и реальные зависимости. Проверка готовности не является SLA.

## Переменные и ограничения

`.env.example` описывает имена. Секреты не коммитятся. PAYMENTS_MODE=disabled, FEATURE_CHECKOUT=false, FEATURE_AUCTIONS=false — обязательные значения этой версии. MAIL_MODE=local допускает только локальный Mailpit; production отправитель не реализован и не имитируется. RESERVATION_HOURS — конфигурируемый срок, 48 часов не утверждённая бизнес-политика.

Комиссии юридически не утверждены. В seed активна только явно DEMO политика, вне DEMO_MODE она не применяется. Изменение политики создаёт новую версию, существующие snapshots не меняются. Реальные платежи, ставки, полноценный вторичный рынок и расширенное жюри — P1. Production deployment, AV файлов, локализация ПДн, договоры, доставщик и легальные тексты требуют отдельных решений, перечисленных в DECISIONS.md.

Оригинальные демо-иллюстрации и лицензия — public/demo/LICENSE.md. Никаких фотографий реальных авторов и публичных списков коллекционеров в seed нет.

## Воспроизводимые дополнительные проверки

```sh
./scripts/backup-drill.sh
node --import tsx --env-file=.env.local scripts/search-benchmark.ts
```

Backup drill создаёт отдельную временную БД, сверяет количества работ/сделок/аудита и удаляет только свои временные ресурсы. Production backup encryption и восстановление S3 проверяются отдельно. Benchmark загружает 10 000 synthetic users, 50 000 works и 100 000 media **строк** внутри откатываемой транзакции. Объекты S3 не создаются, замер относится к SQL, не к HTTP/LCP. Команда предназначена только для изолированной DEMO среды.
