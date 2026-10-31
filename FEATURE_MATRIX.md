# Матрица реализации и проверки

Источник: specs/VERSUS_MASTER_SPEC.md. Версия: локальный пилот 0.1.0. «Проверено» относится к указанной проверке, не к production certification и не к каждому возможному варианту интерфейса.

| Возможность                                                  | Приоритет | Реализация / доказательство                                                                                                                            |
| ------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Регистрация, email verification, reset, server sessions      | P0        | Better Auth + Argon2id, реальный SMTP Mailpit, E2E 1; reset реализован, отдельный browser reset-flow не проверен                                       |
| Multi-role, профессиональный onboarding, приватность         | P0        | Серверные policy checks, self-assign только профессиональных ролей, согласие сохраняется; unit + E2E                                                   |
| Staff MFA                                                    | P0        | TOTP Better Auth, назначение staff требует MFA и отзывает сессии; E2E admin/operator                                                                   |
| Автор, серия, черновик работы, вариант тиража и экземпляры   | P0        | Раздельные сущности; ограничения LIMITED/OPEN/AP на уровне БД; E2E 1 + integration                                                                     |
| Media upload, private original, WebP derivatives             | P0        | MIME bytes + sharp, EXIF stripping, лимиты; настоящий S3, integration fake-file rejection + E2E 1                                                      |
| Модерация и изменения публичного профиля                     | P0        | Мотивированное решение, версия, аудит; изменения опубликованного профиля в pending до решения                                                          |
| Listing / представительство                                  | P0        | Подтверждённый мандат, сроки/область, проверка членства, конфликт эксклюзивных блокирует предложения; integration                                      |
| Каталог и досье                                              | P0        | SSR, RU FTS + автор/серия, URL price/year/color/technique/gallery/city/edition/market/width/availability, pagination/sort; E2E 2                       |
| Приватные запросы и сообщения                                | P0        | Участники/оператор; нет email/личных связей в public DTO; E2E 2 + integration                                                                          |
| Оферта и политика комиссии                                   | P0        | Версионная политика и immutable snapshot; BIGINT копейки; DEMO policy не реальный тариф                                                                |
| Резерв и офлайн-завершение                                   | P0        | Row locks, unique активного резерва/сделки, expiry worker, Idempotency-Key, проверка документа/аудиторского основания; E2E 3 + concurrency integration |
| Open calls                                                   | P0        | Внутренний/внешний источник, дедлайны/зона/правила, подача своих работ, квитанция, редактирование до срока, отзыв, операторские этапы; E2E 4           |
| Private Circle                                               | P0        | Адресное одноразовое hashed приглашение, encrypted outbox, проверка membership при каждом read, немедленный revoke; E2E 5                              |
| Избранное, организации/верификация                           | P0        | Приватные saved_items, организация + OWNER и очередь проверки; API/UI реализованы                                                                      |
| CMS, главная, страницы, события, аукционные анонсы           | P0        | Create/update/archive, безопасный текст без raw HTML, SEO, приоритет, public/private, RSVP-заявка; без ставок                                          |
| Архив                                                        | P0        | Минимальный редакционный CRUD через тип ARCHIVE; публичный исследовательский поиск — P1                                                                |
| Админка / аудит / наблюдаемость                              | P0        | Защищённые страницы и API, immutable audit, health/live+ready, защищённый Prometheus metrics                                                           |
| Redis/BullMQ/outbox                                          | P0        | SMTP delivery/retries/DEAD и освобождение резервов. SMTP at-least-once, не имитация внешней доставки                                                   |
| Docker web/worker/DB/Redis/S3/Mailpit                        | P0        | Собраны и запускаются реальные контейнеры; provider SeaweedFS заменяет недоступный MinIO                                                               |
| Unit / PostgreSQL integration / browser                      | P0        | 5 / 13 / 6 проверок (E2E также на production Docker); фактический финальный отчёт docs/VALIDATION.md                                                   |
| Backup/restore                                               | P0        | pg_dump → отдельная БД → проверка counts → cleanup; S3 full restore и encrypted production backup ещё требуют инфраструктурной проверки                |
| Синтетическая нагрузка                                       | P0 target | SQL-поиск 50k работ + 100k media rows: p95 488 мс; не HTTP/S3/LCP/SLA                                                                                  |
| Настоящие платежи, выплаты, refunds, webhooks                | P1        | Не реализованы, PAYMENTS_MODE=disabled, FEATURE_CHECKOUT=false                                                                                         |
| Внутренние торги и ставки                                    | P1        | Не реализованы, FEATURE_AUCTIONS=false                                                                                                                 |
| Consignment, сложный вторичный рынок, клиентские брифы, жюри | P1        | Backlog, нет декоративных действий с ложным успехом                                                                                                    |
| EN, рекомендации, архивные интеграции и BI                   | P2        | Backlog                                                                                                                                                |

## Границы пилота

Редактирование серий проходит повторную модерацию, заявки меняются до дедлайна без замены receipt, дополнительные варианты имеют отдельные AP-экземпляры. Реализованы diff черновика/серии и агрегированная CSV-выгрузка без PII. Повторная редакция работы скрывает её до одобрения; активный резерв/продажа блокируют такую операцию. Private Circle в P0 — единое членство с доступом к 1–N закрытым подборкам; персональная сегментация внутри клуба — дальнейшее развитие. Матрица описывает проверенные возможности пилота, не production certification.

До production: реальный AV/карантин (upload вне DEMO намеренно блокируется), production SMTP, юридические тексты/согласия и RF data-flow, реальные ставки комиссий, доставщик/страхование, hosting и TLS, отдельная runtime DB role, S3 restore drill, ручной WCAG review и LCP/API нагрузочные измерения. Это не выполненные подключения и не утверждённые решения владельца.
