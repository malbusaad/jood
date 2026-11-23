import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, makeApp, resetDb, signedIn } from "./helpers.js";

const dist = fs.mkdtempSync(path.join(os.tmpdir(), "jood-dist-"));
fs.writeFileSync(
  path.join(dist, "index.html"),
  `<!doctype html><html><head><meta name="description" content="استراحة الجود — العزيزية، الخبر." /><link rel="apple-touch-icon" href="/icon-192.png" /><title>استراحة الجود | Jood Rest</title></head><body></body></html>`,
);
const app = makeApp({ clientDistDir: dist, publicBaseUrl: "https://jood.example" });
// 1×1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  fs.rmSync(dist, { recursive: true, force: true });
  await db.$disconnect();
});

describe("link previews (WhatsApp etc.)", () => {
  it("uses the default icon until one is uploaded, then the owner's icon — on every page, guest links included", async () => {
    const before = (await request(app).get("/g/abc")).text;
    expect(before).toContain('<meta property="og:image" content="https://jood.example/icon-512.png" />');
    expect(before).toContain('<meta property="og:title" content="استراحة الجود | Jood Rest" />');

    const { agent } = await signedIn(app);
    const up = await agent.put("/api/admin/site-images/icon").send({ data: PNG });
    expect([200, 201]).toContain(up.status);
    // A fresh app (the page is cached for a minute).
    const fresh = makeApp({ clientDistDir: dist, publicBaseUrl: "https://jood.example" });
    const html = (await request(fresh).get("/g/abc")).text;
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/jood\.example\/api\/public\/site-images\/icon\?v=[0-9a-f]{16}" \/>/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/api\/public\/site-images\/icon\?v=/);
    expect((await request(fresh).get("/")).text).toContain("og:image");
  });
});
