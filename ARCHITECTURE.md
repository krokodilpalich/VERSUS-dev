# Архитектура

Next.js App Router — SSR страниц, Route Handlers /api/v1, клиентские формы. UI обращается к единому сервисному слою с Zod и deny-by-default политиками. PostgreSQL — единственный источник бизнес-состояния; Drizzle описывает схему, SQL миграции версионированы. Критические операции выполняются в транзакциях с FOR UPDATE и уникальными ограничениями. Artwork, EditionVariant, EditionCopy и Listing — разные сущности.

- src/modules/auth: Better Auth sessions/email/password, роли и staff step-up MFA.
- db: подключение, Drizzle schema, transactional audit/outbox helpers.
- catalog: права, версии, модерация, публичные DTO, media.
- calls: тип источника, лимиты, серверный deadline, receipt.
- commerce: участники запросов, оферта и её условия, атомарный резерв, офлайн-сделка.
- private: адресные приглашения и private visibility, без публичных владельцев.
- content: CMS, события и RSVP, организации/проверки.
- integrations: S3, SMTP Mailpit, Redis/BullMQ worker и transactional outbox.

Оригиналы никогда не публичны. Derivative API повторно проверяет доступ, private ответы no-store/noindex. Деньги bigint в копейках, JSON DTO сериализуют их как безопасные целые; ввод ограничен безопасным диапазоном. Audit immutable на уровне роли runtime, outbox в бизнес-транзакции. Email события имеют ключ и не считаются реально доставленными получателю по SMTP acceptance.

Полный P0 по мастер-ТЗ требует проверки по FEATURE_MATRIX, а не только наличия маршрутов.
