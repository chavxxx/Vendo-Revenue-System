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

ENGINES_DIR="$API_DIR/node_modules/@prisma/engines"
mkdir -p "$ENGINES_DIR"

QE_LIB="$ENGINES_DIR/libquery_engine-debian-openssl-3.0.x.so.node"
SE_BIN="$ENGINES_DIR/schema-engine-debian-openssl-3.0.x"

# 1. Unpack pre-bundled offline engines if present in the repository
if [ -f "$ROOT/prisma-engines/debian-openssl-3.0.x/libquery_engine.so.node.gz" ] && \
   [ -f "$ROOT/prisma-engines/debian-openssl-3.0.x/schema-engine.gz" ]; then
  echo
  echo "===== Unpacking bundled Prisma engines (debian-openssl-3.0.x) ====="
  gzip -dc "$ROOT/prisma-engines/debian-openssl-3.0.x/libquery_engine.so.node.gz" > "$QE_LIB"
  gzip -dc "$ROOT/prisma-engines/debian-openssl-3.0.x/schema-engine.gz" > "$SE_BIN"
  chmod +x "$QE_LIB" "$SE_BIN"
  echo "Prisma engines unpacked successfully from repository bundle."
fi

# 2. Fallback: if engines are missing, download directly with curl (with retries and resume)
if [ ! -s "$QE_LIB" ] || [ ! -s "$SE_BIN" ]; then
  echo
  echo "===== Downloading Prisma engines via curl ====="
  PRISMA_HASH="c2990dca591cba766e3b7ef5d9e8a84796e47ab7"
  for mirror in \
    "${PRISMA_ENGINES_MIRROR:-}" \
    "https://binaries.prisma.sh" \
    "https://cdn.npmmirror.com/binaries/prisma"
  do
    [ -n "$mirror" ] || continue
    echo "--- Trying Prisma engine mirror: $mirror ---"
    if curl -fL -s -S --retry 3 --retry-connrefused -m 60 \
      "$mirror/all_commits/$PRISMA_HASH/debian-openssl-3.0.x/libquery_engine.so.node.gz" | gzip -d > "$QE_LIB" && \
       curl -fL -s -S --retry 3 --retry-connrefused -m 60 \
      "$mirror/all_commits/$PRISMA_HASH/debian-openssl-3.0.x/schema-engine.gz" | gzip -d > "$SE_BIN"; then
      chmod +x "$QE_LIB" "$SE_BIN"
      echo "Prisma engines download succeeded via curl from $mirror"
      break
    else
      echo "Prisma engines download failed from $mirror"
      rm -f "$QE_LIB" "$SE_BIN"
    fi
  done
fi

if [ ! -s "$QE_LIB" ] || [ ! -s "$SE_BIN" ]; then
  echo "ERROR: Failed to obtain Prisma engines for debian-openssl-3.0.x." >&2
  exit 1
fi

export PRISMA_QUERY_ENGINE_LIBRARY="$QE_LIB"
export PRISMA_SCHEMA_ENGINE_BINARY="$SE_BIN"
export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
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

