import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { amenityBySlug, db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, fromIsoDate, todayInRiyadh } from "../src/lib/dates.js";
import type { WhatsAppSender } from "../src/services/notifications.js";

const IBAN = "SA0380000000608010167519";

/** The next Sunday at least a week ahead, so prices are predictable (Sun 950 … Thu 1,200). */
function nextSunday(): string {
  let d = addDays(todayInRiyadh(), 7);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
}
const SUN = nextSunday();
const THU = addDays(SUN, 4);

let sent: { to: string; params: string[] }[] = [];
const fakeWhatsApp: WhatsAppSender = async (to, m) => {
  sent.push({ to, params: m.params });
};
const app = makeApp({ whatsapp: fakeWhatsApp, bookingLimit: 1000 });

beforeEach(async () => {
  await resetDb();
  sent = [];
});
afterAll(() => db.$disconnect());

function guest(i = 1) {
  return { name: `ضيف ${i}`, phone: `05000000${String(i).padStart(2, "0")}`, acceptTerms: true };
}

async function makePart(slug: string, amenitySlugs: string[], price: number | null = 400) {
  const amenities = await Promise.all(amenitySlugs.map(amenityBySlug));
  const part = await db.bookingResource.create({
    data: { slug, name: `جزء ${slug}`, kind: "PART", amenities: { create: amenities.map((a) => ({ amenityId: a.id })) } },
  });
  if (price !== null) await db.pricingRule.create({ data: { resourceId: part.id, kind: "WEEKDAY", price } });
  return part;
}

function book(resourceIds: string[], startDate: string, nights = 1, g = guest()) {
  return request(app).post("/api/public/bookings").send({ resourceIds, startDate, nights, ...g });
}

