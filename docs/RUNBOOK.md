# Эксплуатация пилота

## Запуск и диагностика

Миграции применяются ровно один раз, checksum предотвращает переписывание истории. Проверки: `docker compose --env-file .env.local ps`, `/health/live`, `/health/ready`, outbox_events статусы PENDING/DELIVERED/DEAD. SMTP acceptance в Mailpit означает локальное сохранение, не получение внешним адресатом. Worker доставляет at least once; SMTP не обеспечивает exactly once. Бизнес-эффекты не выполняются через email, reservation/deal API идемпотентны.

Перезапуск worker не меняет статусы сделок автоматически, кроме истечения резервов. Не удалять audit_events, deal_events, commission_policies; триггеры запрещают изменение/удаление. Приватные имена/адреса/токены не включать в access logs reverse proxy. Запросы auth с query токенами необходимо редактировать/исключать из журналов.

## Backup / restore

Цели RPO 24ч / RTO 4ч — не измеренный SLA. Периодически сохранять PostgreSQL custom dump через `pg_dump -Fc` внутри db container в закрытый каталог вне checkout, шифровать age/GPG утверждённым ключом. Секрет подключения не выводить в командной строке/журнале. S3 backup должен включать оригиналы, производные и metadata (SeaweedFS: остановить запись/worker, snapshot всего s3data; для production провайдера — versioning + отдельная immutable копия).

Восстановление проверять на отдельной БД/volume, не поверх рабочей. `pg_restore --no-owner` → миграции → проверка referential integrity → выборка hash/S3 read → health ready → пять smoke-сценариев. Restore drill записывать с временем, количеством таблиц/объектов и проверками. Не объявлять backup working без успешного drill. Backup персональных данных шифруется, доступ только операторам, сроки хранения определяются юристом.

## Первоначальный production admin

Не запускать demo seed. Зарегистрировать реальный аккаунт с подтверждением email и настроить TOTP. DBA с доступом к primary DB проверяет email_verified=true и two_factor_enabled=true, затем в транзакции добавляет ADMIN в user_roles, записывает audit_events и удаляет все старые session этого user. Выполнять параметризованным административным инструментом с секретами из vault; не вставлять credentials в чат/репозиторий. Второго администратора назначать через защищённый UI.

## До production

RF hosting/data-flow legal review, утверждённые документы, AV scanner + карантин, TLS/reverse proxy и лимит тела 16МБ, отдельная ограниченная DB runtime role, backup restore drill, мониторинг outbox DEAD/503, rate limit tuning. Локальное DEMO окружение и его аккаунты не публиковать как коммерческий production. Платежи/ставки остаются выключены, пока не реализованы отдельные адаптеры и юридическая модель.
