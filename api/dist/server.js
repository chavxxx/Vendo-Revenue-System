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
app.use(express_1.default.json({ limit: "10mb" }));
const JWT_SECRET = process.env.JWT_SECRET || "vrm-fallback-secret-development-only-change-in-production";
const APP_VERSION = "1.0.0";
const GITHUB_REPO = process.env.GITHUB_REPO || "chavxxx/Vendo-Revenue-System";
const ALL_PERMS_TRUE = {
    viewDashboard: true,
    encodeHarvest: true,
    editHarvest: true,
    approveHarvest: true,
    manageVendos: true,
    manageLocations: true,
    manageTeams: true,
    manageExpenses: true,
    manageRemittances: true,
    viewReports: true,
    manageUsers: true,
    manageSettings: true
};
const ROLE_DEFAULT_PERMS = {
    SUPER_ADMIN: { ...ALL_PERMS_TRUE },
    ADMIN: { ...ALL_PERMS_TRUE },
    FINANCE: {
        viewDashboard: true,
        encodeHarvest: false,
        editHarvest: false,
        approveHarvest: true,
        manageVendos: false,
        manageLocations: false,
        manageTeams: false,
        manageExpenses: true,
        manageRemittances: true,
        viewReports: true,
        manageUsers: false,
        manageSettings: false
    },
    ENCODER: {
        viewDashboard: true,
        encodeHarvest: true,
        editHarvest: false,
        approveHarvest: false,
        manageVendos: true,
        manageLocations: false,
        manageTeams: false,
        manageExpenses: true,
        manageRemittances: false,
        viewReports: false,
        manageUsers: false,
        manageSettings: false
    },
    HARVESTER: {
        viewDashboard: true,
        encodeHarvest: true,
        editHarvest: false,
        approveHarvest: false,
        manageVendos: false,
        manageLocations: false,
        manageTeams: false,
        manageExpenses: true,
        manageRemittances: true,
        viewReports: false,
        manageUsers: false,
        manageSettings: false
    }
};
function resolvePermissions(role, custom) {
    if (role === client_1.Role.SUPER_ADMIN)
        return { ...ALL_PERMS_TRUE };
    const base = ROLE_DEFAULT_PERMS[role] || ROLE_DEFAULT_PERMS.HARVESTER;
    if (custom && typeof custom === "object") {
        const out = { ...base };
        for (const k of Object.keys(ALL_PERMS_TRUE)) {
            if (typeof custom[k] === "boolean")
                out[k] = custom[k];
        }
        return out;
    }
    return { ...base };
}
async function auth(req, res, next) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token)
        return res.status(401).json({ error: "Authentication required" });
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        const dbUser = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { id: true, role: true, email: true, status: true, permissions: true }
        });
        if (!dbUser || dbUser.status !== client_1.Status.ACTIVE) {
            return res.status(401).json({ error: "Account inactive or not found" });
        }
        req.user = {
            id: dbUser.id,
            role: dbUser.role,
            email: dbUser.email,
            permissions: resolvePermissions(dbUser.role, dbUser.permissions)
        };
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
function requirePerm(perm) {
    return (req, res, next) => {
        if (!req.user)
            return res.status(401).json({ error: "Authentication required" });
        if (req.user.role === client_1.Role.SUPER_ADMIN || req.user.permissions?.[perm])
            return next();
        return res.status(403).json({ error: `Permission denied: requires ${perm}` });
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
    const emailLower = parsed.data.email.trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: { email: { equals: emailLower, mode: "insensitive" } } });
    if (!user || user.status !== client_1.Status.ACTIVE || !(await bcryptjs_1.default.compare(parsed.data.password, user.passwordHash)))
        return res.status(401).json({ error: "Invalid credentials" });
    const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "12h" });
    const permissions = resolvePermissions(user.role, user.permissions);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions } });
});
app.get("/api/me", auth, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true, email: true, role: true, permissions: true } });
    if (!user)
        return res.status(401).json({ error: "User not found" });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, permissions: resolvePermissions(user.role, user.permissions) });
});
// Public Branding Endpoint (used on login page & app shell)
app.get("/api/system/branding", async (_req, res) => {
    try {
        const rows = await prisma.systemSetting.findMany({
            where: { key: { in: ["company_name", "company_logo"] } }
        });
        const map = new Map(rows.map(r => [r.key, r.value]));
        res.json({
            companyName: map.get("company_name") || "Vendo Revenue",
            companyLogo: map.get("company_logo") || ""
        });
    }
    catch {
        res.json({ companyName: "Vendo Revenue", companyLogo: "" });
    }
});
app.post("/api/system/branding", auth, requirePerm("manageSettings"), async (req, res) => {
    const p = zod_1.z.object({
        companyName: zod_1.z.string().trim().min(1).max(80),
        companyLogo: zod_1.z.string().max(2_500_000).optional().nullable()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid branding data (company name required, logo max ~2MB)" });
    try {
        await prisma.$transaction([
            prisma.systemSetting.upsert({
                where: { key: "company_name" },
                create: { key: "company_name", value: p.data.companyName },
                update: { value: p.data.companyName }
            }),
            prisma.systemSetting.upsert({
                where: { key: "company_logo" },
                create: { key: "company_logo", value: p.data.companyLogo || "" },
                update: { value: p.data.companyLogo || "" }
            })
        ]);
        res.json({ companyName: p.data.companyName, companyLogo: p.data.companyLogo || "" });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
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
app.get("/api/vendos", auth, async (req, res) => {
    const municipalityId = req.query.municipalityId ? String(req.query.municipalityId) : "";
    const where = {};
    if (municipalityId) {
        where.barangay = { municipalityId };
    }
    const rows = await prisma.vendo.findMany({
        where,
        include: { barangay: { include: { municipality: true } }, owner: true },
        orderBy: [{ ipAddress: "asc" }, { vlanId: "asc" }, { name: "asc" }]
    });
    res.json(rows);
});
app.get("/api/vendos/monthly-status", auth, async (req, res) => {
    try {
        const now = new Date();
        const monthStr = req.query.month ? String(req.query.month) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const [yr, mo] = monthStr.split("-").map(Number);
        const monthStart = new Date(yr || now.getFullYear(), (mo || now.getMonth() + 1) - 1, 1);
        const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);
        const municipalityId = req.query.municipalityId ? String(req.query.municipalityId) : "";
        const vendoWhere = { status: client_1.Status.ACTIVE };
        if (municipalityId)
            vendoWhere.barangay = { municipalityId };
        const [vendos, items] = await Promise.all([
            prisma.vendo.findMany({
                where: vendoWhere,
                include: { barangay: { include: { municipality: true } }, owner: true },
                orderBy: [{ ipAddress: "asc" }, { name: "asc" }]
            }),
            prisma.harvestItem.findMany({
                where: { harvest: { status: { not: client_1.HarvestStatus.REJECTED } } },
                include: { harvest: { select: { harvestedAt: true, status: true, reference: true } } },
                orderBy: { harvest: { harvestedAt: "desc" } }
            })
        ]);
        const itemsByVendo = new Map();
        for (const item of items) {
            const arr = itemsByVendo.get(item.vendoId) || [];
            arr.push(item);
            itemsByVendo.set(item.vendoId, arr);
        }
        const unharvested = [];
        const newThisMonth = [];
        let harvestedCount = 0;
        for (const v of vendos) {
            const vItems = itemsByVendo.get(v.id) || [];
            const thisMonthItems = vItems.filter(i => i.harvest.harvestedAt >= monthStart && i.harvest.harvestedAt <= monthEnd);
            const priorItems = vItems.filter(i => i.harvest.harvestedAt < monthStart);
            const lastItem = vItems[0] || null;
            const thisMonthGross = thisMonthItems.reduce((s, i) => s + i.gross, 0);
            const harvestedThisMonth = thisMonthItems.length > 0;
            const createdInMonth = v.createdAt >= monthStart && v.createdAt <= monthEnd;
            const isNewThisMonth = (harvestedThisMonth && priorItems.length === 0) || (createdInMonth && priorItems.length === 0);
            if (harvestedThisMonth)
                harvestedCount++;
            const summary = {
                id: v.id,
                ipAddress: v.ipAddress,
                vlanId: v.vlanId,
                name: v.name,
                municipality: v.barangay?.municipality?.name || "—",
                municipalityId: v.barangay?.municipalityId || null,
                barangay: v.barangay?.name || "—",
                owner: v.owner?.name || "—",
                ownerPhone: v.owner?.phone || null,
                harvestedThisMonth,
                isNewThisMonth,
                thisMonthGross,
                lastHarvestAt: lastItem?.harvest.harvestedAt || null,
                lastHarvestGross: lastItem?.gross || 0,
                lastHarvestRef: lastItem?.harvest.reference || null
            };
            if (!harvestedThisMonth)
                unharvested.push(summary);
            if (isNewThisMonth)
                newThisMonth.push(summary);
        }
        // Sort unharvested so high-earning vendos from last month appear first
        unharvested.sort((a, b) => (b.lastHarvestGross || 0) - (a.lastHarvestGross || 0));
        res.json({
            month: monthStr,
            totalActive: vendos.length,
            harvestedCount,
            unharvestedCount: unharvested.length,
            newThisMonthCount: newThisMonth.length,
            unharvested,
            newThisMonth
        });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.post("/api/vendos", auth, requirePerm("manageVendos"), async (req, res) => {
    const p = zod_1.z.object({
        ipAddress: zod_1.z.string().trim().optional().nullable(),
        vlanId: zod_1.z.preprocess(v => (v === "" || v === null || v === undefined ? null : v), zod_1.z.coerce.number().int().positive().nullable()).optional(),
        name: zod_1.z.string().trim().min(1),
        barangayId: zod_1.z.string().optional().nullable(),
        ownerId: zod_1.z.string().optional().nullable(),
        ownerPercent: zod_1.z.coerce.number().int().min(0).max(100).optional(),
        notes: zod_1.z.string().optional()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid vendo data", details: p.error.flatten() });
    const ip = p.data.ipAddress ? p.data.ipAddress.trim() : null;
    const vlan = p.data.vlanId ?? null;
    if (!ip && !vlan)
        return res.status(400).json({ error: "Please provide an IP Address (or VLAN ID)" });
    try {
        const defaults = await getRevenueShareSettings();
        const data = {
            ipAddress: ip,
            vlanId: vlan,
            name: p.data.name,
            notes: p.data.notes,
            ownerPercent: p.data.ownerPercent !== undefined ? p.data.ownerPercent : defaults.ownerPercent,
            barangayId: p.data.barangayId ? p.data.barangayId : null,
            ownerId: p.data.ownerId ? p.data.ownerId : null,
        };
        res.status(201).json(await prisma.vendo.create({ data, include: { barangay: { include: { municipality: true } }, owner: true } }));
    }
    catch (e) {
        if (e.code === "P2002")
            return res.status(409).json({ error: "IP Address or VLAN ID already exists" });
        res.status(400).json({ error: e.message || "Could not create vendo" });
    }
});
app.put("/api/vendos/:id", auth, requirePerm("manageVendos"), async (req, res) => {
    const id = req.params.id;
    const p = zod_1.z.object({
        ipAddress: zod_1.z.string().trim().optional().nullable(),
        vlanId: zod_1.z.preprocess(v => (v === "" || v === null || v === undefined ? null : v), zod_1.z.coerce.number().int().positive().nullable()).optional(),
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
        const data = { ...p.data };
        if (p.data.ipAddress !== undefined)
            data.ipAddress = p.data.ipAddress ? p.data.ipAddress.trim() : null;
        if (p.data.barangayId === "")
            data.barangayId = null;
        if (p.data.ownerId === "")
            data.ownerId = null;
        res.json(await prisma.vendo.update({ where: { id }, data, include: { barangay: { include: { municipality: true } }, owner: true } }));
    }
    catch (e) {
        if (e.code === "P2002")
            return res.status(409).json({ error: "IP Address or VLAN ID already exists" });
        res.status(400).json({ error: e.message });
    }
});
app.delete("/api/vendos/:id", auth, requirePerm("manageVendos"), async (req, res) => {
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
app.post("/api/teams", auth, requirePerm("manageTeams"), async (req, res) => {
    const p = zod_1.z.object({
        name: zod_1.z.string().trim().min(1),
        leader: zod_1.z.string().optional(),
        employeePercent: zod_1.z.preprocess(v => (v === "" || v === null || v === undefined ? null : v), zod_1.z.coerce.number().int().min(0).max(100).nullable()).optional()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Team name is required" });
    try {
        res.status(201).json(await prisma.harvestTeam.create({ data: p.data }));
    }
    catch (e) {
        if (e.code === "P2002")
            return res.status(409).json({ error: "Team name already exists" });
        res.status(400).json({ error: e.message });
    }
});
app.put("/api/teams/:id", auth, requirePerm("manageTeams"), async (req, res) => {
    const id = req.params.id;
    const p = zod_1.z.object({
        name: zod_1.z.string().trim().min(1),
        leader: zod_1.z.string().optional().nullable(),
        employeePercent: zod_1.z.preprocess(v => (v === "" || v === null || v === undefined ? null : v), zod_1.z.coerce.number().int().min(0).max(100).nullable()).optional(),
        status: zod_1.z.nativeEnum(client_1.Status).optional()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid team data" });
    try {
        res.json(await prisma.harvestTeam.update({ where: { id }, data: p.data }));
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.delete("/api/teams/:id", auth, requirePerm("manageTeams"), async (req, res) => {
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
app.get("/api/users", auth, async (req, res) => {
    const canList = req.user.role === client_1.Role.SUPER_ADMIN || req.user.permissions?.manageUsers || financeRoles.includes(req.user.role);
    if (!canList)
        return res.status(403).json({ error: "Insufficient permissions" });
    const users = await prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, permissions: true, status: true, createdAt: true },
        orderBy: { name: "asc" }
    });
    res.json(users.map(u => ({ ...u, resolvedPermissions: resolvePermissions(u.role, u.permissions) })));
});
app.post("/api/users", auth, requirePerm("manageUsers"), async (req, res) => {
    const p = zod_1.z.object({
        name: zod_1.z.string().trim().min(1),
        email: zod_1.z.string().trim().email(),
        password: zod_1.z.string().min(8),
        role: zod_1.z.nativeEnum(client_1.Role),
        permissions: zod_1.z.record(zod_1.z.boolean()).optional().nullable()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid user data; valid email and password (min 8 chars) required" });
    if (p.data.role === client_1.Role.SUPER_ADMIN && req.user.role !== client_1.Role.SUPER_ADMIN) {
        return res.status(403).json({ error: "Only SUPER_ADMIN can create another SUPER_ADMIN" });
    }
    const emailLower = p.data.email.toLowerCase();
    try {
        const existing = await prisma.user.findFirst({ where: { email: { equals: emailLower, mode: "insensitive" } } });
        if (existing)
            return res.status(409).json({ error: "Email already exists" });
        const u = await prisma.user.create({
            data: {
                name: p.data.name,
                email: emailLower,
                passwordHash: await bcryptjs_1.default.hash(p.data.password, 12),
                role: p.data.role,
                permissions: p.data.permissions ?? undefined
            },
            select: { id: true, name: true, email: true, role: true, permissions: true, status: true }
        });
        res.status(201).json(u);
    }
    catch (e) {
        if (e.code === "P2002")
            return res.status(409).json({ error: "Email already exists" });
        res.status(400).json({ error: e.message || "Could not create user" });
    }
});
app.put("/api/users/:id", auth, requirePerm("manageUsers"), async (req, res) => {
    const id = req.params.id;
    const p = zod_1.z.object({
        name: zod_1.z.string().trim().min(1).optional(),
        email: zod_1.z.string().trim().email().optional(),
        role: zod_1.z.nativeEnum(client_1.Role).optional(),
        status: zod_1.z.nativeEnum(client_1.Status).optional(),
        password: zod_1.z.string().min(8).optional(),
        permissions: zod_1.z.record(zod_1.z.boolean()).optional().nullable()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid user update data (password must be at least 8 characters if provided)" });
    try {
        const target = await prisma.user.findUnique({ where: { id } });
        if (!target)
            return res.status(404).json({ error: "User not found" });
        if (target.role === client_1.Role.SUPER_ADMIN && req.user.role !== client_1.Role.SUPER_ADMIN) {
            return res.status(403).json({ error: "Only SUPER_ADMIN can modify a SUPER_ADMIN account" });
        }
        const updateData = {};
        if (p.data.name)
            updateData.name = p.data.name;
        if (p.data.email)
            updateData.email = p.data.email.toLowerCase();
        if (p.data.role)
            updateData.role = p.data.role;
        if (p.data.status)
            updateData.status = p.data.status;
        if (p.data.password)
            updateData.passwordHash = await bcryptjs_1.default.hash(p.data.password, 12);
        if (p.data.permissions !== undefined)
            updateData.permissions = p.data.permissions;
        const u = await prisma.user.update({
            where: { id },
            data: updateData,
            select: { id: true, name: true, email: true, role: true, permissions: true, status: true }
        });
        res.json(u);
    }
    catch (e) {
        if (e.code === "P2002")
            return res.status(409).json({ error: "Email already exists" });
        res.status(400).json({ error: e.message });
    }
});
// Harvesting
app.post("/api/harvests", auth, requirePerm("encodeHarvest"), async (req, res) => {
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
                                expenses: { create: i.expenses.map(e => ({ ...e, encoderId: req.user.id, incurredAt: harvestDate, status: client_1.ExpenseStatus.PENDING })) }
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
app.put("/api/harvests/:id", auth, requirePerm("editHarvest"), async (req, res) => {
    const id = req.params.id;
    const p = zod_1.z.object({
        harvestedAt: zod_1.z.union([zod_1.z.string().datetime(), zod_1.z.string().min(1), zod_1.z.date()]).optional(),
        teamId: zod_1.z.string().optional().nullable(),
        remarks: zod_1.z.string().optional().nullable(),
        gross: zod_1.z.number().int().nonnegative().optional()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid harvest update data" });
    try {
        const h = await prisma.harvest.findUnique({ where: { id }, include: { items: true } });
        if (!h)
            return res.status(404).json({ error: "Harvest not found" });
        if (h.status === client_1.HarvestStatus.APPROVED)
            return res.status(400).json({ error: "Approved harvests cannot be edited directly" });
        const updateData = {};
        if (p.data.harvestedAt) {
            const dt = new Date(p.data.harvestedAt);
            if (isNaN(dt.getTime()))
                throw new Error("Invalid harvest date");
            updateData.harvestedAt = dt;
        }
        if (p.data.teamId !== undefined)
            updateData.teamId = p.data.teamId || null;
        if (p.data.remarks !== undefined)
            updateData.remarks = p.data.remarks;
        await prisma.$transaction(async (tx) => {
            await tx.harvest.update({ where: { id }, data: updateData });
            if (p.data.gross !== undefined && h.items.length === 1) {
                pesos(p.data.gross);
                await tx.harvestItem.update({ where: { id: h.items[0].id }, data: { gross: p.data.gross } });
            }
        });
        res.json({ status: "updated" });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.get("/api/harvests", auth, async (req, res) => {
    const from = req.query.from && !isNaN(Date.parse(String(req.query.from))) ? new Date(String(req.query.from)) : new Date("2000-01-01");
    const to = req.query.to && !isNaN(Date.parse(String(req.query.to)))
        ? (String(req.query.to).length === 10 ? new Date(String(req.query.to) + "T23:59:59.999Z") : new Date(String(req.query.to)))
        : new Date("2099-12-31");
    const teamId = req.query.teamId ? String(req.query.teamId) : "";
    const municipalityId = req.query.municipalityId ? String(req.query.municipalityId) : "";
    const where = { harvestedAt: { gte: from, lte: to } };
    if (teamId)
        where.teamId = teamId;
    if (municipalityId) {
        where.items = { some: { vendo: { barangay: { municipalityId } } } };
    }
    const [rows, allFirstItems] = await Promise.all([
        prisma.harvest.findMany({
            where,
            include: {
                team: true,
                encoder: { select: { id: true, name: true, email: true } },
                items: { include: { vendo: { include: { barangay: { include: { municipality: true } } } }, expenses: true, distribution: { include: { allocations: true } } } }
            },
            orderBy: { harvestedAt: "desc" }
        }),
        prisma.harvestItem.findMany({
            where: { harvest: { status: { not: client_1.HarvestStatus.REJECTED } } },
            select: { vendoId: true, harvest: { select: { harvestedAt: true } } },
            orderBy: { harvest: { harvestedAt: "asc" } }
        })
    ]);
    const firstMonthByVendo = new Map();
    for (const it of allFirstItems) {
        if (!firstMonthByVendo.has(it.vendoId)) {
            const d = it.harvest.harvestedAt;
            firstMonthByVendo.set(it.vendoId, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
        }
    }
    const annotated = rows.map(h => {
        const hm = `${h.harvestedAt.getFullYear()}-${String(h.harvestedAt.getMonth() + 1).padStart(2, "0")}`;
        return {
            ...h,
            items: h.items.map(i => ({
                ...i,
                isNewVendoThisMonth: firstMonthByVendo.get(i.vendoId) === hm
            }))
        };
    });
    res.json(annotated);
});
app.post("/api/harvests/:id/approve", auth, requirePerm("approveHarvest"), async (req, res) => {
    try {
        const id = req.params.id;
        const sysSettings = await getRevenueShareSettings();
        const result = await prisma.$transaction(async (tx) => {
            const h = await tx.harvest.findUnique({ where: { id }, include: { team: true, items: { include: { expenses: true, vendo: true } } } });
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
                const label = item.vendo.ipAddress || (item.vendo.vlanId ? `VLAN ${item.vendo.vlanId}` : item.vendo.name);
                if (net < 0)
                    throw new Error(`Expenses exceed gross collection for ${label}`);
                const ownerPercent = req.body?.ownerPercent !== undefined ? Number(req.body.ownerPercent) : (item.vendo.ownerPercent ?? sysSettings.ownerPercent);
                const teamPercent = h.team?.employeePercent !== null && h.team?.employeePercent !== undefined ? h.team.employeePercent : sysSettings.employeePercent;
                const employeePercent = req.body?.employeePercent !== undefined ? Number(req.body.employeePercent) : teamPercent;
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
app.post("/api/harvests/:id/reject", auth, requirePerm("approveHarvest"), async (req, res) => {
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
// Expenses (both harvest-linked and standalone per-municipality)
app.get("/api/expenses", auth, async (req, res) => {
    const municipalityId = req.query.municipalityId ? String(req.query.municipalityId) : "";
    const status = req.query.status ? String(req.query.status) : "";
    const where = {};
    if (status && status !== "ALL")
        where.status = status;
    if (municipalityId) {
        where.OR = [
            { municipalityId },
            { harvestItem: { vendo: { barangay: { municipalityId } } } }
        ];
    }
    const rows = await prisma.expense.findMany({
        where,
        include: {
            municipality: true,
            encoder: { select: { id: true, name: true } },
            harvestItem: {
                include: {
                    harvest: { select: { id: true, reference: true, harvestedAt: true } },
                    vendo: { include: { barangay: { include: { municipality: true } } } }
                }
            }
        },
        orderBy: [{ incurredAt: "desc" }, { createdAt: "desc" }]
    });
    res.json(rows);
});
app.post("/api/expenses", auth, requirePerm("manageExpenses"), async (req, res) => {
    const p = zod_1.z.object({
        municipalityId: zod_1.z.string().min(1, "Municipality is required"),
        category: zod_1.z.string().trim().min(1),
        description: zod_1.z.string().optional(),
        amount: zod_1.z.coerce.number().int().positive(),
        incurredAt: zod_1.z.union([zod_1.z.string().datetime(), zod_1.z.string().min(1), zod_1.z.date()]).optional()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid expense data (municipality, category, and whole-peso amount required)" });
    try {
        const dt = p.data.incurredAt ? new Date(p.data.incurredAt) : new Date();
        if (isNaN(dt.getTime()))
            return res.status(400).json({ error: "Invalid expense date" });
        const created = await prisma.expense.create({
            data: {
                municipalityId: p.data.municipalityId,
                encoderId: req.user.id,
                category: p.data.category,
                description: p.data.description || null,
                amount: p.data.amount,
                incurredAt: dt,
                status: client_1.ExpenseStatus.PENDING
            },
            include: { municipality: true, encoder: { select: { id: true, name: true } } }
        });
        res.status(201).json(created);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.post("/api/expenses/:id/approve", auth, requirePerm("approveHarvest"), async (req, res) => {
    const id = req.params.id;
    const expense = await prisma.expense.update({ where: { id }, data: { status: client_1.ExpenseStatus.APPROVED } });
    res.json(expense);
});
app.post("/api/expenses/:id/reject", auth, requirePerm("approveHarvest"), async (req, res) => {
    const id = req.params.id;
    const expense = await prisma.expense.update({ where: { id }, data: { status: client_1.ExpenseStatus.REJECTED } });
    res.json(expense);
});
// Remittances / Cash Outflow (Deposits & Owner Remits with Slip Photo)
app.get("/api/remittances", auth, async (req, res) => {
    const from = req.query.from && !isNaN(Date.parse(String(req.query.from))) ? new Date(String(req.query.from)) : new Date("2000-01-01");
    const to = req.query.to && !isNaN(Date.parse(String(req.query.to)))
        ? (String(req.query.to).length === 10 ? new Date(String(req.query.to) + "T23:59:59.999Z") : new Date(String(req.query.to)))
        : new Date("2099-12-31");
    const municipalityId = req.query.municipalityId ? String(req.query.municipalityId) : "";
    const teamId = req.query.teamId ? String(req.query.teamId) : "";
    const type = req.query.type ? String(req.query.type) : "";
    const where = { remittedAt: { gte: from, lte: to } };
    if (municipalityId)
        where.municipalityId = municipalityId;
    if (teamId)
        where.teamId = teamId;
    if (type && (type === client_1.RemittanceType.BANK_DEPOSIT || type === client_1.RemittanceType.REMIT_TO_OWNER))
        where.type = type;
    const rows = await prisma.remittance.findMany({
        where,
        include: {
            municipality: true,
            team: true,
            recordedBy: { select: { id: true, name: true } }
        },
        orderBy: { remittedAt: "desc" }
    });
    res.json(rows);
});
app.post("/api/remittances", auth, requirePerm("manageRemittances"), async (req, res) => {
    const p = zod_1.z.object({
        type: zod_1.z.nativeEnum(client_1.RemittanceType),
        amount: zod_1.z.coerce.number().int().positive(),
        remittedAt: zod_1.z.union([zod_1.z.string().datetime(), zod_1.z.string().min(1), zod_1.z.date()]),
        municipalityId: zod_1.z.string().optional().nullable(),
        teamId: zod_1.z.string().optional().nullable(),
        bankOrChannel: zod_1.z.string().optional().nullable(),
        notes: zod_1.z.string().optional().nullable(),
        slipImage: zod_1.z.string().max(4_000_000).optional().nullable()
    }).safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: "Invalid remittance data (type, whole-peso amount, and date required)" });
    try {
        const dt = new Date(p.data.remittedAt);
        if (isNaN(dt.getTime()))
            return res.status(400).json({ error: "Invalid remittance date" });
        const reference = `R-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
        const created = await prisma.remittance.create({
            data: {
                reference,
                type: p.data.type,
                amount: p.data.amount,
                remittedAt: dt,
                municipalityId: p.data.municipalityId || null,
                teamId: p.data.teamId || null,
                recordedById: req.user.id,
                bankOrChannel: p.data.bankOrChannel || null,
                notes: p.data.notes || null,
                slipImage: p.data.slipImage || null
            },
            include: { municipality: true, team: true, recordedBy: { select: { id: true, name: true } } }
        });
        res.status(201).json(created);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.delete("/api/remittances/:id", auth, allow(...financeRoles), async (req, res) => {
    const id = req.params.id;
    try {
        await prisma.remittance.delete({ where: { id } });
        res.json({ status: "deleted" });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Dashboard & Analytics
app.get("/api/dashboard", auth, async (req, res) => {
    const from = req.query.from && !isNaN(Date.parse(String(req.query.from)))
        ? new Date(String(req.query.from))
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = req.query.to && !isNaN(Date.parse(String(req.query.to)))
        ? (String(req.query.to).length === 10 ? new Date(String(req.query.to) + "T23:59:59.999Z") : new Date(String(req.query.to)))
        : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);
    const municipalityId = req.query.municipalityId ? String(req.query.municipalityId) : "";
    const teamId = req.query.teamId ? String(req.query.teamId) : "";
    const harvestWhere = { harvestedAt: { gte: from, lte: to }, status: client_1.HarvestStatus.APPROVED };
    if (teamId)
        harvestWhere.teamId = teamId;
    const harvests = await prisma.harvest.findMany({
        where: harvestWhere,
        include: {
            team: true,
            items: {
                include: {
                    distribution: true,
                    vendo: { include: { barangay: { include: { municipality: true } } } }
                }
            }
        }
    });
    const filteredItems = harvests.flatMap(h => h.items).filter(i => {
        if (municipalityId && i.vendo?.barangay?.municipalityId !== municipalityId)
            return false;
        return true;
    });
    const totals = filteredItems.reduce((a, i) => {
        const d = i.distribution;
        a.gross += i.gross;
        a.expenses += d?.approvedExpenses || 0;
        a.owner += d?.ownerShare || 0;
        a.employee += d?.employeePool || 0;
        a.company += d?.companyShare || 0;
        return a;
    }, { gross: 0, expenses: 0, owner: 0, employee: 0, company: 0 });
    // Include standalone approved municipality expenses in period (unless filtered strictly by teamId)
    let standaloneExpenses = 0;
    if (!teamId) {
        const expWhere = {
            harvestItemId: null,
            status: client_1.ExpenseStatus.APPROVED,
            incurredAt: { gte: from, lte: to }
        };
        if (municipalityId)
            expWhere.municipalityId = municipalityId;
        const standalone = await prisma.expense.aggregate({ where: expWhere, _sum: { amount: true } });
        standaloneExpenses = standalone._sum.amount || 0;
    }
    const remWhere = { remittedAt: { gte: from, lte: to } };
    if (municipalityId)
        remWhere.municipalityId = municipalityId;
    if (teamId)
        remWhere.teamId = teamId;
    const remAgg = await prisma.remittance.aggregate({ where: remWhere, _sum: { amount: true } });
    const remittedTotal = remAgg._sum.amount || 0;
    const vendoCountWhere = { status: client_1.Status.ACTIVE };
    if (municipalityId)
        vendoCountWhere.barangay = { municipalityId };
    const [vendos, municipalities, pending] = await Promise.all([
        prisma.vendo.count({ where: vendoCountWhere }),
        prisma.municipality.count(),
        prisma.harvest.count({ where: { status: client_1.HarvestStatus.SUBMITTED } })
    ]);
    const totalExpenses = totals.expenses + standaloneExpenses;
    const net = totals.gross - totalExpenses;
    const companyAfterStandalone = Math.max(0, totals.company - standaloneExpenses);
    res.json({
        ...totals,
        expenses: totalExpenses,
        standaloneExpenses,
        company: companyAfterStandalone,
        net,
        remittedTotal,
        cashRemaining: net - remittedTotal,
        vendos,
        municipalities,
        pendingHarvests: pending,
        approvedHarvests: harvests.length
    });
});
// Reports breakdown (Per Vendo, Per Municipality, Per Harvester/Team)
app.get("/api/reports/detailed", auth, async (req, res) => {
    const from = req.query.from && !isNaN(Date.parse(String(req.query.from))) ? new Date(String(req.query.from)) : new Date("2000-01-01");
    const to = req.query.to && !isNaN(Date.parse(String(req.query.to)))
        ? (String(req.query.to).length === 10 ? new Date(String(req.query.to) + "T23:59:59.999Z") : new Date(String(req.query.to)))
        : new Date("2099-12-31");
    const municipalityId = req.query.municipalityId ? String(req.query.municipalityId) : "";
    const teamId = req.query.teamId ? String(req.query.teamId) : "";
    const harvestWhere = { harvestedAt: { gte: from, lte: to }, status: client_1.HarvestStatus.APPROVED };
    if (teamId)
        harvestWhere.teamId = teamId;
    const harvests = await prisma.harvest.findMany({
        where: harvestWhere,
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
    const byMunicipality = {};
    const byHarvester = {};
    const summary = { gross: 0, expenses: 0, standaloneExpenses: 0, net: 0, ownerShare: 0, employeePool: 0, companyShare: 0, remittedTotal: 0 };
    for (const h of harvests) {
        const tId = h.teamId || "unassigned";
        const tName = h.team?.name || "Unassigned Team";
        const tLeader = h.team?.leader || "—";
        for (const item of h.items) {
            const v = item.vendo;
            const mId = v.barangay?.municipalityId || "unassigned";
            const mName = v.barangay?.municipality?.name || "Unassigned Area";
            if (municipalityId && mId !== municipalityId)
                continue;
            const gross = item.gross;
            const exp = item.distribution?.approvedExpenses || 0;
            const net = item.distribution?.netAfterExpenses ?? (gross - exp);
            const ownerShare = item.distribution?.ownerShare || 0;
            const employeePool = item.distribution?.employeePool || 0;
            const companyShare = item.distribution?.companyShare || 0;
            summary.gross += gross;
            summary.expenses += exp;
            summary.net += net;
            summary.ownerShare += ownerShare;
            summary.employeePool += employeePool;
            summary.companyShare += companyShare;
            if (!byVendo[v.id]) {
                byVendo[v.id] = {
                    vendoId: v.id,
                    ipAddress: v.ipAddress || "—",
                    vlanId: v.vlanId,
                    name: v.name,
                    municipalityId: mId,
                    municipalityName: mName,
                    location: `${v.barangay?.name || "—"}, ${mName}`,
                    ownerName: v.owner?.name || "—",
                    harvestCount: 0,
                    gross: 0, expenses: 0, net: 0, ownerShare: 0, employeePool: 0, companyShare: 0
                };
            }
            byVendo[v.id].harvestCount++;
            byVendo[v.id].gross += gross;
            byVendo[v.id].expenses += exp;
            byVendo[v.id].net += net;
            byVendo[v.id].ownerShare += ownerShare;
            byVendo[v.id].employeePool += employeePool;
            byVendo[v.id].companyShare += companyShare;
            if (!byMunicipality[mId]) {
                byMunicipality[mId] = {
                    municipalityId: mId,
                    municipalityName: mName,
                    harvestCount: 0,
                    gross: 0, expenses: 0, standaloneExpenses: 0, net: 0, ownerShare: 0, employeePool: 0, companyShare: 0, remittedTotal: 0
                };
            }
            byMunicipality[mId].harvestCount++;
            byMunicipality[mId].gross += gross;
            byMunicipality[mId].expenses += exp;
            byMunicipality[mId].net += net;
            byMunicipality[mId].ownerShare += ownerShare;
            byMunicipality[mId].employeePool += employeePool;
            byMunicipality[mId].companyShare += companyShare;
            if (!byHarvester[tId]) {
                byHarvester[tId] = {
                    teamId: tId,
                    teamName: tName,
                    leader: tLeader,
                    harvestCount: 0,
                    gross: 0, expenses: 0, net: 0, ownerShare: 0, employeePool: 0, companyShare: 0, remittedTotal: 0
                };
            }
            byHarvester[tId].harvestCount++;
            byHarvester[tId].gross += gross;
            byHarvester[tId].expenses += exp;
            byHarvester[tId].net += net;
            byHarvester[tId].ownerShare += ownerShare;
            byHarvester[tId].employeePool += employeePool;
            byHarvester[tId].companyShare += companyShare;
        }
    }
    // Standalone municipality expenses
    if (!teamId) {
        const expWhere = { harvestItemId: null, status: client_1.ExpenseStatus.APPROVED, incurredAt: { gte: from, lte: to } };
        if (municipalityId)
            expWhere.municipalityId = municipalityId;
        const standalone = await prisma.expense.findMany({ where: expWhere, include: { municipality: true } });
        for (const se of standalone) {
            const mId = se.municipalityId || "unassigned";
            const mName = se.municipality?.name || "Unassigned Area";
            summary.standaloneExpenses += se.amount;
            summary.expenses += se.amount;
            summary.net -= se.amount;
            summary.companyShare = Math.max(0, summary.companyShare - se.amount);
            if (!byMunicipality[mId]) {
                byMunicipality[mId] = {
                    municipalityId: mId,
                    municipalityName: mName,
                    harvestCount: 0,
                    gross: 0, expenses: 0, standaloneExpenses: 0, net: 0, ownerShare: 0, employeePool: 0, companyShare: 0, remittedTotal: 0
                };
            }
            byMunicipality[mId].standaloneExpenses += se.amount;
            byMunicipality[mId].expenses += se.amount;
            byMunicipality[mId].net -= se.amount;
            byMunicipality[mId].companyShare = Math.max(0, byMunicipality[mId].companyShare - se.amount);
        }
    }
    // Remittances per municipality & team
    const remWhere = { remittedAt: { gte: from, lte: to } };
    if (municipalityId)
        remWhere.municipalityId = municipalityId;
    if (teamId)
        remWhere.teamId = teamId;
    const remittances = await prisma.remittance.findMany({ where: remWhere });
    for (const r of remittances) {
        summary.remittedTotal += r.amount;
        if (r.municipalityId && byMunicipality[r.municipalityId]) {
            byMunicipality[r.municipalityId].remittedTotal += r.amount;
        }
        if (r.teamId && byHarvester[r.teamId]) {
            byHarvester[r.teamId].remittedTotal += r.amount;
        }
    }
    res.json({
        period: { from, to },
        summary,
        vendosSummary: Object.values(byVendo),
        municipalitySummary: Object.values(byMunicipality),
        harvesterSummary: Object.values(byHarvester),
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
                (0, child_process_1.execSync)(`${prismaCmd} db push --skip-generate --accept-data-loss`, { timeout: 45000, stdio: "inherit" });
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
