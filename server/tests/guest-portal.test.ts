import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, todayInRiyadh } from "../src/lib/dates.js";
import { checkoutInstant } from "../src/services/guestAccess.js";

const app = makeApp({ publicBaseUrl: "https://jood.example" });

function nextSunday(): string {
  let d = addDays(todayInRiyadh(), 7);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
}

beforeEach(async () => {
  await resetDb();
  await db.siteSetting.create({
    data: {
      key: "guestPortal",
      value: { entryCode: "4321", wifiName: "Jood", wifiPassword: "wifi-pass-1", departureInstructions: ["أطفئ الأنوار"], linkGraceHours: 12, showCodesFrom: "CHECKIN_DAY" },
    },
  });
});
afterAll(() => db.$disconnect());

/** A confirmed booking on `start`, plus a signed-in owner agent. */
async function confirmedBooking(start = nextSunday(), phone = "0500000001") {
  const { agent } = await signedIn(app);
  const full = await fullResource();
  const r = await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: start, nights: 1, name: "سارة محمد القحطاني", nationalId: "1023456789", phone, acceptTerms: true });
  expect(r.status).toBe(201);
  const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
  await agent.post(`/api/admin/bookings/${b.id}/payments`).send({ method: "BANK_TRANSFER", amount: Number(b.totalAmount) }).expect(201);
  await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CONFIRMED" }).expect(200);
  return { agent, booking: b };
}

function tokenOf(url: string) {
  return url.split("/g/")[1]!;
}

describe("issuing the guest link", () => {
  it("only after confirmation", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    const r = await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: nextSunday(), nights: 1, name: "ضيف رقم تسعة", nationalId: "2023456789", phone: "0500000009", acceptTerms: true });
    const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
    const res = await agent.post(`/api/admin/bookings/${b.id}/guest-link`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/بعد تأكيد الحجز/);
  });

  it("returns a long random link once and stores only its hash", async () => {
    const { agent, booking } = await confirmedBooking();
    const res = await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({});
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^https:\/\/jood\.example\/g\/[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(res.body.url);
    const row = await db.guestAccessToken.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toHaveLength(64);
    // Not derivable from the booking reference.
    expect(token).not.toContain(booking.reference);
    // The admin detail shows link status, never the token.
    const detail = await agent.get(`/api/admin/bookings/${booking.id}`);
    expect(detail.body.accessTokens).toHaveLength(1);
    expect(JSON.stringify(detail.body)).not.toContain(token);
    expect(JSON.stringify(detail.body)).not.toContain(row.tokenHash);
    // Audit log never stores the token.
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "guest_link.issue" } });
    expect(JSON.stringify(log.details)).not.toContain(token);
  });

  it("expires after check-out plus the grace hours", async () => {
    const start = nextSunday();
    const { agent, booking } = await confirmedBooking(start);
    const res = await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({});
    const expected = checkoutInstant(booking.endDate, "04:00").getTime() + 12 * 3600_000;
    expect(new Date(res.body.expiresAt).getTime()).toBe(expected);
    expect(new Date(expected).toISOString()).toBe(`${addDays(start, 1)}T13:00:00.000Z`); // 04:00 Riyadh + 12h
  });
});

