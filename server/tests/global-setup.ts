import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Apply all Prisma migrations to the test database before any test file runs.
export default function setup() {
  const envFile = path.resolve(import.meta.dirname, "../.env.test");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.DATABASE_URL?.includes("test")) {
    throw new Error("Refusing to migrate: DATABASE_URL must point to a dedicated *test* database.");
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
}
