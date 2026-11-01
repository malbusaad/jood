import { Router } from "express";
import { z } from "zod";
import type { BookingStatus, Prisma, PrismaClient } from "@prisma/client";
import { HttpError, parse, uuidParam } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { addDays, fromIsoDate, isoDate, todayInRiyadh } from "../../lib/dates.js";
import { phoneSchema } from "../../settings/registry.js";
import {
  STATUS_LABELS,
  TRANSITIONS,
  acceptPendingPayment,
  acceptedPaid,
  changeStatus,
  createBooking,
  evaluateSelection,
  expireStaleBookings,
  recordVerifiedPayment,
  rejectPayment,
} from "../../services/bookings.js";
import { buildContract } from "../../services/contract.js";
import { issueGuestLink, revokeGuestLinks } from "../../services/guestAccess.js";
import type { WhatsAppSender } from "../../services/notifications.js";

const statuses = ["NEW", "AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED", "CANCELLED", "REJECTED", "EXPIRED", "COMPLETED"] as const;

const listQuery = z.object({
  status: z
    .union([z.enum(statuses), z.array(z.enum(statuses))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
  channel: z.enum(["WEBSITE", "GATHERN", "MANUAL"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

/** Phone search that matches both local (05…) and international (9665…) forms. */
function phoneFragment(q: string): string | null {
  const digits = q.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 3 ? digits : null;
}

const listInclude = {
  guest: { select: { id: true, name: true, phone: true } },
  items: { select: { resource: { select: { id: true, name: true, kind: true } } }, distinct: ["resourceId"] },
  payments: { select: { amount: true, status: true } },
} satisfies Prisma.BookingInclude;

function summarize<T extends { payments: { amount: Prisma.Decimal; status: string }[]; items: { resource: { name: string } }[] }>(b: T) {
  const { payments, items, ...rest } = b;
  return {
    ...rest,
    resources: items.map((i) => i.resource),
    paid: acceptedPaid(payments).toFixed(2),
    pendingPayments: payments.filter((p) => p.status === "PENDING").length,
  };
}

export function bookingsRouter(db: PrismaClient, opts: { whatsapp: WhatsAppSender | null; publicBaseUrl: string }) {
  const router = Router();

  router.get("/", async (req, res) => {
    const { status, from, to, q, channel, page } = parse(listQuery, req.query);
    await expireStaleBookings(db);
    const where: Prisma.BookingWhereInput = {
      ...(status ? { status: { in: status } } : {}),
      ...(channel ? { channel } : {}),
      // Overlap with [from, to]
      ...(from ? { endDate: { gt: fromIsoDate(from) } } : {}),
      ...(to ? { startDate: { lte: fromIsoDate(to) } } : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q, mode: "insensitive" } },
              { guest: { name: { contains: q, mode: "insensitive" } } },
              ...(phoneFragment(q) ? [{ guest: { phone: { contains: phoneFragment(q)! } } }] : []),
            ],
          }
        : {}),
    };
    const pageSize = 30;
    const [items, total] = await Promise.all([
      db.booking.findMany({ where, include: listInclude, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      db.booking.count({ where }),
    ]);
    res.json({ items: items.map(summarize), total, page, pageSize });
  });

  router.get("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const b = await db.booking.findUnique({
      where: { id },
      include: {
        guest: true,
        items: { include: { resource: { select: { id: true, name: true, kind: true } } }, orderBy: { date: "asc" } },
        payments: { include: { verifiedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
        confirmedBy: { select: { name: true } },
        // Never the token itself — only its status.
        accessTokens: { select: { id: true, createdAt: true, expiresAt: true, revokedAt: true, lastUsedAt: true }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!b) throw new HttpError(404, "الحجز غير موجود");
    const history = await db.auditLog.findMany({
      where: { entityType: "booking", entityId: id },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { name: true } } },
    });
    res.json({
      ...b,
      paid: acceptedPaid(b.payments).toFixed(2),
      allowedTransitions: TRANSITIONS[b.status],
      statusLabel: STATUS_LABELS[b.status],
      history,
    });
  });

  /** Manual booking by the admin — e.g. a Gathern booking or one agreed by phone. Same conflict rules. */
  router.post("/", async (req, res) => {
    const input = parse(
      z.object({
        resourceIds: z.array(z.uuid()).min(1).max(20),
        startDate: isoDate,
        nights: z.number().int().min(1).max(30),
        name: z.string().trim().min(2).max(120),
        phone: phoneSchema,
        email: z.email().max(254).nullable().optional(),
        guestCount: z.number().int().min(1).max(500).nullable().optional(),
        adminNotes: z.string().trim().max(2000).nullable().optional(),
        channel: z.enum(["GATHERN", "MANUAL"]),
      }),
      req.body,
    );
    const { booking } = await createBooking(
      db,
      {
        resourceIds: input.resourceIds,
        startDate: input.startDate,
        nights: input.nights,
        guest: { name: input.name, phone: input.phone, email: input.email ?? null },
        guestCount: input.guestCount ?? null,
        adminNotes: input.adminNotes ?? null,
        channel: input.channel,
      },
      { req, whatsapp: opts.whatsapp },
    );
    res.status(201).json(booking);
  });

  router.post("/quote", async (req, res) => {
    const sel = parse(z.object({ resourceIds: z.array(z.uuid()).min(1).max(20), startDate: isoDate, nights: z.number().int().min(1).max(30) }), req.body);
    try {
      const ev = await evaluateSelection(db, sel, { channel: "MANUAL" });
      res.json({ available: true, lines: ev.quote.lines, total: Number(ev.quote.total), deposit: ev.deposit });
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) return void res.json({ available: false, reason: err.message });
      throw err;
    }
  });

  router.post("/:id/status", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { status, reason } = parse(
      z.object({ status: z.enum(statuses), reason: z.string().trim().max(500).nullable().optional() }),
      req.body,
    );
    res.json(await changeStatus(db, req, id, status as BookingStatus, reason ?? null));
  });

  router.patch("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(
      z.object({
        adminNotes: z.string().trim().max(2000).nullable(),
        guestCount: z.number().int().min(1).max(500).nullable(),
        contractSent: z.boolean(),
        contractAccepted: z.boolean(),
      }).partial(),
      req.body,
    );
    const { contractSent, contractAccepted, ...rest } = input;
    const data: Prisma.BookingUpdateInput = { ...rest };
    if (contractSent !== undefined) data.contractSentAt = contractSent ? new Date() : null;
    if (contractAccepted !== undefined) data.contractAcceptedAt = contractAccepted ? new Date() : null;
    const updated = await db.booking.update({ where: { id }, data });
    await audit(db, req, { action: "booking.update", entityType: "booking", entityId: id, details: input });
    res.json(updated);
  });

  router.post("/:id/payments", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(
      z.object({
        method: z.enum(["BANK_TRANSFER", "GATHERN"]),
        amount: z.number().positive().max(1_000_000).multipleOf(0.01),
        reportedAt: z.iso.datetime({ offset: true }).nullable().optional(),
        externalRef: z.string().trim().max(100).nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
      }),
      req.body,
    );
    res.status(201).json(await recordVerifiedPayment(db, req, id, input));
  });

  router.post("/payments/:id/accept", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    res.json(await acceptPendingPayment(db, req, id));
  });

  router.post("/payments/:id/reject", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { note } = parse(z.object({ note: z.string().trim().max(500).nullable().optional() }), req.body);
    res.json(await rejectPayment(db, req, id, note ?? null));
  });

  router.post("/:id/guest-link", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    res.status(201).json(await issueGuestLink(db, req, id, opts.publicBaseUrl));
  });

  router.delete("/:id/guest-link", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    await revokeGuestLinks(db, req, id);
    res.status(204).end();
  });

  router.get("/:id/contract", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    res.json(await buildContract(db, id));
  });

  return router;
}

