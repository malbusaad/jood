import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { HttpError, parse, uuidParam } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { detectImageType } from "../../services/licenseLogo.js";

export const MAX_PHOTO_BYTES = 1_500_000;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const select = { id: true, storageKey: true, mimeType: true, sizeBytes: true, alt: true, amenityId: true, sortOrder: true, isHero: true, createdAt: true } as const;
const withUrl = <M extends { storageKey: string }>(m: M) => ({ ...m, url: `/api/media/${encodeURIComponent(m.storageKey)}` });

export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

/** MP4 / MOV ("ftyp" box) or WebM, from the file's own bytes. */
export function detectVideoType(buf: Buffer): string | null {
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") {
    return buf.subarray(8, 10).toString("latin1") === "qt" ? "video/quicktime" : "video/mp4";
  }
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return "video/webm";
  return null;
}

/** «الصور»: the owner uploads photos of the rest house (stored in the database). */
export function mediaRouter(db: PrismaClient) {
  const router = Router();

  /** The intro video file (raw body). Replaces the previous one. */
  router.get("/video", async (_req, res) => {
    const v = await db.mediaAsset.findFirst({ where: { kind: "VIDEO", isPrivate: false }, select: { storageKey: true, sizeBytes: true, mimeType: true, createdAt: true } });
    res.json({ video: v ? { ...v, url: `/api/media/${encodeURIComponent(v.storageKey)}` } : null });
  });
  router.put("/video", async (req, res) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(400, "لم يصل ملف الفيديو");
    const mime = detectVideoType(buf);
    if (!mime) throw new HttpError(400, "الفيديو يجب أن يكون MP4 أو MOV أو WebM");
    // HEVC (iPhone «High Efficiency») plays on Apple devices but not on every Android/PC browser.
    const head = buf.subarray(0, Math.min(buf.length, 4 * 1024 * 1024)).toString("latin1");
    const tail = buf.subarray(Math.max(0, buf.length - 4 * 1024 * 1024)).toString("latin1");
    const hevc = /hvc1|hev1/.test(head) || /hvc1|hev1/.test(tail);
    const v = await db.$transaction(async (tx) => {
      await tx.mediaAsset.deleteMany({ where: { kind: "VIDEO" } });
      return tx.mediaAsset.create({
        data: { kind: "VIDEO", storageKey: `video-${randomUUID()}.${mime === "video/webm" ? "webm" : "mp4"}`, mimeType: mime === "video/quicktime" ? "video/mp4" : mime, sizeBytes: buf.length, data: Buffer.from(buf) },
        select: { storageKey: true, sizeBytes: true },
      });
    });
    await audit(db, req, { action: "media.video_upload", entityType: "media", details: { size: buf.length, mime, hevc } });
    res.json({ url: `/api/media/${encodeURIComponent(v.storageKey)}`, size: v.sizeBytes, warning: hevc ? "الفيديو بصيغة HEVC (عالية الكفاءة): يعمل على أجهزة Apple، وقد لا يعمل على بعض أجهزة أندرويد والكمبيوتر. الأفضل تصديره بصيغة MP4 ‏(H.264)." : null });
  });
  router.delete("/video", async (req, res) => {
    await db.mediaAsset.deleteMany({ where: { kind: "VIDEO" } });
    await audit(db, req, { action: "media.video_delete", entityType: "media" });
    res.status(204).end();
  });

  router.get("/", async (_req, res) => {
    const items = await db.mediaAsset.findMany({ where: { kind: "IMAGE", isPrivate: false }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select });
    res.json({ items: items.map(withUrl) });
  });

  router.post("/", async (req, res) => {
    const input = parse(z.object({ data: z.string().min(1).max(2_200_000), alt: z.string().trim().max(200).nullable().optional() }), req.body);
    const buf = Buffer.from(input.data.replace(/^data:[^,]*,/, ""), "base64");
    if (buf.length > MAX_PHOTO_BYTES) throw new HttpError(413, "حجم الصورة كبير؛ الحد 1.5 ميجابايت");
    const mime = detectImageType(buf);
    if (!mime) throw new HttpError(400, "الصورة يجب أن تكون JPG أو PNG أو WebP");
    const last = await db.mediaAsset.aggregate({ where: { kind: "IMAGE" }, _max: { sortOrder: true } });
    const m = await db.mediaAsset.create({
      data: { kind: "IMAGE", storageKey: `photo-${randomUUID()}.${EXT[mime]}`, mimeType: mime, sizeBytes: buf.length, alt: input.alt ?? null, data: buf, sortOrder: (last._max.sortOrder ?? 0) + 1 },
      select,
    });
    await audit(db, req, { action: "media.upload", entityType: "media", entityId: m.id, details: { size: buf.length, mime } });
    res.status(201).json(withUrl(m));
  });

  router.patch("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(
      z.object({ alt: z.string().trim().max(200).nullable().optional(), amenityId: z.uuid().nullable().optional(), isHero: z.literal(true).optional() }),
      req.body,
    );
    const m = await db.$transaction(async (tx) => {
      // Only one main (hero) photo.
      if (input.isHero) await tx.mediaAsset.updateMany({ where: { kind: "IMAGE", isHero: true }, data: { isHero: false } });
      return tx.mediaAsset.update({ where: { id }, data: input, select });
    });
    res.json(withUrl(m));
  });

  /** New order of the photos (as shown in the gallery). */
  router.put("/order", async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).max(500) }), req.body);
    await db.$transaction(ids.map((id, i) => db.mediaAsset.updateMany({ where: { id, kind: "IMAGE" }, data: { sortOrder: i + 1 } })));
    res.json({ ok: true });
  });

  router.delete("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { count } = await db.mediaAsset.deleteMany({ where: { id, kind: "IMAGE" } });
    if (count === 0) throw new HttpError(404, "الصورة غير موجودة");
    await audit(db, req, { action: "media.delete", entityType: "media", entityId: id });
    res.status(204).end();
  });

  return router;
}
