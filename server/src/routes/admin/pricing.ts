import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { HttpError, parse, uuidParam } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { eachDate, fromIsoDate, isoDate } from "../../lib/dates.js";
import { quote } from "../../services/pricing.js";

const ruleInput = z
  .object({
    resourceId: z.uuid(),
    kind: z.enum(["WEEKDAY", "SEASON", "SPECIAL"]),
    label: z.string().trim().max(120).nullable().default(null),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    startDate: isoDate.nullable().default(null),
    endDate: isoDate.nullable().default(null),
    price: z.number().min(0).max(1_000_000).multipleOf(0.01),
    priority: z.number().int().min(0).max(1000).default(0),
    active: z.boolean().default(true),
  })
  .refine((r) => r.kind === "WEEKDAY" || (r.startDate && r.endDate), {
    message: "الأسعار الموسمية والخاصة تحتاج تاريخ بداية ونهاية",
    path: ["startDate"],
  })
  .refine((r) => !r.startDate || !r.endDate || r.endDate >= r.startDate, {
    message: "تاريخ النهاية قبل البداية",
    path: ["endDate"],
  });

function toData(r: z.infer<typeof ruleInput>) {
  return {
    ...r,
    daysOfWeek: [...new Set(r.daysOfWeek)].sort(),
    startDate: r.startDate && r.kind !== "WEEKDAY" ? fromIsoDate(r.startDate) : null,
    endDate: r.endDate && r.kind !== "WEEKDAY" ? fromIsoDate(r.endDate) : null,
  };
}

export function pricingRouter(db: PrismaClient) {
  const router = Router();

  router.get("/", async (_req, res) => {
    res.json(await db.pricingRule.findMany({ orderBy: [{ resourceId: "asc" }, { kind: "asc" }, { createdAt: "asc" }] }));
  });

  router.post("/", async (req, res) => {
    const input = parse(ruleInput, req.body);
    if (!(await db.bookingResource.findUnique({ where: { id: input.resourceId } }))) throw new HttpError(404, "الجزء غير موجود");
    const rule = await db.pricingRule.create({ data: toData(input) });
    await audit(db, req, { action: "pricing.create", entityType: "pricing_rule", entityId: rule.id, details: input });
    res.status(201).json(rule);
  });

  /**
   * «الأسعار الخاصة والمواسم»: one price for a list of separate dates (e.g. all Eid days), for one or
   * more parts at once. Creates one «سعر خاص» rule per date and part, all with the same name.
   * Base weekday prices are never touched.
   */
  router.post("/special-dates", async (req, res) => {
    const input = parse(
      z.object({
        resourceIds: z.array(z.uuid()).min(1).max(20),
        label: z.string().trim().min(1, "اكتب اسم المناسبة أو العرض").max(120),
        dates: z.array(isoDate).min(1).max(120),
        price: z.number().min(0).max(1_000_000).multipleOf(0.01),
        priority: z.number().int().min(0).max(1000).default(0),
        active: z.boolean().default(true),
      }),
      req.body,
    );
    const resourceIds = [...new Set(input.resourceIds)];
    const found = await db.bookingResource.count({ where: { id: { in: resourceIds } } });
    if (found !== resourceIds.length) throw new HttpError(404, "الجزء غير موجود");
    const dates = [...new Set(input.dates)].sort();
    const rules = await db.$transaction(
      resourceIds.flatMap((resourceId) =>
        dates.map((d) =>
          db.pricingRule.create({
            data: {
              resourceId,
              kind: "SPECIAL",
              label: input.label,
              daysOfWeek: [],
              startDate: fromIsoDate(d),
              endDate: fromIsoDate(d),
              price: input.price,
              priority: input.priority,
              active: input.active,
            },
          }),
        ),
      ),
    );
    await audit(db, req, { action: "pricing.special_dates", entityType: "pricing_rule", details: { ...input, dates, created: rules.length } });
    res.status(201).json(rules);
  });

  router.patch("/:id/active", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    const rule = await db.pricingRule.update({ where: { id }, data: { active } });
    await audit(db, req, { action: active ? "pricing.enable" : "pricing.disable", entityType: "pricing_rule", entityId: id });
    res.json(rule);
  });

  router.put("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(ruleInput, req.body);
    const before = await db.pricingRule.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "قاعدة السعر غير موجودة");
    const rule = await db.pricingRule.update({ where: { id }, data: toData(input) });
    await audit(db, req, {
      action: "pricing.update",
      entityType: "pricing_rule",
      entityId: id,
      details: { before: { price: before.price.toFixed(2), kind: before.kind }, after: input },
    });
    res.json(rule);
  });

  router.delete("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { count } = await db.pricingRule.deleteMany({ where: { id } });
    if (count === 0) throw new HttpError(404, "قاعدة السعر غير موجودة");
    await audit(db, req, { action: "pricing.delete", entityType: "pricing_rule", entityId: id });
    res.status(204).end();
  });

  /** Preview: what would these resources cost on these dates? Shows days with no approved price. */
  router.post("/quote", async (req, res) => {
    const { resourceIds, from, to } = parse(
      z.object({ resourceIds: z.array(z.uuid()).min(1).max(20), from: isoDate, to: isoDate }).refine((v) => v.to > v.from),
      req.body,
    );
    const dates = eachDate(from, to);
    if (dates.length > 62) throw new HttpError(400, "النطاق الأقصى 62 يومًا");
    res.json(await quote(db, resourceIds, dates));
  });

  return router;
}