export function calendarRouter(db: PrismaClient) {
  const router = Router();
  router.get("/", async (req, res) => {
    const { from, to } = parse(
      z.object({ from: isoDate, to: isoDate }).refine((r) => r.to > r.from && r.to <= addDays(r.from, 62), "النطاق الأقصى 62 يومًا"),
      req.query,
    );
    await expireStaleBookings(db);
    const bookings = await db.booking.findMany({
      where: {
        status: { in: ["NEW", "AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED", "COMPLETED"] },
        startDate: { lt: fromIsoDate(to) },
        endDate: { gt: fromIsoDate(from) },
      },
      include: {
        guest: { select: { name: true, phone: true } },
        items: { select: { date: true, resource: { select: { id: true, name: true, kind: true } } } },
      },
      orderBy: { startDate: "asc" },
    });
    res.json({
      bookings: bookings.map((b) => ({
        id: b.id,
        reference: b.reference,
        status: b.status,
        channel: b.channel,
        startDate: b.startDate,
        endDate: b.endDate,
        guest: b.guest,
        kind: b.items.some((i) => i.resource.kind === "FULL") ? "FULL" : "PART",
        resources: [...new Map(b.items.map((i) => [i.resource.id, i.resource])).values()],
      })),
    });
  });
  return router;
}