describe("booking requests from the website", () => {
  it("books the full rest house: server-side price, NEW status, reference, notification", async () => {
    const full = await fullResource();
    const res = await book([full.id], SUN, 2, { ...guest(), guestCount: 20, notes: "عائلة" } as never);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "NEW", total: 1900, deposit: 500, payable: 2400, startDate: SUN, endDate: addDays(SUN, 2) });
    expect(res.body.reference).toMatch(/^JD-\d{6}$/);
    expect(res.body.lines.map((l: { price: string }) => l.price)).toEqual(["950.00", "950.00"]);

    const b = await db.booking.findUniqueOrThrow({ where: { reference: res.body.reference }, include: { guest: true, items: true } });
    expect(b.guest.phone).toBe("966500000001"); // normalised
    expect(b.items).toHaveLength(2);
    expect(await db.bookingLock.count({ where: { bookingId: b.id } })).toBe(11 * 2);

    const n = await db.notification.findFirstOrThrow();
    expect(n).toMatchObject({ type: "NEW_BOOKING", bookingId: b.id, whatsappStatus: "NOT_CONFIGURED" });
    expect(n.title).toContain(res.body.reference);
  });

  it("ignores any price sent by the browser", async () => {
    const full = await fullResource();
    const res = await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: THU, nights: 1, total: 1, price: 1, ...guest() });
    expect(res.status).toBe(201);
    expect(res.body.total).toBe(1200);
  });

  it("books a part, and independent parts on the same day", async () => {
    const majlis = await makePart("majlis", ["majlis"]);
    const tent = await makePart("tent", ["tent"], 300);
    expect((await book([majlis.id], SUN)).status).toBe(201);
    const second = await book([tent.id], SUN, 1, guest(2));
    expect(second.status).toBe(201);
    expect(second.body.total).toBe(300);
  });

  it("books several independent parts together", async () => {
    const majlis = await makePart("majlis", ["majlis"]);
    const tent = await makePart("tent", ["tent"], 300);
    const res = await book([majlis.id, tent.id], SUN);
    expect(res.status).toBe(201);
    expect(res.body.total).toBe(700);
  });

  it("prevents double booking of the full rest house", async () => {
    const full = await fullResource();
    expect((await book([full.id], SUN)).status).toBe(201);
    const again = await book([full.id], SUN, 1, guest(2));
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/محجوز/);
  });

  it("prevents a full booking over a part booking, and a part booking over a full one", async () => {
    const full = await fullResource();
    const majlis = await makePart("majlis", ["majlis"]);
    expect((await book([majlis.id], SUN)).status).toBe(201);
    expect((await book([full.id], SUN, 1, guest(2))).status).toBe(409);
    expect((await book([full.id], THU, 1, guest(3))).status).toBe(201);
    expect((await book([majlis.id], THU, 1, guest(4))).status).toBe(409);
  });

  it("prevents booking the same part twice, including overlapping multi-day stays", async () => {
    const majlis = await makePart("majlis", ["majlis"]);
    expect((await book([majlis.id], SUN, 3)).status).toBe(201);
    expect((await book([majlis.id], addDays(SUN, 2), 2, guest(2))).status).toBe(409);
    expect((await book([majlis.id], addDays(SUN, 3), 1, guest(3))).status).toBe(201); // day after checkout
  });

  it("refuses conflicting parts in one request and the full house combined with parts", async () => {
    const full = await fullResource();
    const a = await makePart("a", ["majlis", "kitchen"]);
    const b = await makePart("b", ["tent", "kitchen"]);
    expect((await book([a.id, b.id], SUN)).status).toBe(400);
    expect((await book([full.id, a.id], SUN)).status).toBe(400);
  });

  it("lets exactly one of many simultaneous requests for the same day succeed", async () => {
    const full = await fullResource();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => book([full.id], SUN, 1, guest(i + 1))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await db.booking.count()).toBe(1);
  });

  it("never books a part without an owner-approved price", async () => {
    const majlis = await makePart("majlis", ["majlis"], null);
    const res = await book([majlis.id], SUN);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/غير متاح للحجز/);
    expect(await db.booking.count()).toBe(0);
  });

  it("does not book a part whose amenity the owner switched off; the full house stays bookable", async () => {
    const full = await fullResource();
    const outdoor = await makePart("outdoor", ["outdoor-1"]);
    await db.amenity.update({ where: { slug: "outdoor-1" }, data: { available: false } });
    expect((await book([outdoor.id], SUN)).status).toBe(400);
    expect((await book([full.id], SUN)).status).toBe(201);
  });

  it("validates dates, length, terms and the honeypot", async () => {
    const full = await fullResource();
    expect((await book([full.id], addDays(todayInRiyadh(), -1))).status).toBe(400);
    expect((await book([full.id], SUN, 8)).status).toBe(400); // maxNights 7
    expect((await book([full.id], addDays(todayInRiyadh(), 400))).status).toBe(400); // beyond maxAdvanceDays
    expect((await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: SUN, nights: 1, name: "x y", phone: "0500000001" })).status).toBe(400);
    expect((await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: SUN, nights: 1, ...guest(), website: "spam" })).status).toBe(400);
    expect((await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: SUN, nights: 1, ...guest(), phone: "12" })).status).toBe(400);
    expect(await db.booking.count()).toBe(0);
  });

  it("returns bank details only to the requester, once the owner has set them", async () => {
    const full = await fullResource();
    const before = await book([full.id], SUN);
    expect(before.body.bank).toBeNull();
    await db.siteSetting.create({ data: { key: "bank", value: { bankName: "بنك", accountHolder: "الاستراحة", iban: IBAN, instructions: null } } });
    const after = await book([full.id], THU, 1, guest(2));
    expect(after.body.bank.iban).toBe(IBAN);
    const site = await request(app).get("/api/public/site");
    expect(JSON.stringify(site.body)).not.toContain(IBAN);
  });

  it("rate-limits booking requests per IP", async () => {
    const limited = makeApp({ bookingLimit: 2 });
    const full = await fullResource();
    const send = (d: string, i: number) => request(limited).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: d, nights: 1, ...guest(i) });
    expect((await send(SUN, 1)).status).toBe(201);
    expect((await send(addDays(SUN, 1), 2)).status).toBe(201);
    expect((await send(addDays(SUN, 2), 3)).status).toBe(429);
  });
});

