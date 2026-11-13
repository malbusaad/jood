import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireAuth, requireRole } from "../../auth/session.js";
import { settingsRouter } from "./settings.js";
import { amenitiesRouter } from "./amenities.js";
import { resourcesRouter } from "./resources.js";
import { pricingRouter } from "./pricing.js";
import { discountsRouter } from "./discounts.js";
import { usersRouter } from "./users.js";
import { auditRouter, notificationsRouter } from "./activity.js";
import { bookingsRouter, calendarRouter, dashboardRouter, guestsRouter } from "./bookings.js";
import type { WhatsAppConfig, WhatsAppSender, WhatsAppTemplateSender } from "../../services/notifications.js";
import { whatsappRouter } from "./whatsapp.js";
import { pushRouter } from "./push.js";
import { expensesRouter, importRouter, reportsRouter } from "./finance.js";
import { mediaRouter } from "./media.js";
import type { PushSend } from "../../services/push.js";
import type { LockClient } from "../../services/ttlock.js";
import type { SecretBox } from "../../lib/secretBox.js";
import { getSetting } from "../../settings/registry.js";
import { SITE_IMAGES, deleteLogo, isSiteImageSlot, logoVersion, saveLogo } from "../../services/licenseLogo.js";
import { HttpError } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { parse } from "../../lib/http.js";
import { z } from "zod";

/** Everything under /api/admin requires a signed-in admin. Sensitive areas are owner-only. */
export function adminRouter(
  db: PrismaClient,
  opts: {
    whatsapp: WhatsAppSender | null;
    publicBaseUrl: string;
    lock: LockClient | null;
    secretBox: SecretBox;
    waConfig?: WhatsAppConfig | null;
    waSend?: WhatsAppTemplateSender | null;
    push?: { send: PushSend; subject: string } | null;
  },
) {
  const router = Router();
  router.use(requireAuth);

  router.use("/dashboard", dashboardRouter(db));
  router.use("/bookings", bookingsRouter(db, opts));
  router.use("/calendar", calendarRouter(db));
  router.use("/guests", guestsRouter(db, opts.secretBox));
  router.use("/settings", settingsRouter(db));
  router.use("/amenities", amenitiesRouter(db));
  router.use("/resources", requireRole("OWNER"), resourcesRouter(db));
  router.use("/pricing", requireRole("OWNER"), pricingRouter(db));
  router.use("/discounts", requireRole("OWNER"), discountsRouter(db));
  router.use("/expenses", requireRole("OWNER"), expensesRouter(db));
  router.use("/media", requireRole("OWNER"), mediaRouter(db));
  router.use("/reports", requireRole("OWNER"), reportsRouter(db));
  router.use("/import", requireRole("OWNER"), importRouter(db, opts.secretBox));
  router.use("/whatsapp", requireRole("OWNER"), whatsappRouter(db, { waConfig: opts.waConfig ?? null, waSend: opts.waSend ?? null }));
  router.use("/users", requireRole("OWNER"), usersRouter(db));
  router.use("/notifications", notificationsRouter(db));
  router.use("/push", pushRouter(db, { box: opts.secretBox, push: opts.push ?? null }));
  router.use("/audit", requireRole("OWNER"), auditRouter(db));

  /** Ministry of Tourism logo: uploaded by the owner as base64 JSON (PNG/JPG/WebP, max 512 KB). */
  router.get("/license-logo", async (_req, res) => {
    const v = await logoVersion(db);
    res.json({ url: v ? `/api/public/license-logo?v=${v}` : null });
  });
  router.put("/license-logo", requireRole("OWNER"), async (req, res) => {
    const { data } = parse(z.object({ data: z.string().min(1).max(800_000) }), req.body);
    const saved = await saveLogo(db, data);
    await audit(db, req, { action: "license_logo.upload", entityType: "setting", entityId: "tourismLicenseLogo", details: { size: saved.size, mime: saved.mime } });
    res.json({ url: `/api/public/license-logo?v=${saved.version}` });
  });
  router.delete("/license-logo", requireRole("OWNER"), async (req, res) => {
    await deleteLogo(db);
    await audit(db, req, { action: "license_logo.delete", entityType: "setting", entityId: "tourismLicenseLogo" });
    res.status(204).end();
  });

  /** Site logo and browser/home-screen icon, uploaded by the owner (same rules as the ministry logo). */
  const slotOf = (raw: string) => {
    if (!isSiteImageSlot(raw)) throw new HttpError(404, "غير موجود");
    return raw;
  };
  router.get("/site-images/:slot", async (req, res) => {
    const slot = slotOf(String(req.params.slot));
    const v = await logoVersion(db, SITE_IMAGES[slot].key);
    res.json({ url: v ? `/api/public/site-images/${slot}?v=${v}` : null });
  });
  router.put("/site-images/:slot", requireRole("OWNER"), async (req, res) => {
    const slot = slotOf(String(req.params.slot));
    const { data } = parse(z.object({ data: z.string().min(1).max(800_000) }), req.body);
    const saved = await saveLogo(db, data, SITE_IMAGES[slot].key);
    await audit(db, req, { action: "site_image.upload", entityType: "setting", entityId: SITE_IMAGES[slot].key, details: { size: saved.size, mime: saved.mime } });
    res.json({ url: `/api/public/site-images/${slot}?v=${saved.version}` });
  });
  router.delete("/site-images/:slot", requireRole("OWNER"), async (req, res) => {
    const slot = slotOf(String(req.params.slot));
    await deleteLogo(db, SITE_IMAGES[slot].key);
    await audit(db, req, { action: "site_image.delete", entityType: "setting", entityId: SITE_IMAGES[slot].key });
    res.status(204).end();
  });

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
