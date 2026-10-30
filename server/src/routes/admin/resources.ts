import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { HttpError, parse, uuidParam } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";

const partInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/, "المعرّف بالإنجليزية الصغيرة والأرقام والشرطة فقط"),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().default(null),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10000).default(0),
  /** المرافق التي يشملها الجزء (المرافق التي لا تنفصل تُجمع في جزء واحد) */
  amenityIds: z.array(z.uuid()).min(1, "اختر مرفقًا واحدًا على الأقل").max(50),
});

const conflictInput = z.object({
  resourceAId: z.uuid(),
  resourceBId: z.uuid(),
  reason: z.string().trim().max(200).nullable().default(null),
});

const include = {
  amenities: { include: { amenity: { select: { id: true, name: true, available: true } } } },
  pricingRules: { orderBy: [{ kind: "asc" as const }, { createdAt: "asc" as const }] },
};

export function resourcesRouter(db: PrismaClient) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const [resources, conflicts] = await Promise.all([
      db.bookingResource.findMany({ include, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
      db.resourceConflict.findMany({ orderBy: { createdAt: "asc" } }),
    ]);
    res.json({ resources, conflicts });
  });

  // Only parts are created by the owner; the single FULL resource is seeded and cannot be removed.
  router.post("/", async (req, res) => {
    const { amenityIds, ...data } = parse(partInput, req.body);
    await assertAmenitiesExist(db, amenityIds);
    const resource = await db.bookingResource.create({
      data: { ...data, kind: "PART", amenities: { create: amenityIds.map((amenityId) => ({ amenityId })) } },
      include,
    });
    await audit(db, req, { action: "resource.create", entityType: "resource", entityId: resource.id, details: { ...data, amenityIds } });
    res.status(201).json(resource);
  });

  router.patch("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { amenityIds, ...data } = parse(partInput.partial(), req.body);
    const existing = await db.bookingResource.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "الجزء غير موجود");
    if (existing.kind === "FULL" && amenityIds) {
      throw new HttpError(400, "الاستراحة كاملة تشمل كل المرافق دائمًا");
    }
    if (amenityIds) await assertAmenitiesExist(db, amenityIds);

    const resource = await db.$transaction(async (tx) => {
      if (amenityIds) {
        await tx.resourceAmenity.deleteMany({ where: { resourceId: id } });
        await tx.resourceAmenity.createMany({ data: amenityIds.map((amenityId) => ({ resourceId: id, amenityId })) });
      }
      return tx.bookingResource.update({ where: { id }, data, include });
    });
    await audit(db, req, { action: "resource.update", entityType: "resource", entityId: id, details: { ...data, amenityIds } });
    res.json(resource);
  });

  router.delete("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const existing = await db.bookingResource.findUnique({ where: { id }, include: { _count: { select: { bookingItems: true } } } });
    if (!existing) throw new HttpError(404, "الجزء غير موجود");
    if (existing.kind === "FULL") throw new HttpError(400, "لا يمكن حذف الاستراحة كاملة");
    if (existing._count.bookingItems > 0) {
      throw new HttpError(409, "يوجد حجوزات على هذا الجزء. أوقف إتاحته بدل حذفه للحفاظ على السجل.");
    }
    await db.bookingResource.delete({ where: { id } });
    await audit(db, req, { action: "resource.delete", entityType: "resource", entityId: id });
    res.status(204).end();
  });

  // ─── التعارضات الصريحة ───
  router.post("/conflicts", async (req, res) => {
    const { resourceAId, resourceBId, reason } = parse(conflictInput, req.body);
    if (resourceAId === resourceBId) throw new HttpError(400, "اختر جزأين مختلفين");
    const [a, b] = [resourceAId, resourceBId].sort() as [string, string];
    const count = await db.bookingResource.count({ where: { id: { in: [a, b] } } });
    if (count !== 2) throw new HttpError(404, "الجزء غير موجود");
    const existing = await db.resourceConflict.findUnique({ where: { resourceAId_resourceBId: { resourceAId: a, resourceBId: b } } });
    if (existing) throw new HttpError(409, "هذا التعارض مسجل مسبقًا");
    const conflict = await db.resourceConflict.create({ data: { resourceAId: a, resourceBId: b, reason } });
    await audit(db, req, { action: "conflict.create", entityType: "conflict", entityId: conflict.id, details: { a, b, reason } });
    res.status(201).json(conflict);
  });

  router.delete("/conflicts/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { count } = await db.resourceConflict.deleteMany({ where: { id } });
    if (count === 0) throw new HttpError(404, "التعارض غير موجود");
    await audit(db, req, { action: "conflict.delete", entityType: "conflict", entityId: id });
    res.status(204).end();
  });

  return router;
}

async function assertAmenitiesExist(db: PrismaClient, ids: string[]) {
  const unique = [...new Set(ids)];
  const found = await db.amenity.count({ where: { id: { in: unique } } });
  if (found !== unique.length) throw new HttpError(400, "بعض المرافق المختارة غير موجودة");
}
