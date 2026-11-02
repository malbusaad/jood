import type { PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { HttpError } from "../lib/http.js";
import { generateToken, hashToken } from "../lib/tokens.js";
import { audit } from "../lib/audit.js";
import { toIsoDate } from "../lib/dates.js";
import { getSettings } from "../settings/registry.js";

/** Check-out moment of a booking (its end date at the configured check-out time, Riyadh UTC+3). */
export function checkoutInstant(endDate: Date, checkOut: string): Date {
  return new Date(`${toIsoDate(endDate)}T${checkOut}:00+03:00`);
}

/**
 * Issues a new private guest link for a confirmed booking. Any earlier link stops working.
 * The token is returned once and only its SHA-256 hash is stored.
 */
export async function issueGuestLink(db: PrismaClient, req: Request, bookingId: string, publicBaseUrl: string) {
  const booking = await db.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new HttpError(404, "الحجز غير موجود");
  if (booking.status !== "CONFIRMED") throw new HttpError(409, "يُرسل رابط البوابة بعد تأكيد الحجز فقط");

  const { stay, guestPortal } = await getSettings(db, ["stay", "guestPortal"]);
  const expiresAt = new Date(checkoutInstant(booking.endDate, stay.checkOut).getTime() + guestPortal.linkGraceHours * 3600_000);
  if (expiresAt <= new Date()) throw new HttpError(409, "انتهى موعد هذا الحجز");

  const token = generateToken();
  const record = await db.$transaction(async (tx) => {
    await tx.guestAccessToken.updateMany({ where: { bookingId, revokedAt: null }, data: { revokedAt: new Date() } });
    const created = await tx.guestAccessToken.create({ data: { bookingId, tokenHash: hashToken(token), expiresAt } });
    await audit(tx, req, { action: "guest_link.issue", entityType: "booking", entityId: bookingId, details: { expiresAt } });
    return created;
  });
  return { id: record.id, url: `${publicBaseUrl.replace(/\/$/, "")}/g/${token}`, expiresAt };
}

export async function revokeGuestLinks(db: PrismaClient, req: Request, bookingId: string) {
  const { count } = await db.guestAccessToken.updateMany({ where: { bookingId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (count > 0) await audit(db, req, { action: "guest_link.revoke", entityType: "booking", entityId: bookingId });
  return count;
}
