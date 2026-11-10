import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, makeApp, resetDb, signedIn } from "./helpers.js";

const app = makeApp();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body")]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpg")]);

beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

describe("news ticker", () => {
  it("ships the owner's five phrases by default, in order", async () => {
    const site = (await request(app).get("/api/public/site")).body;
    expect(site.ticker.enabled).toBe(true);
    expect(site.ticker.items.map((i: { text: string }) => i.text)).toEqual([
      "أهلًا وسهلًا بكم في استراحة الجود.",
      "استمتعوا بأوقاتكم في أجواء من الخصوصية والراحة.",
      "اكتشفوا مرافقنا وخيارات الحجز.",
      "عروض ومميزات خاصة لضيوف استراحة الجود.",
      "احجزوا موعدكم الآن.",
    ]);
    expect(site.ticker).toMatchObject({ secondsPerItem: 8, direction: "rtl", mobile: "animate" });
  });

  it("lets the owner add, edit, disable, reorder and remove phrases, speed and direction — without code changes", async () => {
    const { agent } = await signedIn(app);
    const value = {
      enabled: true,
      items: [
        { id: "new", text: "عرض نهاية الأسبوع", active: true },
        { id: "welcome", text: "حياكم الله في استراحة الجود", active: false },
      ],
      secondsPerItem: 5,
      direction: "ltr",
      mobile: "static",
    };
    expect((await agent.put("/api/admin/settings/ticker").send(value)).status).toBe(200);
    const site = (await request(app).get("/api/public/site")).body;
    expect(site.ticker).toEqual(value);
  });

  it("rejects bad values and staff edits", async () => {
    const { agent } = await signedIn(app);
    const base = { enabled: true, items: [{ id: "a", text: "x", active: true }], secondsPerItem: 8, direction: "rtl", mobile: "animate" };
    expect((await agent.put("/api/admin/settings/ticker").send({ ...base, secondsPerItem: 1 })).status).toBe(400);
    expect((await agent.put("/api/admin/settings/ticker").send({ ...base, direction: "up" })).status).toBe(400);
    expect((await agent.put("/api/admin/settings/ticker").send({ ...base, items: [base.items[0], base.items[0]] })).status).toBe(400);
    expect((await agent.put("/api/admin/settings/ticker").send({ ...base, items: [{ id: "a", text: "  ", active: true }] })).status).toBe(400);
    const staff = (await signedIn(app, "STAFF")).agent;
    expect((await staff.put("/api/admin/settings/ticker").send(base)).status).toBe(403);
  });
});

describe("Ministry of Tourism licence", () => {
  it("is hidden with no invented number or logo until the owner provides them", async () => {
    const site = (await request(app).get("/api/public/site")).body;
    expect(site.tourismLicense).toEqual({ enabled: false, licenseNumber: null, text: "مرخصة من وزارة السياحة", logoUrl: null });
    expect((await request(app).get("/api/public/license-logo")).status).toBe(404);
  });

  it("cannot be shown without a licence number", async () => {
    const { agent } = await signedIn(app);
    const res = await agent.put("/api/admin/settings/tourismLicense").send({ enabled: true, licenseNumber: null, text: "مرخصة من وزارة السياحة" });
    expect(res.status).toBe(400);
    const ok = await agent.put("/api/admin/settings/tourismLicense").send({ enabled: true, licenseNumber: "12345678", text: "مرخصة من وزارة السياحة" });
    expect(ok.status).toBe(200);
    expect((await request(app).get("/api/public/site")).body.tourismLicense).toMatchObject({ enabled: true, licenseNumber: "12345678" });
  });

  it("stores an uploaded logo in the database and serves it with its real type", async () => {
    const { agent } = await signedIn(app);
    const up = await agent.put("/api/admin/license-logo").send({ data: PNG.toString("base64") });
    expect(up.status).toBe(200);
    expect(up.body.url).toMatch(/^\/api\/public\/license-logo\?v=[0-9a-f]{16}$/);
    const site = (await request(app).get("/api/public/site")).body;
    expect(site.tourismLicense.logoUrl).toBe(up.body.url);
    const img = await request(app).get(up.body.url);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(img.body).equals(PNG)).toBe(true);
    // The image is not shipped inside the settings JSON.
    expect(JSON.stringify((await agent.get("/api/admin/settings")).body)).not.toContain(PNG.toString("base64"));
    // Replacing it changes the URL (cache-busting); a data: URL prefix is accepted.
    const up2 = await agent.put("/api/admin/license-logo").send({ data: `data:image/jpeg;base64,${JPG.toString("base64")}` });
    expect(up2.body.url).not.toBe(up.body.url);
    expect((await request(app).get("/api/public/license-logo")).headers["content-type"]).toBe("image/jpeg");
    await agent.delete("/api/admin/license-logo").expect(204);
    expect((await request(app).get("/api/public/site")).body.tourismLicense.logoUrl).toBeNull();
  });

  it("refuses SVG, non-images, oversize files and non-owners", async () => {
    const { agent } = await signedIn(app);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    expect((await agent.put("/api/admin/license-logo").send({ data: svg })).status).toBe(400);
    expect((await agent.put("/api/admin/license-logo").send({ data: "not base64 !!" })).status).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]).toString("base64");
    expect([413]).toContain((await agent.put("/api/admin/license-logo").send({ data: big })).status);
    const staff = (await signedIn(app, "STAFF")).agent;
    expect((await staff.put("/api/admin/license-logo").send({ data: PNG.toString("base64") })).status).toBe(403);
    expect((await request(app).put("/api/admin/license-logo").send({ data: PNG.toString("base64") })).status).toBe(401);
    expect((await request(app).get("/api/public/license-logo")).status).toBe(404);
  });
});

describe("site logo and icon", () => {
  it("lets the owner upload the logo and the icon; the site uses them", async () => {
    const { agent } = await signedIn(app);
    expect((await request(app).get("/api/public/site")).body.media).toMatchObject({ logoUrl: null, iconUrl: null });
    const logo = await agent.put("/api/admin/site-images/logo").send({ data: PNG.toString("base64") });
    expect(logo.status).toBe(200);
    const icon = await agent.put("/api/admin/site-images/icon").send({ data: JPG.toString("base64") });
    const media = (await request(app).get("/api/public/site")).body.media;
    expect(media.logoUrl).toBe(logo.body.url);
    expect(media.iconUrl).toBe(icon.body.url);
    expect(media.logoUrl).toMatch(/^\/api\/public\/site-images\/logo\?v=[0-9a-f]{16}$/);
    const img = await request(app).get("/api/public/site-images/icon");
    expect(img.headers["content-type"]).toBe("image/jpeg");
    // Each image is separate from the ministry logo.
    expect((await request(app).get("/api/public/license-logo")).status).toBe(404);
    await agent.delete("/api/admin/site-images/logo").expect(204);
    expect((await request(app).get("/api/public/site")).body.media.logoUrl).toBeNull();
  });

  it("refuses SVG, unknown slots and non-owners", async () => {
    const { agent } = await signedIn(app);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64");
    expect((await agent.put("/api/admin/site-images/icon").send({ data: svg })).status).toBe(400);
    expect((await agent.put("/api/admin/site-images/other").send({ data: PNG.toString("base64") })).status).toBe(404);
    expect((await request(app).get("/api/public/site-images/other")).status).toBe(404);
    const staff = (await signedIn(app, "STAFF")).agent;
    expect((await staff.put("/api/admin/site-images/logo").send({ data: PNG.toString("base64") })).status).toBe(403);
  });
});
