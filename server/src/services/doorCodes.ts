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
  return stayWindows(dates, stay, now)[0] ?? null;
}

/**
 * Every window still to come (or under way): one per run of consecutive days. A booking on Thursday
 * and Saturday has two windows, so its codes work on those days only — never on Friday.
 */
export function stayWindows(dates: string[], stay: { checkIn: string; checkOut: string }, now = new Date()) {
  const sorted = [...new Set(dates)].sort();
  const runs: string[][] = [];
  for (const d of sorted) {
    const run = runs.at(-1);
    if (run && addDays(run.at(-1)!, 1) === d) run.push(d);
    else runs.push([d]);
  }
  return runs
    .map((run) => ({ startsAt: new Date(`${run[0]}T${stay.checkIn}:00+03:00`), endsAt: new Date(`${addDays(run.at(-1)!, 1)}T${stay.checkOut}:00+03:00`) }))
    .filter((w) => w.endsAt > now);
}

function reason(err: unknown) {
  return (err instanceof Error ? err.message : "unknown error").slice(0, 500);
}

/**
 * Creates the door code(s) on the lock for a confirmed booking, ready in advance: one passcode for
 * each run of days (separate days get their own window), each valid only from that day's check-in
 * to its check-out. The same number is used for every day when the lock accepts it, so the guest
 * has one code that simply works on their days. Earlier codes of the booking are deleted first.
 */
export async function issueDoorCode(db: PrismaClient, lock: LockClient | null, box: SecretBox, bookingId: string, req: Request | null, now = new Date()) {
  if (!lock) throw new HttpError(409, "ربط القفل غير مُعد بعد (بيانات TTLock في إعدادات الخادم)");
  const booking = await db.booking.findUnique({ where: { id: bookingId }, include: { guest: { select: { name: true } }, items: { select: { date: true } } } });
  if (!booking) throw new HttpError(404, "الحجز غير موجود");
  if (booking.status !== "CONFIRMED") throw new HttpError(409, "يُنشأ رقم الباب بعد تأكيد الحجز فقط");

  const failures = await revokeDoorCodes(db, lock, bookingId, req, now);
  if (failures > 0) throw new HttpError(502, "تعذر حذف رقم الباب السابق من القفل، فلم يُنشأ رقم جديد. حاول مرة أخرى.");

  const { stay } = await getSettings(db, ["stay"]);
  const windows = stayWindows(booking.items.map((i) => toIsoDate(i.date)), stay, now);
  if (windows.length === 0) throw new HttpError(409, "انتهى موعد هذا الحجز");
  const name = `${booking.reference} ${booking.guest.name}`.slice(0, 50);
  const code = generateDoorCode();

  const rows = [];
  let lastError: unknown = null;
  for (const [i, { startsAt, endsAt }] of windows.entries()) {
    // Same number for every day; if the lock refuses a repeated number, that day gets its own.
    const attempts = i === 0 ? [code] : [code, generateDoorCode()];
    let row = null;
    for (const c of attempts) {
      try {
        const { externalId } = await lock.addPasscode({ code: c, name, startsAt, endsAt });
        row = await db.doorCode.create({ data: { bookingId, lockId: lock.lockId, externalId, codeEncrypted: box.seal(c), startsAt, endsAt, status: "ACTIVE" } });
        await audit(db, req, { action: "door_code.issue", entityType: "booking", entityId: bookingId, details: { startsAt, endsAt } });
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!row) await db.doorCode.create({ data: { bookingId, lockId: lock.lockId, startsAt, endsAt, status: "FAILED", error: reason(lastError) } });
    else rows.push(row);
  }
  if (rows.length < windows.length) {
    if (lastError instanceof TTLockError) throw new HttpError(502, `تعذر إنشاء رقم الباب في TTLock: ${lastError.message}`);
    throw lastError;
  }
  return rows[0]!;
}

/** Deletes the booking's active codes from the lock. Returns how many could not be deleted. */
export async function revokeDoorCodes(db: PrismaClient, lock: LockClient | null, bookingId: string, req: Request | null, now = new Date()) {
  const active = await db.doorCode.findMany({ where: { bookingId, status: "ACTIVE" } });
  let failures = 0;
  for (const c of active) {
    if (c.endsAt <= now) {
      // An expired code no longer opens the door: clean it from the lock if possible, never block on it.
      if (lock && c.externalId) await lock.deletePasscode(c.externalId).catch(() => undefined);
      await db.doorCode.update({ where: { id: c.id }, data: { status: "DELETED", deletedAt: new Date(), error: null } });
      continue;
    }
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
export async function currentDoorCode(db: PrismaClient, box: SecretBox, bookingId: string, now = new Date()): Promise<string | null> {
  // The code of the day under way, or of the next booked day.
  const c = await db.doorCode.findFirst({ where: { bookingId, status: "ACTIVE", endsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
  return c?.codeEncrypted ? box.open(c.codeEncrypted) : null;
}

/** Owner view: every upcoming day's window and its code. */
export async function doorCodeSchedule(db: PrismaClient, box: SecretBox, bookingId: string, now = new Date()) {
  const rows = await db.doorCode.findMany({ where: { bookingId, status: "ACTIVE", endsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
  return rows.map((r) => ({ startsAt: r.startsAt, endsAt: r.endsAt, code: r.codeEncrypted ? box.open(r.codeEncrypted) : null }));
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
    include: { items: { select: { date: true } }, doorCodes: { where: { status: { in: ["ACTIVE", "FAILED"] }, endsAt: { gt: now } } }, guest: { select: { name: true } } },
    orderBy: { startDate: "asc" },
    take: 100,
  });
  let issued = 0;
  for (const b of bookings) {
    const windows = stayWindows(b.items.map((i) => toIsoDate(i.date)), stay, now);
    if (windows.length === 0) continue;
    // Every upcoming day already has its code (or a failure the owner was told about): nothing to do.
    const key = (w: { startsAt: Date; endsAt: Date }) => `${w.startsAt.getTime()}-${w.endsAt.getTime()}`;
    const have = new Set(b.doorCodes.map(key));
    if (windows.every((w) => have.has(key(w))) && b.doorCodes.length === windows.length) continue;
    try {
      await issueDoorCode(db, lock, box, b.id, null, now);
      issued++;
    } catch (err) {
      await onFailure({ id: b.id, reference: b.reference, guestName: b.guest.name }, err instanceof Error ? err.message : "error");
    }
  }
  return issued;
}
