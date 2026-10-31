# Фактическая проверка — 31 октября 2026

Среда: Node 24.19, Next 16.4.3, PostgreSQL 17.6, Drizzle 0.45.4, postgres-js 3.4.7, Redis 7.4.5, Mailpit 1.27.8, SeaweedFS 3.97, системный Chromium. Docker image Node 24.22.2. Этот отчёт описывает локальные проверки; production deploy не выполнялся.

| Проверка                     | Результат                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| db:migrate                   | Миграции 0001–0009 применены; повторный запуск проверяет checksum и не дублирует их                                                                                            |
| db:seed                      | Идемпотентные demo records, 30 работ, 10 авторов, 7 институций, 2 фиктивных offline confirmations, pending offer, 6 заявок и expired reservation                               |
| typecheck                    | PASS                                                                                                                                                                           |
| lint --max-warnings=0        | PASS                                                                                                                                                                           |
| Vitest unit                  | 5 passed                                                                                                                                                                       |
| PostgreSQL integration       | 13 passed; concurrency, idempotency, expiry, snapshot immutability, ownership, private, deadlines, fake file, expired invite, mandates, AP, series review, application editing |
| build                        | PASS, Next production Webpack, типы проверены                                                                                                                                  |
| Docker build web/worker      | PASS, TLS verification сохранена, proxy CA через BuildKit secret                                                                                                               |
| Docker health/ready          | ready; реальный DB query, Redis ping, authenticated S3 bucket head                                                                                                             |
| Playwright dev               | 6 passed: пять P0 цепочек + desktop/mobile/axe                                                                                                                                 |
| Playwright production Docker | 6 passed (1.1 min): все пять цепочек P0 + desktop/mobile/axe, настоящие production Docker web/worker                                                                           |
| Backup/restore drill         | PASS; восстановлено 44 работы, 10 сделок, 185 событий аудита на момент drill; временные БД/dump удалены                                                                        |
| Synthetic SQL benchmark      | 10k users / 50k works / 100k media rows, 20 queries; p50 298 мс, p95 488 мс, транзакция rollback                                                                               |

## Принципиальные ограничения доказательств

E2E — гибрид браузерных действий и реальных API: авторизация/письмо, загрузка/submit, модерация, поиск/запрос, reply/принятие, offline-confirm, заявление и invite/revoke проходят настоящий сервер. Часть fixture создания сущностей вызывает API. Это не стопроцентное UI покрытие всех форм.

Axe smoke не равен полному WCAG 2.2 AA аудиту. SQL p95 не равен HTTP p95 и не подтверждает LCP 2.5с, S3-throughput, SLA, RPO/RTO. S3 backup restore и внешнее staging-развёртывание не проверены. CI workflow создан, но GitHub Actions из этого чата не запускался. Восстановление snapshot в новой облачной задаче не проверялось.

## Исправленные при проверке проблемы

- Недоступны официальные MinIO образы; применён настоящий S3-compatible SeaweedFS.
- Внутренний Docker DNS должен входить в NO_PROXY; внешняя политика прокси сохранена.
- SeaweedFS нужны ёмкости для обоих buckets; проверка готовности делает настоящий write/delete probe.
- Better Auth UUID/defaults и актуальные MFA lockout поля отражены в миграциях.
- Drizzle меняет сериализаторы клиента; ORM и raw SQL используют отдельные pools.
- Кириллические page params декодируются; функциональность проверена E2E.
- Rate limit не отключался: E2E соблюдает Retry-After.
- Turbopack build упирался в ограничения IPC, Webpack build проходит.
- Docker COPY сохранял mode 600 исходников; chown обеспечивает чтение непривилегированным node.

После приёмки временные карточки с префиксами DEMO E2E / DEMO Integration архивированы, их сделки и аудит сохранены. Исходные 30 демо-работ сохранены. Health ready после очистки подтверждён.

## Аудит зависимостей

После удаления неиспользуемого drizzle-kit:

- `npm audit --omit=dev --json`: **0 vulnerabilities**.
- Полное дерево: **16 moderate**, **0 high**, **0 critical** — minimatch/ESLint и их development-зависимости. Автоматически предлагаемые откаты eslint-config-next до 0.x / ESLint до 4.x не применялись: они несовместимы с текущим стеком.

Drizzle ORM и миграции сохранены: используется версионированный SQL runner с checksum. До удаления optional peer drizzle-kit в runtime-аудите было 4 moderate esbuild-зависимости; после удаления они отсутствуют. Development glob-шаблоны не принимаются из пользовательского API. Это результаты текущей базы advisory, не гарантия отсутствия всех уязвимостей.

Повторный запуск полного scripts/setup-local.sh после очистки зависимостей: PASS. Финальные Docker-образы после удаления drizzle-kit: health ready и повторные 6 Playwright tests passed. Черновик среды сохраняет install_script, start_skill и проверенный mount_path VERSUS-dev; репозиторий имеет unborn HEAD, исходники сохранены в рабочем каталоге; статус передачи в GitHub проверяется по удалённому main. Публикация snapshot остаётся действием владельца среды.

Для переноса на Mac добавлен генерируемый локальный CA bundle для Compose build secrets. Публичные доверенные корни проверены через X509Certificate; .env.local и .local/build-ca.pem исключены из Git. Проверки конфигурации с облачным и переносимым fallback выполняются отдельно от запуска на настоящем Mac; macOS runtime из cloud не проверялся.
