# Безопасность

Deny-by-default, серверные сессии Better Auth, Zod strict input schemas, SameSite/HttpOnly cookies, проверка Origin на изменяющих запросах. Staff требует MFA. Публичные DTO не содержат email, владельцев коллекций, переписку, документы или приватные цены.

Параметризованный SQL, row locks и unique constraints для резервов/заявок; права проверяются в транзакции. Приглашения привязаны к verified email, хранятся SHA-256, одноразовые, со сроком. Резервы требуют Idempotency-Key, привязанного к пользователю и операции. CMS выводится plain text, без raw HTML. Изображения sniff/decoder, ограничения размеров и пикселей, EXIF удаляется из производных.

Не включать production до legal/data-flow review, AV pipeline, TLS/reverse proxy, проверки backup restore и секретов. Безопасные defaults запрещают платежи/ставки. Не логировать PII/токены. Инцидент: отключить интеграции, отозвать сессии, изолировать файлы/листинг, сохранить аудит. Подробнее README и docs/RUNBOOK.md.

Фактический npm audit после удаления неиспользуемого drizzle-kit: runtime-only — 0 vulnerabilities; полное дерево — 16 moderate предупреждений в development tooling (minimatch/ESLint), 0 high/critical. Drizzle ORM и SQL миграции сохранены. Не использовать `npm audit fix --force`: предлагаемые откаты несовместимы с Next.js. Пользовательские glob-шаблоны API не принимаются. Подробности и scope: docs/VALIDATION.md.
