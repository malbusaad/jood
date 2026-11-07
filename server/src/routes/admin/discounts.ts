import { Router } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { HttpError, parse, uuidParam } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { fromIsoDate, isoDate, toIsoDate } from "../../lib/dates.js";
import { discountCodeSchema } from "../../services/discounts.js";

const codeInput = z
  .object({
    code: discountCodeSchema,
    label: z.string().trim().max(120).nullable().default(null),
    type: z.enum(["PERCENT", "FIXED"]),
    value: z.number().positive().max(1_000_000).multipleOf(0.01),
    startDate: isoDate.nullable().default(null),
    endDate: isoDate.nullable().default(null),
    maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
    onePerGuest: z.boolean().default(false),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    includeSpecialDays: z.boolean().default(true),
    scope: z.enum(["ALL", "FULL_ONLY"]).default("ALL"),
    minAmount: z.number().min(0).max(1_000_000).multipleOf(0.01).nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((v) => v.type !== "PERCENT" || v.value <= 100, { message: "النسبة من 1 إلى 100", path: ["value"] })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: "تاريخ الانتهاء قبل البداية", path: ["endDate"] });

type CodeInput = z.infer<typeof codeInput>;

function toData(v: CodeInput) {
  return {
    ...v,
    daysOfWeek: [...new Set(v.daysOfWeek)].sort(),
    startDate: v.startDate ? fromIsoDate(v.startDate) : null,
    endDate: v.endDate ? fromIsoDate(v.endDate) : null,
  };
}

function present<C extends { startDate: Date | null; endDate: Date | null; value: Prisma.Decimal; minAmount: Prisma.Decimal | null }>(c: C) {
  return {
    ...c,
    value: Number(c.value),
    minAmount: c.minAmount === null ? null : Number(c.minAmount),
    startDate: c.startDate ? toIsoDate(c.startDate) : null,
    endDate: c.endDate ? toIsoDate(c.endDate) : null,
  };
}

/** «الخصومات وأكواد الخصم» — owner only. */
export function discountsRouter(db: PrismaClient) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const codes = await db.discountCode.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { redemptions: true } } } });
    res.json(codes.map(({ _count, ...c }) => ({ ...present(c), totalRedemptions: _count.redemptions })));
  });

  router.get("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const c = await db.discountCode.findUnique({
      where: { id },
      include: {
        redemptions: {
          orderBy: { createdAt: "desc" },
          include: { booking: { select: { id: true, reference: true, status: true, startDate: true } }, guest: { select: { name: true } } },
        },
      },
    });
    if (!c) throw new HttpError(404, "كود الخصم غير موجود");
    const { redemptions, ...code } = c;
    res.json({
      ...present(code),
      redemptions: redemptions.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        status: r.status,
        createdAt: r.createdAt,
        releasedAt: r.releasedAt,
        guestName: r.guest.name,
        booking: { ...r.booking, startDate: toIsoDate(r.booking.startDate) },
      })),
    });
  });

  router.post("/", async (req, res) => {
    const input = parse(codeInput, req.body);
    const c = await db.discountCode.create({ data: toData(input) });
    await audit(db, req, { action: "discount.create", entityType: "discount_code", entityId: c.id, details: input });
    res.status(201).json(present(c));
  });

  router.put("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(codeInput, req.body);
    const before = await db.discountCode.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "كود الخصم غير موجود");
    if (input.maxUses !== null && input.maxUses < before.usedCount) {
      throw new HttpError(400, `الكود مستخدم ${before.usedCount} مرات؛ لا يمكن أن يكون الحد الأقصى أقل من ذلك`);
    }
    // Changes apply to new bookings only: existing bookings keep the discount they were given.
    const c = await db.discountCode.update({ where: { id }, data: toData(input) });
    await audit(db, req, { action: "discount.update", entityType: "discount_code", entityId: id, details: input });
    res.json(present(c));
  });

  router.patch("/:id/active", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    const c = await db.discountCode.update({ where: { id }, data: { active } });
    await audit(db, req, { action: active ? "discount.enable" : "discount.disable", entityType: "discount_code", entityId: id });
    res.json(present(c));
  });

  /** A code that was ever used is kept for the record — it can only be switched off. */
  router.delete("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const used = await db.discountRedemption.count({ where: { codeId: id } });
    if (used > 0) throw new HttpError(409, "الكود مستخدم في حجوزات سابقة؛ أوقفه بدل حذفه حفاظًا على السجل");
    const { count } = await db.discountCode.deleteMany({ where: { id } });
    if (count === 0) throw new HttpError(404, "كود الخصم غير موجود");
    await audit(db, req, { action: "discount.delete", entityType: "discount_code", entityId: id });
    res.status(204).end();
  });

  return router;
}
