"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function seed() {
    const email = process.env.ADMIN_EMAIL || "admin@example.com";
    const password = process.env.ADMIN_PASSWORD || "AdminPassword123!";
    console.log("Seeding database...");
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
        const admin = await prisma.user.create({
            data: {
                name: "System Administrator",
                email,
                passwordHash: await bcryptjs_1.default.hash(password, 12),
                role: client_1.Role.SUPER_ADMIN,
                status: client_1.Status.ACTIVE,
            },
        });
        console.log(`Created administrator: ${admin.email}`);
    }
    else {
        console.log(`Administrator already exists: ${existing.email}`);
    }
    console.log("Seeding complete.");
}
seed()
    .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
