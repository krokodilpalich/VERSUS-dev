#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/local-env.mjs
npm ci
# Each cloud task is already isolated; use this checkout, never create a worktree for setup.
docker compose --env-file .env.local up -d db redis s3 mailpit
npm run db:migrate
npm run services:wait
npm run db:seed
printf 'Setup complete. Run npm run dev and npm run worker in separate terminals.\n'
