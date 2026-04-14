#!/usr/bin/env bash
# ─── School Agent Update Script ─────────────────────────────────────────────
# Safely updates the on-premises agent at a school site.
#
# Usage:
#   bash scripts/update-agent.sh
#
# Steps:
#   1. Pull latest code from git
#   2. Install agent dependencies
#   3. Restart PM2 process
#   4. Verify heartbeat is sending
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
AGENT_DIR="$PROJECT_DIR/agent"

cd "$PROJECT_DIR"

echo "═══════════════════════════════════════════"
echo "  SAFEGUARD Agent — Update"
echo "═══════════════════════════════════════════"
echo ""

# 1. Pull latest code
echo "[1/3] Pulling latest code..."
git pull origin main
echo ""

# 2. Install agent dependencies
echo "[2/3] Installing agent dependencies..."
cd "$AGENT_DIR"
npm install
echo ""

# 3. Restart PM2 process
echo "[3/3] Restarting PM2 process..."
if pm2 list | grep -q "school-agent"; then
  pm2 restart school-agent
  echo ""
  echo "Agent restarted. Checking logs..."
  sleep 3
  pm2 logs school-agent --lines 10 --nostream
else
  echo "  PM2 process 'school-agent' not found."
  echo "  Start it with: cd agent && pm2 start ecosystem.config.js"
fi
echo ""

echo "═══════════════════════════════════════════"
echo "  Agent update complete!"
echo "  Monitor: pm2 logs school-agent"
echo "═══════════════════════════════════════════"
