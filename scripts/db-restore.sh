#!/usr/bin/env bash
# Restore an ELIXOR backup made by db-backup.sh, using pg_restore.
#
#   scripts/db-restore.sh backups/elixor_20261028_120000.dump              # into DATABASE_URL
#   RESTORE_URL=postgres://.../scratch scripts/db-restore.sh backups/x.dump # into another database
#
# --clean --if-exists drops each object before recreating it, so restoring
# over the same database replaces its current contents. Restore into a
# separate (scratch) database first if you only want to inspect a backup.
set -euo pipefail

DUMP="${1:-}"
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: $0 <backup-file.dump>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${RESTORE_URL:-${DATABASE_URL:-}}"
if [[ -z "$TARGET" && -f "$ROOT/backend/.env" ]]; then
  TARGET="$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')"
fi
if [[ -z "$TARGET" ]]; then
  echo "Set RESTORE_URL or DATABASE_URL." >&2
  exit 1
fi

read -r -p "This replaces the objects in the target database with the backup. Continue? [y/N] " answer
[[ "$answer" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 0; }

ARGS=(--clean --if-exists --no-owner --no-privileges --single-transaction)

if command -v pg_restore >/dev/null 2>&1; then
  pg_restore "${ARGS[@]}" --dbname "$TARGET" "$DUMP"
elif command -v docker >/dev/null 2>&1; then
  DIR="$(cd "$(dirname "$DUMP")" && pwd)"
  docker run --rm -v "$DIR:/backups" postgres:17-alpine \
    pg_restore "${ARGS[@]}" --dbname "$TARGET" "/backups/$(basename "$DUMP")"
else
  echo "Neither pg_restore nor docker is installed." >&2
  exit 1
fi

echo "Restore finished."
