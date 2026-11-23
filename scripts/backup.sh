#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
source .env
STAMP="$(date +%Y%m%d-%H%M%S)"
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-vendo}" "${POSTGRES_DB:-vendo}" | gzip > "backups/vrm-${STAMP}.sql.gz"
echo "Backup created: backups/vrm-${STAMP}.sql.gz"
