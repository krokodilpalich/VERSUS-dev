#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p .local
# This temporary database is created by this drill only; never restore over the application DB.
drill_db="versus_restore_$(node -e 'process.stdout.write(require("node:crypto").randomBytes(6).toString("hex"))')"
drill_dump=".local/${drill_db}.dump"
cleanup() {
  docker compose --env-file .env.local exec -T db dropdb -U versus --if-exists "$drill_db"
  rm -f "$drill_dump"
}
trap cleanup EXIT
docker compose --env-file .env.local exec -T db pg_dump -U versus -d versus -Fc > "$drill_dump"
docker compose --env-file .env.local exec -T db createdb -U versus "$drill_db"
docker compose --env-file .env.local exec -T db pg_restore --exit-on-error --no-owner -U versus -d "$drill_db" < "$drill_dump"
source_counts="$(docker compose --env-file .env.local exec -T db psql -U versus -d versus -Atc "SELECT (SELECT count(*) FROM artworks)||','||(SELECT count(*) FROM deals)||','||(SELECT count(*) FROM audit_events)")"
restored_counts="$(docker compose --env-file .env.local exec -T db psql -U versus -d "$drill_db" -Atc "SELECT (SELECT count(*) FROM artworks)||','||(SELECT count(*) FROM deals)||','||(SELECT count(*) FROM audit_events)")"
[ "$source_counts" = "$restored_counts" ]
printf 'PostgreSQL restore drill passed: artworks,deals,audit = %s\n' "$restored_counts"