describe("options and quotes", () => {
  it("lists what can be booked with availability and exact prices", async () => {
    const full = await fullResource();
    const majlis = await makePart("majlis", ["majlis"]);
    await makePart("tent", ["tent"], null); // no price → not bookable
    await book([majlis.id], SUN);

    const res = await request(app).get(`/api/public/options?startDate=${SUN}&nights=1`);
    expect(res.status).toBe(200);
    expect(res.body.deposit).toBe(500);
    const byName = Object.fromEntries(res.body.options.map((o: { name: string }) => [o.name, o]));
    expect(byName["الاستراحة كاملة"]).toMatchObject({ id: full.id, available: false }); // blocked by the majlis booking
    expect(byName["جزء majlis"]).toMatchObject({ available: false });
    expect(byName["جزء tent"]).toMatchObject({ available: false, total: null });

    const thu = await request(app).get(`/api/public/options?startDate=${THU}&nights=1`);
    expect(thu.body.options.find((o: { id: string }) => o.id === full.id)).toMatchObject({ available: true, total: 1200 });
  });

  it("quotes a selection with the price breakdown, deposit and amount payable", async () => {
    const full = await fullResource();
    const res = await request(app).post("/api/public/quote").send({ resourceIds: [full.id], startDate: addDays(SUN, 3), nights: 2 });
    expect(res.body).toMatchObject({ available: true, total: 2150, deposit: 500, payable: 2650 });
    expect(res.body.lines).toHaveLength(2);
  });
});

