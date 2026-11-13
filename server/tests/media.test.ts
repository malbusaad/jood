import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, makeApp, resetDb, signedIn } from "./helpers.js";
import { videoEmbed } from "../src/settings/registry.js";

const app = makeApp({ allowedOrigins: ["http://jood.test"] });
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500, 1)]);

beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

describe("photos", () => {
  it("the owner uploads photos; they appear in the gallery in order, with descriptions and a main photo", async () => {
    const { agent } = await signedIn(app);
    const a = (await agent.post("/api/admin/media").send({ data: `data:image/jpeg;base64,${JPG.toString("base64")}`, alt: "الجلسة الخارجية" })).body;
    const b = (await agent.post("/api/admin/media").send({ data: PNG.toString("base64") })).body;
    expect(a.url).toMatch(/^\/api\/media\/photo-[0-9a-f-]+\.jpg$/);
    let site = (await request(app).get("/api/public/site")).body.media;
    expect(site.gallery.map((g: { url: string }) => g.url)).toEqual([a.url, b.url]);
    expect(site.gallery[0].alt).toBe("الجلسة الخارجية");
    expect(site.heroImageUrl).toBeNull();

    await agent.patch(`/api/admin/media/${b.id}`).send({ isHero: true, alt: "المجلس" }).expect(200);
    await agent.patch(`/api/admin/media/${a.id}`).send({ isHero: true }).expect(200);
    await agent.put("/api/admin/media/order").send({ ids: [b.id, a.id] }).expect(200);
    site = (await request(app).get("/api/public/site")).body.media;
    expect(site.heroImageUrl).toBe(a.url); // only one main photo
    expect(site.gallery.map((g: { url: string }) => g.url)).toEqual([b.url, a.url]);

    const img = await request(app).get(a.url);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect(img.headers["cache-control"]).toContain("immutable");
    expect(Buffer.from(img.body).equals(JPG)).toBe(true);

    await agent.delete(`/api/admin/media/${b.id}`).expect(204);
    expect((await request(app).get(b.url)).status).toBe(404);
    expect((await agent.get("/api/admin/media")).body.items).toHaveLength(1);
  });

  it("refuses non-images, SVG, oversize files and non-owners; private files are never served", async () => {
    const { agent } = await signedIn(app);
    expect((await agent.post("/api/admin/media").send({ data: Buffer.from("<svg/>").toString("base64") })).status).toBe(400);
    expect((await agent.post("/api/admin/media").send({ data: Buffer.concat([JPG, Buffer.alloc(1_550_000)]).toString("base64") })).status).toBe(413);
    const staff = (await signedIn(app, "STAFF")).agent;
    expect((await staff.post("/api/admin/media").send({ data: JPG.toString("base64") })).status).toBe(403);
    await db.mediaAsset.create({ data: { kind: "PAYMENT_PROOF", storageKey: "proof-1.jpg", mimeType: "image/jpeg", sizeBytes: JPG.length, isPrivate: true, data: JPG } });
    expect((await request(app).get("/api/media/proof-1.jpg")).status).toBe(404);
  });
});

