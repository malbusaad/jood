import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, makeApp, resetDb, signedIn } from "./helpers.js";

const app = makeApp();
const IBAN = "SA0380000000608010167519";

beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

describe("public site API", () => {
  it("serves approved content, amenities and weekday prices", async () => {
    const res = await request(app).get("/api/public/site");
    expect(res.status).toBe(200);
    expect(res.body.general.name).toBe("استراحة الجود");
    expect(res.body.stay).toEqual({ checkIn: "14:00", checkOut: "04:00" });
    expect(res.body.houseRules).toHaveLength(12);
    expect(res.body.amenities).toHaveLength(11);
    expect(JSON.stringify(res.body.amenities)).not.toMatch(/مسبح/);
    // Sunday..Saturday
    expect(res.body.weekdayPrices).toEqual([950, 950, 950, 950, 1200, 1200, 1200]);
    expect(res.body.gathern.url).toBeNull();
    expect(res.body.contact).toEqual({ phone: null, whatsapp: null, email: null, mapUrl: null });
  });

  it("never exposes private settings, even after the owner fills them in", async () => {
    const { agent } = await signedIn(app);
    await agent.put("/api/admin/settings/bank").send({ bankName: "بنك", accountHolder: "المالك", iban: IBAN, instructions: null }).expect(200);
    await agent
      .put("/api/admin/settings/guestPortal")
      .send({ entryCode: "4321", wifiName: "Jood", wifiPassword: "wifi-secret", departureInstructions: [], linkGraceHours: 12, showCodesFrom: "CHECKIN_DAY" })
      .expect(200);
    const res = await request(app).get("/api/public/site");
    const body = JSON.stringify(res.body);
    for (const secret of [IBAN, "4321", "wifi-secret", "bank", "guestPortal", "notifications", "contract"]) {
      expect(body).not.toContain(secret);
    }
  });

  it("hides amenities the owner hides", async () => {
    await db.amenity.update({ where: { slug: "volleyball" }, data: { visible: false } });
    const res = await request(app).get("/api/public/site");
    expect(res.body.amenities.map((a: { slug: string }) => a.slug)).not.toContain("volleyball");
  });
});

describe("admin settings", () => {
  it("validates and normalises values", async () => {
    const { agent } = await signedIn(app);
    expect((await agent.put("/api/admin/settings/stay").send({ checkIn: "25:00", checkOut: "04:00" })).status).toBe(400);
    expect((await agent.put("/api/admin/settings/bank").send({ bankName: null, accountHolder: null, iban: "123", instructions: null })).status).toBe(400);
    expect((await agent.put("/api/admin/settings/gathern").send({ url: "http://insecure.example", notice: "x" })).status).toBe(400);
    expect((await agent.put("/api/admin/settings/unknown").send({})).status).toBe(404);

    const contact = await agent.put("/api/admin/settings/contact").send({ phone: "0501234567", whatsapp: "+966 50 123 4567", email: null, mapUrl: null });
    expect(contact.status).toBe(200);
    expect(contact.body.value).toMatchObject({ phone: "966501234567", whatsapp: "966501234567" });

    const bank = await agent.put("/api/admin/settings/bank").send({ bankName: "بنك", accountHolder: "المالك", iban: "sa03 8000 0000 6080 1016 7519", instructions: null });
    expect(bank.body.value.iban).toBe(IBAN);
  });

  it("changes check-in/out times from settings (not hard-coded)", async () => {
    const { agent } = await signedIn(app);
    await agent.put("/api/admin/settings/stay").send({ checkIn: "15:00", checkOut: "03:00" }).expect(200);
    const res = await request(app).get("/api/public/site");
    expect(res.body.stay).toEqual({ checkIn: "15:00", checkOut: "03:00" });
  });

  it("shows staff operational settings but not bank details or guest codes", async () => {
    const { agent } = await signedIn(app, "STAFF");
    const res = await agent.get("/api/admin/settings");
    expect(res.status).toBe(200);
    expect(res.body.stay).toBeDefined();
    for (const key of ["bank", "guestPortal", "notifications", "contract"]) expect(res.body[key]).toBeUndefined();
  });

  it("audits changes without storing secrets", async () => {
    const { agent } = await signedIn(app);
    await agent.put("/api/admin/settings/bank").send({ bankName: "بنك", accountHolder: "المالك", iban: IBAN, instructions: null }).expect(200);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "settings.update" } });
    expect(log.entityId).toBe("bank");
    expect(JSON.stringify(log.details)).not.toContain(IBAN);
    expect(log.userId).not.toBeNull();
  });
});

