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
git config --global --add safe.directory "$PROJECT_DIR" 2>/dev/null || true
git fetch origin main || true
LOCAL_HASH=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
REMOTE_HASH=$(git rev-parse origin/main 2>/dev/null || echo "$LOCAL_HASH")

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ] && [ "$LOCAL_HASH" != "unknown" ]; then
  echo "System is already up to date (${LOCAL_HASH:0:7})."
else
  echo "Pulling updates ($LOCAL_HASH -> $REMOTE_HASH)..."
  git reset --hard origin/main || git pull origin main || true
fi

# Sync database schema with Prisma
echo "Syncing database schema..."
if [ -d "api" ]; then
  if [ -x "api/node_modules/.bin/prisma" ]; then
    (cd api && ./node_modules/.bin/prisma db push --skip-generate 2>/dev/null || true)
  elif command -v npx >/dev/null 2>&1; then
    (cd api && npx prisma db push --skip-generate 2>/dev/null || true)
  fi
fi

# Restart services if docker is active
if command -v docker >/dev/null 2>&1; then
  echo "Rebuilding and restarting application containers with latest updates..."
  docker compose up -d --build api web 2>/dev/null || docker compose restart api web 2>/dev/null || true
fi

echo "Update process finished successfully!"
