import { Router } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { HttpError, parse, uuidParam } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";

/** Icons the owner can pick for an amenity or service (the client draws each one). */
export const iconNames = [
  "tent", "majlis", "dining", "outdoor", "kitchen", "restroom", "volleyball", "coffee", "kids", "wifi",
  "parking", "bbq", "pool", "bedroom", "tv", "ac", "shower", "garden", "lighting", "fridge",
  "microwave", "laundry", "shade", "baby", "games", "speakers", "projector", "cctv", "cleaning", "water",
  "fan", "power", "accessible", "gym", "football", "music", "drinks", "chef", "heater", "cooling",
  "events", "cinema", "security", "entrance", "charging", "puzzle", "bike", "flowers", "smokefree", "family",
  "mic", "sun", "star", "prayer",
] as const;

// Field rules shared by «create» and «edit». Defaults apply only when creating: an edit changes
// only the fields it sends (a quick on/off toggle must never reset the others).
const amenityFields = {
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/, "المعرّف بالإنجليزية الصغيرة والأرقام والشرطة فقط"),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable(),
  capacityText: z.string().trim().max(80).nullable(),
  capacityMax: z.number().int().positive().max(1000).nullable(),
  note: z.string().trim().max(120).nullable(),
  icon: z.enum(iconNames),
  category: z.enum(["FACILITY", "SERVICE"]),
  sortOrder: z.number().int().min(0).max(10000),
  visible: z.boolean(),
  available: z.boolean(),
};
const amenityInput = z.object({
  ...amenityFields,
  description: amenityFields.description.default(null),
  capacityText: amenityFields.capacityText.default(null),
  capacityMax: amenityFields.capacityMax.default(null),
  note: amenityFields.note.default(null),
  icon: amenityFields.icon.default("outdoor"),
  category: amenityFields.category.default("FACILITY"),
  sortOrder: amenityFields.sortOrder.default(0),
  visible: amenityFields.visible.default(true),
  available: amenityFields.available.default(true),
});
const amenityPatch = z.object(amenityFields).partial();

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
    const data = parse(amenityPatch, req.body);
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
