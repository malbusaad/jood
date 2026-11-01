import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { HttpError, parse } from "../lib/http.js";
import { hashToken } from "../lib/tokens.js";
import { todayInRiyadh, toIsoDate } from "../lib/dates.js";
import { getSettings } from "../settings/registry.js";

const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/) });

/**
 * Guest portal API. The only credential is the private link's random token; nothing here is
 * reachable by booking reference, guest name or phone.
 */
export function guestRouter(db: PrismaClient) {
  const router = Router();

  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "عدد كبير من الطلبات، حاول لاحقًا" },
    }),
  );
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/:token", async (req, res) => {
    const parsed = tokenParam.safeParse(req.params);
    if (!parsed.success) throw new HttpError(404, "الرابط غير صحيح");
    const access = await db.guestAccessToken.findUnique({
      where: { tokenHash: hashToken(parsed.data.token) },
      include: {
        booking: {
          include: {
            guest: { select: { name: true } },
            items: { select: { resource: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (!access) throw new HttpError(404, "الرابط غير صحيح");
    const b = access.booking;
    if (access.revokedAt || access.expiresAt <= new Date() || !["CONFIRMED", "COMPLETED"].includes(b.status)) {
      throw new HttpError(410, "انتهت صلاحية هذا الرابط. تواصل معنا إذا احتجت المساعدة.");
    }
    await db.guestAccessToken.update({ where: { id: access.id }, data: { lastUsedAt: new Date() } });

    const s = await getSettings(db, ["general", "stay", "houseRules", "contact", "guestPortal"]);
    const start = toIsoDate(b.startDate);
    const showCodes = s.guestPortal.showCodesFrom === "IMMEDIATELY" || todayInRiyadh() >= start;

    res.json({
      siteName: s.general.name,
      guestName: b.guest.name,
      reference: b.reference,
      startDate: start,
      endDate: toIsoDate(b.endDate),
      checkIn: s.stay.checkIn,
      checkOut: s.stay.checkOut,
      items: [...new Map(b.items.map((i) => [i.resource.id, i.resource.name])).values()],
      houseRules: s.houseRules,
      departureInstructions: s.guestPortal.departureInstructions,
      contact: s.contact,
      location: s.general.location,
      codes: showCodes
        ? { entryCode: s.guestPortal.entryCode, wifiName: s.guestPortal.wifiName, wifiPassword: s.guestPortal.wifiPassword }
        : null,
      codesAvailableOn: showCodes ? null : start,
      expiresAt: access.expiresAt,
    });
  });

  return router;
}
