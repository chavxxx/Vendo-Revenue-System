import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient, Role, HarvestStatus, ExpenseStatus, Status } from "@prisma/client";
import { z } from "zod";
import { exec, execSync } from "child_process";
import path from "path";

const prisma = new PrismaClient();
const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN === "*" ? true : process.env.CORS_ORIGIN?.split(",") }));
app.use(express.json({ limit: "5mb" }));

const JWT_SECRET = process.env.JWT_SECRET || "vrm-fallback-secret-development-only-change-in-production";
const APP_VERSION = "1.0.0";
const GITHUB_REPO = process.env.GITHUB_REPO || "chavxxx/Vendo-Revenue-System";

type AuthRequest = Request & { user?: { id: string; role: Role; email: string } };

function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET) as any;
    next();
  } catch { return res.status(401).json({ error: "Invalid or expired token" }); }
}
function allow(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Insufficient permissions" });
    next();
  };
}
const adminRoles = [Role.SUPER_ADMIN, Role.ADMIN];
const financeRoles = [Role.SUPER_ADMIN, Role.ADMIN, Role.FINANCE];

function pesos(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Money amounts must be non-negative whole pesos");
  return n;
}
function roundPeso(n: number) { return Math.floor(n + 0.5); }

function getLocalCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.GIT_COMMIT || "local";
  }
}

async function bootstrap() {
  const email = process.env.ADMIN_EMAIL || "admin@example.com";
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn("WARNING: ADMIN_PASSWORD is not set in environment. Skipping bootstrap admin creation.");
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: { name: "System Administrator", email, passwordHash: await bcrypt.hash(password, 12), role: Role.SUPER_ADMIN, status: Status.ACTIVE }
    });
    console.log(`Created initial administrator: ${email}`);
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", service: "Vendo Revenue System API", db: "connected", version: APP_VERSION });
  } catch {
    res.status(200).json({ status: "ok", service: "Vendo Revenue System API", db: "starting", version: APP_VERSION });
  }
});

// Authentication
app.post("/api/auth/login", async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valid email and password required" });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || user.status !== Status.ACTIVE || !(await bcrypt.compare(parsed.data.password, user.passwordHash)))
    return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get("/api/me", auth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, name: true, email: true, role: true } });
  if (!user) return res.status(401).json({ error: "User not found" });
  res.json(user);
});

app.post("/api/auth/change-password", auth, async (req: AuthRequest, res) => {
  const p = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8)
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "New password must be at least 8 characters" });
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  const match = await bcrypt.compare(p.data.currentPassword, user.passwordHash);
  if (!match) return res.status(401).json({ error: "Current password does not match" });
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(p.data.newPassword, 12) }
  });
  res.json({ status: "ok", message: "Password updated successfully" });
});

