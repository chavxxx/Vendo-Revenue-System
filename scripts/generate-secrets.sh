#!/usr/bin/env bash
set -euo pipefail
echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
echo "JWT_SECRET=$(openssl rand -hex 48)"
echo "ADMIN_PASSWORD=$(openssl rand -base64 24)"
