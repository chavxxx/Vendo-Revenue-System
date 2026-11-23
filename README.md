# Vendo Revenue Manager

Self-hosted application for coin-vendo harvesting, revenue distribution, expenses, location and vendo registries, and reporting.

## Complete Ubuntu installer

**Target:** Ubuntu Server 22.04 or 24.04 on a Proxmox VM.

Suggested VM resources: 4 vCPU, 8 GB RAM, and 80 GB SSD. A static LAN IP is recommended.

1. Extract the complete project ZIP on the Ubuntu VM.
2. Change into the extracted `vendo-revenue-manager` directory.
3. Run:

```bash
sudo bash install.sh
```

The installer automatically installs or verifies:

- Ubuntu prerequisites: CA certificates, curl, GnuPG, OpenSSL, Python 3, and sudo
- Docker Engine, containerd, Docker Buildx, and Docker Compose plugin
- Node.js 22 build environment (provided by the official `node:22-bookworm` container image; no host Node.js installation required)
- Nginx frontend container
- PostgreSQL 16 container
- API dependencies, Prisma engines, generated Prisma Client, and TypeScript build
- Frontend dependencies and production build

The build process installs npm dependencies in a normal Node container using host networking, with automatic registry failover (Huawei Cloud, npmmirror, then npmjs). Prisma engine downloads are handled separately using the npmmirror Prisma binary mirror, with Prisma's official CDN as fallback. Dockerfiles do not run npm installs during BuildKit builds.

The installer creates `.env` only when needed, preserves existing settings, generates strong secrets for missing placeholders, and saves initial administrator credentials in `.initial-admin-credentials` with file permissions restricted to root. It does not prepopulate municipalities, barangays, owners, vendos, teams, or employees.

After installation, open:

```text
http://UBUNTU-VM-IP:8080
```

The installer prints the configured URL and initial administrator credentials. Change the password after the first login.

### Re-running the installer

Run `sudo bash install.sh` again. Existing `.env` values and Docker volumes are preserved. The installer rebuilds the application images and restarts the services. **It does not run `docker compose down -v` and does not delete PostgreSQL data.**

### Useful commands

```bash
# Service status
sudo docker compose ps

# Follow logs
sudo docker compose logs -f

# Restart services
sudo docker compose restart

# Stop services (keeps database data)
sudo docker compose down

# Start again
sudo docker compose up -d

# Create a database backup
sudo bash scripts/backup.sh
```

## Network and Internet access

The web frontend listens on the configured `HTTP_PORT` (default `8080`) and proxies `/api` to the API container. PostgreSQL and the API are not published as host ports.

For public Internet access, configure a domain and HTTPS reverse proxy (Caddy or Nginx Proxy Manager are options). Point DNS to your public endpoint and forward TCP 443 to the HTTPS reverse proxy. Do not expose PostgreSQL port 5432 or API port 3000. The installer does not make router, NAT, DNS, or firewall changes.

## Financial rules

Expenses are deducted from gross collection first. The location owner receives 25% of the post-expense amount. The employee pool is 5% of the remaining 75%. Company share is the residual amount.

Example: gross ₱10,000; approved expenses ₱1,000; distributable ₱9,000:
- Location owner: ₱2,250
- Employee pool: ₱338 (rounded)
- Company share: ₱6,412 (residual reconciliation)

The employee pool is not automatically distributed. Admin manually allocates it. Unallocated employee pool is not treated as company revenue.

## Backups and restore

Create a backup:

```bash
sudo bash scripts/backup.sh
```

Restore:

```bash
sudo bash scripts/restore.sh backups/your-backup.sql.gz
```

Restore overwrites the current database. Take a fresh backup first.

## Important product limitations

This is an initial deployable foundation, not a certified accounting or payroll product. Validate it with representative transactions before relying on it for settlements. MFA, password reset, immutable external audit storage, formal disbursement workflows, and a future Android application are not included in this release.


### Docker image download interruptions
The installer configures Docker for one concurrent layer download and up to
10 download attempts per pull, then reloads the daemon configuration without
stopping running containers. Each required image is also pulled with up to six
installer-level retries and increasing delays. Already downloaded layers remain
in Docker's local image cache, so rerunning `sudo bash install.sh` resumes from
the layers still missing. Docker documents both daemon settings and SIGHUP
reload support.


### Source correction for API TypeScript build
The harvest creation endpoint's Prisma `create()` options object requires one
additional closing brace before the call closes. The source in this package
contains the correction. For a project extracted from an earlier ZIP, run
`python3 scripts/fix-harvest-syntax.py` before rebuilding.
