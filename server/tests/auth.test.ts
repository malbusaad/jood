import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PASSWORD, createUser, db, makeApp, resetDb, signedIn } from "./helpers.js";
import { hashPassword, verifyPassword } from "../src/lib/password.js";

const app = makeApp();

beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

describe("password hashing", () => {
  it("stores a salted scrypt hash, never the password", async () => {
    const h1 = await hashPassword("some-password-123");
    const h2 = await hashPassword("some-password-123");
    expect(h1).toMatch(/^scrypt\$/);
    expect(h1).not.toContain("some-password-123");
    expect(h1).not.toBe(h2);
    expect(await verifyPassword("some-password-123", h1)).toBe(true);
    expect(await verifyPassword("wrong-password-123", h1)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("admin login", () => {
  it("signs in with correct credentials and sets a strict httpOnly cookie", async () => {
    const user = await createUser("OWNER");
    const res = await request(app).post("/api/auth/login").send({ email: "OWNER@jood.test", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, role: "OWNER" });
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/jood_admin=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    // Only the token hash is stored server-side.
    const token = /jood_admin=([^;]+)/.exec(cookie)![1]!;
    const session = await db.session.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(token);
    expect(session.tokenHash).toHaveLength(64);
  });

  it("marks the cookie Secure in production mode", async () => {
    await createUser("OWNER");
    const res = await request(makeApp({ secureCookies: true }))
      .post("/api/auth/login")
      .send({ email: "owner@jood.test", password: PASSWORD });
    expect(String(res.headers["set-cookie"])).toMatch(/Secure/);
  });

  it("rejects a wrong password and an unknown email with the same message", async () => {
    await createUser("OWNER");
    const wrong = await request(app).post("/api/auth/login").send({ email: "owner@jood.test", password: "nope-nope-nope" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "who@jood.test", password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
    expect(await db.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(2);
  });

  it("rejects disabled accounts", async () => {
    const user = await createUser("OWNER");
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    const res = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("rate-limits repeated failed logins", async () => {
    const limited = makeApp({ loginLimit: 3 });
    const attempt = () => request(limited).post("/api/auth/login").send({ email: "x@jood.test", password: "wrong-password" });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });

  it("logs out and invalidates the session server-side", async () => {
    const { agent } = await signedIn(app);
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    expect((await agent.post("/api/auth/logout").send({})).status).toBe(204);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    expect(await db.session.count()).toBe(0);
  });

  it("ends sessions of a user who gets disabled", async () => {
    const { agent, user } = await signedIn(app, "STAFF");
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("rejects expired sessions", async () => {
    const { agent } = await signedIn(app);
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await agent.get("/api/admin/settings")).status).toBe(401);
  });

  it("changes the password and signs out other sessions", async () => {
    const { agent, user } = await signedIn(app);
    const other = request.agent(app);
    await other.post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    const res = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: "a-brand-new-password" });
    expect(res.status).toBe(204);
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    expect((await other.get("/api/auth/me")).status).toBe(401);
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password: "a-brand-new-password" });
    expect(login.status).toBe(200);
  });
});

describe("admin API protection", () => {
  it.each(["/api/admin/settings", "/api/admin/amenities", "/api/admin/resources", "/api/admin/pricing", "/api/admin/notifications", "/api/admin/audit", "/api/admin/users"])(
    "%s requires login",
    async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    },
  );

  it("ignores forged session cookies", async () => {
    const res = await request(app).get("/api/admin/settings").set("Cookie", "jood_admin=forged-token-forged-token-forged");
    expect(res.status).toBe(401);
  });

  it("forbids staff from owner-only areas", async () => {
    const { agent } = await signedIn(app, "STAFF");
    for (const path of ["/api/admin/resources", "/api/admin/pricing", "/api/admin/users", "/api/admin/audit"]) {
      expect((await agent.get(path)).status).toBe(403);
    }
    expect((await agent.put("/api/admin/settings/stay").send({ checkIn: "15:00", checkOut: "03:00" })).status).toBe(403);
    expect((await agent.get("/api/admin/amenities")).status).toBe(200);
  });

  it("rejects cross-site and form-encoded mutations (CSRF)", async () => {
    const { agent } = await signedIn(app);
    const evil = await agent
      .put("/api/admin/settings/stay")
      .set("Origin", "https://evil.example")
      .send({ checkIn: "15:00", checkOut: "03:00" });
    expect(evil.status).toBe(403);
    const form = await agent
      .put("/api/admin/settings/stay")
      .type("form")
      .send("checkIn=15:00&checkOut=03:00");
    expect(form.status).toBe(415);
  });

  it("does not leak internal errors", async () => {
    const { agent } = await signedIn(app);
    const res = await agent.post("/api/admin/amenities").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.ts/);
  });
});

describe("account management", () => {
  it("lets the owner add a staff account and never returns password hashes", async () => {
    const { agent } = await signedIn(app);
    const res = await agent.post("/api/admin/users").send({ email: "staff@jood.test", name: "موظف", password: "staff-password-1", role: "STAFF" });
    expect(res.status).toBe(201);
    expect(res.body.passwordHash).toBeUndefined();
    const list = await agent.get("/api/admin/users");
    expect(JSON.stringify(list.body)).not.toMatch(/scrypt/);
  });

  it("prevents the owner from disabling themselves", async () => {
    const { agent, user } = await signedIn(app);
    const res = await agent.patch(`/api/admin/users/${user.id}`).send({ active: false });
    expect(res.status).toBe(400);
  });
});
