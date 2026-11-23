#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

echo "=== Vendo Revenue System Updater ==="
echo "Timestamp: $(date)"

# Ensure git remote is configured
REMOTE_URL="${VRM_GIT_REMOTE:-https://github.com/chavxxx/Vendo-Revenue-System.git}"
if ! git remote | grep -q '^origin$'; then
  git remote add origin "$REMOTE_URL"
fi

# Fetch and pull latest changes
echo "Checking for updates from origin main..."
git fetch origin main || true
LOCAL_HASH=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
REMOTE_HASH=$(git rev-parse origin/main 2>/dev/null || echo "$LOCAL_HASH")

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ] && [ "$LOCAL_HASH" != "unknown" ]; then
  echo "System is already up to date (${LOCAL_HASH:0:7})."
else
  echo "Pulling updates ($LOCAL_HASH -> $REMOTE_HASH)..."
  git pull origin main || true
fi

# Apply database migrations
echo "Syncing database schema..."
if [ -d "api" ]; then
  (cd api && npx prisma db push --skip-generate 2>/dev/null || true)
  (cd api && npx prisma generate 2>/dev/null || true)
fi

# Rebuild assets
echo "Compiling API..."
if [ -d "api" ]; then
  (cd api && npm run build || true)
fi

echo "Compiling Frontend..."
if [ -d "web" ]; then
  (cd web && npm run build || true)
fi

# Restart services if docker is active
if command -v docker >/dev/null 2>&1 && docker compose ps --services 2>/dev/null | grep -q 'api'; then
  echo "Restarting application containers..."
  docker compose restart api web 2>/dev/null || true
fi

echo "Update process finished!"
