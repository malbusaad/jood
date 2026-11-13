import { randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { HttpError } from "../lib/http.js";
import { addDays } from "../lib/dates.js";
import { audit } from "../lib/audit.js";
import { toIsoDate } from "../lib/dates.js";
import type { SecretBox } from "../lib/secretBox.js";
import { getSettings } from "../settings/registry.js";
import { checkoutInstant } from "./guestAccess.js";
import { TTLockError, type LockClient } from "./ttlock.js";

/** A 6-digit code without obvious patterns (no repeated digit runs like 111, no straight 123456). */
export function generateDoorCode(): string {
  for (;;) {
    const code = String(randomInt(100000, 1000000));
    if (/(\d)\1\1/.test(code)) continue;
    if ("0123456789".includes(code) || "9876543210".includes(code)) continue;
    return code;
  }
}

export function checkinInstant(startDate: Date, checkIn: string): Date {
  return new Date(`${toIsoDate(startDate)}T${checkIn}:00+03:00`);
}

/**
 * When the code must be valid: from check-in of the stay's next run of consecutive days to check-out
 * after it. For a normal booking (consecutive days) this is simply check-in → check-out. For an old
 * booking spread over separate days (e.g. three Sundays) it is only the next of those days, so a code
 * is never valid during days that belong to other guests.
 */
export function stayWindow(dates: string[], stay: { checkIn: string; checkOut: string }, now = new Date()) {
  const sorted = [...new Set(dates)].sort();
  const runs: string[][] = [];
  for (const d of sorted) {
    const run = runs.at(-1);
    if (run && addDays(run.at(-1)!, 1) === d) run.push(d);
    else runs.push([d]);
  }
  for (const run of runs) {
    const startsAt = new Date(`${run[0]}T${stay.checkIn}:00+03:00`);
    const endsAt = new Date(`${addDays(run.at(-1)!, 1)}T${stay.checkOut}:00+03:00`);
    if (endsAt > now) return { startsAt, endsAt };
  }
  return null;
}

function reason(err: unknown) {
  return (err instanceof Error ? err.message : "unknown error").slice(0, 500);
}

/**
 * Creates a door code on the lock for a confirmed booking, valid from check-in to check-out.
 * Any earlier active code for the booking is deleted from the lock first.
 */
export async function issueDoorCode(db: PrismaClient, lock: LockClient | null, box: SecretBox, bookingId: string, req: Request | null, now = new Date()) {
  if (!lock) throw new HttpError(409, "ربط القفل غير مُعد بعد (بيانات TTLock في إعدادات الخادم)");
  const booking = await db.booking.findUnique({ where: { id: bookingId }, include: { guest: { select: { name: true } }, items: { select: { date: true } } } });
  if (!booking) throw new HttpError(404, "الحجز غير موجود");
  if (booking.status !== "CONFIRMED") throw new HttpError(409, "يُنشأ رقم الباب بعد تأكيد الحجز فقط");

  const failures = await revokeDoorCodes(db, lock, bookingId, req);
  if (failures > 0) throw new HttpError(502, "تعذر حذف رقم الباب السابق من القفل، فلم يُنشأ رقم جديد. حاول مرة أخرى.");

  const { stay } = await getSettings(db, ["stay"]);
  const window = stayWindow(booking.items.map((i) => toIsoDate(i.date)), stay, now);
  if (!window) throw new HttpError(409, "انتهى موعد هذا الحجز");
  const { startsAt, endsAt } = window;
  const code = generateDoorCode();

  try {
    const { externalId } = await lock.addPasscode({ code, name: `${booking.reference} ${booking.guest.name}`.slice(0, 50), startsAt, endsAt });
    const row = await db.doorCode.create({
      data: { bookingId, lockId: lock.lockId, externalId, codeEncrypted: box.seal(code), startsAt, endsAt, status: "ACTIVE" },
    });
    await audit(db, req, { action: "door_code.issue", entityType: "booking", entityId: bookingId, details: { startsAt, endsAt } });
    return row;
  } catch (err) {
    await db.doorCode.create({ data: { bookingId, lockId: lock.lockId, startsAt, endsAt, status: "FAILED", error: reason(err) } });
    if (err instanceof TTLockError) throw new HttpError(502, `تعذر إنشاء رقم الباب في TTLock: ${err.message}`);
    throw err;
  }
}

/** Deletes the booking's active codes from the lock. Returns how many could not be deleted. */
export async function revokeDoorCodes(db: PrismaClient, lock: LockClient | null, bookingId: string, req: Request | null) {
  const active = await db.doorCode.findMany({ where: { bookingId, status: "ACTIVE" } });
  let failures = 0;
  for (const c of active) {
    try {
      if (!lock) throw new Error("lock not configured");
      if (c.externalId) await lock.deletePasscode(c.externalId);
      await db.doorCode.update({ where: { id: c.id }, data: { status: "DELETED", deletedAt: new Date(), error: null } });
      await audit(db, req, { action: "door_code.delete", entityType: "booking", entityId: bookingId });
    } catch (err) {
      failures++;
      await db.doorCode.update({ where: { id: c.id }, data: { error: `تعذر الحذف: ${reason(err)}`.slice(0, 500) } });
    }
  }
  return failures;
}

/** The booking's current door code in clear text (for the guest portal and the owner), or null. */
export async function currentDoorCode(db: PrismaClient, box: SecretBox, bookingId: string): Promise<string | null> {
  const c = await db.doorCode.findFirst({ where: { bookingId, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  return c?.codeEncrypted ? box.open(c.codeEncrypted) : null;
}

/**
 * Makes sure every confirmed upcoming booking has a valid door code, without the owner pressing
 * anything — e.g. bookings imported from the previous records, or the next day of a booking spread
 * over separate days. A code that failed in TTLock is not retried automatically (the owner was told
 * and can retry from the booking page), so a broken gateway never causes a flood of attempts.
 */
export async function ensureDoorCodes(
  db: PrismaClient,
  lock: LockClient | null,
  box: SecretBox,
  onFailure: (booking: { id: string; reference: string; guestName: string }, reason: string) => Promise<unknown>,
  now = new Date(),
) {
  if (!lock) return 0;
  const { doorLock, stay } = await getSettings(db, ["doorLock", "stay"]);
  if (!doorLock.enabled) return 0;
  const bookings = await db.booking.findMany({
    where: { status: "CONFIRMED", endDate: { gte: new Date(now.getTime() - 2 * 86_400_000) } },
    include: { items: { select: { date: true } }, doorCodes: { orderBy: { createdAt: "desc" }, take: 1 }, guest: { select: { name: true } } },
    orderBy: { startDate: "asc" },
    take: 100,
  });
  let issued = 0;
  for (const b of bookings) {
    const w = stayWindow(b.items.map((i) => toIsoDate(i.date)), stay, now);
    if (!w) continue;
    const last = b.doorCodes[0];
    const same = last && last.startsAt.getTime() === w.startsAt.getTime() && last.endsAt.getTime() === w.endsAt.getTime();
    if (same && (last.status === "ACTIVE" || last.status === "FAILED")) continue;
    try {
      await issueDoorCode(db, lock, box, b.id, null, now);
      issued++;
    } catch (err) {
      await onFailure({ id: b.id, reference: b.reference, guestName: b.guest.name }, err instanceof Error ? err.message : "error");
    }
  }
  return issued;
}
