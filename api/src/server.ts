import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient, Role, HarvestStatus, ExpenseStatus } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN === "*" ? true : process.env.CORS_ORIGIN?.split(",") }));
app.use(express.json({ limit: "2mb" }));

const JWT_SECRET = process.env.JWT_SECRET!;
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
// Round to nearest peso, half up for non-negative amounts.
function roundPeso(n: number) { return Math.floor(n + 0.5); }

async function bootstrap() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: { name: "System Administrator", email, passwordHash: await bcrypt.hash(password, 12), role: Role.SUPER_ADMIN }
    });
    console.log(`Created initial administrator: ${email}`);
  }
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "Vendo Revenue Manager API" }));

app.post("/api/auth/login", async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valid email and password required" });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || user.status !== "ACTIVE" || !(await bcrypt.compare(parsed.data.password, user.passwordHash)))
    return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get("/api/me", auth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, name: true, email: true, role: true } });
  res.json(user);
});

// Generic registry endpoints; all records start empty.
app.get("/api/municipalities", auth, async (_req, res) => res.json(await prisma.municipality.findMany({ include: { _count: { select: { barangays: true } } }, orderBy: { name: "asc" } })));
app.post("/api/municipalities", auth, allow(...adminRoles), async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Municipality name is required" });
  try { res.status(201).json(await prisma.municipality.create({ data: p.data })); }
  catch { res.status(409).json({ error: "Municipality already exists" }); }
});
app.get("/api/barangays", auth, async (_req, res) => res.json(await prisma.barangay.findMany({ include: { municipality: true }, orderBy: { name: "asc" } })));
app.post("/api/barangays", auth, allow(...adminRoles), async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1), municipalityId: z.string() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Barangay name and municipality are required" });
  res.status(201).json(await prisma.barangay.create({ data: p.data }));
});
app.get("/api/owners", auth, async (_req, res) => res.json(await prisma.locationOwner.findMany({ include: { _count: { select: { vendos: true } } }, orderBy: { name: "asc" } })));
app.post("/api/owners", auth, allow(...adminRoles), async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1), phone: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Owner name is required" });
  res.status(201).json(await prisma.locationOwner.create({ data: p.data }));
});
app.get("/api/vendos", auth, async (_req, res) => res.json(await prisma.vendo.findMany({ include: { barangay: { include: { municipality: true } }, owner: true }, orderBy: { vlanId: "asc" } })));
app.post("/api/vendos", auth, allow(...adminRoles), async (req, res) => {
  const p = z.object({ vlanId: z.number().int().positive(), name: z.string().trim().min(1), barangayId: z.string().optional().nullable(), ownerId: z.string().optional().nullable(), ownerPercent: z.number().int().min(0).max(100).default(25), notes: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid vendo data", details: p.error.flatten() });
  try { res.status(201).json(await prisma.vendo.create({ data: p.data })); }
  catch { res.status(409).json({ error: "VLAN ID already exists or related record is invalid" }); }
});
app.get("/api/teams", auth, async (_req, res) => res.json(await prisma.harvestTeam.findMany({ orderBy: { name: "asc" } })));
app.post("/api/teams", auth, allow(...adminRoles), async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1), leader: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Team name is required" });
  try { res.status(201).json(await prisma.harvestTeam.create({ data: p.data })); } catch { res.status(409).json({ error: "Team already exists" }); }
});
app.get("/api/users", auth, allow(...adminRoles), async (_req, res) => res.json(await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, status: true, createdAt: true }, orderBy: { name: "asc" } })));
app.post("/api/users", auth, allow(Role.SUPER_ADMIN), async (req, res) => {
  const p = z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(12), role: z.nativeEnum(Role) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid user data; password must be at least 12 characters" });
  try {
    const u = await prisma.user.create({ data: { ...p.data, passwordHash: await bcrypt.hash(p.data.password, 12) }, select: { id: true, name: true, email: true, role: true } });
    res.status(201).json(u);
  } catch { res.status(409).json({ error: "Email already exists" }); }
});

