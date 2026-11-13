import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { createApp } from "./app.js";
import { metaTemplateSender, metaWhatsAppSender, notifyOwner, whatsAppConfigFromEnv } from "./services/notifications.js";
import { processDueMessages } from "./services/waAutomation.js";
import { ensureDoorCodes } from "./services/doorCodes.js";
import { webPushSend } from "./services/push.js";
import { alertUnpaidBalances, expireStaleBookings } from "./services/bookings.js";
import { ttlockClient, ttlockConfigFromEnv } from "./services/ttlock.js";
import { makeSecretBox } from "./lib/secretBox.js";

const env = loadEnv();
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(here, "../../client/dist");

await prisma.$connect();
const waConfig = whatsAppConfigFromEnv();
const whatsapp = waConfig ? metaWhatsAppSender(waConfig) : null;
const waSend = waConfig ? metaTemplateSender(waConfig) : null;
const secretBox = makeSecretBox(env.SESSION_SECRET, "door-codes");
const lock = (() => {
  const cfg = ttlockConfigFromEnv();
  return cfg ? ttlockClient(cfg) : null;
})();
const app = createApp({
  db: prisma,
  clientDistDir,
  secureCookies: env.NODE_ENV === "production",
  allowedOrigins: [new URL(env.PUBLIC_BASE_URL).origin],
  publicBaseUrl: env.PUBLIC_BASE_URL,
  secretBox,
  waConfig,
  waSend,
  push: { send: webPushSend, subject: new URL(env.PUBLIC_BASE_URL).origin },
  lock,
  whatsapp,
});

// Expire unpaid requests past their payment deadline (also checked before every availability lookup).
const expiryTimer = setInterval(() => {
  expireStaleBookings(prisma).catch((err) => console.error("[expiry]", err instanceof Error ? err.message : err));
  // Alert the owner (once per booking) when the balance or deposit is still unpaid at the deadline.
  alertUnpaidBalances(prisma, whatsapp).catch((err) => console.error("[balance-alert]", err instanceof Error ? err.message : err));
}, 5 * 60 * 1000);
expiryTimer.unref();

// Door codes for confirmed upcoming bookings that have none yet (e.g. imported records). Never retries a failure.
const ensureCodes = () =>
  ensureDoorCodes(prisma, lock, secretBox, (b, reason) =>
    notifyOwner(
      prisma,
      { type: "SYSTEM", title: `تعذر إنشاء رمز الباب ${b.reference}`, body: `${b.guestName}\n${reason}\nأعد المحاولة من صفحة الحجز ← رمز الباب.`, bookingId: b.id },
      whatsapp,
    ),
  ).catch((err) => console.error("[door-codes]", err instanceof Error ? err.message : err));
setTimeout(ensureCodes, 15_000).unref();
setInterval(ensureCodes, 5 * 60 * 1000).unref();

// Guest WhatsApp messages: sends what is due, every minute (state lives in the database).
const waTimer = setInterval(() => {
  processDueMessages(prisma, { send: waSend, ownerWhatsapp: whatsapp, secretBox }).catch((err) =>
    console.error("[whatsapp-automation]", err instanceof Error ? err.message : err),
  );
}, 60 * 1000);
waTimer.unref();

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
