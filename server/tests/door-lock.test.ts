import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, todayInRiyadh } from "../src/lib/dates.js";
import { makeSecretBox } from "../src/lib/secretBox.js";
import { generateDoorCode } from "../src/services/doorCodes.js";
import { TTLockError, ttlockClient, ttlockConfigFromEnv, type LockClient } from "../src/services/ttlock.js";

/** In-memory stand-in for the lock, recording what the app asked TTLock to do. */
function fakeLock(opts: { failAdd?: boolean; failDelete?: boolean } = {}) {
  const codes = new Map<string, { code: string; startsAt: Date; endsAt: Date }>();
  let next = 1000;
  const lock: LockClient & { codes: typeof codes; calls: string[] } = {
    lockId: "123456",
    codes,
    calls: [],
    async addPasscode(p) {
      lock.calls.push("add");
      if (opts.failAdd) throw new TTLockError("TTLock -3002: gateway offline", -3002);
      const id = String(next++);
      codes.set(id, p);
      return { externalId: id };
    },
    async deletePasscode(id) {
      lock.calls.push("delete");
      if (opts.failDelete) throw new TTLockError("TTLock -3002: gateway offline", -3002);
      codes.delete(id);
    },
    async listLocks() {
      return [{ lockId: "123456", name: "باب الاستراحة", hasGateway: true, battery: 87 }];
    },
  };
  return lock;
}

const box = makeSecretBox("test-secret-test-secret-test-secret-1", "door-codes");

function nextSunday(): string {
  let d = addDays(todayInRiyadh(), 7);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
}

beforeEach(async () => {
  await resetDb();
  await db.siteSetting.create({ data: { key: "doorLock", value: { enabled: true } } });
});
afterAll(() => db.$disconnect());

async function setup(lock: LockClient | null, start = nextSunday()) {
  const app = makeApp({ lock, secretBox: box, publicBaseUrl: "https://jood.example" });
  const { agent } = await signedIn(app);
  const full = await fullResource();
  const r = await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: start, nights: 1, name: "سارة", phone: "0500000001", acceptTerms: true });
  const booking = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
  await agent.post(`/api/admin/bookings/${booking.id}/payments`).send({ method: "BANK_TRANSFER", amount: Number(booking.totalAmount) }).expect(201);
  return { app, agent, booking, start };
}

const confirm = (agent: ReturnType<typeof request.agent>, id: string) => agent.post(`/api/admin/bookings/${id}/status`).send({ status: "CONFIRMED" });

describe("door code on confirmation", () => {
  it("creates a code on the lock valid from check-in to check-out, stored encrypted", async () => {
    const lock = fakeLock();
    const { agent, booking, start } = await setup(lock);
    await confirm(agent, booking.id).expect(200);

    expect(lock.codes.size).toBe(1);
    const [externalId, sent] = [...lock.codes.entries()][0]!;
    expect(sent!.code).toMatch(/^\d{6}$/);
    expect(sent!.startsAt.toISOString()).toBe(`${start}T11:00:00.000Z`); // 14:00 Riyadh
    expect(sent!.endsAt.toISOString()).toBe(`${addDays(start, 1)}T01:00:00.000Z`); // 04:00 Riyadh next day

    const row = await db.doorCode.findFirstOrThrow();
    expect(row).toMatchObject({ status: "ACTIVE", externalId, lockId: "123456" });
    expect(row.codeEncrypted).not.toContain(sent!.code);
    expect(box.open(row.codeEncrypted!)).toBe(sent!.code);

    // The owner sees the code on the booking page.
    const detail = await agent.get(`/api/admin/bookings/${booking.id}`);
    expect(detail.body.doorCode).toBe(sent!.code);
    expect(detail.body.doorCodes[0]).toMatchObject({ status: "ACTIVE" });
    // Audit never contains the code.
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(sent!.code);
  });

  it("does nothing when the owner has not enabled the lock", async () => {
    await db.siteSetting.update({ where: { key: "doorLock" }, data: { value: { enabled: false } } });
    const lock = fakeLock();
    const { agent, booking } = await setup(lock);
    await confirm(agent, booking.id).expect(200);
    expect(lock.calls).toEqual([]);
  });

  it("keeps the booking confirmed and alerts the owner when TTLock fails", async () => {
    const lock = fakeLock({ failAdd: true });
    const { agent, booking } = await setup(lock);
    await confirm(agent, booking.id).expect(200);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CONFIRMED");
    const row = await db.doorCode.findFirstOrThrow();
    expect(row.status).toBe("FAILED");
    expect(row.error).toContain("gateway offline");
    const n = await db.notification.findFirstOrThrow({ where: { type: "SYSTEM" } });
    expect(n.title).toContain("تعذر إنشاء رقم الباب");
  });
});

