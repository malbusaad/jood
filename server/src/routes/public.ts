import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { fullNameSchema, getSetting, getSettings, nationalIdSchema, phoneSchema, publicSettingKeys, videoEmbed } from "../settings/registry.js";
import type { SecretBox } from "../lib/secretBox.js";
import { addDays, eachDate, isoDate, todayInRiyadh } from "../lib/dates.js";
import { HttpError, parse } from "../lib/http.js";
import { resolveRule } from "../services/pricing.js";
import { blockedResources } from "../services/conflicts.js";
import { createBooking, evaluateSelection, expireStaleBookings } from "../services/bookings.js";
import type { WhatsAppSender } from "../services/notifications.js";
import { SITE_IMAGES, isSiteImageSlot, logoVersion, readLogo } from "../services/licenseLogo.js";
import { computeDiscount, discountCodeSchema, findCode } from "../services/discounts.js";
import { upfrontFor } from "../services/payments.js";
import { Prisma } from "@prisma/client";

const rangeSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.to > r.from, "يجب أن يكون تاريخ النهاية بعد البداية")
  .refine((r) => eachDate(r.from, r.to).length <= 62, "النطاق الأقصى 62 يومًا");

const selectionSchema = z.object({
  resourceIds: z.array(z.uuid()).min(1).max(20),
  startDate: isoDate,
  nights: z.number().int().min(1).max(30),
});

const bookingSchema = selectionSchema.extend({
  name: fullNameSchema,
  phone: phoneSchema,
  nationalId: nationalIdSchema,
  email: z.email().max(254).nullable().optional(),
  guestCount: z.number().int().min(1).max(500).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  acceptTerms: z.literal(true, { error: "يجب الموافقة على الشروط والتعليمات" }),
  /** Honeypot: real visitors never see or fill this field. */
  website: z.string().max(0).optional(),
  discountCode: z.union([z.literal(""), discountCodeSchema]).nullable().optional(),
  paymentPlan: z.enum(["FULL", "DEPOSIT"]).default("FULL"),
  depositTiming: z.enum(["WITH_FIRST_PAYMENT", "BEFORE_CHECKIN"]).default("WITH_FIRST_PAYMENT"),
});

