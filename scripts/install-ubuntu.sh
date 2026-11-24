#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
PROJECT_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd -P)"
cd "$PROJECT_DIR"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# Re-enter as root so Docker socket and apt permissions are consistent.
if [[ "${EUID}" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || die "sudo is required. Run this installer as root."
  exec sudo -E bash "$SCRIPT_PATH" "$@"
fi

NPM_REGISTRY="${NPM_REGISTRY:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry|-r)
      NPM_REGISTRY="$2"
      shift 2
      ;;
    --registry=*)
      NPM_REGISTRY="${1#*=}"
      shift
      ;;
    http://*|https://*)
      NPM_REGISTRY="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$NPM_REGISTRY" && -f "$PROJECT_DIR/.env" ]]; then
  NPM_REGISTRY="$(grep '^NPM_REGISTRY=' "$PROJECT_DIR/.env" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi
export NPM_REGISTRY

[[ -f "$PROJECT_DIR/docker-compose.yml" ]] || die "Run this installer from the extracted Vendo Revenue Manager project."
[[ -f "$PROJECT_DIR/api/package.json" ]] || die "API source files are missing."
[[ -f "$PROJECT_DIR/web/package.json" ]] || die "Frontend source files are missing."

if [[ ! -r /etc/os-release ]]; then
  die "Cannot identify Linux distribution."
fi
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || die "This installer supports Ubuntu Server 22.04 and 24.04. Detected: ${PRETTY_NAME:-unknown}"

case "${VERSION_ID:-}" in
  22.04|24.04) ;;
  *) echo "WARNING: Ubuntu ${VERSION_ID:-unknown} is not the primary tested target. Continuing with the detected Ubuntu codename." ;;
esac

export DEBIAN_FRONTEND=noninteractive

say "Installing Ubuntu prerequisites"
apt-get update
apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  openssl \
  python3 \
  lsb-release \
  sudo

install_docker_repo() {
  local codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  [[ -n "$codename" ]] || die "Ubuntu release codename not found."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${codename}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
}

if ! command -v docker >/dev/null 2>&1 || ! systemctl list-unit-files docker.service 2>/dev/null | grep -q '^docker.service'; then
  say "Installing Docker Engine, Buildx, and Compose plugin"
  install_docker_repo
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  say "Docker Engine detected; checking Compose and Buildx"
  if ! docker compose version >/dev/null 2>&1 || ! docker buildx version >/dev/null 2>&1; then
    install_docker_repo
    apt-get install -y docker-compose-plugin docker-buildx-plugin
  fi
fi
systemctl enable --now docker
docker info >/dev/null 2>&1 || die "Docker daemon is not responding. Check: systemctl status docker"

docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is not installed."
docker buildx version >/dev/null 2>&1 || die "Docker Buildx plugin is not installed."

say "Tuning Docker image downloads for unstable CDN connections"
# Docker officially supports changing these settings through daemon.json and
# reloading the daemon with SIGHUP. Preserve all unrelated existing settings.
python3 - <<'PY'
import json
from pathlib import Path

path = Path("/etc/docker/daemon.json")
path.parent.mkdir(parents=True, exist_ok=True)

if path.exists():
    try:
        config = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid existing {path}: {exc}")
else:
    config = {}

if not isinstance(config, dict):
    raise SystemExit(f"{path} must contain a JSON object.")

config["max-concurrent-downloads"] = 1
config["max-download-attempts"] = 10

tmp = path.with_suffix(".json.tmp")
tmp.write_text(json.dumps(config, indent=2) + "\n")
tmp.replace(path)
PY

if ! dockerd --validate --config-file=/etc/docker/daemon.json >/dev/null; then
  die "Docker daemon configuration validation failed. Check /etc/docker/daemon.json."
fi

# Docker supports hot-reloading max-concurrent-downloads and
# max-download-attempts with SIGHUP; this does not stop running containers.
systemctl kill --signal=HUP --kill-who=main docker.service
sleep 2
docker info >/dev/null 2>&1 || die "Docker daemon did not respond after configuration reload."

pull_with_retry() {
  local image="$1"
  local attempt
  for attempt in 1 2 3 4 5 6; do
    say "Pulling ${image} (attempt ${attempt}/6)"
    if docker pull "$image"; then
      echo "Successfully pulled ${image}"
      return 0
    fi
    if [[ "$attempt" -lt 6 ]]; then
      local delay=$((attempt * 10))
      echo "Image download interrupted. Retrying in ${delay} seconds..." >&2
      sleep "$delay"
    fi
  done
  die "Could not download ${image} after 6 attempts. Previously completed image layers remain cached; rerun the installer to resume."
}

say "Preparing secure application configuration"
python3 "$PROJECT_DIR/scripts/configure-env.py"
chmod 600 "$PROJECT_DIR/.env" "$PROJECT_DIR/.initial-admin-credentials"

say "Validating Docker Compose configuration"
docker compose config --quiet

say "Pulling required container base images with retry/resume"
pull_with_retry node:22-bookworm
pull_with_retry nginx:alpine
pull_with_retry postgres:16-alpine

say "Building frontend and API dependencies outside BuildKit"
echo "This stage uses a regular Node container with host networking and automatic npm registry failover."
docker run --rm \
  --network host \
  --env NODE_OPTIONS=--dns-result-order=ipv4first \
  --env NPM_REGISTRY="${NPM_REGISTRY:-}" \
  --env PRISMA_ENGINES_MIRROR="${PRISMA_ENGINES_MIRROR:-}" \
  --volume "$PROJECT_DIR:/workspace" \
  --workdir /workspace \
  node:22-bookworm \
  sh /workspace/scripts/build-assets-in-node.sh

say "Building application images (no npm downloads in Dockerfiles)"
docker compose --progress plain build --no-cache api web

say "Starting PostgreSQL, API, and web frontend"
docker compose up -d

HTTP_PORT="$(python3 - <<'PY'
from pathlib import Path
for line in Path(".env").read_text().splitlines():
    if line.startswith("HTTP_PORT="):
        print(line.split("=", 1)[1].strip())
        break
else:
    print("8080")
PY
)"

[[ "$HTTP_PORT" =~ ^[0-9]+$ ]] || die "HTTP_PORT in .env must be numeric."
HEALTH_URL="http://127.0.0.1:${HTTP_PORT}/api/health"

say "Waiting for database and API health"
healthy=0
for attempt in $(seq 1 60); do
  if curl -fsS --max-time 4 "$HEALTH_URL" >/tmp/vrm-health.json 2>/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "$healthy" -ne 1 ]]; then
  echo "Application health check did not pass. Recent service logs:" >&2
  docker compose ps >&2 || true
  docker compose logs --tail=120 db api web >&2 || true
  die "Installation finished with an unhealthy application. Review the logs above."
fi

say "Installation completed"
docker compose ps
echo
echo "Application URL: http://<UBUNTU-VM-IP>:${HTTP_PORT}"
echo "API health:      ${HEALTH_URL}"
echo "Admin email and initial password are saved in:"
echo "  ${PROJECT_DIR}/.initial-admin-credentials"
echo
cat "$PROJECT_DIR/.initial-admin-credentials"
echo
echo "IMPORTANT:"
echo "- Change the initial admin password after signing in."
echo "- Do not expose PostgreSQL port 5432 or API port 3000 publicly."
echo "- Configure HTTPS before using this application over the public Internet."
echo "- This installer does not delete Docker volumes or existing application data."