describe("door code lifecycle", () => {
  it("deletes the code from the lock when the booking is cancelled", async () => {
    const lock = fakeLock();
    const { agent, booking } = await setup(lock);
    await confirm(agent, booking.id).expect(200);
    await agent.post(`/api/admin/bookings/${booking.id}/status`).send({ status: "CANCELLED" }).expect(200);
    expect(lock.codes.size).toBe(0);
    expect((await db.doorCode.findFirstOrThrow()).status).toBe("DELETED");
  });

  it("alerts the owner if the code cannot be deleted on cancellation", async () => {
    const lock = fakeLock({ failDelete: true });
    const { agent, booking } = await setup(lock);
    await confirm(agent, booking.id).expect(200);
    await agent.post(`/api/admin/bookings/${booking.id}/status`).send({ status: "CANCELLED" }).expect(200);
    expect((await db.doorCode.findFirstOrThrow()).status).toBe("ACTIVE");
    expect((await db.notification.findFirstOrThrow({ where: { type: "SYSTEM" } })).title).toContain("تعذر حذف رقم الباب");
  });

  it("re-issuing replaces the old code on the lock; manual delete removes it", async () => {
    const lock = fakeLock();
    const { agent, booking } = await setup(lock);
    await confirm(agent, booking.id).expect(200);
    const first = [...lock.codes.values()][0]!.code;
    const res = await agent.post(`/api/admin/bookings/${booking.id}/door-code`).send({});
    expect(res.status).toBe(201);
    expect(lock.codes.size).toBe(1);
    expect(res.body.code).toBe([...lock.codes.values()][0]!.code);
    expect(lock.calls).toEqual(["add", "delete", "add"]);
    expect(await db.doorCode.count({ where: { status: "ACTIVE" } })).toBe(1);
    expect(first).toMatch(/^\d{6}$/);

    await agent.delete(`/api/admin/bookings/${booking.id}/door-code`).expect(204);
    expect(lock.codes.size).toBe(0);
  });

  it("refuses door codes before confirmation, without a configured lock, and for staff", async () => {
    const lock = fakeLock();
    const { app, agent, booking } = await setup(lock);
    expect((await agent.post(`/api/admin/bookings/${booking.id}/door-code`).send({})).status).toBe(409);
    await confirm(agent, booking.id).expect(200);

    const noLock = makeApp({ lock: null, secretBox: box });
    const owner2 = request.agent(noLock);
    await db.user.create({ data: { email: "o2@jood.test", name: "o2", role: "OWNER", passwordHash: (await db.user.findFirstOrThrow()).passwordHash } });
    await owner2.post("/api/auth/login").send({ email: "o2@jood.test", password: "correct-horse-battery" }).expect(200);
    expect((await owner2.post(`/api/admin/bookings/${booking.id}/door-code`).send({})).status).toBe(409);

    const { agent: staff } = await signedIn(app, "STAFF");
    expect((await staff.post(`/api/admin/bookings/${booking.id}/door-code`).send({})).status).toBe(403);
    expect((await staff.get(`/api/admin/bookings/${booking.id}`)).body.doorCode).toBeNull();
  });
});

describe("guest portal shows the booking's door code", () => {
  it("uses the TTLock code instead of the fixed entry code, on the check-in day", async () => {
    await db.siteSetting.create({
      data: { key: "guestPortal", value: { entryCode: "0000", wifiName: "ALJOOD", wifiPassword: null, departureInstructions: [], linkGraceHours: 12, showCodesFrom: "CHECKIN_DAY" } },
    });
    const lock = fakeLock();
    const { app, agent, booking } = await setup(lock, todayInRiyadh());
    await confirm(agent, booking.id).expect(200);
    const code = [...lock.codes.values()][0]!.code;
    const { body: link } = await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({});
    const portal = await request(app).get(`/api/guest/${link.url.split("/g/")[1]}`);
    expect(portal.body.codes).toMatchObject({ entryCode: code, wifiName: "ALJOOD" });
  });

  it("hides the door code before the check-in day", async () => {
    const lock = fakeLock();
    const { app, agent, booking } = await setup(lock);
    await confirm(agent, booking.id).expect(200);
    const { body: link } = await agent.post(`/api/admin/bookings/${booking.id}/guest-link`).send({});
    const portal = await request(app).get(`/api/guest/${link.url.split("/g/")[1]}`);
    expect(portal.body.codes).toBeNull();
    expect(JSON.stringify(portal.body)).not.toContain([...lock.codes.values()][0]!.code);
  });
});