describe("statuses, payments and confirmation", () => {
  async function newBooking(resourceIds?: string[]) {
    const ids = resourceIds ?? [(await fullResource()).id];
    const res = await book(ids, SUN);
    return db.booking.findUniqueOrThrow({ where: { reference: res.body.reference } });
  }

  it("never confirms without a verified payment covering the booking amount", async () => {
    const { agent, user } = await signedIn(app);
    const b = await newBooking();
    const early = await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CONFIRMED" });
    expect(early.status).toBe(409);

    await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "AWAITING_PAYMENT" }).expect(200);
    await agent.post(`/api/admin/bookings/${b.id}/payments`).send({ method: "BANK_TRANSFER", amount: 500 }).expect(201);
    expect((await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CONFIRMED" })).status).toBe(409);

    await agent.post(`/api/admin/bookings/${b.id}/payments`).send({ method: "BANK_TRANSFER", amount: 450, reportedAt: new Date().toISOString(), note: "تحويل ثاني" }).expect(201);
    const ok = await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CONFIRMED" });
    expect(ok.status).toBe(200);
    const confirmed = await db.booking.findUniqueOrThrow({ where: { id: b.id }, include: { payments: true } });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedById).toBe(user.id);
    expect(confirmed.payments.every((p) => p.status === "ACCEPTED" && p.verifiedById === user.id && p.verifiedAt)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "payment.verified" } })).toBe(2);
  });

  it("does not treat an uploaded/pending payment as received", async () => {
    const { agent } = await signedIn(app);
    const b = await newBooking();
    await db.payment.create({ data: { bookingId: b.id, method: "BANK_TRANSFER", amount: 950, status: "PENDING" } });
    expect((await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CONFIRMED" })).status).toBe(409);
  });

  it("rejects a reported payment, or accepts it after verification", async () => {
    const { agent } = await signedIn(app);
    const b = await newBooking();
    const p1 = await db.payment.create({ data: { bookingId: b.id, method: "BANK_TRANSFER", amount: 950 } });
    const rej = await agent.post(`/api/admin/bookings/payments/${p1.id}/reject`).send({ note: "لم يصل المبلغ" });
    expect(rej.body.status).toBe("REJECTED");
    expect((await agent.post(`/api/admin/bookings/payments/${p1.id}/accept`).send({})).status).toBe(409);

    const p2 = await db.payment.create({ data: { bookingId: b.id, method: "BANK_TRANSFER", amount: 950 } });
    expect((await agent.post(`/api/admin/bookings/payments/${p2.id}/accept`).send({})).body.status).toBe("ACCEPTED");
    expect((await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CONFIRMED" })).status).toBe(200);
  });

  it("cancels a booking and frees the day", async () => {
    const { agent } = await signedIn(app);
    const b = await newBooking();
    const res = await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CANCELLED", reason: "طلب الضيف" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "CANCELLED", cancelReason: "طلب الضيف" });
    expect(await db.bookingLock.count()).toBe(0);
    expect((await book([(await fullResource()).id], SUN, 1, guest(9))).status).toBe(201);
  });

  it("refuses invalid status changes", async () => {
    const { agent } = await signedIn(app);
    const b = await newBooking();
    await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CANCELLED" }).expect(200);
    expect((await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "AWAITING_PAYMENT" })).status).toBe(409);
    expect((await agent.post(`/api/admin/bookings/${b.id}/payments`).send({ method: "BANK_TRANSFER", amount: 100 })).status).toBe(409);
  });

  it("new requests wait for the owner; the payment deadline starts at «awaiting payment» and then expires", async () => {
    const { agent } = await signedIn(app);
    const b = await newBooking();
    expect(b.expiresAt).toBeNull();

    const moved = await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "AWAITING_PAYMENT" });
    const deadline = new Date(moved.body.expiresAt).getTime();
    expect(deadline).toBeGreaterThan(Date.now() + 14.9 * 3600_000);
    expect(deadline).toBeLessThan(Date.now() + 15.1 * 3600_000);

    await db.booking.update({ where: { id: b.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const full = await fullResource();
    const other = await book([full.id], SUN, 1, guest(5)); // triggers expiry first
    expect(other.status).toBe(201);
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("EXPIRED");
  });

  it("expiry never frees a day that someone else could double-book (confirmed bookings never expire)", async () => {
    const { agent } = await signedIn(app);
    const b = await newBooking();
    await agent.post(`/api/admin/bookings/${b.id}/payments`).send({ method: "BANK_TRANSFER", amount: 950 }).expect(201);
    await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CONFIRMED" }).expect(200);
    await db.booking.update({ where: { id: b.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await book([(await fullResource()).id], SUN, 1, guest(5))).status).toBe(409);
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CONFIRMED");
  });

  it("records contract sent and the guest's «موافق»", async () => {
    const { agent } = await signedIn(app);
    const b = await newBooking();
    const res = await agent.patch(`/api/admin/bookings/${b.id}`).send({ contractSent: true, contractAccepted: true, adminNotes: "وافق عبر واتساب" });
    expect(res.status).toBe(200);
    expect(res.body.contractSentAt).not.toBeNull();
    expect(res.body.contractAcceptedAt).not.toBeNull();
  });
});

describe("Gathern and manual bookings", () => {
  it("records a Gathern booking manually, with the same conflict rules and no assumed fees", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    const res = await agent
      .post("/api/admin/bookings")
      .send({ resourceIds: [full.id], startDate: THU, nights: 1, name: "ضيف جاذر إن", phone: "0551234567", channel: "GATHERN", adminNotes: "حجز جاذر إن" });
    expect(res.status).toBe(201);
    expect(res.body.channel).toBe("GATHERN");
    expect(Number(res.body.totalAmount)).toBe(1200); // base price only — no platform fee added
    expect(await db.notification.count()).toBe(0); // owner made it; no "new request" alert

    const pay = await agent.post(`/api/admin/bookings/${res.body.id}/payments`).send({ method: "GATHERN", amount: 1200, externalRef: "GTH-123" });
    expect(pay.status).toBe(201);
    expect(pay.body).toMatchObject({ method: "GATHERN", status: "ACCEPTED", externalRef: "GTH-123" });
    expect((await book([full.id], THU)).status).toBe(409);
  });
});

describe("admin access", () => {
  it("requires login for every booking endpoint and lets staff manage bookings", async () => {
    const full = await fullResource();
    const r = await book([full.id], SUN);
    const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
    for (const [m, path] of [["get", "/api/admin/bookings"], ["get", `/api/admin/bookings/${b.id}`], ["get", "/api/admin/dashboard"], ["get", "/api/admin/guests"], ["get", `/api/admin/bookings/${b.id}/contract`]] as const) {
      expect((await request(app)[m](path)).status).toBe(401);
    }
    expect((await request(app).post(`/api/admin/bookings/${b.id}/status`).send({ status: "CANCELLED" })).status).toBe(401);
    const { agent } = await signedIn(app, "STAFF");
    expect((await agent.get(`/api/admin/bookings/${b.id}`)).status).toBe(200);
  });

  it("does not expose one guest's booking through public endpoints", async () => {
    const full = await fullResource();
    await book([full.id], SUN);
    const cal = await request(app).get(`/api/public/calendar?from=${SUN}&to=${addDays(SUN, 1)}`);
    expect(JSON.stringify(cal.body)).not.toMatch(/ضيف|9665/);
    expect((await request(app).get("/api/public/bookings")).status).toBe(404);
  });
});

describe("admin views", () => {
  it("lists, filters and searches bookings; shows details and allowed actions", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    await book([full.id], SUN, 1, guest(1));
    await book([full.id], THU, 1, { ...guest(2), name: "محمد العتيبي" });
    const all = await agent.get("/api/admin/bookings");
    expect(all.body.total).toBe(2);
    expect((await agent.get("/api/admin/bookings?q=العتيبي")).body.total).toBe(1);
    expect((await agent.get("/api/admin/bookings?q=500000002")).body.total).toBe(1);
    expect((await agent.get(`/api/admin/bookings?from=${THU}&to=${THU}`)).body.total).toBe(1);
    expect((await agent.get("/api/admin/bookings?status=CONFIRMED")).body.total).toBe(0);
    const detail = await agent.get(`/api/admin/bookings/${all.body.items[0].id}`);
    expect(detail.body.allowedTransitions).toEqual(["AWAITING_PAYMENT", "CONFIRMED", "REJECTED", "CANCELLED"]);
    expect(detail.body.guest.phone).toMatch(/^9665/);
  });

  it("summarises the dashboard and the calendar", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    const majlis = await makePart("majlis", ["majlis"]);
    const r1 = await book([full.id], THU);
    await book([majlis.id], SUN, 1, guest(2));
    const b1 = await db.booking.findUniqueOrThrow({ where: { reference: r1.body.reference } });
    await agent.post(`/api/admin/bookings/${b1.id}/payments`).send({ method: "BANK_TRANSFER", amount: 1200 }).expect(201);
    await agent.post(`/api/admin/bookings/${b1.id}/status`).send({ status: "CONFIRMED" }).expect(200);
    await db.amenity.update({ where: { slug: "volleyball" }, data: { available: false } });

    const d = (await agent.get("/api/admin/dashboard")).body;
    expect(d).toMatchObject({ upcoming: 2, confirmedUpcoming: 1, newRequests: 1, revenueAll: "1200", unreadNotifications: 2 });
    expect(d.unavailableAmenities.map((a: { name: string }) => a.name)).toEqual(["ملعب كرة الطائرة"]);

    const cal = (await agent.get(`/api/admin/calendar?from=${SUN}&to=${addDays(SUN, 7)}`)).body;
    expect(cal.bookings.map((b: { kind: string; status: string }) => [b.kind, b.status])).toEqual([
      ["PART", "NEW"],
      ["FULL", "CONFIRMED"],
    ]);
  });

  it("finds guests and their booking history", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    await book([full.id], SUN, 1, guest(1));
    await book([full.id], THU, 1, guest(1)); // same phone → same guest
    const list = (await agent.get("/api/admin/guests?q=0500000001")).body;
    expect(list).toHaveLength(1);
    expect(list[0].bookingCount).toBe(2);
    const g = (await agent.get(`/api/admin/guests/${list[0].id}`)).body;
    expect(g.bookings).toHaveLength(2);
  });
});

