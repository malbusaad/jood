import { PrismaClient } from "@prisma/client";
import { seedInitialData } from "./seed-data.js";

const db = new PrismaClient();
try {
  await seedInitialData(db);
  console.log("[seed] initial data is in place");
} finally {
  await db.$disconnect();
}