describe("lock connection test", () => {
  it("reports configuration and lists locks (owner only)", async () => {
    const app = makeApp({ lock: fakeLock(), secretBox: box });
    const { agent } = await signedIn(app);
    const res = await agent.get("/api/admin/lock/status");
    expect(res.body).toMatchObject({ configured: true, enabled: true, lockId: "123456", locks: [{ name: "باب الاستراحة", hasGateway: true, battery: 87 }] });
  });

  it("reports when TTLock is not configured", async () => {
    const { agent } = await signedIn(makeApp({ lock: null }));
    expect((await agent.get("/api/admin/lock/status")).body).toMatchObject({ configured: false, locks: [] });
  });
});

describe("TTLock API client", () => {
  const env = { TTLOCK_CLIENT_ID: "cid", TTLOCK_CLIENT_SECRET: "csecret", TTLOCK_USERNAME: "owner@mail", TTLOCK_PASSWORD: "lock-pass", TTLOCK_LOCK_ID: "123456" };

  it("is not configured without all credentials", () => {
    expect(ttlockConfigFromEnv({})).toBeNull();
    expect(ttlockConfigFromEnv({ ...env, TTLOCK_LOCK_ID: "" })).toBeNull();
    expect(ttlockConfigFromEnv(env)!.apiBase).toBe("https://euapi.ttlock.com");
  });

  it("logs in with the MD5 password, adds a passcode through the gateway, re-logs in on an expired token", async () => {
    const requests: { url: string; body: URLSearchParams }[] = [];
    let addCalls = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init.body));
      requests.push({ url, body });
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.endsWith("/oauth2/token")) return json({ access_token: `tok${requests.length}`, expires_in: 7776000 });
      if (url.endsWith("/v3/keyboardPwd/add")) return json(++addCalls === 1 ? { errcode: 10004, errmsg: "invalid token" } : { keyboardPwdId: 98765 });
      if (url.endsWith("/v3/keyboardPwd/delete")) return json({ errcode: 0, errmsg: "none error message" });
      return json({ errcode: -1 });
    });
    const client = ttlockClient(ttlockConfigFromEnv(env)!, fetchMock as unknown as typeof fetch);
    const startsAt = new Date("2026-12-10T11:00:00Z");
    const endsAt = new Date("2026-12-11T01:00:00Z");
    const r = await client.addPasscode({ code: "482915", name: "JD-000001 سارة", startsAt, endsAt });
    expect(r.externalId).toBe("98765");

    const login = requests[0]!;
    expect(login.url).toBe("https://euapi.ttlock.com/oauth2/token");
    expect(login.body.get("password")).toBe(createHash("md5").update("lock-pass").digest("hex"));
    // The token endpoint takes snake_case client credentials (TTLock OAuth2 docs); the /v3 endpoints take clientId.
    expect(Object.fromEntries(login.body)).toMatchObject({ client_id: "cid", client_secret: "csecret", username: "owner@mail" });
    expect(login.body.has("clientId")).toBe(false);

    const add = requests.find((x) => x.url.endsWith("/v3/keyboardPwd/add") && x.body.get("accessToken") !== "tok1")!;
    expect(Object.fromEntries(add.body)).toMatchObject({
      clientId: "cid",
      lockId: "123456",
      keyboardPwd: "482915",
      startDate: String(startsAt.getTime()),
      endDate: String(endsAt.getTime()),
      addType: "2",
    });
    expect(requests.filter((x) => x.url.endsWith("/oauth2/token"))).toHaveLength(2); // re-login after 10004

    await client.deletePasscode("98765");
    expect(Object.fromEntries(requests.at(-1)!.body)).toMatchObject({ keyboardPwdId: "98765", deleteType: "2", lockId: "123456" });
  });

  it("surfaces TTLock errors", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.endsWith("/oauth2/token") ? { access_token: "t", expires_in: 100 } : { errcode: -3002, errmsg: "The gateway is offline" }), { status: 200 }),
    );
    const client = ttlockClient(ttlockConfigFromEnv(env)!, fetchMock as unknown as typeof fetch);
    await expect(client.addPasscode({ code: "482915", name: "x", startsAt: new Date(), endsAt: new Date() })).rejects.toThrow("TTLock -3002: The gateway is offline");
  });
});

describe("helpers", () => {
  it("generates 6-digit codes without obvious patterns", () => {
    for (let i = 0; i < 500; i++) {
      const c = generateDoorCode();
      expect(c).toMatch(/^[1-9]\d{5}$/);
      expect(c).not.toMatch(/(\d)\1\1/);
      expect("0123456789".includes(c)).toBe(false);
    }
  });

  it("detects tampered encrypted codes", () => {
    const sealed = box.seal("482915");
    expect(box.open(sealed)).toBe("482915");
    expect(box.open(sealed.slice(0, -2) + "AA")).toBeNull();
    expect(makeSecretBox("another-secret-another-secret-12345", "door-codes").open(sealed)).toBeNull();
  });
});