describe("guest portal", () => {
  it("shows the guest their booking, rules and contacts — and hides codes before check-in day", async () => {
    const { agent, booking } = await confirmedBooking();
    const { body: link } = await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({});
    const res = await request(app).get(`/api/guest/${tokenOf(link.url)}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({
      guestName: "سارة محمد القحطاني",
      reference: booking.reference,
      checkIn: "14:00",
      checkOut: "04:00",
      items: ["الاستراحة كاملة"],
      departureInstructions: ["أطفئ الأنوار"],
      codes: null,
    });
    expect(res.body.houseRules).toHaveLength(12);
    expect(res.body.codesAvailableOn).toBe(res.body.startDate);
    expect(JSON.stringify(res.body)).not.toMatch(/4321|wifi-pass-1|9665|totalAmount/);
    expect((await db.guestAccessToken.findFirstOrThrow()).lastUsedAt).not.toBeNull();
  });

  it("shows entry code and Wi-Fi on the check-in day", async () => {
    const { agent, booking } = await confirmedBooking(todayInRiyadh());
    const { body: link } = await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({});
    const res = await request(app).get(`/api/guest/${tokenOf(link.url)}`);
    expect(res.body.codes).toEqual({ entryCode: "4321", wifiName: "Jood", wifiPassword: "wifi-pass-1" });
  });

  it("shows codes right away when the owner chooses so", async () => {
    const { agent, booking } = await confirmedBooking();
    await db.siteSetting.update({
      where: { key: "guestPortal" },
      data: { value: { entryCode: "4321", wifiName: "Jood", wifiPassword: "wifi-pass-1", departureInstructions: [], linkGraceHours: 12, showCodesFrom: "IMMEDIATELY" } },
    });
    const { body: link } = await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({});
    expect((await request(app).get(`/api/guest/${tokenOf(link.url)}`)).body.codes.entryCode).toBe("4321");
  });

  it("rejects unknown or malformed tokens", async () => {
    expect((await request(app).get(`/api/guest/${"x".repeat(43)}`)).status).toBe(404);
    expect((await request(app).get("/api/guest/short")).status).toBe(404);
    expect((await request(app).get("/api/guest/' OR 1=1 --")).status).toBe(404);
  });

  it("each link opens only its own booking", async () => {
    const a = await confirmedBooking(nextSunday(), "0500000001");
    const linkA = (await a.agent.post(`/api/admin/bookings/${a.booking.id}/guest-link`).send({})).body;
    const full = await fullResource();
    const r = await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: addDays(nextSunday(), 2), nights: 1, name: "ضيف آخر ثاني", nationalId: "2023456788", phone: "0500000002", acceptTerms: true });
    const res = await request(app).get(`/api/guest/${tokenOf(linkA.url)}`);
    expect(res.body.reference).toBe(a.booking.reference);
    expect(JSON.stringify(res.body)).not.toContain(r.body.reference);
    expect(JSON.stringify(res.body)).not.toContain("ضيف آخر ثاني");
  });
});

describe("revoking and re-issuing", () => {
  it("revokes the link", async () => {
    const { agent, booking } = await confirmedBooking();
    const { body: link } = await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({});
    await agent.delete(`/api/admin/bookings/${booking.id}/guest-link`).expect(204);
    const res = await request(app).get(`/api/guest/${tokenOf(link.url)}`);
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/انتهت صلاحية/);
  });

  it("re-issuing stops the old link and the new one works", async () => {
    const { agent, booking } = await confirmedBooking();
    const first = (await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({})).body;
    const second = (await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({})).body;
    expect(first.url).not.toBe(second.url);
    expect((await request(app).get(`/api/guest/${tokenOf(first.url)}`)).status).toBe(410);
    expect((await request(app).get(`/api/guest/${tokenOf(second.url)}`)).status).toBe(200);
  });

  it("stops working after it expires", async () => {
    const { agent, booking } = await confirmedBooking();
    const { body: link } = await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({});
    await db.guestAccessToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get(`/api/guest/${tokenOf(link.url)}`)).status).toBe(410);
  });

  it("stops working when the booking is cancelled", async () => {
    const { agent, booking } = await confirmedBooking();
    const { body: link } = await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({});
    await agent.post(`/api/admin/bookings/${booking.id}/status`).send({ status: "CANCELLED", reason: "طلب الضيف" }).expect(200);
    expect((await request(app).get(`/api/guest/${tokenOf(link.url)}`)).status).toBe(410);
    expect((await db.guestAccessToken.findFirstOrThrow()).revokedAt).not.toBeNull();
  });

  it("requires admin login to issue or revoke", async () => {
    const { booking } = await confirmedBooking();
    expect((await request(app).post(`/api/admin/bookings/${booking.id}/guest-link`).send({})).status).toBe(401);
    expect((await request(app).delete(`/api/admin/bookings/${booking.id}/guest-link`)).status).toBe(401);
  });
});
