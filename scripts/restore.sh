#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then echo "Usage: $0 backups/file.sql.gz"; exit 1; fi
cd "$(dirname "$0")/.."
source .env
echo "WARNING: This replaces the current database contents."
read -r -p "Type RESTORE to continue: " confirm
[[ "$confirm" == "RESTORE" ]] || exit 1
gunzip -c "$1" | docker compose exec -T db psql -U "${POSTGRES_USER:-vendo}" -d "${POSTGRES_DB:-vendo}"
echo "Restore completed."
