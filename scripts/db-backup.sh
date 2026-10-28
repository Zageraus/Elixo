#!/usr/bin/env bash
# Back up the ELIXOR database with PostgreSQL's native pg_dump.
#
#   scripts/db-backup.sh                 # reads DATABASE_URL from backend/.env
#   DATABASE_URL=postgres://... scripts/db-backup.sh
#
# Writes backups/elixor_<timestamp>.dump (custom format, compressed) with the
# public schema: tables, data, constraints, indexes, views, functions,
# procedures, triggers and RLS policies. Supabase-managed schemas (auth,
# storage) are left out because Supabase backs those up itself.
#
# Needs pg_dump 17 or newer (the server is PostgreSQL 17). Without a local
# install it falls back to the official postgres:17 Docker image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${DATABASE_URL:-}" && -f "$ROOT/backend/.env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set (add it to backend/.env)." >&2
  exit 1
fi

mkdir -p "$ROOT/backups"
FILE="elixor_$(date +%Y%m%d_%H%M%S).dump"
ARGS=(--format=custom --no-owner --no-privileges --schema=public --file)

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$DATABASE_URL" "${ARGS[@]}" "$ROOT/backups/$FILE"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "$ROOT/backups:/backups" postgres:17-alpine \
    pg_dump "$DATABASE_URL" "${ARGS[@]}" "/backups/$FILE"
else
  echo "Neither pg_dump nor docker is installed." >&2
  exit 1
fi

echo "Backup written to backups/$FILE ($(du -h "$ROOT/backups/$FILE" | cut -f1))"
echo "Contents: pg_restore --list backups/$FILE"