export function dashboardRouter(db: PrismaClient) {
  const router = Router();
  router.get("/", async (_req, res) => {
    await expireStaleBookings(db);
    const today = fromIsoDate(todayInRiyadh());
    const monthStart = fromIsoDate(`${todayInRiyadh().slice(0, 7)}-01`);
    const active = ["NEW", "AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED"] as BookingStatus[];
    const [upcoming, confirmedUpcoming, newRequests, awaitingVerification, pendingPayments, revenueMonth, revenueAll, cancelledMonth, unavailableAmenities, unread, next] =
      await Promise.all([
        db.booking.count({ where: { status: { in: active }, endDate: { gt: today } } }),
        db.booking.count({ where: { status: "CONFIRMED", endDate: { gt: today } } }),
        db.booking.count({ where: { status: "NEW" } }),
        db.booking.count({ where: { status: "AWAITING_VERIFICATION" } }),
        db.payment.count({ where: { status: "PENDING" } }),
        db.payment.aggregate({ _sum: { amount: true }, where: { status: "ACCEPTED", verifiedAt: { gte: monthStart } } }),
        db.payment.aggregate({ _sum: { amount: true }, where: { status: "ACCEPTED" } }),
        db.booking.count({ where: { status: "CANCELLED", cancelledAt: { gte: monthStart } } }),
        db.amenity.findMany({ where: { available: false }, select: { id: true, name: true } }),
        db.notification.count({ where: { readAt: null } }),
        db.booking.findMany({
          where: { status: { in: active }, endDate: { gt: today } },
          include: listInclude,
          orderBy: { startDate: "asc" },
          take: 8,
        }),
      ]);
    res.json({
      upcoming,
      confirmedUpcoming,
      newRequests,
      awaitingVerification,
      pendingPayments,
      revenueMonth: (revenueMonth._sum.amount ?? 0).toString(),
      revenueAll: (revenueAll._sum.amount ?? 0).toString(),
      cancelledMonth,
      unavailableAmenities,
      unreadNotifications: unread,
      next: next.map(summarize),
    });
  });
  return router;
}

export function guestsRouter(db: PrismaClient) {
  const router = Router();
  router.get("/", async (req, res) => {
    const { q } = parse(z.object({ q: z.string().trim().max(100).optional() }), req.query);
    const guests = await db.guest.findMany({
      where: q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, ...(phoneFragment(q) ? [{ phone: { contains: phoneFragment(q)! } }] : []), { email: { contains: q, mode: "insensitive" } }] }
        : {},
      include: { _count: { select: { bookings: true } }, bookings: { select: { startDate: true }, orderBy: { startDate: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(
      guests.map(({ bookings, _count, ...g }) => ({ ...g, bookingCount: _count.bookings, lastStay: bookings[0]?.startDate ?? null })),
    );
  });
  router.get("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const g = await db.guest.findUnique({
      where: { id },
      include: { bookings: { include: listInclude, orderBy: { startDate: "desc" } } },
    });
    if (!g) throw new HttpError(404, "الضيف غير موجود");
    res.json({ ...g, bookings: g.bookings.map(summarize) });
  });
  router.patch("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(
      z.object({ name: z.string().trim().min(2).max(120), email: z.email().max(254).nullable(), notes: z.string().trim().max(2000).nullable() }).partial(),
      req.body,
    );
    const g = await db.guest.update({ where: { id }, data: input });
    await audit(db, req, { action: "guest.update", entityType: "guest", entityId: id, details: input });
    res.json(g);
  });
  return router;
}