// Municipalities
app.get("/api/municipalities", auth, async (_req, res) => res.json(await prisma.municipality.findMany({ include: { _count: { select: { barangays: true } } }, orderBy: { name: "asc" } })));
app.post("/api/municipalities", auth, allow(...adminRoles), async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Municipality name is required" });
  try { res.status(201).json(await prisma.municipality.create({ data: p.data })); }
  catch { res.status(409).json({ error: "Municipality already exists" }); }
});
app.put("/api/municipalities/:id", auth, allow(...adminRoles), async (req, res) => {
  const id = req.params.id as string;
  const p = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Valid name is required" });
  try {
    res.json(await prisma.municipality.update({ where: { id }, data: p.data }));
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/municipalities/:id", auth, allow(...adminRoles), async (req, res) => {
  const id = req.params.id as string;
  try {
    const count = await prisma.barangay.count({ where: { municipalityId: id } });
    if (count > 0) return res.status(400).json({ error: `Cannot delete municipality with ${count} existing barangays` });
    await prisma.municipality.delete({ where: { id } });
    res.json({ status: "ok" });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Barangays
app.get("/api/barangays", auth, async (_req, res) => res.json(await prisma.barangay.findMany({ include: { municipality: true, _count: { select: { vendos: true } } }, orderBy: { name: "asc" } })));
app.post("/api/barangays", auth, allow(...adminRoles), async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1), municipalityId: z.string().min(1) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Barangay name and municipality are required" });
  try {
    res.status(201).json(await prisma.barangay.create({ data: p.data }));
  } catch {
    res.status(409).json({ error: "Barangay already exists in this municipality or municipality not found" });
  }
});
app.put("/api/barangays/:id", auth, allow(...adminRoles), async (req, res) => {
  const id = req.params.id as string;
  const p = z.object({ name: z.string().trim().min(1), municipalityId: z.string().min(1) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Valid data is required" });
  try {
    res.json(await prisma.barangay.update({ where: { id }, data: p.data }));
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/barangays/:id", auth, allow(...adminRoles), async (req, res) => {
  const id = req.params.id as string;
  try {
    const count = await prisma.vendo.count({ where: { barangayId: id } });
    if (count > 0) return res.status(400).json({ error: `Cannot delete barangay with ${count} assigned vendos` });
    await prisma.barangay.delete({ where: { id } });
    res.json({ status: "ok" });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Location Owners
app.get("/api/owners", auth, async (_req, res) => res.json(await prisma.locationOwner.findMany({ include: { _count: { select: { vendos: true } } }, orderBy: { name: "asc" } })));
app.post("/api/owners", auth, allow(...adminRoles), async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1), phone: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Owner name is required" });
  try {
    res.status(201).json(await prisma.locationOwner.create({ data: p.data }));
  } catch (e: any) { res.status(400).json({ error: e.message || "Could not create owner" }); }
});
app.put("/api/owners/:id", auth, allow(...adminRoles), async (req, res) => {
  const id = req.params.id as string;
  const p = z.object({ name: z.string().trim().min(1), phone: z.string().optional().nullable(), status: z.nativeEnum(Status).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid owner data" });
  try {
    res.json(await prisma.locationOwner.update({ where: { id }, data: p.data }));
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/owners/:id", auth, allow(...adminRoles), async (req, res) => {
  const id = req.params.id as string;
  try {
    const count = await prisma.vendo.count({ where: { ownerId: id } });
    if (count > 0) {
      await prisma.locationOwner.update({ where: { id }, data: { status: Status.INACTIVE } });
      return res.json({ status: "deactivated", message: "Owner has linked vendos and was deactivated." });
    }
    await prisma.locationOwner.delete({ where: { id } });
    res.json({ status: "deleted" });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Vendos
app.get("/api/vendos", auth, async (_req, res) => res.json(await prisma.vendo.findMany({ include: { barangay: { include: { municipality: true } }, owner: true }, orderBy: { vlanId: "asc" } })));
app.post("/api/vendos", auth, allow(...adminRoles), async (req, res) => {
  const p = z.object({
    vlanId: z.coerce.number().int().positive(),
    name: z.string().trim().min(1),
    barangayId: z.string().optional().nullable(),
    ownerId: z.string().optional().nullable(),
    ownerPercent: z.coerce.number().int().min(0).max(100).default(25),
    notes: z.string().optional()
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid vendo data", details: p.error.flatten() });
  try {
    const data = {
      ...p.data,
      barangayId: p.data.barangayId ? p.data.barangayId : null,
      ownerId: p.data.ownerId ? p.data.ownerId : null,
    };
    res.status(201).json(await prisma.vendo.create({ data }));
  } catch {
    res.status(409).json({ error: "VLAN ID already exists or related record is invalid" });
  }
});
app.put("/api/vendos/:id", auth, allow(...adminRoles), async (req, res) => {
  const id = req.params.id as string;
  const p = z.object({
    vlanId: z.coerce.number().int().positive().optional(),
    name: z.string().trim().min(1).optional(),
    barangayId: z.string().optional().nullable(),
    ownerId: z.string().optional().nullable(),
    ownerPercent: z.coerce.number().int().min(0).max(100).optional(),
    status: z.nativeEnum(Status).optional(),
    notes: z.string().optional().nullable()
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid vendo update data" });
  try {
    const data = {
      ...p.data,
      barangayId: p.data.barangayId === "" ? null : p.data.barangayId,
      ownerId: p.data.ownerId === "" ? null : p.data.ownerId
    };
    res.json(await prisma.vendo.update({ where: { id }, data, include: { barangay: { include: { municipality: true } }, owner: true } }));
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/vendos/:id", auth, allow(...adminRoles), async (req, res) => {
  const id = req.params.id as string;
  try {
    const count = await prisma.harvestItem.count({ where: { vendoId: id } });
    if (count > 0) {
      await prisma.vendo.update({ where: { id }, data: { status: Status.INACTIVE } });
      return res.json({ status: "deactivated", message: "Vendo has historical harvest records and was marked INACTIVE." });
    }
    await prisma.vendo.delete({ where: { id } });
    res.json({ status: "deleted" });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Harvesting Teams
app.get("/api/teams", auth, async (_req, res) => res.json(await prisma.harvestTeam.findMany({ include: { _count: { select: { harvests: true } } }, orderBy: { name: "asc" } })));
app.post("/api/teams", auth, allow(...adminRoles), async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1), leader: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Team name is required" });
  try { res.status(201).json(await prisma.harvestTeam.create({ data: p.data })); } catch { res.status(409).json({ error: "Team already exists" }); }
});
app.put("/api/teams/:id", auth, allow(...adminRoles), async (req, res) => {
  const id = req.params.id as string;
  const p = z.object({ name: z.string().trim().min(1), leader: z.string().optional().nullable(), status: z.nativeEnum(Status).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid team data" });
  try {
    res.json(await prisma.harvestTeam.update({ where: { id }, data: p.data }));
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/teams/:id", auth, allow(...adminRoles), async (req, res) => {
  const id = req.params.id as string;
  try {
    const count = await prisma.harvest.count({ where: { teamId: id } });
    if (count > 0) {
      await prisma.harvestTeam.update({ where: { id }, data: { status: Status.INACTIVE } });
      return res.json({ status: "deactivated", message: "Team has harvest history and was marked INACTIVE." });
    }
    await prisma.harvestTeam.delete({ where: { id } });
    res.json({ status: "deleted" });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Users
app.get("/api/users", auth, allow(...adminRoles), async (_req, res) => res.json(await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, status: true, createdAt: true }, orderBy: { name: "asc" } })));
app.post("/api/users", auth, allow(Role.SUPER_ADMIN), async (req, res) => {
  const p = z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(8), role: z.nativeEnum(Role) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid user data; password must be at least 8 characters" });
  try {
    const u = await prisma.user.create({ data: { ...p.data, passwordHash: await bcrypt.hash(p.data.password, 12) }, select: { id: true, name: true, email: true, role: true } });
    res.status(201).json(u);
  } catch { res.status(409).json({ error: "Email already exists" }); }
});
app.put("/api/users/:id", auth, allow(Role.SUPER_ADMIN), async (req, res) => {
  const id = req.params.id as string;
  const p = z.object({
    name: z.string().min(1).optional(),
    role: z.nativeEnum(Role).optional(),
    status: z.nativeEnum(Status).optional(),
    password: z.string().min(8).optional()
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid user update data" });
  try {
    const updateData: any = {};
    if (p.data.name) updateData.name = p.data.name;
    if (p.data.role) updateData.role = p.data.role;
    if (p.data.status) updateData.status = p.data.status;
    if (p.data.password) updateData.passwordHash = await bcrypt.hash(p.data.password, 12);
    const u = await prisma.user.update({ where: { id }, data: updateData, select: { id: true, name: true, email: true, role: true, status: true } });
    res.json(u);
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Harvesting
app.post("/api/harvests", auth, async (req: AuthRequest, res) => {
  const p = z.object({
    harvestedAt: z.union([z.string().datetime(), z.string().min(1), z.date()]),
    teamId: z.string().optional().nullable(),
    remarks: z.string().optional(),
    items: z.array(z.object({
      vendoId: z.string(),
      coins: z.array(z.object({ denomination: z.number().int().positive(), quantity: z.number().int().nonnegative() })).optional().default([]),
      gross: z.number().int().nonnegative().optional(),
      expenses: z.array(z.object({ category: z.string().min(1), description: z.string().optional(), amount: z.number().int().positive() })).optional().default([])
    })).min(1)
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid harvesting data", details: p.error.flatten() });
  const refs = new Set<string>();
  for (const item of p.data.items) if (refs.has(item.vendoId)) return res.status(400).json({ error: "A vendo can only appear once per harvest session" }); else refs.add(item.vendoId);
  try {
    const harvestDate = new Date(p.data.harvestedAt);
    if (isNaN(harvestDate.getTime())) throw new Error("Invalid harvest date format");
    const result = await prisma.$transaction(async tx => {
      const reference = `H-${Date.now()}-${Math.floor(Math.random()*1000).toString().padStart(3,"0")}`;
      return tx.harvest.create({ data: {
        reference, harvestedAt: harvestDate, teamId: p.data.teamId || null,
        encoderId: req.user!.id, remarks: p.data.remarks,
        items: { create: p.data.items.map(i => {
          const coinTotal = i.coins.reduce((s,c) => s + c.denomination*c.quantity, 0);
          const gross = i.gross ?? coinTotal;
          if (i.coins.length && gross !== coinTotal) throw new Error("Gross amount must equal denomination totals");
          pesos(gross);
          return { vendoId: i.vendoId, gross,
            coinCounts: { create: i.coins.map(c => ({ ...c, amount: c.denomination*c.quantity })) },
            expenses: { create: i.expenses.map(e => ({ ...e, status: ExpenseStatus.PENDING })) }
          };
        }) }
      }, include: { items: { include: { vendo: true, expenses: true, coinCounts: true } }, team: true } });
    });
    res.status(201).json(result);
  } catch (e:any) { res.status(400).json({ error: e.message || "Could not create harvest" }); }
});

app.get("/api/harvests", auth, async (req, res) => {
  const from = req.query.from && !isNaN(Date.parse(String(req.query.from))) ? new Date(String(req.query.from)) : new Date("2000-01-01");
  const to = req.query.to && !isNaN(Date.parse(String(req.query.to))) ? new Date(String(req.query.to)) : new Date("2099-12-31");
  const rows = await prisma.harvest.findMany({
    where: { harvestedAt: { gte: from, lte: to } },
    include: {
      team: true,
      encoder: { select: { id: true, name: true, email: true } },
      items: { include: { vendo: { include: { barangay: { include: { municipality: true } } } }, expenses: true, distribution: { include: { allocations: true } } } }
    },
    orderBy: { harvestedAt: "desc" }
  });
  res.json(rows);
});

app.post("/api/harvests/:id/approve", auth, allow(...financeRoles), async (req, res) => {
  try {
    const id = req.params.id as string;
    const result = await prisma.$transaction(async tx => {
      const h = await tx.harvest.findUnique({ where: { id }, include: { items: { include: { expenses: true, vendo: true } } } });
      if (!h) throw new Error("Harvest not found");
      if (h.status === HarvestStatus.APPROVED) throw new Error("Harvest already approved");
      if (h.status === HarvestStatus.REJECTED) throw new Error("Rejected harvest cannot be approved; create a new transaction");
      const items = [];
      for (const item of h.items) {
        const pending = item.expenses.filter((e: any) => e.status === ExpenseStatus.PENDING);
        if (pending.length) await tx.expense.updateMany({ where: { id: { in: pending.map((e: any) => e.id) } }, data: { status: ExpenseStatus.APPROVED } });
        const approvedExpenses = item.expenses.filter((e: any) => e.status === ExpenseStatus.APPROVED || e.status === ExpenseStatus.PENDING).reduce((s: number, e: any) => s + e.amount, 0);
        const net = item.gross - approvedExpenses;
        if (net < 0) throw new Error(`Expenses exceed gross collection for VLAN ${item.vendo.vlanId}`);
        const ownerPercent = item.vendo.ownerPercent;
        const ownerExact = net * ownerPercent / 100;
        const ownerShare = roundPeso(ownerExact);
        const remaining = net - ownerShare;
        const employeePool = roundPeso(remaining * 0.05);
        const companyShare = remaining - employeePool;
        items.push(await tx.distribution.upsert({
          where: { harvestItemId: item.id },
          create: { harvestItemId: item.id, gross: item.gross, approvedExpenses, netAfterExpenses: net, ownerPercent, ownerShare, employeePercent: 5, employeePool, companyShare },
          update: { gross: item.gross, approvedExpenses, netAfterExpenses: net, ownerPercent, ownerShare, employeePercent: 5, employeePool, companyShare }
        }));
      }
      await tx.harvest.update({ where: { id: h.id }, data: { status: HarvestStatus.APPROVED, approvedAt: new Date() } });
      return items;
    });
    res.json({ status: "APPROVED", distributions: result });
  } catch (e:any) { res.status(400).json({ error: e.message }); }
});

app.post("/api/harvests/:id/reject", auth, allow(...financeRoles), async (req, res) => {
  try {
    const id = req.params.id as string;
    const h = await prisma.harvest.findUnique({ where: { id } });
    if (!h) return res.status(404).json({ error: "Harvest not found" });
    if (h.status === HarvestStatus.APPROVED) return res.status(400).json({ error: "Approved harvest cannot be rejected" });
    const updated = await prisma.harvest.update({
      where: { id },
      data: { status: HarvestStatus.REJECTED }
    });
    res.json(updated);
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Expenses
app.post("/api/expenses/:id/approve", auth, allow(...financeRoles), async (req, res) => {
  const id = req.params.id as string;
  const expense = await prisma.expense.update({ where: { id }, data: { status: ExpenseStatus.APPROVED } });
  res.json(expense);
});
app.post("/api/expenses/:id/reject", auth, allow(...financeRoles), async (req, res) => {
  const id = req.params.id as string;
  const expense = await prisma.expense.update({ where: { id }, data: { status: ExpenseStatus.REJECTED } });
  res.json(expense);
});

// Dashboard & Analytics
app.get("/api/dashboard", auth, async (req, res) => {
  const from = req.query.from && !isNaN(Date.parse(String(req.query.from))) ? new Date(String(req.query.from)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = req.query.to && !isNaN(Date.parse(String(req.query.to))) ? new Date(String(req.query.to)) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);
  const harvests = await prisma.harvest.findMany({ where: { harvestedAt: { gte: from, lte: to }, status: HarvestStatus.APPROVED }, include: { items: { include: { distribution: true, vendo: { include: { barangay: { include: { municipality: true } } } } } } } });
  const totals = harvests.flatMap(h=>h.items).reduce((a: { gross: number; expenses: number; owner: number; employee: number; company: number }, i)=>{
    const d=i.distribution;
    a.gross+=i.gross; a.expenses+=d?.approvedExpenses||0; a.owner+=d?.ownerShare||0; a.employee+=d?.employeePool||0; a.company+=d?.companyShare||0; return a;
  }, {gross:0,expenses:0,owner:0,employee:0,company:0});
  const [vendos, municipalities, pending] = await Promise.all([
    prisma.vendo.count({ where: { status: Status.ACTIVE } }),
    prisma.municipality.count(),
    prisma.harvest.count({ where: { status: HarvestStatus.SUBMITTED } })
  ]);
  res.json({ ...totals, net: totals.gross-totals.expenses, vendos, municipalities, pendingHarvests: pending, approvedHarvests: harvests.length });
});

// Reports breakdown
app.get("/api/reports/detailed", auth, async (req, res) => {
  const from = req.query.from && !isNaN(Date.parse(String(req.query.from))) ? new Date(String(req.query.from)) : new Date("2000-01-01");
  const to = req.query.to && !isNaN(Date.parse(String(req.query.to))) ? new Date(String(req.query.to)) : new Date("2099-12-31");
  const harvests = await prisma.harvest.findMany({
    where: { harvestedAt: { gte: from, lte: to }, status: HarvestStatus.APPROVED },
    include: {
      team: true,
      items: {
        include: {
          vendo: { include: { barangay: { include: { municipality: true } }, owner: true } },
          distribution: true,
          expenses: true
        }
      }
    },
    orderBy: { harvestedAt: "asc" }
  });

  const byVendo: Record<string, any> = {};
  for (const h of harvests) {
    for (const item of h.items) {
      const v = item.vendo;
      const key = v.id;
      if (!byVendo[key]) {
        byVendo[key] = {
          vendoId: v.id,
          vlanId: v.vlanId,
          name: v.name,
          location: `${v.barangay?.name || "—"}, ${v.barangay?.municipality?.name || "—"}`,
          ownerName: v.owner?.name || "—",
          harvestCount: 0,
          gross: 0,
          expenses: 0,
          net: 0,
          ownerShare: 0,
          employeePool: 0,
          companyShare: 0
        };
      }
      byVendo[key].harvestCount++;
      byVendo[key].gross += item.gross;
      byVendo[key].expenses += item.distribution?.approvedExpenses || 0;
      byVendo[key].net += item.distribution?.netAfterExpenses || 0;
      byVendo[key].ownerShare += item.distribution?.ownerShare || 0;
      byVendo[key].employeePool += item.distribution?.employeePool || 0;
      byVendo[key].companyShare += item.distribution?.companyShare || 0;
    }
  }

  res.json({
    period: { from, to },
    vendosSummary: Object.values(byVendo),
    totalHarvests: harvests.length
  });
});

// Distributions & Allocations
app.get("/api/distributions", auth, allow(...financeRoles), async (_req, res) => {
  const rows = await prisma.distribution.findMany({
    include: {
      harvestItem: { include: { vendo: { include: { barangay: { include: { municipality: true } } } }, harvest: true } },
      allocations: { include: { employee: { select: { id: true, name: true, email: true } } } }
    },
    orderBy: { createdAt: "desc" }
  });
  res.json(rows);
});

app.get("/api/allocations", auth, allow(...financeRoles), async (_req, res) => res.json(await prisma.employeeAllocation.findMany({ include: { employee: { select: { name: true } }, distribution: { include: { harvestItem: { include: { vendo: true, harvest: true } } } } }, orderBy: { createdAt: "desc" } })));

app.post("/api/distributions/:id/allocations", auth, allow(Role.SUPER_ADMIN, Role.ADMIN, Role.FINANCE), async (req, res) => {
  const p = z.object({ employeeId: z.string(), amount: z.number().int().positive(), note: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Employee and whole-peso allocation amount are required" });
  try {
    const id = req.params.id as string;
    const allocation = await prisma.$transaction(async tx => {
      const d = await tx.distribution.findUnique({ where: { id }, include: { allocations: true } });
      if (!d) throw new Error("Distribution not found");
      const allocated = d.allocations.reduce((s: number, a: any) => s + a.amount, 0);
      if (allocated + p.data.amount > d.employeePool) throw new Error("Allocation exceeds available employee share pool");
      const employee = await tx.user.findUnique({ where: { id: p.data.employeeId } });
      if (!employee) throw new Error("Employee not found");
      return tx.employeeAllocation.create({ data: { distributionId: d.id, employeeId: p.data.employeeId, amount: p.data.amount, note: p.data.note } });
    });
    res.status(201).json(allocation);
  } catch (e:any) { res.status(400).json({ error: e.message }); }
});

// System Version & GitHub Update Checker
app.get("/api/system/version", auth, async (_req, res) => {
  const commit = getLocalCommit();
  res.json({
    version: APP_VERSION,
    commit: commit ? commit.slice(0, 7) : "dev",
    fullCommit: commit,
    repo: GITHUB_REPO,
    nodeVersion: process.version
  });
});

app.get("/api/system/check-updates", auth, async (_req, res) => {
  try {
    const localCommit = getLocalCommit();
    const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`, {
      headers: {
        "User-Agent": "VendoRevenueSystem-Updater",
        "Accept": "application/vnd.github.v3+json"
      }
    });

    if (!resp.ok) {
      if (resp.status === 404 || resp.status === 409) {
        return res.json({
          currentVersion: APP_VERSION,
          currentCommit: localCommit ? localCommit.slice(0, 7) : "dev",
          updateAvailable: false,
          message: "Repository is initialized or empty."
        });
      }
      return res.status(502).json({ error: `GitHub API responded with status ${resp.status}` });
    }

    const latest = await resp.json();
    const remoteSha: string = latest.sha || "";
    const updateAvailable = Boolean(
      localCommit &&
      remoteSha &&
      localCommit !== "local" &&
      !localCommit.startsWith(remoteSha) &&
      !remoteSha.startsWith(localCommit)
    );

    res.json({
      currentVersion: APP_VERSION,
      currentCommit: localCommit ? localCommit.slice(0, 7) : "dev",
      latestCommit: remoteSha.slice(0, 7),
      latestMessage: latest.commit?.message?.split("\n")[0] || "",
      latestDate: latest.commit?.committer?.date || latest.commit?.author?.date,
      updateAvailable,
      repoUrl: `https://github.com/${GITHUB_REPO}`,
      commitUrl: latest.html_url
    });
  } catch (e: any) {
    res.status(500).json({ error: "Could not check GitHub updates: " + e.message });
  }
});

app.post("/api/system/apply-update", auth, allow(Role.SUPER_ADMIN), async (_req, res) => {
  const updateScript = path.resolve(__dirname, "../../scripts/update.sh");
  exec(`bash "${updateScript}"`, (error, stdout, stderr) => {
    if (error) {
      console.error("Update script failed:", error, stderr);
    } else {
      console.log("Update script finished:", stdout);
    }
  });
  res.json({ status: "started", message: "Update initiated in background. The system will refresh when complete." });
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT || 3000);
bootstrap().then(() => app.listen(port, "0.0.0.0", () => console.log(`VRM API listening on ${port}`)))
  .catch(e => { console.error("Startup failed", e); process.exit(1); });
