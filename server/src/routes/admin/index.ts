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

/** Everything under /api/admin requires a signed-in admin. Sensitive areas are owner-only. */
export function adminRouter(db: PrismaClient, opts: { whatsapp: WhatsAppSender | null }) {
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

  return router;
}
