# Vendo Revenue System

Self-hosted application for coin-vendo harvesting, revenue distribution, expenses, location and vendo registries, employee share pools, financial reporting, and automated updates.

## Features

- **Coin Harvesting & Expense Deductions**: Record coin collections (₱1, ₱5, ₱10, ₱20 coin counts or gross totals) and associated operating expenses.
- **Strict Financial Engine**:
  - Operating expenses are deducted first from gross collections.
  - Location owner receives 25% of net collection.
  - Employee share pool receives 5% of the remaining 75%.
  - Company retains residual net revenue (exact rounding reconciliation).
- **Interactive Approval Workflows**: Finance and Admin roles can review, approve, or reject harvest submissions and individual expenses.
- **Employee Share Allocations**: Manually allocate shares to registered employees against approved pools with full ledger tracking.
- **Analytics & Export**: Real-time revenue charts (Recharts), customizable date range filters, and one-click export to CSV and JSON.
- **Full Registries & Management**: Complete CRUD operations for Vendos (with VLAN IDs), Municipalities, Barangays, Location Owners, Harvesting Teams, and System Users.
- **In-App & CLI GitHub Updates**: Check for latest updates directly from the UI or via `bash scripts/update.sh`.
- **Account Security**: Change password directly from the user dashboard.

---

## Installation & Deployment

### Ubuntu Server (VM or Bare Metal)
**Target:** Ubuntu Server 22.04 or 24.04 (Proxmox VM recommended: 4 vCPU, 8 GB RAM, 80 GB SSD).

1. Clone the repository:
```bash
git clone https://github.com/chavxxx/Vendo-Revenue-System.git
cd Vendo-Revenue-System
```

2. Run the automated installer:
```bash
sudo bash install.sh
```

The installer configures:
- Docker Engine, containerd, and Docker Compose plugin
- PostgreSQL 16 database container with persistent storage
- Express + Prisma TypeScript API container
- Nginx frontend container serving the production React application
- Strong generated secrets in `.env` and root-protected administrator credentials in `.initial-admin-credentials`

After installation, open:
```text
http://<UBUNTU-SERVER-IP>:8080
```

---

## Updating the Application

### Option 1: Automatic In-App Updates (One-Click)
1. The system automatically checks GitHub for updates every 15 minutes and on application launch.
2. When a newer version is pushed to GitHub, an **Update Available** notification banner appears at the top of the dashboard.
3. Click **Update from GitHub**. The system pulls the latest code from GitHub `main`, syncs the database schema with Prisma, reloads services, and refreshes the browser with zero data loss.
4. You can also manually check and trigger updates anytime under **Settings** → **System & GitHub Updates**.

### Option 2: From the Terminal
Run the update script directly on the server:
```bash
sudo bash scripts/update.sh
```
This fetches the latest code from GitHub `origin/main`, applies database schema migrations, and restarts application containers in seconds.

---

## Useful Commands

```bash
# Service status
docker compose ps

# Follow container logs
docker compose logs -f

# Restart services
docker compose restart

# Create a database backup
sudo bash scripts/backup.sh

# Restore a database backup
sudo bash scripts/restore.sh backups/vrm-YYYYMMDD-HHMMSS.sql.gz
```

---

## Financial Rules & Distribution

1. **Distributable Net** = Gross Collection - Approved Expenses
2. **Location Owner Share** = Distributable Net × 25% (or custom configured vendo %)
3. **Remaining Balance** = Distributable Net - Location Owner Share
4. **Employee Pool** = Remaining Balance × 5% (rounded to whole pesos)
5. **Company Share** = Remaining Balance - Employee Pool (residual reconciliation ensures whole-peso balance)

*Example:* Gross ₱10,000; Approved Expenses ₱1,000; Distributable Net ₱9,000:
- Location Owner (25%): ₱2,250
- Employee Pool (5%): ₱338
- Company Share: ₱6,412