/** Public catalog API. Returns only public settings — never bank details, codes or guest data. */
export function publicRouter(
  db: PrismaClient,
  opts: { whatsapp: WhatsAppSender | null; bookingLimit: number; secretBox: SecretBox; codeCheckLimit?: number },
) {
  const router = Router();

  router.get("/site", async (_req, res) => {
    const [settings, amenities, fullResource, media, licenseLogo, siteLogo, siteIcon] = await Promise.all([
      getSettings(db, publicSettingKeys),
      db.amenity.findMany({
        where: { visible: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, slug: true, name: true, description: true, capacityText: true, note: true, icon: true, category: true, available: true },
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
      logoVersion(db),
      logoVersion(db, SITE_IMAGES.logo.key),
      logoVersion(db, SITE_IMAGES.icon.key),
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
      tourismLicense: { ...settings.tourismLicense, logoUrl: licenseLogo ? `/api/public/license-logo?v=${licenseLogo}` : null },
      amenities,
      weekdayPrices,
      media: {
        logoUrl: siteLogo
          ? `/api/public/site-images/logo?v=${siteLogo}`
          : media.find((m) => m.kind === "LOGO")
            ? mediaUrl(media.find((m) => m.kind === "LOGO")!.storageKey)
            : null,
        iconUrl: siteIcon ? `/api/public/site-images/icon?v=${siteIcon}` : null,
        heroImageUrl: (() => {
          const hero = media.find((m) => m.kind === "IMAGE" && m.isHero);
          return hero ? mediaUrl(hero.storageKey) : null;
        })(),
        videoUrl: media.find((m) => m.kind === "VIDEO") ? mediaUrl(media.find((m) => m.kind === "VIDEO")!.storageKey) : null,
        // An uploaded video file is shown first; otherwise the YouTube/Vimeo link.
        video: media.find((m) => m.kind === "VIDEO")
          ? { kind: "file" as const, src: mediaUrl(media.find((m) => m.kind === "VIDEO")!.storageKey) }
          : settings.introVideo.url
            ? videoEmbed(settings.introVideo.url)
            : null,
        gallery: media
          .filter((m) => m.kind === "IMAGE")
          .map((m) => ({ url: mediaUrl(m.storageKey), alt: m.alt ?? "", amenityId: m.amenityId })),
      },
    });
  });

  /** Site logo / icon uploaded by the owner. */
  router.get("/site-images/:slot", async (req, res) => {
    const slot = String(req.params.slot);
    if (!isSiteImageSlot(slot)) throw new HttpError(404, "غير موجود");
    const img = await readLogo(db, SITE_IMAGES[slot].key);
    if (!img) throw new HttpError(404, "لا توجد صورة");
    res.set("Content-Type", img.mime);
    res.set("Cache-Control", "public, max-age=86400");
    res.set("Content-Security-Policy", "default-src 'none'");
    res.send(img.bytes);
  });

  /** The Ministry of Tourism logo uploaded by the owner (raster image, served from the database). */
  router.get("/license-logo", async (_req, res) => {
    const logo = await readLogo(db);
    if (!logo) throw new HttpError(404, "لا يوجد شعار");
    res.set("Content-Type", logo.mime);
    res.set("Cache-Control", "public, max-age=86400");
    res.set("Content-Security-Policy", "default-src 'none'");
    res.send(logo.bytes);
  });

  /** Daily price and availability of the full rest house — used by the public calendar. */
  router.get("/calendar", async (req, res) => {
    const { from, to } = parse(rangeSchema, req.query);
    await expireStaleBookings(db);
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

  /**
   * What can be booked for a given start date and number of days: the full rest house and the
   * parts the owner made bookable, each with availability and the exact price for those days.
   */
  router.get("/options", async (req, res) => {
    const { startDate, nights } = parse(z.object({ startDate: isoDate, nights: z.coerce.number().int().min(1).max(30) }), req.query);
    await expireStaleBookings(db);
    const resources = await db.bookingResource.findMany({
      where: { active: true },
      include: { amenities: { include: { amenity: { select: { name: true } } } } },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
    });
    const options = await Promise.all(
      resources.map(async (r) => {
        try {
          const ev = await evaluateSelection(db, { resourceIds: [r.id], startDate, nights }, { channel: "WEBSITE" });
          return { id: r.id, name: r.name, kind: r.kind, description: r.description, amenities: r.amenities.map((a) => a.amenity.name), available: true, total: Number(ev.quote.total), reason: null };
        } catch (err) {
          if (!(err instanceof HttpError)) throw err;
          return { id: r.id, name: r.name, kind: r.kind, description: r.description, amenities: r.amenities.map((a) => a.amenity.name), available: false, total: null, reason: err.message };
        }
      }),
    );
    const policy = await getSetting(db, "bookingPolicy");
    res.set("Cache-Control", "no-store");
    res.json({ options, deposit: policy.securityDeposit, maxNights: policy.maxNights });
  });

  /** Exact price breakdown for a selection, re-checked on the server. */
  // Checking discount codes is limited per IP so codes cannot be guessed by trying many.
  const codeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: opts.codeCheckLimit ?? 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => !req.body?.discountCode,
    message: { error: "محاولات كثيرة لكود الخصم، حاول لاحقًا" },
  });

  router.post("/quote", codeLimiter, async (req, res) => {
    const { discountCode: rawCode, ...rest } = (req.body ?? {}) as Record<string, unknown>;
    const sel = parse(selectionSchema, rest);
    try {
      const ev = await evaluateSelection(db, sel, { channel: "WEBSITE" });
      const subtotal = Number(ev.quote.total);
      // Discount: worked out here from the stored code; a bad code never blocks the quote itself.
      let discount = null;
      let discountError: string | null = null;
      if (typeof rawCode === "string" && rawCode.trim()) {
        const parsed = discountCodeSchema.safeParse(rawCode);
        try {
          if (!parsed.success) throw new HttpError(400, "كود الخصم غير صحيح أو غير مفعّل");
          const d = computeDiscount(await findCode(db, parsed.data), {
            lines: ev.quote.lines,
            subtotal: new Prisma.Decimal(ev.quote.total),
            resourceKinds: ev.resources.map((r) => r.kind),
          });
          discount = { code: d.code, amount: Number(d.amount) };
        } catch (err) {
          if (!(err instanceof HttpError)) throw err;
          discountError = err.message;
        }
      }
      const total = discount ? subtotal - discount.amount : subtotal;
      // Payment options shown to the guest: the up-front booking part of each plan (deposit is separate).
      const policy = await getSetting(db, "bookingPolicy");
      const depositPlan = policy.allowDepositPlan
        ? { percent: policy.depositPercent, upfront: Number(upfrontFor("DEPOSIT", total, policy.depositPercent)) }
        : null;
      res.json({
        available: true,
        lines: ev.quote.lines,
        subtotal,
        discount,
        discountError,
        total,
        deposit: ev.deposit,
        payable: total + ev.deposit,
        endDate: ev.endDate,
        paymentOptions: { depositPlan, balanceDueHours: policy.balanceDueHours },
      });
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) return void res.json({ available: false, reason: err.message });
      throw err;
    }
  });

  const bookingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: opts.bookingLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "عدد كبير من الطلبات، حاول لاحقًا أو تواصل معنا مباشرة" },
  });

  /** Sends a booking request. It is NOT a confirmed booking: the owner contacts the guest on WhatsApp first. */
  router.post("/bookings", bookingLimiter, async (req, res) => {
    const input = parse(bookingSchema, req.body);
    const { booking, evaluation, discount } = await createBooking(
      db,
      {
        resourceIds: input.resourceIds,
        startDate: input.startDate,
        nights: input.nights,
        guest: { name: input.name, phone: input.phone, email: input.email ?? null, nationalId: input.nationalId },
        guestCount: input.guestCount ?? null,
        guestNotes: input.notes ?? null,
        channel: "WEBSITE",
        discountCode: input.discountCode || null,
        paymentPlan: input.paymentPlan,
        depositTiming: input.depositTiming,
      },
      { whatsapp: opts.whatsapp, secretBox: opts.secretBox },
    );
    // Bank details go only to the person who just sent a request — never to the public pages.
    const bank = await getSetting(db, "bank");
    const total = Number(booking.totalAmount);
    const deposit = Number(booking.depositAmount);
    res.status(201).json({
      reference: booking.reference,
      status: booking.status,
      startDate: input.startDate,
      endDate: evaluation.endDate,
      items: evaluation.resources.map((r) => r.name),
      lines: evaluation.quote.lines,
      subtotal: Number(evaluation.quote.total),
      discount: discount ? { code: discount.code, amount: Number(discount.amount) } : null,
      total,
      deposit,
      payable: total + deposit,
      paymentPlan: booking.paymentPlan,
      depositTiming: booking.depositTiming,
      upfront: Number(booking.upfrontAmount),
      // What to transfer now to confirm: the up-front booking part (+ the deposit if chosen with it).
      dueNow: Number(booking.upfrontAmount) + (booking.depositTiming === "WITH_FIRST_PAYMENT" ? deposit : 0),
      balanceDueHours: (await getSetting(db, "bookingPolicy")).balanceDueHours,
      bank: bank.iban ? bank : null,
    });
  });

  return router;
}
