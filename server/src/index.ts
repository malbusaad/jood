import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { createApp } from "./app.js";

const env = loadEnv();
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(here, "../../client/dist");

await prisma.$connect();
const app = createApp({ db: prisma, clientDistDir });

const server = app.listen(env.PORT, () => {
  console.log(`[jood] server listening on port ${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal: string) {
  console.log(`[jood] ${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
