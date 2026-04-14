#!/usr/bin/env bash
# ─── Database Backup Script ─────────────────────────────────────────────────
# Creates a timestamped pg_dump backup before migrations or updates.
#
# Usage:
#   npm run db:backup
#   bash scripts/backup-db.sh
#
# Reads DATABASE_URL from .env if present.
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")

# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep 'DATABASE_URL' | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Set it in .env or environment."
  exit 1
fi

mkdir -p "$BACKUP_DIR"

BACKUP_FILE="${BACKUP_DIR}/infosec_backup_${TIMESTAMP}.sql"

echo "Backing up database to: ${BACKUP_FILE}"
pg_dump "$DATABASE_URL" > "$BACKUP_FILE"

# Compress the backup
gzip "$BACKUP_FILE"
echo "Backup complete: ${BACKUP_FILE}.gz"

# Clean up old backups (keep last 10)
cd "$BACKUP_DIR"
ls -tp *.sql.gz 2>/dev/null | tail -n +11 | xargs -I {} rm -- {} 2>/dev/null || true
echo "Old backups cleaned (keeping last 10)"
