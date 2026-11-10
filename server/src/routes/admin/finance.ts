import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { HttpError, parse, uuidParam } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { fromIsoDate, isoDate, toIsoDate } from "../../lib/dates.js";
import type { SecretBox } from "../../lib/secretBox.js";
import { commitImport, parseWorkbook, planImport } from "../../services/importer.js";

export const EXPENSE_CATEGORIES = ["صيانة", "كهرباء ومياه", "نظافة", "مشتريات", "رواتب", "تسويق", "أخرى"];

const expenseInput = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(60),
  date: isoDate,
  amount: z.number().positive().max(10_000_000).multipleOf(0.01),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const present = <E extends { date: Date; amount: { toString(): string } }>(e: E) => ({ ...e, date: toIsoDate(e.date), amount: Number(e.amount.toString()) });

/** «المصاريف» — owner only. */
export function expensesRouter(db: PrismaClient) {
  const router = Router();
  router.get("/", async (req, res) => {
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional(), category: z.string().max(60).optional() }), req.query);
    const where = {
      ...(q.from || q.to ? { date: { ...(q.from ? { gte: fromIsoDate(q.from) } : {}), ...(q.to ? { lte: fromIsoDate(q.to) } : {}) } } : {}),
      ...(q.category ? { category: q.category } : {}),
    };
    const items = await db.expense.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
    const used = await db.expense.findMany({ distinct: ["category"], select: { category: true } });
    res.json({
      items: items.map(present),
      total: Math.round(items.reduce((s, e) => s + Number(e.amount), 0) * 100) / 100,
      categories: [...new Set([...EXPENSE_CATEGORIES, ...used.map((u) => u.category)])],
    });
  });
  router.post("/", async (req, res) => {
    const input = parse(expenseInput, req.body);
    const e = await db.expense.create({ data: { ...input, notes: input.notes ?? null, date: fromIsoDate(input.date) } });
    await audit(db, req, { action: "expense.create", entityType: "expense", entityId: e.id, details: { amount: input.amount, category: input.category } });
    res.status(201).json(present(e));
  });
  router.put("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(expenseInput, req.body);
    const e = await db.expense.update({ where: { id }, data: { ...input, notes: input.notes ?? null, date: fromIsoDate(input.date) } });
    await audit(db, req, { action: "expense.update", entityType: "expense", entityId: id, details: { amount: input.amount, category: input.category } });
    res.json(present(e));
  });
  router.delete("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { count } = await db.expense.deleteMany({ where: { id } });
    if (count === 0) throw new HttpError(404, "المصروف غير موجود");
    await audit(db, req, { action: "expense.delete", entityType: "expense", entityId: id });
    res.status(204).end();
  });
  return router;
}

/**
 * Monthly report. «قيمة الحجوزات» = confirmed/completed bookings, counted in the month of their first
 * day (as in the owner's previous records). «المحصّل» = verified booking money received in that month,
 * net of refunds. Security deposits are not income. Net = booking value − expenses.
 */
export function reportsRouter(db: PrismaClient) {
  const router = Router();
  router.get("/monthly", async (req, res) => {
    const { year } = parse(z.object({ year: z.coerce.number().int().min(2020).max(2100) }), req.query);
    const from = fromIsoDate(`${year}-01-01`);
    const to = fromIsoDate(`${year + 1}-01-01`);
    const [bookings, payments, expenses] = await Promise.all([
      db.booking.findMany({ where: { status: { in: ["CONFIRMED", "COMPLETED"] }, startDate: { gte: from, lt: to } }, select: { startDate: true, totalAmount: true } }),
      db.payment.findMany({ where: { status: "ACCEPTED", purpose: "BOOKING", verifiedAt: { gte: from, lt: to } }, select: { verifiedAt: true, amount: true, kind: true } }),
      db.expense.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, amount: true, category: true } }),
    ]);
    const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, "0")}`, bookings: 0, bookingValue: 0, collected: 0, expenses: 0, net: 0 }));
    const at = (d: Date) => months[Number(toIsoDate(d).slice(5, 7)) - 1]!;
    for (const b of bookings) {
      const m = at(b.startDate);
      m.bookings++;
      m.bookingValue += Number(b.totalAmount);
    }
    for (const p of payments) at(p.verifiedAt!).collected += (p.kind === "REFUND" ? -1 : 1) * Number(p.amount);
    const byCategory: Record<string, number> = {};
    for (const e of expenses) {
      at(e.date).expenses += Number(e.amount);
      byCategory[e.category] = (byCategory[e.category] ?? 0) + Number(e.amount);
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    for (const m of months) {
      m.bookingValue = r2(m.bookingValue);
      m.collected = r2(m.collected);
      m.expenses = r2(m.expenses);
      m.net = r2(m.bookingValue - m.expenses);
    }
    const total = months.reduce((t, m) => ({ bookings: t.bookings + m.bookings, bookingValue: r2(t.bookingValue + m.bookingValue), collected: r2(t.collected + m.collected), expenses: r2(t.expenses + m.expenses), net: r2(t.net + m.net) }), { bookings: 0, bookingValue: 0, collected: 0, expenses: 0, net: 0 });
    res.json({ year, months, total, byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, r2(v)])) });
  });
  return router;
}

/** «استيراد السجل السابق» — preview first, then import. Owner only. The file is read in memory and not stored. */
export function importRouter(db: PrismaClient, box: SecretBox) {
  const router = Router();
  const fileOf = (body: unknown) => {
    const { data } = parse(z.object({ data: z.string().min(1).max(8_000_000) }), body);
    const buf = Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64");
    if (buf.length < 100 || buf.subarray(0, 2).toString("latin1") !== "PK") throw new HttpError(400, "الملف ليس ملف Excel ‎.xlsx");
    return buf;
  };
  router.post("/preview", async (req, res) => {
    const plan = await planImport(db, await parseWorkbook(fileOf(req.body)));
    res.json({ summary: plan.summary, issues: plan.issues });
  });
  router.post("/commit", async (req, res) => {
    const plan = await planImport(db, await parseWorkbook(fileOf(req.body)));
    if (plan.toImport.length === 0 && plan.expenses.length === 0) throw new HttpError(409, "لا يوجد جديد للاستيراد (كل السجلات مستوردة مسبقًا)");
    res.json({ summary: await commitImport(db, req, box, plan), issues: plan.issues });
  });
  return router;
}