describe("amenities admin", () => {
  it("creates an amenity and attaches it to the full rest house automatically", async () => {
    const { agent } = await signedIn(app);
    const res = await agent.post("/api/admin/amenities").send({ slug: "bbq", name: "منطقة الشواء", note: "متوفرة", icon: "outdoor" });
    expect(res.status).toBe(201);
    const full = await db.bookingResource.findFirstOrThrow({ where: { kind: "FULL" }, include: { amenities: true } });
    expect(full.amenities.map((a) => a.amenityId)).toContain(res.body.id);
  });

  it("toggles availability and visibility, and edits capacity", async () => {
    const { agent } = await signedIn(app);
    const tent = await db.amenity.findUniqueOrThrow({ where: { slug: "tent" } });
    const res = await agent.patch(`/api/admin/amenities/${tent.id}`).send({ available: false, capacityText: "16 شخصًا", capacityMax: 16 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, capacityText: "16 شخصًا" });
  });

  it("refuses to delete an amenity that belongs to a bookable part", async () => {
    const { agent } = await signedIn(app);
    const majlis = await db.amenity.findUniqueOrThrow({ where: { slug: "majlis" } });
    await agent.post("/api/admin/resources").send({ slug: "majlis", name: "المجلس", amenityIds: [majlis.id] }).expect(201);
    expect((await agent.delete(`/api/admin/amenities/${majlis.id}`)).status).toBe(409);
    const wifi = await db.amenity.findUniqueOrThrow({ where: { slug: "wifi" } });
    expect((await agent.delete(`/api/admin/amenities/${wifi.id}`)).status).toBe(204);
  });

  it("rejects duplicate slugs", async () => {
    const { agent } = await signedIn(app);
    expect((await agent.post("/api/admin/amenities").send({ slug: "tent", name: "خيمة" })).status).toBe(409);
  });
});

describe("editing keeps what was not sent", () => {
  it("a quick on/off toggle of an amenity never resets its other fields", async () => {
    const app = makeApp();
    const { agent } = await signedIn(app);
    const a = (await agent.post("/api/admin/amenities").send({ slug: "pool-x", name: "مرفق تجربة", capacityText: "10 أشخاص", note: "مكيف", icon: "majlis", category: "SERVICE", sortOrder: 7, description: "وصف" })).body;
    await agent.patch(`/api/admin/amenities/${a.id}`).send({ available: false }).expect(200);
    await agent.patch(`/api/admin/amenities/${a.id}`).send({ visible: false }).expect(200);
    const after = await db.amenity.findUniqueOrThrow({ where: { id: a.id } });
    expect(after).toMatchObject({ capacityText: "10 أشخاص", note: "مكيف", icon: "majlis", category: "SERVICE", sortOrder: 7, description: "وصف", available: false, visible: false });
  });

  it("the same for booking parts", async () => {
    const app = makeApp();
    const { agent } = await signedIn(app);
    const majlis = await db.amenity.findUniqueOrThrow({ where: { slug: "majlis" } });
    const p = (await agent.post("/api/admin/resources").send({ slug: "part-x", name: "جزء تجربة", description: "وصف الجزء", sortOrder: 9, amenityIds: [majlis.id] })).body;
    await agent.patch(`/api/admin/resources/${p.id}`).send({ active: false }).expect(200);
    expect(await db.bookingResource.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ description: "وصف الجزء", sortOrder: 9, active: false });
  });
});

describe("amenity icons", () => {
  it("accepts the new icons and the site draws every one of them", async () => {
    const fs = await import("node:fs");
    const { iconNames } = await import("../src/routes/admin/amenities.js");
    const client = fs.readFileSync(new URL("../../client/src/components/AmenityIcon.tsx", import.meta.url), "utf8");
    for (const name of iconNames) expect(client, `icon «${name}» missing in the client`).toMatch(new RegExp(`\\b${name}: `));
    const app = makeApp();
    const { agent } = await signedIn(app);
    expect((await agent.post("/api/admin/amenities").send({ slug: "parking-x", name: "مواقف", icon: "parking", category: "SERVICE" })).status).toBe(201);
    expect((await agent.post("/api/admin/amenities").send({ slug: "nope-x", name: "x", icon: "rocket" })).status).toBe(400);
  });
});
