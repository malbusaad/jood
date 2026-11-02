import { randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { HttpError } from "../lib/http.js";
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

function reason(err: unknown) {
  return (err instanceof Error ? err.message : "unknown error").slice(0, 500);
}

/**
 * Creates a door code on the lock for a confirmed booking, valid from check-in to check-out.
 * Any earlier active code for the booking is deleted from the lock first.
 */
export async function issueDoorCode(db: PrismaClient, lock: LockClient | null, box: SecretBox, bookingId: string, req: Request | null) {
  if (!lock) throw new HttpError(409, "ربط القفل غير مُعد بعد (بيانات TTLock في إعدادات الخادم)");
  const booking = await db.booking.findUnique({ where: { id: bookingId }, include: { guest: { select: { name: true } } } });
  if (!booking) throw new HttpError(404, "الحجز غير موجود");
  if (booking.status !== "CONFIRMED") throw new HttpError(409, "يُنشأ رقم الباب بعد تأكيد الحجز فقط");

  const failures = await revokeDoorCodes(db, lock, bookingId, req);
  if (failures > 0) throw new HttpError(502, "تعذر حذف رقم الباب السابق من القفل، فلم يُنشأ رقم جديد. حاول مرة أخرى.");

  const { stay } = await getSettings(db, ["stay"]);
  const startsAt = checkinInstant(booking.startDate, stay.checkIn);
  const endsAt = checkoutInstant(booking.endDate, stay.checkOut);
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
