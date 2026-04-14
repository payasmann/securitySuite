#!/usr/bin/env bash
# ─── Cloud Dashboard Update Script ──────────────────────────────────────────
# Safely updates the company server with database backup and migration.
#
# Usage:
#   bash scripts/update-cloud.sh
#   bash scripts/update-cloud.sh --skip-backup   (for dev environments)
#
# Steps:
#   1. Pull latest code from git
#   2. Install dependencies
#   3. Backup database (unless --skip-backup)
#   4. Run database migrations
#   5. Generate Prisma client
#   6. Build Next.js
#   7. Restart PM2 process
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SKIP_BACKUP=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --skip-backup) SKIP_BACKUP=true ;;
  esac
done

cd "$PROJECT_DIR"

echo "═══════════════════════════════════════════"
echo "  SAFEGUARD Cloud Dashboard — Update"
echo "═══════════════════════════════════════════"
echo ""

# 1. Pull latest code
echo "[1/7] Pulling latest code..."
git pull origin main
echo ""

# 2. Install dependencies
echo "[2/7] Installing dependencies..."
npm install --production=false
echo ""

# 3. Backup database
if [ "$SKIP_BACKUP" = false ]; then
  echo "[3/7] Backing up database..."
  bash scripts/backup-db.sh
  echo ""
else
  echo "[3/7] Skipping database backup (--skip-backup flag)"
  echo ""
fi

# 4. Run database migrations
echo "[4/7] Running database migrations..."
npx prisma migrate deploy
echo ""

# 5. Generate Prisma client
echo "[5/7] Generating Prisma client..."
npx prisma generate
echo ""

# 6. Build Next.js
echo "[6/7] Building Next.js..."
npm run build
echo ""

# 7. Restart PM2 process
echo "[7/7] Restarting PM2 process..."
if pm2 list | grep -q "cloud-dashboard"; then
  pm2 restart cloud-dashboard
else
  echo "  PM2 process 'cloud-dashboard' not found."
  echo "  Start it with: pm2 start ecosystem.config.js"
fi
echo ""

echo "═══════════════════════════════════════════"
echo "  Update complete!"
echo "  Verify: curl -s http://localhost:3001/api/healthz | jq ."
echo "═══════════════════════════════════════════"
