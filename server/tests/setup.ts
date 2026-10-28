import fs from "node:fs";
import path from "node:path";

// Load server/.env.test when present (CI provides variables directly instead).
const envFile = path.resolve(import.meta.dirname, "../.env.test");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

if (!process.env.DATABASE_URL?.includes("test")) {
  throw new Error("Refusing to run tests: DATABASE_URL must point to a dedicated *test* database.");
}
