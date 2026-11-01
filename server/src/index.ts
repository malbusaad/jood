import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { createApp } from "./app.js";
import { metaWhatsAppSender, whatsAppConfigFromEnv } from "./services/notifications.js";
import { expireStaleBookings } from "./services/bookings.js";

const env = loadEnv();
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(here, "../../client/dist");

await prisma.$connect();
const app = createApp({
  db: prisma,
  clientDistDir,
  secureCookies: env.NODE_ENV === "production",
  allowedOrigins: [new URL(env.PUBLIC_BASE_URL).origin],
  whatsapp: (() => {
    const cfg = whatsAppConfigFromEnv();
    return cfg ? metaWhatsAppSender(cfg) : null;
  })(),
});

// Expire unpaid requests past their payment deadline (also checked before every availability lookup).
const expiryTimer = setInterval(() => {
  expireStaleBookings(prisma).catch((err) => console.error("[expiry]", err instanceof Error ? err.message : err));
}, 5 * 60 * 1000);
expiryTimer.unref();

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
