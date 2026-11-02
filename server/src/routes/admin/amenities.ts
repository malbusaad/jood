import { Router } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { HttpError, parse, uuidParam } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";

const iconNames = ["tent", "majlis", "dining", "outdoor", "kitchen", "restroom", "volleyball", "coffee", "kids", "wifi"] as const;

const amenityInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/, "المعرّف بالإنجليزية الصغيرة والأرقام والشرطة فقط"),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().default(null),
  capacityText: z.string().trim().max(80).nullable().default(null),
  capacityMax: z.number().int().positive().max(1000).nullable().default(null),
  note: z.string().trim().max(120).nullable().default(null),
  icon: z.enum(iconNames).default("outdoor"),
  sortOrder: z.number().int().min(0).max(10000).default(0),
  visible: z.boolean().default(true),
  available: z.boolean().default(true),
});

export function amenitiesRouter(db: PrismaClient) {
  const router = Router();

  router.get("/", async (_req, res) => {
    res.json(await db.amenity.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }));
  });

  router.post("/", async (req, res) => {
    const data = parse(amenityInput, req.body);
    const amenity = await db.$transaction(async (tx) => {
      const created = await tx.amenity.create({ data });
      // The full rest house always covers every amenity, so it keeps conflicting with every part.
      const full = await tx.bookingResource.findFirst({ where: { kind: "FULL" } });
      if (full) await tx.resourceAmenity.create({ data: { resourceId: full.id, amenityId: created.id } });
      return created;
    });
    await audit(db, req, { action: "amenity.create", entityType: "amenity", entityId: amenity.id, details: data });
    res.status(201).json(amenity);
  });

  router.patch("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const data = parse(amenityInput.partial(), req.body);
    const amenity = await db.amenity.update({ where: { id }, data });
    await audit(db, req, { action: "amenity.update", entityType: "amenity", entityId: id, details: data });
    res.json(amenity);
  });

  router.delete("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const usedByParts = await db.resourceAmenity.count({ where: { amenityId: id, resource: { kind: "PART" } } });
    if (usedByParts > 0) {
      throw new HttpError(409, "هذا المرفق جزء من جزء قابل للحجز. أزله من الجزء أولًا، أو أخفِه بدل حذفه.");
    }
    try {
      await db.$transaction([
        db.resourceAmenity.deleteMany({ where: { amenityId: id } }),
        db.amenity.delete({ where: { id } }),
      ]);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") throw new HttpError(404, "المرفق غير موجود");
      throw err;
    }
    await audit(db, req, { action: "amenity.delete", entityType: "amenity", entityId: id });
    res.status(204).end();
  });

  return router;
}
