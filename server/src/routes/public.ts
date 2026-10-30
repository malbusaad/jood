import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { getSettings, publicSettingKeys } from "../settings/registry.js";
import { addDays, eachDate, isoDate, todayInRiyadh } from "../lib/dates.js";
import { HttpError, parse } from "../lib/http.js";
import { resolveRule } from "../services/pricing.js";
import { blockedResources } from "../services/conflicts.js";

const rangeSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.to > r.from, "يجب أن يكون تاريخ النهاية بعد البداية")
  .refine((r) => eachDate(r.from, r.to).length <= 62, "النطاق الأقصى 62 يومًا");

/** Public catalog API. Returns only public settings — never bank details, codes or guest data. */
export function publicRouter(db: PrismaClient) {
  const router = Router();

  router.get("/site", async (_req, res) => {
    const [settings, amenities, fullResource, media] = await Promise.all([
      getSettings(db, publicSettingKeys),
      db.amenity.findMany({
        where: { visible: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, slug: true, name: true, description: true, capacityText: true, note: true, icon: true, available: true },
      }),
      db.bookingResource.findFirst({
        where: { kind: "FULL", active: true },
        include: { pricingRules: { where: { active: true, kind: "WEEKDAY" } } },
      }),
      db.mediaAsset.findMany({
        where: { isPrivate: false, kind: { in: ["IMAGE", "VIDEO", "LOGO"] } },
        orderBy: { sortOrder: "asc" },
        select: { id: true, kind: true, storageKey: true, alt: true, amenityId: true, isHero: true },
      }),
    ]);

    // Base weekday price of the full rest house: index 0 = Sunday ... 6 = Saturday (null = no approved price).
    const weekdayPrices = [0, 1, 2, 3, 4, 5, 6].map((dow) => {
      const sample = addDays("2026-01-04", dow); // 2026-01-04 is a Sunday
      const rule = fullResource ? resolveRule(fullResource.pricingRules, sample) : null;
      return rule ? Number(rule.price) : null;
    });

    const mediaUrl = (key: string) => `/api/media/${encodeURIComponent(key)}`;
    res.set("Cache-Control", "public, max-age=60");
    res.json({
      ...settings,
      amenities,
      weekdayPrices,
      media: {
        logoUrl: media.find((m) => m.kind === "LOGO") ? mediaUrl(media.find((m) => m.kind === "LOGO")!.storageKey) : null,
        heroImageUrl: (() => {
          const hero = media.find((m) => m.kind === "IMAGE" && m.isHero);
          return hero ? mediaUrl(hero.storageKey) : null;
        })(),
        videoUrl: media.find((m) => m.kind === "VIDEO") ? mediaUrl(media.find((m) => m.kind === "VIDEO")!.storageKey) : null,
        gallery: media
          .filter((m) => m.kind === "IMAGE")
          .map((m) => ({ url: mediaUrl(m.storageKey), alt: m.alt ?? "", amenityId: m.amenityId })),
      },
    });
  });

  /** Daily price and availability of the full rest house — used by the public calendar. */
  router.get("/calendar", async (req, res) => {
    const { from, to } = parse(rangeSchema, req.query);
    const full = await db.bookingResource.findFirst({
      where: { kind: "FULL", active: true },
      include: { pricingRules: { where: { active: true } } },
    });
    if (!full) throw new HttpError(404, "الحجز غير متاح حاليًا");

    const today = todayInRiyadh();
    const dates = eachDate(from, to);
    const blocked = (await blockedResources(db, [full.id], dates)).get(full.id) ?? new Set();

    res.set("Cache-Control", "no-store");
    res.json({
      days: dates.map((date) => {
        const rule = resolveRule(full.pricingRules, date);
        return {
          date,
          price: rule ? Number(rule.price) : null,
          available: date >= today && rule !== null && !blocked.has(date),
        };
      }),
    });
  });

  return router;
}
