import { z } from "zod";

/** Date-only values are handled as "YYYY-MM-DD" strings and stored as UTC midnight (Postgres DATE). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD")
  .refine((s) => toIsoDate(fromIsoDate(s)) === s, "تاريخ غير صحيح");

export function fromIsoDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(s: string, days: number): string {
  const d = fromIsoDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(s: string): number {
  return fromIsoDate(s).getUTCDay();
}

/** Every date from start (inclusive) to end (exclusive). */
export function eachDate(start: string, endExclusive: string): string[] {
  const out: string[] = [];
  for (let d = start; d < endExclusive; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today's date in Saudi Arabia (UTC+3, no DST). */
export function todayInRiyadh(now = new Date()): string {
  return toIsoDate(new Date(now.getTime() + 3 * 60 * 60 * 1000));
}
