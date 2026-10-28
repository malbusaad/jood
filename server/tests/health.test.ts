import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";

const db = new PrismaClient();
const app = createApp({ db });

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/health", () => {
  it("reports a connected database", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", database: "connected" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const broken = new PrismaClient({
      datasourceUrl: "postgresql://nobody:nothing@127.0.0.1:1/none_test",
    });
    const res = await request(createApp({ db: broken })).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "error" });
    await broken.$disconnect();
  });

  it("sets security headers", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});

describe("unknown API routes", () => {
  it("returns 404 JSON", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});
