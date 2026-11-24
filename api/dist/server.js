"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const http_1 = __importDefault(require("http"));
const prisma = new client_1.PrismaClient();
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: process.env.CORS_ORIGIN === "*" ? true : process.env.CORS_ORIGIN?.split(",") }));
app.use(express_1.default.json({ limit: "5mb" }));
const JWT_SECRET = process.env.JWT_SECRET || "vrm-fallback-secret-development-only-change-in-production";
const APP_VERSION = "1.0.0";
const GITHUB_REPO = process.env.GITHUB_REPO || "chavxxx/Vendo-Revenue-System";
function auth(req, res, next) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token)
        return res.status(401).json({ error: "Authentication required" });
    try {
        req.user = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        next();
    }
    catch {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}
function allow(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role))
            return res.status(403).json({ error: "Insufficient permissions" });
        next();
    };
}
const adminRoles = [client_1.Role.SUPER_ADMIN, client_1.Role.ADMIN];
const financeRoles = [client_1.Role.SUPER_ADMIN, client_1.Role.ADMIN, client_1.Role.FINANCE];
function pesos(n) {
    if (!Number.isSafeInteger(n) || n < 0)
        throw new Error("Money amounts must be non-negative whole pesos");
    return n;
}
function roundPeso(n) { return Math.floor(n + 0.5); }
function getLocalCommit() {
    if (process.env.GIT_COMMIT && process.env.GIT_COMMIT !== "local") {
        return process.env.GIT_COMMIT.trim();
    }
    try {
        const gitSha = (0, child_process_1.execSync)("git rev-parse HEAD", { timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
        if (gitSha && gitSha.length >= 7)
            return gitSha;
    }
    catch { }
    try {
        if (fs_1.default.existsSync("/workspace/.git")) {
            const gitSha = (0, child_process_1.execSync)("git -C /workspace rev-parse HEAD", { timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
            if (gitSha && gitSha.length >= 7)
                return gitSha;
        }
    }
    catch { }
    const searchPaths = [
        path_1.default.resolve(__dirname, "version.json"),
        path_1.default.resolve(__dirname, "../version.json"),
        path_1.default.resolve(__dirname, "../../version.json"),
        "/workspace/version.json",
        "/app/dist/version.json",
        "/app/version.json",
        path_1.default.resolve(__dirname, "../.git-commit"),
        path_1.default.resolve(__dirname, "../../.git-commit"),
        "/workspace/.git-commit"
    ];
    for (const p of searchPaths) {
        try {
            if (fs_1.default.existsSync(p)) {
                if (p.endsWith(".json")) {
                    const data = JSON.parse(fs_1.default.readFileSync(p, "utf-8"));
                    if (data.commit)
                        return data.commit.trim();
                }
                else {
                    const content = fs_1.default.readFileSync(p, "utf-8").trim();
                    if (content)
                        return content;
                }
            }
        }
        catch { }
    }
    return "dev";
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
            data: { name: "System Administrator", email, passwordHash: await bcryptjs_1.default.hash(password, 12), role: client_1.Role.SUPER_ADMIN, status: client_1.Status.ACTIVE }
        });
        console.log(`Created initial administrator: ${email}`);
    }
}
app.get("/api/health", async (_req, res) => {
    try {
        await prisma.$queryRaw `SELECT 1`;
        res.json({ status: "ok", service: "Vendo Revenue System API", db: "connected", version: APP_VERSION });
    }
    catch {
        res.status(200).json({ status: "ok", service: "Vendo Revenue System API", db: "starting", version: APP_VERSION });
    }
});
// Authentication
app.post("/api/auth/login", async (req, res) => {
    const parsed = zod_1.z.object({ email: zod_1.z.string().email(), password: zod_1.z.string().min(1) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Valid email and password required" });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || user.status !== client_1.Status.ACTIVE || !(await bcryptjs_1.default.compare(parsed.data.password, user.passwordHash)))
        return res.status(401).json({ error: "Invalid credentials" });
    const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});
app.get("/api/me", auth, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true, email: true, role: true } });
    if (!user)
        return res.status(401).json({ error: "User not found" });
    res.json(user);
});
app.post("/api/auth/change-password", auth, async (req, res) => {
    const p = zod_1.z.object({
        currentPassword: zod_1.z.string().min(1),
        newPassword: zod_1.z.string().min(8)
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "New password must be at least 8 characters" });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user)
        return res.status(404).json({ error: "User not found" });
    const match = await bcryptjs_1.default.compare(p.data.currentPassword, user.passwordHash);
    if (!match)
        return res.status(401).json({ error: "Current password does not match" });
    await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcryptjs_1.default.hash(p.data.newPassword, 12) }
    });
    res.json({ status: "ok", message: "Password updated successfully" });
});
// Municipalities
app.get("/api/municipalities", auth, async (_req, res) => res.json(await prisma.municipality.findMany({ include: { _count: { select: { barangays: true } } }, orderBy: { name: "asc" } })));
app.post("/api/municipalities", auth, allow(...adminRoles), async (req, res) => {
    const p = zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(100) }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Municipality name is required" });
    try {
        res.status(201).json(await prisma.municipality.create({ data: p.data }));
    }
    catch {
        res.status(409).json({ error: "Municipality already exists" });
    }
});
app.put("/api/municipalities/:id", auth, allow(...adminRoles), async (req, res) => {
    const id = req.params.id;
    const p = zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(100) }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Valid name is required" });
    try {
        res.json(await prisma.municipality.update({ where: { id }, data: p.data }));
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.delete("/api/municipalities/:id", auth, allow(...adminRoles), async (req, res) => {
    const id = req.params.id;
    try {
        const count = await prisma.barangay.count({ where: { municipalityId: id } });
        if (count > 0)
            return res.status(400).json({ error: `Cannot delete municipality with ${count} existing barangays` });
        await prisma.municipality.delete({ where: { id } });
        res.json({ status: "ok" });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Barangays
app.get("/api/barangays", auth, async (_req, res) => res.json(await prisma.barangay.findMany({ include: { municipality: true, _count: { select: { vendos: true } } }, orderBy: { name: "asc" } })));
app.post("/api/barangays", auth, allow(...adminRoles), async (req, res) => {
    const p = zod_1.z.object({ name: zod_1.z.string().trim().min(1), municipalityId: zod_1.z.string().min(1) }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Barangay name and municipality are required" });
    try {
        res.status(201).json(await prisma.barangay.create({ data: p.data }));
    }
    catch {
        res.status(409).json({ error: "Barangay already exists in this municipality or municipality not found" });
    }
});
app.put("/api/barangays/:id", auth, allow(...adminRoles), async (req, res) => {
    const id = req.params.id;
    const p = zod_1.z.object({ name: zod_1.z.string().trim().min(1), municipalityId: zod_1.z.string().min(1) }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Valid data is required" });
    try {
        res.json(await prisma.barangay.update({ where: { id }, data: p.data }));
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.delete("/api/barangays/:id", auth, allow(...adminRoles), async (req, res) => {
    const id = req.params.id;
    try {
        const count = await prisma.vendo.count({ where: { barangayId: id } });
        if (count > 0)
            return res.status(400).json({ error: `Cannot delete barangay with ${count} assigned vendos` });
        await prisma.barangay.delete({ where: { id } });
        res.json({ status: "ok" });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Location Owners
app.get("/api/owners", auth, async (_req, res) => res.json(await prisma.locationOwner.findMany({ include: { _count: { select: { vendos: true } } }, orderBy: { name: "asc" } })));
app.post("/api/owners", auth, allow(...adminRoles), async (req, res) => {
    const p = zod_1.z.object({ name: zod_1.z.string().trim().min(1), phone: zod_1.z.string().optional() }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Owner name is required" });
    try {
        res.status(201).json(await prisma.locationOwner.create({ data: p.data }));
    }
    catch (e) {
        res.status(400).json({ error: e.message || "Could not create owner" });
    }
});
app.put("/api/owners/:id", auth, allow(...adminRoles), async (req, res) => {
    const id = req.params.id;
    const p = zod_1.z.object({ name: zod_1.z.string().trim().min(1), phone: zod_1.z.string().optional().nullable(), status: zod_1.z.nativeEnum(client_1.Status).optional() }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid owner data" });
    try {
        res.json(await prisma.locationOwner.update({ where: { id }, data: p.data }));
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.delete("/api/owners/:id", auth, allow(...adminRoles), async (req, res) => {
    const id = req.params.id;
    try {
        const count = await prisma.vendo.count({ where: { ownerId: id } });
        if (count > 0) {
            await prisma.locationOwner.update({ where: { id }, data: { status: client_1.Status.INACTIVE } });
            return res.json({ status: "deactivated", message: "Owner has linked vendos and was deactivated." });
        }
        await prisma.locationOwner.delete({ where: { id } });
        res.json({ status: "deleted" });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Revenue Share Settings Helper
async function getRevenueShareSettings() {
    try {
        const settings = await prisma.systemSetting.findMany({
            where: { key: { in: ["default_owner_percent", "default_employee_percent"] } }
        });
        const map = new Map(settings.map(s => [s.key, s.value]));
        const ownerPercent = parseInt(map.get("default_owner_percent") || "25", 10) || 25;
        const employeePercent = parseInt(map.get("default_employee_percent") || "5", 10) || 5;
        const remaining = 100 - ownerPercent;
        const companyPercent = Math.max(0, remaining - Math.round(remaining * (employeePercent / 100)));
        return { ownerPercent, employeePercent, companyPercent };
    }
    catch {
        return { ownerPercent: 25, employeePercent: 5, companyPercent: 71 };
    }
}
// Vendos
app.get("/api/vendos", auth, async (_req, res) => res.json(await prisma.vendo.findMany({ include: { barangay: { include: { municipality: true } }, owner: true }, orderBy: { vlanId: "asc" } })));
app.post("/api/vendos", auth, allow(...adminRoles), async (req, res) => {
    const p = zod_1.z.object({
        vlanId: zod_1.z.coerce.number().int().positive(),
        name: zod_1.z.string().trim().min(1),
        barangayId: zod_1.z.string().optional().nullable(),
        ownerId: zod_1.z.string().optional().nullable(),
        ownerPercent: zod_1.z.coerce.number().int().min(0).max(100).optional(),
        notes: zod_1.z.string().optional()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid vendo data", details: p.error.flatten() });
    try {
        const defaults = await getRevenueShareSettings();
        const data = {
            ...p.data,
            ownerPercent: p.data.ownerPercent !== undefined ? p.data.ownerPercent : defaults.ownerPercent,
            barangayId: p.data.barangayId ? p.data.barangayId : null,
            ownerId: p.data.ownerId ? p.data.ownerId : null,
        };
        res.status(201).json(await prisma.vendo.create({ data }));
    }
    catch {
        res.status(409).json({ error: "VLAN ID already exists or related record is invalid" });
    }
});
app.put("/api/vendos/:id", auth, allow(...adminRoles), async (req, res) => {
    const id = req.params.id;
    const p = zod_1.z.object({
        vlanId: zod_1.z.coerce.number().int().positive().optional(),
        name: zod_1.z.string().trim().min(1).optional(),
        barangayId: zod_1.z.string().optional().nullable(),
        ownerId: zod_1.z.string().optional().nullable(),
        ownerPercent: zod_1.z.coerce.number().int().min(0).max(100).optional(),
        status: zod_1.z.nativeEnum(client_1.Status).optional(),
        notes: zod_1.z.string().optional().nullable()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid vendo update data" });
    try {
        const data = {
            ...p.data,
            barangayId: p.data.barangayId === "" ? null : p.data.barangayId,
            ownerId: p.data.ownerId === "" ? null : p.data.ownerId
        };
        res.json(await prisma.vendo.update({ where: { id }, data, include: { barangay: { include: { municipality: true } }, owner: true } }));
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.delete("/api/vendos/:id", auth, allow(...adminRoles), async (req, res) => {
    const id = req.params.id;
    try {
        const count = await prisma.harvestItem.count({ where: { vendoId: id } });
        if (count > 0) {
            await prisma.vendo.update({ where: { id }, data: { status: client_1.Status.INACTIVE } });
            return res.json({ status: "deactivated", message: "Vendo has historical harvest records and was marked INACTIVE." });
        }
        await prisma.vendo.delete({ where: { id } });
        res.json({ status: "deleted" });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Harvesting Teams
app.get("/api/teams", auth, async (_req, res) => res.json(await prisma.harvestTeam.findMany({ include: { _count: { select: { harvests: true } } }, orderBy: { name: "asc" } })));
app.post("/api/teams", auth, allow(...adminRoles), async (req, res) => {
    const p = zod_1.z.object({ name: zod_1.z.string().trim().min(1), leader: zod_1.z.string().optional() }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Team name is required" });
    try {
        res.status(201).json(await prisma.harvestTeam.create({ data: p.data }));
    }
    catch {
        res.status(409).json({ error: "Team already exists" });
    }
});
app.put("/api/teams/:id", auth, allow(...adminRoles), async (req, res) => {
    const id = req.params.id;
    const p = zod_1.z.object({ name: zod_1.z.string().trim().min(1), leader: zod_1.z.string().optional().nullable(), status: zod_1.z.nativeEnum(client_1.Status).optional() }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid team data" });
    try {
        res.json(await prisma.harvestTeam.update({ where: { id }, data: p.data }));
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.delete("/api/teams/:id", auth, allow(...adminRoles), async (req, res) => {
    const id = req.params.id;
    try {
        const count = await prisma.harvest.count({ where: { teamId: id } });
        if (count > 0) {
            await prisma.harvestTeam.update({ where: { id }, data: { status: client_1.Status.INACTIVE } });
            return res.json({ status: "deactivated", message: "Team has harvest history and was marked INACTIVE." });
        }
        await prisma.harvestTeam.delete({ where: { id } });
        res.json({ status: "deleted" });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Users
app.get("/api/users", auth, allow(...adminRoles), async (_req, res) => res.json(await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, status: true, createdAt: true }, orderBy: { name: "asc" } })));
app.post("/api/users", auth, allow(client_1.Role.SUPER_ADMIN), async (req, res) => {
    const p = zod_1.z.object({ name: zod_1.z.string().min(1), email: zod_1.z.string().email(), password: zod_1.z.string().min(8), role: zod_1.z.nativeEnum(client_1.Role) }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid user data; password must be at least 8 characters" });
    try {
        const u = await prisma.user.create({ data: { ...p.data, passwordHash: await bcryptjs_1.default.hash(p.data.password, 12) }, select: { id: true, name: true, email: true, role: true } });
        res.status(201).json(u);
    }
    catch {
        res.status(409).json({ error: "Email already exists" });
    }
});
app.put("/api/users/:id", auth, allow(client_1.Role.SUPER_ADMIN), async (req, res) => {
    const id = req.params.id;
    const p = zod_1.z.object({
        name: zod_1.z.string().min(1).optional(),
        role: zod_1.z.nativeEnum(client_1.Role).optional(),
        status: zod_1.z.nativeEnum(client_1.Status).optional(),
        password: zod_1.z.string().min(8).optional()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid user update data" });
    try {
        const updateData = {};
        if (p.data.name)
            updateData.name = p.data.name;
        if (p.data.role)
            updateData.role = p.data.role;
        if (p.data.status)
            updateData.status = p.data.status;
        if (p.data.password)
            updateData.passwordHash = await bcryptjs_1.default.hash(p.data.password, 12);
        const u = await prisma.user.update({ where: { id }, data: updateData, select: { id: true, name: true, email: true, role: true, status: true } });
        res.json(u);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Harvesting
app.post("/api/harvests", auth, async (req, res) => {
    const p = zod_1.z.object({
        harvestedAt: zod_1.z.union([zod_1.z.string().datetime(), zod_1.z.string().min(1), zod_1.z.date()]),
        teamId: zod_1.z.string().optional().nullable(),
        remarks: zod_1.z.string().optional(),
        items: zod_1.z.array(zod_1.z.object({
            vendoId: zod_1.z.string(),
            coins: zod_1.z.array(zod_1.z.object({ denomination: zod_1.z.number().int().positive(), quantity: zod_1.z.number().int().nonnegative() })).optional().default([]),
            gross: zod_1.z.number().int().nonnegative().optional(),
            expenses: zod_1.z.array(zod_1.z.object({ category: zod_1.z.string().min(1), description: zod_1.z.string().optional(), amount: zod_1.z.number().int().positive() })).optional().default([])
        })).min(1)
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid harvesting data", details: p.error.flatten() });
    const refs = new Set();
    for (const item of p.data.items)
        if (refs.has(item.vendoId))
            return res.status(400).json({ error: "A vendo can only appear once per harvest session" });
        else
            refs.add(item.vendoId);
    try {
        const harvestDate = new Date(p.data.harvestedAt);
        if (isNaN(harvestDate.getTime()))
            throw new Error("Invalid harvest date format");
        const result = await prisma.$transaction(async (tx) => {
            const reference = `H-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
            return tx.harvest.create({ data: {
                    reference, harvestedAt: harvestDate, teamId: p.data.teamId || null,
                    encoderId: req.user.id, remarks: p.data.remarks,
                    items: { create: p.data.items.map(i => {
                            const coinTotal = i.coins.reduce((s, c) => s + c.denomination * c.quantity, 0);
                            const gross = i.gross ?? coinTotal;
                            if (i.coins.length && gross !== coinTotal)
                                throw new Error("Gross amount must equal denomination totals");
                            pesos(gross);
                            return { vendoId: i.vendoId, gross,
                                coinCounts: { create: i.coins.map(c => ({ ...c, amount: c.denomination * c.quantity })) },
                                expenses: { create: i.expenses.map(e => ({ ...e, status: client_1.ExpenseStatus.PENDING })) }
                            };
                        }) }
                }, include: { items: { include: { vendo: true, expenses: true, coinCounts: true } }, team: true } });
        });
        res.status(201).json(result);
    }
    catch (e) {
        res.status(400).json({ error: e.message || "Could not create harvest" });
    }
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
        const id = req.params.id;
        const sysSettings = await getRevenueShareSettings();
        const result = await prisma.$transaction(async (tx) => {
            const h = await tx.harvest.findUnique({ where: { id }, include: { items: { include: { expenses: true, vendo: true } } } });
            if (!h)
                throw new Error("Harvest not found");
            if (h.status === client_1.HarvestStatus.APPROVED)
                throw new Error("Harvest already approved");
            if (h.status === client_1.HarvestStatus.REJECTED)
                throw new Error("Rejected harvest cannot be approved; create a new transaction");
            const items = [];
            for (const item of h.items) {
                const pending = item.expenses.filter((e) => e.status === client_1.ExpenseStatus.PENDING);
                if (pending.length)
                    await tx.expense.updateMany({ where: { id: { in: pending.map((e) => e.id) } }, data: { status: client_1.ExpenseStatus.APPROVED } });
                const approvedExpenses = item.expenses.filter((e) => e.status === client_1.ExpenseStatus.APPROVED || e.status === client_1.ExpenseStatus.PENDING).reduce((s, e) => s + e.amount, 0);
                const net = item.gross - approvedExpenses;
                if (net < 0)
                    throw new Error(`Expenses exceed gross collection for VLAN ${item.vendo.vlanId}`);
                const ownerPercent = req.body?.ownerPercent !== undefined ? Number(req.body.ownerPercent) : (item.vendo.ownerPercent || sysSettings.ownerPercent);
                const employeePercent = req.body?.employeePercent !== undefined ? Number(req.body.employeePercent) : sysSettings.employeePercent;
                const ownerExact = net * ownerPercent / 100;
                const ownerShare = roundPeso(ownerExact);
                const remaining = net - ownerShare;
                const employeePool = roundPeso(remaining * (employeePercent / 100));
                const companyShare = remaining - employeePool;
                items.push(await tx.distribution.upsert({
                    where: { harvestItemId: item.id },
                    create: { harvestItemId: item.id, gross: item.gross, approvedExpenses, netAfterExpenses: net, ownerPercent, ownerShare, employeePercent, employeePool, companyShare },
                    update: { gross: item.gross, approvedExpenses, netAfterExpenses: net, ownerPercent, ownerShare, employeePercent, employeePool, companyShare }
                }));
            }
            await tx.harvest.update({ where: { id: h.id }, data: { status: client_1.HarvestStatus.APPROVED, approvedAt: new Date() } });
            return items;
        });
        res.json({ status: "APPROVED", distributions: result });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.post("/api/harvests/:id/reject", auth, allow(...financeRoles), async (req, res) => {
    try {
        const id = req.params.id;
        const h = await prisma.harvest.findUnique({ where: { id } });
        if (!h)
            return res.status(404).json({ error: "Harvest not found" });
        if (h.status === client_1.HarvestStatus.APPROVED)
            return res.status(400).json({ error: "Approved harvest cannot be rejected" });
        const updated = await prisma.harvest.update({
            where: { id },
            data: { status: client_1.HarvestStatus.REJECTED }
        });
        res.json(updated);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Expenses
app.post("/api/expenses/:id/approve", auth, allow(...financeRoles), async (req, res) => {
    const id = req.params.id;
    const expense = await prisma.expense.update({ where: { id }, data: { status: client_1.ExpenseStatus.APPROVED } });
    res.json(expense);
});
app.post("/api/expenses/:id/reject", auth, allow(...financeRoles), async (req, res) => {
    const id = req.params.id;
    const expense = await prisma.expense.update({ where: { id }, data: { status: client_1.ExpenseStatus.REJECTED } });
    res.json(expense);
});
// Dashboard & Analytics
app.get("/api/dashboard", auth, async (req, res) => {
    const from = req.query.from && !isNaN(Date.parse(String(req.query.from))) ? new Date(String(req.query.from)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = req.query.to && !isNaN(Date.parse(String(req.query.to))) ? new Date(String(req.query.to)) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);
    const harvests = await prisma.harvest.findMany({ where: { harvestedAt: { gte: from, lte: to }, status: client_1.HarvestStatus.APPROVED }, include: { items: { include: { distribution: true, vendo: { include: { barangay: { include: { municipality: true } } } } } } } });
    const totals = harvests.flatMap(h => h.items).reduce((a, i) => {
        const d = i.distribution;
        a.gross += i.gross;
        a.expenses += d?.approvedExpenses || 0;
        a.owner += d?.ownerShare || 0;
        a.employee += d?.employeePool || 0;
        a.company += d?.companyShare || 0;
        return a;
    }, { gross: 0, expenses: 0, owner: 0, employee: 0, company: 0 });
    const [vendos, municipalities, pending] = await Promise.all([
        prisma.vendo.count({ where: { status: client_1.Status.ACTIVE } }),
        prisma.municipality.count(),
        prisma.harvest.count({ where: { status: client_1.HarvestStatus.SUBMITTED } })
    ]);
    res.json({ ...totals, net: totals.gross - totals.expenses, vendos, municipalities, pendingHarvests: pending, approvedHarvests: harvests.length });
});
// Reports breakdown
app.get("/api/reports/detailed", auth, async (req, res) => {
    const from = req.query.from && !isNaN(Date.parse(String(req.query.from))) ? new Date(String(req.query.from)) : new Date("2000-01-01");
    const to = req.query.to && !isNaN(Date.parse(String(req.query.to))) ? new Date(String(req.query.to)) : new Date("2099-12-31");
    const harvests = await prisma.harvest.findMany({
        where: { harvestedAt: { gte: from, lte: to }, status: client_1.HarvestStatus.APPROVED },
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
    const byVendo = {};
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
app.post("/api/distributions/:id/allocations", auth, allow(client_1.Role.SUPER_ADMIN, client_1.Role.ADMIN, client_1.Role.FINANCE), async (req, res) => {
    const p = zod_1.z.object({ employeeId: zod_1.z.string(), amount: zod_1.z.number().int().positive(), note: zod_1.z.string().optional() }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Employee and whole-peso allocation amount are required" });
    try {
        const id = req.params.id;
        const allocation = await prisma.$transaction(async (tx) => {
            const d = await tx.distribution.findUnique({ where: { id }, include: { allocations: true } });
            if (!d)
                throw new Error("Distribution not found");
            const allocated = d.allocations.reduce((s, a) => s + a.amount, 0);
            if (allocated + p.data.amount > d.employeePool)
                throw new Error("Allocation exceeds available employee share pool");
            const employee = await tx.user.findUnique({ where: { id: p.data.employeeId } });
            if (!employee)
                throw new Error("Employee not found");
            return tx.employeeAllocation.create({ data: { distributionId: d.id, employeeId: p.data.employeeId, amount: p.data.amount, note: p.data.note } });
        });
        res.status(201).json(allocation);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Update distribution percentages and recalculate shares
app.put("/api/distributions/:id", auth, allow(...financeRoles), async (req, res) => {
    const id = req.params.id;
    const p = zod_1.z.object({
        ownerPercent: zod_1.z.coerce.number().int().min(0).max(100).optional(),
        employeePercent: zod_1.z.coerce.number().int().min(0).max(100).optional()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid distribution share data" });
    try {
        const dist = await prisma.distribution.findUnique({ where: { id } });
        if (!dist)
            return res.status(404).json({ error: "Distribution record not found" });
        const ownerPercent = p.data.ownerPercent !== undefined ? p.data.ownerPercent : dist.ownerPercent;
        const employeePercent = p.data.employeePercent !== undefined ? p.data.employeePercent : dist.employeePercent;
        const net = dist.netAfterExpenses;
        const ownerExact = net * ownerPercent / 100;
        const ownerShare = roundPeso(ownerExact);
        const remaining = net - ownerShare;
        const employeePool = roundPeso(remaining * (employeePercent / 100));
        const companyShare = remaining - employeePool;
        const updated = await prisma.distribution.update({
            where: { id },
            data: {
                ownerPercent,
                ownerShare,
                employeePercent,
                employeePool,
                companyShare
            }
        });
        res.json(updated);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// System Revenue Share Settings
app.get("/api/system/settings", auth, async (_req, res) => {
    const shares = await getRevenueShareSettings();
    res.json(shares);
});
app.post("/api/system/settings", auth, allow(...adminRoles), async (req, res) => {
    const p = zod_1.z.object({
        ownerPercent: zod_1.z.coerce.number().int().min(0).max(100),
        employeePercent: zod_1.z.coerce.number().int().min(0).max(100)
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid share percentages", details: p.error.flatten() });
    try {
        await prisma.$transaction([
            prisma.systemSetting.upsert({
                where: { key: "default_owner_percent" },
                create: { key: "default_owner_percent", value: p.data.ownerPercent.toString() },
                update: { value: p.data.ownerPercent.toString() }
            }),
            prisma.systemSetting.upsert({
                where: { key: "default_employee_percent" },
                create: { key: "default_employee_percent", value: p.data.employeePercent.toString() },
                update: { value: p.data.employeePercent.toString() }
            })
        ]);
        const updated = await getRevenueShareSettings();
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
function restartDockerContainer(containerName) {
    return new Promise((resolve) => {
        if (!fs_1.default.existsSync("/var/run/docker.sock"))
            return resolve(false);
        const req = http_1.default.request({
            socketPath: "/var/run/docker.sock",
            path: `/v1.43/containers/${containerName}/restart`,
            method: "POST"
        }, (res) => resolve(res.statusCode === 204 || res.statusCode === 200));
        req.on("error", (e) => {
            console.warn(`[Updater] Docker socket restart for ${containerName} failed:`, e.message);
            resolve(false);
        });
        req.setTimeout(8000, () => {
            req.destroy();
            resolve(false);
        });
        req.end();
    });
}
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
        const remoteSha = latest.sha || "";
        const isSame = Boolean(localCommit &&
            remoteSha &&
            localCommit !== "dev" &&
            (localCommit.toLowerCase().startsWith(remoteSha.toLowerCase()) ||
                remoteSha.toLowerCase().startsWith(localCommit.toLowerCase())));
        const updateAvailable = Boolean(remoteSha && !isSame);
        res.json({
            currentVersion: APP_VERSION,
            currentCommit: localCommit ? localCommit.slice(0, 7) : "dev",
            fullCurrentCommit: localCommit,
            latestCommit: remoteSha.slice(0, 7),
            fullLatestCommit: remoteSha,
            latestMessage: latest.commit?.message?.split("\n")[0] || "",
            latestAuthor: latest.commit?.author?.name || latest.author?.login || "Maintainer",
            latestDate: latest.commit?.committer?.date || latest.commit?.author?.date,
            updateAvailable,
            repoUrl: `https://github.com/${GITHUB_REPO}`,
            commitUrl: latest.html_url
        });
    }
    catch (e) {
        res.status(500).json({ error: "Could not check GitHub updates: " + e.message });
    }
});
app.post("/api/system/apply-update", auth, allow(client_1.Role.SUPER_ADMIN), async (_req, res) => {
    let projectRoot = "";
    if (fs_1.default.existsSync("/workspace/scripts/update.sh") || fs_1.default.existsSync("/workspace/.git")) {
        projectRoot = "/workspace";
    }
    else if (fs_1.default.existsSync(path_1.default.resolve(__dirname, "../../scripts/update.sh"))) {
        projectRoot = path_1.default.resolve(__dirname, "../..");
    }
    else if (fs_1.default.existsSync(path_1.default.resolve(__dirname, "../scripts/update.sh"))) {
        projectRoot = path_1.default.resolve(__dirname, "..");
    }
    else {
        projectRoot = process.cwd();
    }
    console.log(`[Updater] Starting update process in root: ${projectRoot}`);
    // Send early HTTP response so UI can show progress immediately
    res.json({
        status: "started",
        message: "Update initiated. Pulling code from GitHub, syncing database, and reloading services."
    });
    // Execute update sequence asynchronously
    setTimeout(async () => {
        try {
            try {
                (0, child_process_1.execSync)("git config --global --add safe.directory '*'", { timeout: 5000, stdio: "ignore" });
            }
            catch { }
            let gitSuccess = false;
            try {
                console.log(`[Updater] Running git fetch and reset to origin/main in ${projectRoot}...`);
                (0, child_process_1.execSync)(`git -C "${projectRoot}" fetch origin main`, { timeout: 60000, stdio: "inherit" });
                (0, child_process_1.execSync)(`git -C "${projectRoot}" reset --hard origin/main`, { timeout: 30000, stdio: "inherit" });
                gitSuccess = true;
                console.log(`[Updater] Git update succeeded.`);
            }
            catch (e) {
                console.warn(`[Updater] Direct git reset failed (${e.message}), trying update.sh script...`);
                const updateScript = path_1.default.join(projectRoot, "scripts/update.sh");
                if (fs_1.default.existsSync(updateScript)) {
                    try {
                        (0, child_process_1.execSync)(`bash "${updateScript}"`, { timeout: 90000, stdio: "inherit" });
                        gitSuccess = true;
                    }
                    catch (shErr) {
                        console.error(`[Updater] bash update.sh failed:`, shErr.message);
                    }
                }
            }
            // Sync Prisma schema
            try {
                console.log(`[Updater] Syncing Prisma database schema...`);
                const prismaCmd = fs_1.default.existsSync("./node_modules/.bin/prisma")
                    ? "./node_modules/.bin/prisma"
                    : fs_1.default.existsSync(`${projectRoot}/api/node_modules/.bin/prisma`)
                        ? `${projectRoot}/api/node_modules/.bin/prisma`
                        : "npx prisma";
                (0, child_process_1.execSync)(`${prismaCmd} db push --skip-generate`, { timeout: 45000, stdio: "inherit" });
                console.log(`[Updater] Database schema sync completed.`);
            }
            catch (pErr) {
                console.warn(`[Updater] Prisma db push warning:`, pErr.message);
            }
            // If Docker socket is mounted, restart Nginx and API containers
            if (fs_1.default.existsSync("/var/run/docker.sock")) {
                console.log(`[Updater] Restarting vrm-web container...`);
                await restartDockerContainer("vrm-web");
                console.log(`[Updater] Restarting vrm-api container...`);
                await restartDockerContainer("vrm-api");
            }
            // Also exit current process cleanly so container restart policy or host supervisor refreshes
            console.log(`[Updater] Process reload scheduled in 1.2s.`);
            setTimeout(() => process.exit(0), 1200);
        }
        catch (err) {
            console.error(`[Updater] Update execution encountered error:`, err);
        }
    }, 100);
});
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
});
const port = Number(process.env.PORT || 3000);
bootstrap().then(() => app.listen(port, "0.0.0.0", () => console.log(`VRM API listening on ${port}`)))
    .catch(e => { console.error("Startup failed", e); process.exit(1); });