app.post("/api/harvests", auth, async (req: AuthRequest, res) => {
  const p = z.object({
    harvestedAt: z.string().datetime(), teamId: z.string().optional().nullable(), remarks: z.string().optional(),
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
    const result = await prisma.$transaction(async tx => {
      const reference = `H-${Date.now()}-${Math.floor(Math.random()*1000).toString().padStart(3,"0")}`;
      return tx.harvest.create({ data: {
        reference, harvestedAt: new Date(p.data.harvestedAt), teamId: p.data.teamId || null,
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
  const from = req.query.from ? new Date(String(req.query.from)) : new Date("2000-01-01");
  const to = req.query.to ? new Date(String(req.query.to)) : new Date("2999-12-31");
  const rows = await prisma.harvest.findMany({ where: { harvestedAt: { gte: from, lte: to } }, include: { team: true, encoder: { select: { name: true } }, items: { include: { vendo: true, expenses: true, distribution: true } } }, orderBy: { harvestedAt: "desc" } });
  res.json(rows);
});

app.post("/api/harvests/:id/approve", auth, allow(...financeRoles), async (req, res) => {
  try {
    const result = await prisma.$transaction(async tx => {
      const h = await tx.harvest.findUnique({ where: { id: req.params.id }, include: { items: { include: { expenses: true, vendo: true } } } });
      if (!h) throw new Error("Harvest not found");
      if (h.status === HarvestStatus.APPROVED) throw new Error("Harvest already approved");
      if (h.status === HarvestStatus.REJECTED) throw new Error("Rejected harvest cannot be approved; create a new transaction");
      const items = [];
      for (const item of h.items) {
        const pending = item.expenses.filter(e => e.status === ExpenseStatus.PENDING);
        // Approval approves submitted expenses as part of this harvest. Finance can reject individual expenses separately in a future workflow.
        if (pending.length) await tx.expense.updateMany({ where: { id: { in: pending.map(e => e.id) } }, data: { status: ExpenseStatus.APPROVED } });
        const approvedExpenses = item.expenses.filter(e => e.status === ExpenseStatus.APPROVED || e.status === ExpenseStatus.PENDING).reduce((s,e)=>s+e.amount,0);
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

app.post("/api/expenses/:id/approve", auth, allow(...financeRoles), async (req, res) => {
  const expense = await prisma.expense.update({ where: { id: req.params.id }, data: { status: ExpenseStatus.APPROVED } });
  res.json(expense);
});
app.post("/api/expenses/:id/reject", auth, allow(...financeRoles), async (req, res) => {
  const expense = await prisma.expense.update({ where: { id: req.params.id }, data: { status: ExpenseStatus.REJECTED } });
  res.json(expense);
});

app.get("/api/dashboard", auth, async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const harvests = await prisma.harvest.findMany({ where: { harvestedAt: { gte: from, lte: to }, status: HarvestStatus.APPROVED }, include: { items: { include: { distribution: true, vendo: { include: { barangay: { include: { municipality: true } } } } } } } });
  const totals = harvests.flatMap(h=>h.items).reduce((a,i)=>{
    const d=i.distribution;
    a.gross+=i.gross; a.expenses+=d?.approvedExpenses||0; a.owner+=d?.ownerShare||0; a.employee+=d?.employeePool||0; a.company+=d?.companyShare||0; return a;
  }, {gross:0,expenses:0,owner:0,employee:0,company:0});
  const [vendos, municipalities, pending] = await Promise.all([
    prisma.vendo.count({ where: { status: "ACTIVE" } }),
    prisma.municipality.count(),
    prisma.harvest.count({ where: { status: HarvestStatus.SUBMITTED } })
  ]);
  res.json({ ...totals, net: totals.gross-totals.expenses, vendos, municipalities, pendingHarvests: pending, approvedHarvests: harvests.length });
});

app.get("/api/allocations", auth, allow(...financeRoles), async (_req, res) => res.json(await prisma.employeeAllocation.findMany({ include: { employee: { select: { name: true } }, distribution: { include: { harvestItem: { include: { vendo: true, harvest: true } } } } }, orderBy: { createdAt: "desc" } })));
app.post("/api/distributions/:id/allocations", auth, allow(Role.SUPER_ADMIN, Role.ADMIN, Role.FINANCE), async (req, res) => {
  const p = z.object({ employeeId: z.string(), amount: z.number().int().positive(), note: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Employee and whole-peso allocation amount are required" });
  try {
    const allocation = await prisma.$transaction(async tx => {
      const d = await tx.distribution.findUnique({ where: { id: req.params.id }, include: { allocations: true } });
      if (!d) throw new Error("Distribution not found");
      const allocated = d.allocations.reduce((s,a)=>s+a.amount,0);
      if (allocated + p.data.amount > d.employeePool) throw new Error("Allocation exceeds available employee share pool");
      const employee = await tx.user.findUnique({ where: { id: p.data.employeeId } });
      if (!employee) throw new Error("Employee not found");
      return tx.employeeAllocation.create({ data: { distributionId: d.id, employeeId: p.data.employeeId, amount: p.data.amount, note: p.data.note } });
    });
    res.status(201).json(allocation);
  } catch (e:any) { res.status(400).json({ error: e.message }); }
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT || 3000);
bootstrap().then(() => app.listen(port, "0.0.0.0", () => console.log(`VRM API listening on ${port}`)))
  .catch(e => { console.error("Startup failed", e); process.exit(1); });
