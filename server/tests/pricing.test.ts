import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, fullResource, makeApp, resetDb, signedIn, amenityBySlug } from "./helpers.js";
import { quote } from "../src/services/pricing.js";
import { addDays, todayInRiyadh } from "../src/lib/dates.js";

const app = makeApp();

beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

// 2026-11-01 is a Sunday.
const SUN = "2026-11-01";
const WED = "2026-11-04";
const THU = "2026-11-05";
const SAT = "2026-11-07";

describe("pricing engine", () => {
  it("prices the full rest house by weekday: 950 Sun–Wed, 1,200 Thu–Sat", async () => {
    const full = await fullResource();
    const q = await quote(db, [full.id], [SUN, WED, THU, SAT]);
    expect(q.lines.map((l) => l.price)).toEqual(["950.00", "950.00", "1200.00", "1200.00"]);
    expect(q.total).toBe("4300.00");
    expect(q.missing).toEqual([]);
  });

  it("applies seasonal prices over weekday prices, and special prices over both", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    await agent
      .post("/api/admin/pricing")
      .send({ resourceId: full.id, kind: "SEASON", label: "موسم الشتاء", startDate: "2026-11-01", endDate: "2026-11-30", price: 1100 })
      .expect(201);
    await agent
      .post("/api/admin/pricing")
      .send({ resourceId: full.id, kind: "SPECIAL", label: "تاريخ خاص", startDate: THU, endDate: THU, price: 1500 })
      .expect(201);
    const q = await quote(db, [full.id], [SUN, THU, "2026-12-03"]);
    expect(q.lines.map((l) => [l.date, l.price, l.ruleKind])).toEqual([
      [SUN, "1100.00", "SEASON"],
      [THU, "1500.00", "SPECIAL"],
      ["2026-12-03", "1200.00", "WEEKDAY"], // Thursday after the season
    ]);
  });

  it("supports seasonal prices limited to certain weekdays", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    await agent
      .post("/api/admin/pricing")
      .send({ resourceId: full.id, kind: "SEASON", startDate: "2026-11-01", endDate: "2026-11-30", daysOfWeek: [4, 5, 6], price: 1400 })
      .expect(201);
    const q = await quote(db, [full.id], [WED, THU]);
    expect(q.lines.map((l) => l.price)).toEqual(["950.00", "1400.00"]);
  });

  it("never invents a price for a part the owner has not priced", async () => {
    const { agent } = await signedIn(app);
    const majlis = await amenityBySlug("majlis");
    const part = await agent.post("/api/admin/resources").send({ slug: "majlis", name: "المجلس", amenityIds: [majlis.id] });
    const q = await quote(db, [part.body.id], [SUN, THU]);
    expect(q.lines).toEqual([]);
    expect(q.total).toBe("0.00");
    expect(q.missing.map((m) => m.date)).toEqual([SUN, THU]);
  });

  it("uses only the price the owner sets for a part", async () => {
    const { agent } = await signedIn(app);
    const majlis = await amenityBySlug("majlis");
    const part = await agent.post("/api/admin/resources").send({ slug: "majlis", name: "المجلس", amenityIds: [majlis.id] });
    await agent.post("/api/admin/pricing").send({ resourceId: part.body.id, kind: "WEEKDAY", daysOfWeek: [], price: 400 }).expect(201);
    const q = await quote(db, [part.body.id], [SUN, SAT]);
    expect(q.lines.map((l) => l.price)).toEqual(["400.00", "400.00"]);
    expect(q.missing).toEqual([]);
  });

  it("ignores disabled rules", async () => {
    const full = await fullResource();
    await db.pricingRule.updateMany({ where: { resourceId: full.id }, data: { active: false } });
    const q = await quote(db, [full.id], [SUN]);
    expect(q.missing).toHaveLength(1);
  });

  it("validates rule input", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    const bad = [
      { resourceId: full.id, kind: "SEASON", price: 100 }, // no dates
      { resourceId: full.id, kind: "SPECIAL", startDate: THU, endDate: SUN, price: 100 }, // end before start
      { resourceId: full.id, kind: "WEEKDAY", daysOfWeek: [7], price: 100 },
      { resourceId: full.id, kind: "WEEKDAY", price: -5 },
    ];
    for (const body of bad) expect((await agent.post("/api/admin/pricing").send(body)).status).toBe(400);
  });

  it("edits the weekday prices from the admin API", async () => {
    const { agent } = await signedIn(app);
    const rule = await db.pricingRule.findFirstOrThrow({ where: { label: "الأحد إلى الأربعاء" } });
    await agent
      .put(`/api/admin/pricing/${rule.id}`)
      .send({ resourceId: rule.resourceId, kind: "WEEKDAY", label: rule.label, daysOfWeek: [0, 1, 2, 3], price: 1000 })
      .expect(200);
    const site = await request(app).get("/api/public/site");
    expect(site.body.weekdayPrices).toEqual([1000, 1000, 1000, 1000, 1200, 1200, 1200]);
  });
});

describe("public calendar", () => {
  it("returns the daily price and availability of the full rest house", async () => {
    const today = todayInRiyadh();
    const res = await request(app).get(`/api/public/calendar?from=${addDays(today, -1)}&to=${addDays(today, 7)}`);
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(8);
    expect(res.body.days[0].available).toBe(false); // yesterday
    for (const d of res.body.days.slice(1)) {
      expect([950, 1200]).toContain(d.price);
      expect(d.available).toBe(true);
    }
  });

  it("validates the range", async () => {
    expect((await request(app).get("/api/public/calendar?from=2026-11-10&to=2026-11-01")).status).toBe(400);
    expect((await request(app).get("/api/public/calendar?from=2026-01-01&to=2026-12-31")).status).toBe(400);
    expect((await request(app).get("/api/public/calendar?from=2026-02-30&to=2026-03-02")).status).toBe(400);
  });
});
