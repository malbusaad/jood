import ExcelJS from "exceljs";
import { Prisma, type BookingStatus, type PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { HttpError } from "../lib/http.js";
import { addDays, fromIsoDate, todayInRiyadh } from "../lib/dates.js";
import { audit } from "../lib/audit.js";
import type { SecretBox } from "../lib/secretBox.js";
import { asciiDigits, nationalIdSchema, phoneSchema } from "../settings/registry.js";
import { blockedResources, lockKeysByResource } from "./conflicts.js";

/**
 * Imports the owner's previous records (the «نسخة البيانات الشاملة» workbook): customers, past and
 * upcoming bookings with the amounts received, and expenses. Nothing is guessed: empty cells stay
 * empty, and every imported booking says where it came from. Re-importing the same file adds nothing.
 */

export interface ParsedBooking {
  ref: string;
  name: string;
  phone: string | null;
  nationalId: string | null;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
  dates: string[];
  total: number;
  deposit: number | null;
  paid: number | null;
  notes: string | null;
  createdAt: Date | null;
}
export interface ParsedExpense {
  ref: string;
  title: string;
  category: string;
  date: string;
  amount: number;
  notes: string | null;
  createdAt: Date | null;
}

type Cell = ExcelJS.CellValue;

function cellText(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("").trim() || null;
    if ("text" in v && typeof v.text === "string") return v.text.trim() || null;
    if ("result" in v) return cellText(v.result as Cell);
    return null;
  }
  return String(v).trim() || null;
}
function cellNumber(v: Cell): number | null {
  if (typeof v === "object" && v !== null && !(v instanceof Date) && "result" in v) return cellNumber(v.result as Cell);
  if (typeof v === "number") return v;
  const t = cellText(v);
  if (!t) return null;
  const n = Number(asciiDigits(t).replace(/[,\s٬]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function cellDate(v: Cell): string | null {
  if (typeof v === "object" && v !== null && !(v instanceof Date) && "result" in v) return cellDate(v.result as Cell);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = cellText(v);
  const m = t ? asciiDigits(t).match(/\d{4}-\d{2}-\d{2}/) : null;
  return m ? m[0] : null;
}
function cellDateTime(v: Cell): Date | null {
  // Excel stores the clock time without a zone; the file says it is Riyadh time (UTC+3).
  if (v instanceof Date) return new Date(v.getTime() - 3 * 3600_000);
  const t = cellText(v);
  if (!t) return null;
  // Written in Riyadh time, e.g. «2026-04-13 12:24:02».
  const m = asciiDigits(t).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  return m ? new Date(`${m[1]}T${m[2]!.length === 5 ? `${m[2]}:00` : m[2]}+03:00`) : null;
}

/** Finds the header row (the one whose cells include `first`) and maps header names to columns. */
function table(ws: ExcelJS.Worksheet, first: string) {
  let headerRow = 0;
  const cols = new Map<string, number>();
  for (let n = 1; n <= ws.rowCount && !headerRow; n++) {
    const row = ws.getRow(n);
    row.eachCell((cell) => {
      if (cellText(cell.value) === first) headerRow = n;
    });
    if (headerRow) row.eachCell((cell, c) => cols.set(cellText(cell.value) ?? "", c));
  }
  if (!headerRow) throw new HttpError(400, `لم أجد عمود «${first}» في ورقة «${ws.name}»`);
  const rows: ((name: string) => Cell)[] = [];
  for (let n = headerRow + 1; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const get = (name: string) => {
      const c = cols.get(name);
      return c ? row.getCell(c).value : null;
    };
    if (cellText(get(first))) rows.push(get);
  }
  return rows;
}

const STATUS: Record<string, ParsedBooking["status"]> = { مؤكد: "CONFIRMED", معلق: "PENDING", ملغى: "CANCELLED", ملغي: "CANCELLED" };

export async function parseWorkbook(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new HttpError(400, "تعذر قراءة الملف. ارفع ملف Excel بصيغة ‎.xlsx");
  }
  const issues: string[] = [];
  const sheetB = wb.getWorksheet("جميع الحجوزات");
  if (!sheetB) throw new HttpError(400, "لم أجد ورقة «جميع الحجوزات» في الملف");

  const bookings: ParsedBooking[] = [];
  for (const get of table(sheetB, "رقم الحجز")) {
    const ref = asciiDigits(cellText(get("رقم الحجز"))!).replace(/\s/g, "");
    const name = (cellText(get("اسم المستأجر")) ?? "").replace(/\s+/g, " ");
    const main = cellDate(get("التاريخ الرئيسي"));
    const total = cellNumber(get("إجمالي مبلغ الحجز (ر.س)"));
    const statusText = cellText(get("حالة الحجز")) ?? "";
    if (!name || !main || total === null || !STATUS[statusText]) {
      issues.push(`الحجز ${ref}: بيانات ناقصة (الاسم أو التاريخ أو المبلغ أو الحالة) — لن يُستورد`);
      continue;
    }
    const extra = (cellText(get("الأيام الإضافية")) ?? "").split(/[\n،,]+/).map((s) => (asciiDigits(s).match(/\d{4}-\d{2}-\d{2}/) ?? [])[0]).filter(Boolean) as string[];
    const rawPhone = cellText(get("رقم الجوال"));
    let phone: string | null = null;
    if (rawPhone) {
      const p = phoneSchema.safeParse(rawPhone.replace(/[^\d٠-٩۰-۹+]/g, ""));
      if (p.success) phone = p.data;
      else issues.push(`الحجز ${ref}: رقم الجوال غير صالح — سيُستورد بدون جوال`);
    }
    const rawId = cellText(get("رقم الهوية / الإقامة"));
    let nationalId: string | null = null;
    if (rawId) {
      const p = nationalIdSchema.safeParse(rawId.replace(/[^\d٠-٩۰-۹]/g, ""));
      if (p.success) nationalId = p.data;
      else issues.push(`الحجز ${ref}: رقم الهوية غير صالح — سيُستورد بدون هوية`);
    }
    bookings.push({
      ref,
      name,
      phone,
      nationalId,
      status: STATUS[statusText]!,
      dates: [...new Set([main, ...extra])].sort(),
      total,
      deposit: cellNumber(get("العربون المسجل (ر.س)")),
      paid: cellNumber(get("المدفوع المسجل (ر.س)")),
      notes: cellText(get("ملاحظات")),
      createdAt: cellDateTime(get("تاريخ إنشاء السجل (الرياض)")),
    });
  }

  const expenses: ParsedExpense[] = [];
  const sheetE = wb.getWorksheet("المصاريف");
  if (sheetE) {
    for (const get of table(sheetE, "رقم المصروف")) {
      const ref = asciiDigits(cellText(get("رقم المصروف"))!).replace(/\s/g, "");
      const title = cellText(get("البند / الوصف"));
      const date = cellDate(get("تاريخ المصروف"));
      const amount = cellNumber(get("المبلغ (ر.س)"));
      if (!title || !date || !amount || amount <= 0) {
        issues.push(`المصروف ${ref}: بيانات ناقصة — لن يُستورد`);
        continue;
      }
      expenses.push({ ref, title: title.slice(0, 200), category: (cellText(get("التصنيف")) ?? "أخرى").slice(0, 60), date, amount, notes: cellText(get("ملاحظات")), createdAt: cellDateTime(get("تاريخ إنشاء السجل (الرياض)")) });
    }
  }
  if (bookings.length === 0 && expenses.length === 0) throw new HttpError(400, "لم أجد حجوزات أو مصاريف في الملف");
  return { bookings, expenses, issues };
}

const reference = (ref: string) => `OLD-${ref}`.slice(0, 20);
const received = (b: ParsedBooking) => Math.min(b.total, Math.max(b.deposit ?? 0, b.paid ?? 0));

function statusFor(b: ParsedBooking, today: string): BookingStatus {
  const last = b.dates.at(-1)!;
  if (b.status === "CANCELLED") return "CANCELLED";
  if (b.status === "PENDING") return last < today ? "EXPIRED" : "NEW";
  return last < today ? "COMPLETED" : "CONFIRMED";
}

/** What the import would do — no changes are made. */
export async function planImport(db: PrismaClient, parsed: Awaited<ReturnType<typeof parseWorkbook>>) {
  const today = todayInRiyadh();
  const full = await db.bookingResource.findFirst({ where: { kind: "FULL", active: true } });
  if (!full) throw new HttpError(409, "لا يوجد «الاستراحة كاملة» في الأجزاء");

  const existingRefs = new Set((await db.booking.findMany({ where: { reference: { in: parsed.bookings.map((b) => reference(b.ref)) } }, select: { reference: true } })).map((b) => b.reference));
  const existingExp = new Set((await db.expense.findMany({ where: { externalRef: { in: parsed.expenses.map((e) => `IMP-${e.ref}`) } }, select: { externalRef: true } })).map((e) => e.externalRef));

  const issues = [...parsed.issues];
  const toImport: (ParsedBooking & { status2: BookingStatus; lockDates: string[] })[] = [];
  let skipped = 0;
  for (const b of parsed.bookings) {
    if (existingRefs.has(reference(b.ref))) {
      skipped++;
      continue;
    }
    const status2 = statusFor(b, today);
    // Only current/upcoming active bookings hold their days in the calendar.
    const lockDates = status2 === "CONFIRMED" || status2 === "NEW" ? b.dates.filter((d) => d >= today) : [];
    if (lockDates.length) {
      const blocked = (await blockedResources(db, [full.id], lockDates)).get(full.id);
      if (blocked?.size) {
        issues.push(`الحجز ${b.ref} (${b.name}): يتعارض مع حجز موجود في الموقع يوم ${[...blocked].sort().join("، ")} — لن يُستورد، راجعه يدويًا`);
        continue;
      }
    }
    toImport.push({ ...b, status2, lockDates });
  }
  const expenses = parsed.expenses.filter((e) => !existingExp.has(`IMP-${e.ref}`));

  const phones = new Set(toImport.map((b) => b.phone).filter(Boolean) as string[]);
  const knownPhones = new Set((await db.guest.findMany({ where: { phone: { in: [...phones] } }, select: { phone: true } })).map((g) => g.phone));
  const byStatus = toImport.reduce<Record<string, number>>((a, b) => ({ ...a, [b.status2]: (a[b.status2] ?? 0) + 1 }), {});
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

  return {
    fullId: full.id,
    toImport,
    expenses,
    summary: {
      bookings: toImport.length,
      byStatus,
      skippedExisting: skipped,
      expenses: expenses.length,
      skippedExpenses: parsed.expenses.length - expenses.length,
      newCustomers: [...phones].filter((p) => !knownPhones.has(p)).length + new Set(toImport.filter((b) => !b.phone).map((b) => b.name)).size,
      existingCustomers: [...phones].filter((p) => knownPhones.has(p)).length,
      bookingValueConfirmed: sum(toImport.filter((b) => b.status2 === "CONFIRMED" || b.status2 === "COMPLETED").map((b) => b.total)),
      received: sum(toImport.map(received)),
      expensesTotal: sum(expenses.map((e) => e.amount)),
      upcoming: toImport
        .filter((b) => b.lockDates.length)
        .map((b) => ({ ref: b.ref, name: b.name, dates: b.dates, total: b.total, received: received(b), status: b.status2 })),
    },
    issues,
  };
}

/** Writes everything in one transaction (all or nothing). */
export async function commitImport(db: PrismaClient, req: Request, box: SecretBox, plan: Awaited<ReturnType<typeof planImport>>) {
  const keys = [...new Set([...(await lockKeysByResource(db, [plan.fullId])).values()].flat())];
  try {
    await db.$transaction(
      async (tx) => {
        const noPhoneGuests = new Map<string, string>();
        for (const b of plan.toImport) {
          const idData = b.nationalId ? { nationalIdEnc: box.seal(b.nationalId), nationalIdLast4: b.nationalId.slice(-4) } : {};
          let guestId: string;
          if (b.phone) {
            const existing = await tx.guest.findUnique({ where: { phone: b.phone } });
            if (existing) {
              guestId = existing.id;
              if (b.nationalId && !existing.nationalIdEnc) await tx.guest.update({ where: { id: existing.id }, data: idData });
            } else {
              guestId = (await tx.guest.create({ data: { name: b.name, phone: b.phone, notes: "من السجل السابق", ...idData } })).id;
            }
          } else {
            // Without a phone number, the same name is taken as the same customer (as in the original file).
            const known = noPhoneGuests.get(b.name) ?? (await tx.guest.findFirst({ where: { phone: null, name: b.name } }))?.id;
            guestId = known ?? (await tx.guest.create({ data: { name: b.name, phone: null, notes: "من السجل السابق — بدون رقم جوال", ...idData } })).id;
            noPhoneGuests.set(b.name, guestId);
          }

          const n = b.dates.length;
          const per = Math.floor((b.total / n) * 100) / 100;
          const prices = b.dates.map((_, i) => (i === 0 ? Math.round((b.total - per * (n - 1)) * 100) / 100 : per));
          const createdAt = b.createdAt ?? new Date();
          const notes = [
            `مستورد من السجل السابق (رقم الحجز ${b.ref}).`,
            b.dates.length > 1 ? `الأيام: ${b.dates.join("، ")}.` : null,
            b.deposit ? `العربون المسجل: ${b.deposit} ريال.` : null,
            b.paid ? `المدفوع المسجل: ${b.paid} ريال.` : null,
            b.notes,
          ].filter(Boolean).join("\n");
          const booking = await tx.booking.create({
            data: {
              reference: reference(b.ref),
              guestId,
              status: b.status2,
              channel: "IMPORTED",
              startDate: fromIsoDate(b.dates[0]!),
              endDate: fromIsoDate(addDays(b.dates.at(-1)!, 1)),
              totalAmount: b.total,
              upfrontAmount: b.total,
              depositAmount: 0,
              legacyPayment: true,
              priceBreakdown: b.dates.map((d, i) => ({ date: d, resourceId: plan.fullId, resourceName: "الاستراحة كاملة", price: prices[i]!.toFixed(2), ruleKind: "WEEKDAY", ruleLabel: "سجل سابق" })) as unknown as Prisma.InputJsonValue,
              adminNotes: notes,
              createdAt,
              confirmedAt: b.status2 === "CONFIRMED" || b.status2 === "COMPLETED" ? createdAt : null,
            },
          });
          await tx.bookingItem.createMany({ data: b.dates.map((d, i) => ({ bookingId: booking.id, resourceId: plan.fullId, date: fromIsoDate(d), price: prices[i]! })) });
          if (b.lockDates.length) {
            await tx.bookingLock.createMany({ data: keys.flatMap((key) => b.lockDates.map((d) => ({ key, date: fromIsoDate(d), bookingId: booking.id }))) });
          }
          const got = received(b);
          if (got > 0) {
            await tx.payment.create({
              data: {
                bookingId: booking.id,
                method: "BANK_TRANSFER",
                purpose: "BOOKING",
                amount: got,
                status: "ACCEPTED",
                note: "مبلغ مستلم مسجل في السجل السابق (العربون/المدفوع) — طريقة الدفع غير محددة في الملف",
                verifiedAt: createdAt,
                verifiedById: req.user!.id,
                createdAt,
              },
            });
          }
        }
        if (plan.expenses.length) {
          await tx.expense.createMany({
            data: plan.expenses.map((e) => ({
              title: e.title,
              category: e.category,
              date: fromIsoDate(e.date),
              amount: e.amount,
              notes: e.notes,
              externalRef: `IMP-${e.ref}`,
              createdAt: e.createdAt ?? new Date(),
            })),
            skipDuplicates: true,
          });
        }
        // Counts only — no personal data in the audit log.
        await audit(tx, req, { action: "import.commit", entityType: "import", details: { bookings: plan.toImport.length, expenses: plan.expenses.length } });
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "حُجز أحد الأيام القادمة في الموقع أثناء الاستيراد. لم يُستورد شيء؛ أعد المعاينة ثم الاستيراد.");
    }
    throw err;
  }
  return plan.summary;
}
