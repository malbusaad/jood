import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { amenityBySlug, db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { blockedResources, lockKeysByResource, resourcesCompatible } from "../src/services/conflicts.js";
import { addDays, fromIsoDate } from "../src/lib/dates.js";

const app = makeApp();
const DAY = "2026-12-10";

beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

async function makePart(slug: string, amenitySlugs: string[]) {
  const amenities = await Promise.all(amenitySlugs.map(amenityBySlug));
  return db.bookingResource.create({
    data: { slug, name: slug, kind: "PART", amenities: { create: amenities.map((a) => ({ amenityId: a.id })) } },
  });
}

/** Inserts an active booking and its locks the way the booking service will (phase 4). */
async function holdBooking(client: PrismaClient | Prisma.TransactionClient, resourceIds: string[], dates: string[], phone: string) {
  const keys = [...(await lockKeysByResource(client, resourceIds)).values()].flat();
  const guest = await client.guest.upsert({ where: { phone }, create: { name: "ضيف", phone }, update: {} });
  const booking = await client.booking.create({
    data: {
      reference: `T-${phone}`,
      guestId: guest.id,
      startDate: fromIsoDate(dates[0]!),
      endDate: fromIsoDate(addDays(dates.at(-1)!, 1)),
      totalAmount: 0,
      priceBreakdown: [],
    },
  });
  await client.bookingLock.createMany({
    data: keys.flatMap((key) => dates.map((d) => ({ key, date: fromIsoDate(d), bookingId: booking.id }))),
  });
  return booking;
}

describe("conflict rules", () => {
  it("full rest house conflicts with every part", async () => {
    const full = await fullResource();
    const majlis = await makePart("majlis", ["majlis"]);
    const tent = await makePart("tent", ["tent"]);
    expect(await resourcesCompatible(db, [full.id, majlis.id])).toBe(false);
    expect(await resourcesCompatible(db, [full.id, tent.id])).toBe(false);
  });

  it("independent parts can be booked together", async () => {
    const majlis = await makePart("majlis", ["majlis"]);
    const tent = await makePart("tent", ["tent"]);
    expect(await resourcesCompatible(db, [majlis.id, tent.id])).toBe(true);
  });

  it("parts sharing an amenity conflict (inseparable amenities)", async () => {
    const majlisWithKitchen = await makePart("majlis-kitchen", ["majlis", "kitchen"]);
    const tentWithKitchen = await makePart("tent-kitchen", ["tent", "kitchen"]);
    expect(await resourcesCompatible(db, [majlisWithKitchen.id, tentWithKitchen.id])).toBe(false);
  });

  it("explicit conflicts set by the owner apply between otherwise independent parts", async () => {
    const { agent } = await signedIn(app);
    const majlis = await makePart("majlis", ["majlis"]);
    const tent = await makePart("tent", ["tent"]);
    await agent.post("/api/admin/resources/conflicts").send({ resourceAId: tent.id, resourceBId: majlis.id, reason: "مدخل مشترك" }).expect(201);
    expect(await resourcesCompatible(db, [majlis.id, tent.id])).toBe(false);
    // Duplicate in either order is rejected; self-conflict is rejected.
    expect((await agent.post("/api/admin/resources/conflicts").send({ resourceAId: majlis.id, resourceBId: tent.id })).status).toBe(409);
    expect((await agent.post("/api/admin/resources/conflicts").send({ resourceAId: tent.id, resourceBId: tent.id })).status).toBe(400);
  });
});

describe("availability", () => {
  it("a full booking blocks every part on that day; a part booking blocks the full rest house", async () => {
    const full = await fullResource();
    const majlis = await makePart("majlis", ["majlis"]);
    const tent = await makePart("tent", ["tent"]);

    await holdBooking(db, [majlis.id], [DAY], "966500000001");
    const blocked = await blockedResources(db, [full.id, majlis.id, tent.id], [DAY]);
    expect(blocked.get(full.id)?.has(DAY)).toBe(true);
    expect(blocked.get(majlis.id)?.has(DAY)).toBe(true);
    expect(blocked.has(tent.id)).toBe(false); // independent part still available
  });
});

describe("database-level double-booking prevention", () => {
  it("rejects booking the same part twice on the same day", async () => {
    const majlis = await makePart("majlis", ["majlis"]);
    await holdBooking(db, [majlis.id], [DAY], "966500000001");
    await expect(holdBooking(db, [majlis.id], [DAY], "966500000002")).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects a full booking over an existing part booking (and vice versa)", async () => {
    const full = await fullResource();
    const tent = await makePart("tent", ["tent"]);
    await holdBooking(db, [tent.id], [DAY], "966500000001");
    await expect(holdBooking(db, [full.id], [DAY], "966500000002")).rejects.toMatchObject({ code: "P2002" });

    await holdBooking(db, [full.id], ["2026-12-11"], "966500000003");
    await expect(holdBooking(db, [tent.id], ["2026-12-11"], "966500000004")).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows independent parts on the same day", async () => {
    const majlis = await makePart("majlis", ["majlis"]);
    const tent = await makePart("tent", ["tent"]);
    await holdBooking(db, [majlis.id], [DAY], "966500000001");
    await expect(holdBooking(db, [tent.id], [DAY], "966500000002")).resolves.toBeDefined();
  });

  it("lets exactly one of many simultaneous requests win", async () => {
    const full = await fullResource();
    const clients = Array.from({ length: 6 }, () => new PrismaClient());
    try {
      const results = await Promise.allSettled(
        clients.map((c, i) => c.$transaction((tx) => holdBooking(tx, [full.id], [DAY, "2026-12-11"], `96650000010${i}`))),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.booking.count()).toBe(1); // losers rolled back completely
      expect(await db.bookingLock.count({ where: { date: fromIsoDate(DAY) } })).toBe(11);
    } finally {
      await Promise.all(clients.map((c) => c.$disconnect()));
    }
  });

  it("releases locks when a booking is cancelled, so the day becomes bookable again", async () => {
    const full = await fullResource();
    const first = await holdBooking(db, [full.id], [DAY], "966500000001");
    await db.booking.update({ where: { id: first.id }, data: { status: "CANCELLED" } });
    expect(await db.bookingLock.count()).toBe(0);
    await expect(holdBooking(db, [full.id], [DAY], "966500000002")).resolves.toBeDefined();
  });

  it.each(["REJECTED", "EXPIRED"] as const)("releases locks when a booking becomes %s", async (status) => {
    const full = await fullResource();
    const b = await holdBooking(db, [full.id], [DAY], "966500000001");
    await db.booking.update({ where: { id: b.id }, data: { status } });
    expect(await db.bookingLock.count()).toBe(0);
  });

  it("keeps locks while a booking moves between active states", async () => {
    const full = await fullResource();
    const b = await holdBooking(db, [full.id], [DAY], "966500000001");
    for (const status of ["AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED"] as const) {
      await db.booking.update({ where: { id: b.id }, data: { status } });
      expect(await db.bookingLock.count()).toBe(11);
    }
  });

  it("refuses locks for an inactive booking", async () => {
    const full = await fullResource();
    const b = await holdBooking(db, [full.id], [DAY], "966500000001");
    await db.booking.update({ where: { id: b.id }, data: { status: "CANCELLED" } });
    await expect(db.bookingLock.create({ data: { key: "amenity:x", date: fromIsoDate(DAY), bookingId: b.id } })).rejects.toThrow(/not active/);
  });
});

describe("database constraints", () => {
  it("allows only one full rest house resource", async () => {
    await expect(db.bookingResource.create({ data: { slug: "full-2", name: "x", kind: "FULL" } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects bookings whose end is not after the start", async () => {
    const guest = await db.guest.create({ data: { name: "ضيف", phone: "966500000009" } });
    await expect(
      db.booking.create({
        data: { reference: "T-1", guestId: guest.id, startDate: fromIsoDate(DAY), endDate: fromIsoDate(DAY), totalAmount: 0, priceBreakdown: [] },
      }),
    ).rejects.toThrow(/bookings_dates_valid/);
  });

  it("rejects negative prices and non-positive payments", async () => {
    const full = await fullResource();
    await expect(db.pricingRule.create({ data: { resourceId: full.id, kind: "WEEKDAY", price: -1 } })).rejects.toThrow(/pricing_rules_price_non_negative/);
    const guest = await db.guest.create({ data: { name: "ضيف", phone: "966500000008" } });
    const b = await db.booking.create({
      data: { reference: "T-2", guestId: guest.id, startDate: fromIsoDate(DAY), endDate: fromIsoDate("2026-12-11"), totalAmount: 950, priceBreakdown: [] },
    });
    await expect(db.payment.create({ data: { bookingId: b.id, method: "BANK_TRANSFER", amount: 0 } })).rejects.toThrow(/payments_amount_positive/);
  });

  it("rejects seasonal/special rules without dates at the database level too", async () => {
    const full = await fullResource();
    await expect(db.pricingRule.create({ data: { resourceId: full.id, kind: "SEASON", price: 100 } })).rejects.toThrow(/pricing_rules_dated_kinds/);
  });

  it("refuses to delete a guest who has bookings", async () => {
    const full = await fullResource();
    const b = await holdBooking(db, [full.id], [DAY], "966500000001");
    await expect(db.guest.delete({ where: { id: b.guestId } })).rejects.toThrow();
  });
});

describe("resources admin", () => {
  it("creates, edits and deletes a part; the full rest house cannot be deleted or re-scoped", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    const majlis = await amenityBySlug("majlis");
    const kitchen = await amenityBySlug("kitchen");

    const created = await agent.post("/api/admin/resources").send({ slug: "majlis", name: "المجلس", amenityIds: [majlis.id] });
    expect(created.status).toBe(201);
    expect(created.body.kind).toBe("PART");

    const edited = await agent.patch(`/api/admin/resources/${created.body.id}`).send({ amenityIds: [majlis.id, kitchen.id], active: false });
    expect(edited.status).toBe(200);
    expect(edited.body.amenities).toHaveLength(2);
    expect(edited.body.active).toBe(false);

    expect((await agent.delete(`/api/admin/resources/${full.id}`)).status).toBe(400);
    expect((await agent.patch(`/api/admin/resources/${full.id}`).send({ amenityIds: [majlis.id] })).status).toBe(400);
    expect((await agent.delete(`/api/admin/resources/${created.body.id}`)).status).toBe(204);
  });

  it("refuses to delete a part that has bookings", async () => {
    const { agent } = await signedIn(app);
    const tent = await makePart("tent", ["tent"]);
    await holdBooking(db, [tent.id], [DAY], "966500000001");
    await db.bookingItem.create({ data: { bookingId: (await db.booking.findFirstOrThrow()).id, resourceId: tent.id, date: fromIsoDate(DAY), price: 0 } });
    expect((await agent.delete(`/api/admin/resources/${tent.id}`)).status).toBe(409);
  });
});