describe("intro video", () => {
  it("understands YouTube, Vimeo and .mp4 links", () => {
    expect(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ kind: "iframe", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0" });
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ?si=abc")!.src).toContain("/embed/dQw4w9WgXcQ");
    expect(videoEmbed("https://youtube.com/shorts/dQw4w9WgXcQ")!.src).toContain("/embed/dQw4w9WgXcQ");
    expect(videoEmbed("https://vimeo.com/123456789")).toEqual({ kind: "iframe", src: "https://player.vimeo.com/video/123456789" });
    expect(videoEmbed("https://example.com/jood.mp4")).toEqual({ kind: "file", src: "https://example.com/jood.mp4" });
    expect(videoEmbed("https://example.com/page")).toBeNull();
  });

  it("the owner sets the link and the site shows the player; the page allows only those players", async () => {
    const { agent } = await signedIn(app);
    expect((await agent.put("/api/admin/settings/introVideo").send({ url: "https://example.com/page" })).status).toBe(400);
    await agent.put("/api/admin/settings/introVideo").send({ url: "https://youtu.be/dQw4w9WgXcQ" }).expect(200);
    const site = (await request(app).get("/api/public/site")).body;
    expect(site.media.video).toEqual({ kind: "iframe", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0" });
    const csp = (await request(app).get("/api/health")).headers["content-security-policy"];
    expect(csp).toContain("frame-src https://www.youtube-nocookie.com https://player.vimeo.com");
  });
});

describe("intro video file (no YouTube)", () => {
  // A tiny but real-looking MP4 header ("ftyp" box) followed by data.
  const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(4), Buffer.from("isommp42"), Buffer.alloc(5000, 9)]);
  const send = (agent: ReturnType<typeof request.agent>, body: Buffer, type = "video/mp4") =>
    agent.put("/api/admin/media/video").set("Content-Type", type).set("Origin", "http://127.0.0.1").send(body);

  it("uploads the file, shows it on the site instead of the link, and plays with byte ranges (iPhone)", async () => {
    const { agent } = await signedIn(app);
    await agent.put("/api/admin/settings/introVideo").send({ url: "https://youtu.be/dQw4w9WgXcQ" }).expect(200);
    const up = await agent.put("/api/admin/media/video").set("Origin", "http://jood.test").set("Content-Type", "video/mp4").send(MP4);
    expect(up.status).toBe(200);
    expect(up.body.warning).toBeNull();
    const site = (await request(app).get("/api/public/site")).body.media;
    expect(site.video).toEqual({ kind: "file", src: up.body.url });

    const whole = await request(app).get(up.body.url);
    expect(whole.headers["accept-ranges"]).toBe("bytes");
    expect(Buffer.from(whole.body).equals(MP4)).toBe(true);
    const part = await request(app).get(up.body.url).set("Range", "bytes=0-99");
    expect(part.status).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 0-99/${MP4.length}`);
    expect(Buffer.from(part.body).equals(MP4.subarray(0, 100))).toBe(true);
    const last = await request(app).get(up.body.url).set("Range", "bytes=-10");
    expect(Buffer.from(last.body).equals(MP4.subarray(-10))).toBe(true);
    expect((await request(app).get(up.body.url).set("Range", `bytes=${MP4.length + 5}-`)).status).toBe(416);

    // A new upload replaces the old one; deleting falls back to the link.
    const up2 = await agent.put("/api/admin/media/video").set("Origin", "http://jood.test").set("Content-Type", "video/mp4").send(MP4);
    expect(await db.mediaAsset.count({ where: { kind: "VIDEO" } })).toBe(1);
    expect((await request(app).get(up.body.url)).status).toBe(404);
    await agent.delete("/api/admin/media/video").expect(204);
    expect((await request(app).get("/api/public/site")).body.media.video.kind).toBe("iframe");
    expect(up2.status).toBe(200);
  });

  it("warns about iPhone HEVC files, refuses non-videos, requires the owner and a same-site origin", async () => {
    const { agent } = await signedIn(app);
    const hevc = Buffer.concat([MP4, Buffer.from("....hvc1....")]);
    expect((await agent.put("/api/admin/media/video").set("Origin", "http://jood.test").set("Content-Type", "video/quicktime").send(hevc)).body.warning).toMatch(/HEVC/);
    expect((await agent.put("/api/admin/media/video").set("Origin", "http://jood.test").set("Content-Type", "video/mp4").send(Buffer.from("not a video at all"))).status).toBe(400);
    expect((await send(agent, MP4)).status).toBe(403); // another site's origin
    expect((await agent.put("/api/admin/media/video").set("Content-Type", "video/mp4").send(MP4)).status).toBe(403); // no origin at all
    const staff = (await signedIn(app, "STAFF")).agent;
    expect((await staff.put("/api/admin/media/video").set("Origin", "http://jood.test").set("Content-Type", "video/mp4").send(MP4)).status).toBe(403);
  });
});
