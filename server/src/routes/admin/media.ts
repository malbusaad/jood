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

/** «الصور»: the owner uploads photos of the rest house (stored in the database). */
export function mediaRouter(db: PrismaClient) {
  const router = Router();

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
