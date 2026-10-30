import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireAuth, requireRole } from "../../auth/session.js";
import { settingsRouter } from "./settings.js";
import { amenitiesRouter } from "./amenities.js";
import { resourcesRouter } from "./resources.js";
import { pricingRouter } from "./pricing.js";
import { usersRouter } from "./users.js";
import { auditRouter, notificationsRouter } from "./activity.js";

/** Everything under /api/admin requires a signed-in admin. Sensitive areas are owner-only. */
export function adminRouter(db: PrismaClient) {
  const router = Router();
  router.use(requireAuth);

  router.use("/settings", settingsRouter(db));
  router.use("/amenities", amenitiesRouter(db));
  router.use("/resources", requireRole("OWNER"), resourcesRouter(db));
  router.use("/pricing", requireRole("OWNER"), pricingRouter(db));
  router.use("/users", requireRole("OWNER"), usersRouter(db));
  router.use("/notifications", notificationsRouter(db));
  router.use("/audit", requireRole("OWNER"), auditRouter(db));

  return router;
}
