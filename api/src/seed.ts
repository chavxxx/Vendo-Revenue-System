import "dotenv/config";
import { PrismaClient, Role, Status } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

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
        passwordHash: await bcrypt.hash(password, 12),
        role: Role.SUPER_ADMIN,
        status: Status.ACTIVE,
      },
    });
    console.log(`Created administrator: ${admin.email}`);
  } else {
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