describe("contract", () => {
  it("fills the approved template with the booking, the 500 SAR deposit and the cancellation policy", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    const r = await book([full.id], SUN, 2, { ...guest(), name: "سارة القحطاني" });
    const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
    const c = (await agent.get(`/api/admin/bookings/${b.id}/contract`)).body;
    const text = JSON.stringify(c.blocks);
    expect(c.reference).toBe(r.body.reference);
    expect(text).toContain("سارة القحطاني");
    expect(text).toContain("966500000001");
    expect(text).toContain(r.body.reference);
    expect(text).toContain("500 ريال");
    expect(text).toContain("1,900 ريال");
    expect(text).toContain("2,400 ريال"); // total payable incl. deposit
    expect(text).toContain("2:00 ظهرًا");
    expect(text).toContain("72 ساعة");
    expect(text).toContain("«موافق»");
    expect(text).not.toMatch(/\{\{/);
    expect(text).not.toContain("اسم المالك");
    expect(c.blocks[0]).toEqual({ type: "title", text: "عقد حجز استراحة الجود" });
    expect(c.warnings).toContain("بيانات الحساب البنكي غير مكتملة في الإعدادات.");
  });

  it("uses the owner's edits and current settings, and flags unknown placeholders", async () => {
    const { agent } = await signedIn(app);
    await agent.put("/api/admin/settings/bank").send({ bankName: "بنك", accountHolder: "الاستراحة", iban: IBAN, instructions: null }).expect(200);
    await agent.put("/api/admin/settings/contract").send({ template: "# عقد\n## بند\nالمستأجر {{guestName}} {{oops}}\n{{bankDetails}}" }).expect(200);
    const full = await fullResource();
    const r = await book([full.id], SUN);
    const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
    const c = (await agent.get(`/api/admin/bookings/${b.id}/contract`)).body;
    expect(c.blocks.map((x: { type: string }) => x.type)).toEqual(["title", "heading", "paragraph", "table"]);
    expect(JSON.stringify(c.blocks)).toContain(IBAN);
    expect(c.warnings).toEqual(["متغيرات غير معروفة في نص العقد: {{oops}}"]);
  });
});

describe("owner WhatsApp notification", () => {
  it("sends the new-request alert to the owner's WhatsApp once enabled", async () => {
    await db.siteSetting.create({ data: { key: "notifications", value: { ownerWhatsapp: "966555000111", whatsappEnabled: true } } });
    const full = await fullResource();
    const r = await book([full.id], SUN);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("966555000111");
    expect(sent[0]!.params[0]).toBe(r.body.reference);
    expect((await db.notification.findFirstOrThrow()).whatsappStatus).toBe("SENT");
  });

  it("keeps the booking and the in-panel notification when WhatsApp fails", async () => {
    await db.siteSetting.create({ data: { key: "notifications", value: { ownerWhatsapp: "966555000111", whatsappEnabled: true } } });
    const failing = makeApp({ whatsapp: async () => { throw new Error("WhatsApp API 401: invalid token"); } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const full = await fullResource();
    const r = await request(failing).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: SUN, nights: 1, ...guest() });
    expect(r.status).toBe(201);
    const n = await db.notification.findFirstOrThrow();
    expect(n.whatsappStatus).toBe("FAILED");
    expect(n.whatsappError).toContain("401");
  });

  it("does not send when the owner has not enabled it", async () => {
    await db.siteSetting.create({ data: { key: "notifications", value: { ownerWhatsapp: "966555000111", whatsappEnabled: false } } });
    const full = await fullResource();
    await book([full.id], SUN);
    expect(sent).toHaveLength(0);
    expect((await db.notification.findFirstOrThrow()).whatsappStatus).toBe("NOT_CONFIGURED");
  });

  it("lists notifications with an unread count and marks them read", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    await book([full.id], SUN);
    const list = (await agent.get("/api/admin/notifications")).body;
    expect(list.unread).toBe(1);
    await agent.post(`/api/admin/notifications/${list.items[0].id}/read`).send({}).expect(204);
    expect((await agent.get("/api/admin/notifications")).body.unread).toBe(0);
  });
});

describe("dates are stored as calendar days", () => {
  it("stores start/end as DATE values regardless of server timezone", async () => {
    const full = await fullResource();
    const r = await book([full.id], SUN);
    const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
    expect(b.startDate).toEqual(fromIsoDate(SUN));
    expect(b.endDate).toEqual(fromIsoDate(addDays(SUN, 1)));
  });
});

describe("payment deadline", () => {
  it("defaults to the owner's 15 hours, in the contract too", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    const r = await book([full.id], SUN);
    const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
    const c = (await agent.get(`/api/admin/bookings/${b.id}/contract`)).body;
    expect(JSON.stringify(c.blocks)).toContain("خلال 15 ساعة من طلب الدفع");
  });
});
