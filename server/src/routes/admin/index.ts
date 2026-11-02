import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireAuth, requireRole } from "../../auth/session.js";
import { settingsRouter } from "./settings.js";
import { amenitiesRouter } from "./amenities.js";
import { resourcesRouter } from "./resources.js";
import { pricingRouter } from "./pricing.js";
import { usersRouter } from "./users.js";
import { auditRouter, notificationsRouter } from "./activity.js";
import { bookingsRouter, calendarRouter, dashboardRouter, guestsRouter } from "./bookings.js";
import type { WhatsAppSender } from "../../services/notifications.js";
import type { LockClient } from "../../services/ttlock.js";
import type { SecretBox } from "../../lib/secretBox.js";
import { getSetting } from "../../settings/registry.js";

/** Everything under /api/admin requires a signed-in admin. Sensitive areas are owner-only. */
export function adminRouter(
  db: PrismaClient,
  opts: { whatsapp: WhatsAppSender | null; publicBaseUrl: string; lock: LockClient | null; secretBox: SecretBox },
) {
  const router = Router();
  router.use(requireAuth);

  router.use("/dashboard", dashboardRouter(db));
  router.use("/bookings", bookingsRouter(db, opts));
  router.use("/calendar", calendarRouter(db));
  router.use("/guests", guestsRouter(db));
  router.use("/settings", settingsRouter(db));
  router.use("/amenities", amenitiesRouter(db));
  router.use("/resources", requireRole("OWNER"), resourcesRouter(db));
  router.use("/pricing", requireRole("OWNER"), pricingRouter(db));
  router.use("/users", requireRole("OWNER"), usersRouter(db));
  router.use("/notifications", notificationsRouter(db));
  router.use("/audit", requireRole("OWNER"), auditRouter(db));

  /** Door lock connection test: shows whether TTLock is configured and lists the account's locks. */
  router.get("/lock/status", requireRole("OWNER"), async (_req, res) => {
    const settings = await getSetting(db, "doorLock");
    if (!opts.lock) return void res.json({ configured: false, enabled: settings.enabled, locks: [], error: null });
    try {
      const locks = await opts.lock.listLocks();
      res.json({ configured: true, enabled: settings.enabled, lockId: opts.lock.lockId, locks, error: null });
    } catch (err) {
      res.json({ configured: true, enabled: settings.enabled, lockId: opts.lock.lockId, locks: [], error: err instanceof Error ? err.message : "error" });
    }
  });

  return router;
}
