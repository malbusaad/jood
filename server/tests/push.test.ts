import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, todayInRiyadh } from "../src/lib/dates.js";
import type { PushSend } from "../src/services/push.js";

/** Fake push service: records deliveries; endpoints containing "gone" behave like a removed device. */
const delivered: { endpoint: string; payload: { title: string; body: string; url: string }; subject: string; publicKey: string }[] = [];
const send: PushSend = async (sub, payload, vapid) => {
  if (sub.endpoint.includes("gone")) throw Object.assign(new Error("Received unexpected response code"), { statusCode: 410 });
  if (sub.endpoint.includes("down")) throw Object.assign(new Error("push service unavailable"), { statusCode: 503 });
  delivered.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), subject: vapid.subject, publicKey: vapid.publicKey });
};
const app = makeApp({ push: { send, subject: "https://jood.example" }, bookingLimit: 1000 });

const device = (name: string) => ({ endpoint: `https://web.push.apple.com/${name}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) }, label: "آيفون" });

function nextSunday() {
  let d = addDays(todayInRiyadh(), 7);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
}

beforeEach(async () => {
  await resetDb();
  delivered.length = 0;
});
afterAll(() => db.$disconnect());

describe("phone notifications (Web Push)", () => {
  it("creates its keys once, stores the private key encrypted, and gives the public key to the panel", async () => {
    const { agent } = await signedIn(app);
    const a = (await agent.get("/api/admin/push")).body;
    const b = (await agent.get("/api/admin/push")).body;
    expect(a.enabled).toBe(true);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(b.publicKey).toBe(a.publicKey);
    const stored = JSON.stringify((await db.siteSetting.findUniqueOrThrow({ where: { key: "vapidKeys" } })).value);
    expect(stored).toContain("privateKeyEnc");
    expect(stored).not.toMatch(/"privateKey"/);
    // Never part of the settings API.
    expect(JSON.stringify((await agent.get("/api/admin/settings")).body)).not.toContain("privateKeyEnc");
  });

  it("registers a device and notifies it of a new booking request, linking to the booking", async () => {
    const { agent } = await signedIn(app);
    expect((await agent.post("/api/admin/push/subscriptions").send(device("iphone"))).status).toBe(201);
    expect((await agent.post("/api/admin/push/subscriptions").send(device("iphone"))).status).toBe(201); // same device, no duplicate
    expect(await db.pushSubscription.count()).toBe(1);

    const full = await fullResource();
    const r = await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: nextSunday(), nights: 1, name: "سارة محمد القحطاني", nationalId: "1023456789", phone: "0500000001", acceptTerms: true });
    expect(r.status).toBe(201);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.payload.title).toBe(`طلب حجز جديد ${r.body.reference}`);
    expect(delivered[0]!.payload.body).toContain("سارة محمد القحطاني");
    const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
    expect(delivered[0]!.payload.url).toBe(`/admin/bookings/${b.id}`);
    expect(delivered[0]!.subject).toBe("https://jood.example");
    expect((await db.pushSubscription.findFirstOrThrow()).lastSuccessAt).not.toBeNull();
  });

  it("forgets removed devices, keeps the reason for other failures, and never breaks the booking", async () => {
    const { agent } = await signedIn(app);
    await agent.post("/api/admin/push/subscriptions").send(device("gone-1")).expect(201);
    await agent.post("/api/admin/push/subscriptions").send(device("down-1")).expect(201);
    await agent.post("/api/admin/push/subscriptions").send(device("ok-1")).expect(201);
    const t = (await agent.post("/api/admin/push/test").send({})).body;
    expect(t).toEqual({ sent: 1, failed: 2 });
    const left = await db.pushSubscription.findMany({ orderBy: { endpoint: "asc" } });
    expect(left.map((s) => s.endpoint.split("/").pop())).toEqual(["down-1", "ok-1"]);
    expect(left[0]!.lastError).toContain("503");
    expect(delivered[0]!.payload.title).toContain("إشعار تجريبي");
  });

  it("each admin sees and removes only their own devices; login required", async () => {
    const owner = (await signedIn(app)).agent;
    const staff = (await signedIn(app, "STAFF")).agent;
    await owner.post("/api/admin/push/subscriptions").send(device("owner-phone")).expect(201);
    await staff.post("/api/admin/push/subscriptions").send(device("staff-phone")).expect(201);
    const mine = (await staff.get("/api/admin/push")).body.devices;
    expect(mine).toHaveLength(1);
    expect(mine[0].service).toBe("web.push.apple.com");
    const ownersId = (await owner.get("/api/admin/push")).body.devices[0].id;
    expect((await staff.delete(`/api/admin/push/subscriptions/${ownersId}`)).status).toBe(404);
    expect((await request(app).get("/api/admin/push")).status).toBe(401);
    expect((await owner.post("/api/admin/push/subscriptions").send({ ...device("x"), endpoint: "http://insecure/x" })).status).toBe(400);
  });

  it("serves the home-screen app definition and a fresh service worker header", async () => {
    const m = await request(app).get("/admin.webmanifest");
    expect(m.headers["content-type"]).toContain("application/manifest+json");
    expect(JSON.parse(m.text)).toMatchObject({ start_url: "/admin", display: "standalone", lang: "ar" });
  });
});
