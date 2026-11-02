import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getSettings, isSettingKey, settingDefinitions, settingKeys } from "../../settings/registry.js";
import { HttpError, parse } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { requireRole } from "../../auth/session.js";

export function settingsRouter(db: PrismaClient) {
  const router = Router();

  // Staff see operational settings only; bank details, guest codes, notification and contract config are owner-only.
  const staffKeys = settingKeys.filter((k) => !["bank", "guestPortal", "notifications", "contract"].includes(k));

  router.get("/", async (req, res) => {
    res.json(await getSettings(db, req.user!.role === "OWNER" ? settingKeys : staffKeys));
  });

  // Only the owner may change settings (they include bank details and guest access codes).
  router.put("/:key", requireRole("OWNER"), async (req, res) => {
    const key = String(req.params.key);
    if (!isSettingKey(key)) throw new HttpError(404, "إعداد غير معروف");
    const value = parse(settingDefinitions[key].schema, req.body) as Prisma.InputJsonValue;
    await db.siteSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await audit(db, req, { action: "settings.update", entityType: "setting", entityId: key, details: value });
    res.json({ key, value });
  });

  return router;
}
