import type { Prisma, PrismaClient } from "@prisma/client";
import { fromIsoDate } from "../lib/dates.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Lock keys a resource occupies on each booked day:
 * - one per amenity it includes (`amenity:<id>`): resources sharing an amenity conflict;
 * - one per explicit conflict it takes part in (`conflict:<id>`).
 * The full rest house includes every amenity, so it conflicts with every part.
 */
export async function lockKeysByResource(db: Db, resourceIds: string[]): Promise<Map<string, string[]>> {
  const resources = await db.bookingResource.findMany({
    where: { id: { in: resourceIds } },
    select: {
      id: true,
      amenities: { select: { amenityId: true } },
      conflictsA: { select: { id: true } },
      conflictsB: { select: { id: true } },
    },
  });
  return new Map(
    resources.map((r) => [
      r.id,
      [
        ...r.amenities.map((a) => `amenity:${a.amenityId}`),
        ...[...r.conflictsA, ...r.conflictsB].map((c) => `conflict:${c.id}`),
      ],
    ]),
  );
}

/** True when the given resources may be booked together (no shared amenity or explicit conflict). */
export async function resourcesCompatible(db: Db, resourceIds: string[]): Promise<boolean> {
  const keys = [...(await lockKeysByResource(db, resourceIds)).values()].flat();
  return new Set(keys).size === keys.length;
}

/** Resource ids (among candidates) that are blocked on any of the given dates by active bookings. */
export async function blockedResources(db: Db, candidateIds: string[], dates: string[]) {
  const keysByResource = await lockKeysByResource(db, candidateIds);
  const allKeys = [...new Set([...keysByResource.values()].flat())];
  if (allKeys.length === 0 || dates.length === 0) return new Map<string, Set<string>>();

  const locks = await db.bookingLock.findMany({
    where: { key: { in: allKeys }, date: { in: dates.map(fromIsoDate) } },
    select: { key: true, date: true },
  });
  const lockedByKey = new Map<string, Set<string>>();
  for (const l of locks) {
    const d = l.date.toISOString().slice(0, 10);
    if (!lockedByKey.has(l.key)) lockedByKey.set(l.key, new Set());
    lockedByKey.get(l.key)!.add(d);
  }

  /** resourceId → set of blocked dates */
  const blocked = new Map<string, Set<string>>();
  for (const [resourceId, keys] of keysByResource) {
    for (const key of keys) {
      for (const d of lockedByKey.get(key) ?? []) {
        if (!blocked.has(resourceId)) blocked.set(resourceId, new Set());
        blocked.get(resourceId)!.add(d);
      }
    }
  }
  return blocked;
}
