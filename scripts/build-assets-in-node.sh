#!/bin/sh
set -eu

ROOT="/workspace"
API_DIR="$ROOT/api"
WEB_DIR="$ROOT/web"
export NODE_OPTIONS="--dns-result-order=ipv4first"
export npm_config_fetch_retries=2
export npm_config_fetch_retry_factor=2
export npm_config_fetch_retry_mintimeout=2000
export npm_config_fetch_retry_maxtimeout=10000
export npm_config_fetch_timeout=60000
export npm_config_maxsockets=10
export npm_config_audit=false
export npm_config_fund=false

# Support custom user registry, then official npm and global Cloudflare CDN, then regional mirrors
REGISTRIES="
${NPM_REGISTRY:-}
https://registry.npmjs.org/
https://registry.yarnpkg.com/
https://registry.npmmirror.com/
https://repo.huaweicloud.com/repository/npm/
"

probe_registry() {
  url="$1"
  code=$(curl -4 -fsS -m 4 -o /dev/null -w "%{http_code}" "${url%/}/react" 2>/dev/null || curl -fsS -m 4 -o /dev/null -w "%{http_code}" "${url%/}/react" 2>/dev/null || echo "000")
  [ "$code" = "200" ]
}

install_dependencies() {
  label="$1"
  dir="$2"
  shift 2 || true
  extra_flags="$*"
  echo
  echo "===== Installing $label dependencies ====="
  cd "$dir"

  selected=""
  for registry in $REGISTRIES; do
    [ -n "$registry" ] || continue
    echo
    echo "--- Testing npm registry connectivity: $registry ---"
    if ! probe_registry "$registry"; then
      echo "Registry unreachable or slow; skipping: $registry"
      continue
    fi

    echo "--- Using responsive npm registry: $registry ---"
    rm -rf node_modules

    if npm install \
      --registry="$registry" \
      --legacy-peer-deps \
      --ignore-scripts \
      --no-audit \
      --no-fund \
      $extra_flags
    then
      selected="$registry"
      echo "$selected" > .vrm-npm-registry-used
      echo "Dependency installation succeeded using $selected"
      return 0
    fi

    echo "Registry attempt failed: $registry"
  done

  echo "ERROR: All configured npm registries failed for $label." >&2
  return 1
}

echo "Checking OpenSSL runtime prerequisites..."
command -v openssl >/dev/null 2>&1 || { echo "OpenSSL is missing from the Node build image." >&2; exit 1; }
openssl version

echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"
echo "Node DNS order: IPv4 first"
echo "Network mode is supplied by the installer (host network on Linux)."

# Build frontend if not pre-built
if [ -s "$WEB_DIR/dist/index.html" ] && [ "${FORCE_REBUILD:-false}" != "true" ]; then
  echo
  echo "===== Frontend pre-built assets detected ====="
  echo "Using verified distribution in $WEB_DIR/dist (skipping npm install & build)."
else
  install_dependencies "frontend" "$WEB_DIR"
  cd "$WEB_DIR"
  npm run build
  test -s dist/index.html
  rm -rf node_modules .vrm-npm-registry-used
  echo "Frontend build completed."
fi

# Build API dependencies
if [ -s "$API_DIR/dist/server.js" ] && [ "${FORCE_REBUILD:-false}" != "true" ]; then
  echo
  echo "===== API pre-compiled assets detected ====="
  echo "Installing runtime production dependencies only (skipping TypeScript/dev build)..."
  install_dependencies "API (production runtime)" "$API_DIR" "--omit=dev"
else
  install_dependencies "API (full build)" "$API_DIR"
  cd "$API_DIR"
  echo
  echo "===== Compiling API ====="
  npm run build
  test -s dist/server.js
  echo
  echo "===== Removing development-only API dependencies ====="
  npm prune --omit=dev --ignore-scripts --no-audit --no-fund
fi

cd "$API_DIR"

# Prisma engine mirrors: official CDN first, then npmmirror fallback
prisma_mirror=""
for mirror in \
  "${PRISMA_ENGINES_MIRROR:-}" \
  "https://binaries.prisma.sh" \
  "https://cdn.npmmirror.com/binaries/prisma"
do
  [ -n "$mirror" ] || continue
  echo
  echo "--- Downloading Prisma engines from $mirror ---"
  if (
    cd "$API_DIR/node_modules/@prisma/engines"
    PRISMA_ENGINES_MIRROR="$mirror" \
      NODE_OPTIONS="$NODE_OPTIONS" \
      node scripts/postinstall.js
  ); then
    prisma_mirror="$mirror"
    echo "Prisma engine download succeeded: $mirror"
    break
  fi
  echo "Prisma engine mirror failed: $mirror"
done

if [ -z "$prisma_mirror" ]; then
  echo "ERROR: Prisma engines could not be downloaded from configured mirrors." >&2
  exit 1
fi

export PRISMA_ENGINES_MIRROR="$prisma_mirror"
export DATABASE_URL="postgresql://vendo:installer-check-only@127.0.0.1:5432/vendo?schema=public"

echo
echo "===== Generating Prisma Client ====="
./node_modules/.bin/prisma generate --schema=prisma/schema.prisma

rm -f .vrm-npm-registry-used

test -x node_modules/.bin/prisma
test -d node_modules/.prisma/client
test -s dist/server.js

echo
echo "BUILD ASSETS READY"
echo "Frontend: $WEB_DIR/dist"
echo "API:      $API_DIR/dist"
echo "Runtime dependencies and generated Prisma Client: $API_DIR/node_modules"

