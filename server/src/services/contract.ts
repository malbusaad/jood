import type { PrismaClient } from "@prisma/client";
import { HttpError } from "../lib/http.js";
import { toIsoDate, todayInRiyadh } from "../lib/dates.js";
import { formatDateAr, formatSAR, formatTimeAr } from "../lib/format.js";
import { getSettings } from "../settings/registry.js";
import type { QuoteLine } from "./pricing.js";
import type { SecretBox } from "../lib/secretBox.js";

export type ContractBlock =
  | { type: "title"; text: string }
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "ordered"; start: number; items: string[] }
  | { type: "bullets"; items: string[] }
  | { type: "table"; rows: [string, string][] }
  | { type: "prices"; rows: { date: string; item: string; price: string }[]; total: string };

export interface Contract {
  reference: string;
  guestName: string;
  guestPhone: string;
  blocks: ContractBlock[];
  /** Things the owner should fix before sending (missing bank details, unknown placeholders). */
  warnings: string[];
}

const BLOCK_PLACEHOLDERS = ["bookingDetails", "bankDetails", "houseRules", "cancellationPolicy"] as const;

/** Parses the owner's contract text into blocks (see settings/contract-template.ts for the format). */
export function parseTemplate(
  template: string,
  inline: Record<string, string>,
  blocks: Record<(typeof BLOCK_PLACEHOLDERS)[number], ContractBlock[]>,
): { blocks: ContractBlock[]; unknown: string[] } {
  const out: ContractBlock[] = [];
  const unknown = new Set<string>();
  const fill = (s: string) =>
    s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => {
      if (key in inline) return inline[key]!;
      unknown.add(key);
      return m;
    });

  for (const raw of template.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const blockKey = /^\{\{\s*(\w+)\s*\}\}$/.exec(line)?.[1];
    if (blockKey && (BLOCK_PLACEHOLDERS as readonly string[]).includes(blockKey)) {
      out.push(...blocks[blockKey as (typeof BLOCK_PLACEHOLDERS)[number]]);
      continue;
    }
    const last = out.at(-1);
    let m: RegExpExecArray | null;
    if ((m = /^#\s+(.*)$/.exec(line))) out.push({ type: "title", text: fill(m[1]!) });
    else if ((m = /^##\s+(.*)$/.exec(line))) out.push({ type: "heading", text: fill(m[1]!) });
    else if ((m = /^(\d+)[.)]\s+(.*)$/.exec(line))) {
      if (last?.type === "ordered") last.items.push(fill(m[2]!));
      else out.push({ type: "ordered", start: Number(m[1]), items: [fill(m[2]!)] });
    } else if ((m = /^[-•]\s+(.*)$/.exec(line))) {
      if (last?.type === "bullets") last.items.push(fill(m[1]!));
      else out.push({ type: "bullets", items: [fill(m[1]!)] });
    } else out.push({ type: "paragraph", text: fill(line) });
  }
  return { blocks: out, unknown: [...unknown] };
}

/** Builds the filled contract for one booking from the owner's template and current settings. */
export async function buildContract(db: PrismaClient, bookingId: string, box: SecretBox): Promise<Contract> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { guest: true, items: { include: { resource: { select: { name: true, kind: true } } } } },
  });
  if (!booking) throw new HttpError(404, "الحجز غير موجود");

  const s = await getSettings(db, ["contract", "bank", "stay", "houseRules", "cancellationPolicy", "bookingPolicy"]);
  const warnings: string[] = [];

  const start = toIsoDate(booking.startDate);
  const end = toIsoDate(booking.endDate);
  const days = Math.round((booking.endDate.getTime() - booking.startDate.getTime()) / 86_400_000);
  const resourceNames = [...new Map(booking.items.map((i) => [i.resourceId, i.resource.name])).values()];
  const total = Number(booking.totalAmount);
  const deposit = Number(booking.depositAmount);
  const discount = Number(booking.discountAmount);
  const subtotal = total + discount;

  const details: ContractBlock[] = [
    {
      type: "table",
      rows: [
        ["المحجوز", resourceNames.join("، ")],
        ["الدخول", `${formatDateAr(start)} — الساعة ${formatTimeAr(s.stay.checkIn)}`],
        ["الخروج", `${formatDateAr(end)} — الساعة ${formatTimeAr(s.stay.checkOut)}`],
        ["عدد الأيام", String(days)],
        ...(booking.guestCount ? ([["عدد الضيوف المتوقع", String(booking.guestCount)]] as [string, string][]) : []),
        ...(discount > 0
          ? ([
              ["مبلغ الحجز قبل الخصم", formatSAR(subtotal)],
              [`الخصم${booking.discountCode ? ` (كود ${booking.discountCode})` : ""}`, `− ${formatSAR(discount)}`],
            ] as [string, string][])
          : []),
        ["مبلغ الحجز", formatSAR(total)],
        ["مبلغ التأمين (مسترد)", formatSAR(deposit)],
        ["الإجمالي المستحق", formatSAR(total + deposit)],
        ...(booking.legacyPayment
          ? []
          : ([
              [
                "طريقة السداد",
                booking.paymentPlan === "FULL"
                  ? "كامل مبلغ الحجز مقدمًا"
                  : `عربون ${formatSAR(Number(booking.upfrontAmount))} مقدمًا، والباقي ${formatSAR(total - Number(booking.upfrontAmount))} قبل موعد الدخول بـ ${s.bookingPolicy.balanceDueHours} ساعة`,
              ],
              [
                "سداد التأمين",
                deposit === 0 ? "لا يوجد" : booking.depositTiming === "WITH_FIRST_PAYMENT" ? "مع الدفعة الأولى" : `قبل موعد الدخول بـ ${s.bookingPolicy.balanceDueHours} ساعة`,
              ],
            ] as [string, string][])),
      ],
    },
    {
      type: "prices",
      rows: (booking.priceBreakdown as unknown as QuoteLine[]).map((l) => ({
        date: formatDateAr(l.date),
        item: l.resourceName,
        price: formatSAR(l.price),
      })),
      total: formatSAR(subtotal),
    },
  ];

  const bank = s.bank;
  if (!bank.iban || !bank.bankName || !bank.accountHolder) warnings.push("بيانات الحساب البنكي غير مكتملة في الإعدادات.");
  const bankBlock: ContractBlock[] = [
    {
      type: "table",
      rows: [
        ["البنك", bank.bankName ?? "—"],
        ["اسم صاحب الحساب", bank.accountHolder ?? "—"],
        ["رقم الآيبان", bank.iban ?? "—"],
      ],
    },
  ];

  const policyLines = (s.cancellationPolicy.text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (policyLines.length === 0) warnings.push("سياسة الإلغاء غير محددة في الإعدادات.");

  const guestIdNumber = booking.guest.nationalIdEnc ? box.open(booking.guest.nationalIdEnc) : null;
  if (!guestIdNumber) warnings.push("رقم هوية/إقامة المستأجر غير مسجل في بيانات الضيف.");

  const hours = s.bookingPolicy.unpaidExpiryHours;
  const { blocks, unknown } = parseTemplate(
    s.contract.template,
    {
      reference: booking.reference,
      issueDate: formatDateAr(todayInRiyadh()),
      guestName: booking.guest.name,
      guestPhone: booking.guest.phone,
      guestIdNumber: guestIdNumber ?? "—",
      checkIn: formatTimeAr(s.stay.checkIn),
      checkOut: formatTimeAr(s.stay.checkOut),
      deposit: formatSAR(deposit),
      total: formatSAR(total),
      startDate: formatDateAr(start),
      endDate: formatDateAr(end),
      paymentDeadline: hours ? `${hours} ساعة` : "المدة التي يحددها الطرف الأول",
    },
    {
      bookingDetails: details,
      bankDetails: bankBlock,
      houseRules: [{ type: "ordered", start: 1, items: s.houseRules }],
      cancellationPolicy: policyLines.length
        ? [{ type: "ordered", start: 1, items: policyLines }]
        : [{ type: "paragraph", text: "—" }],
    },
  );
  if (unknown.length) warnings.push(`متغيرات غير معروفة في نص العقد: ${unknown.map((u) => `{{${u}}}`).join("، ")}`);

  return { reference: booking.reference, guestName: booking.guest.name, guestPhone: booking.guest.phone, blocks, warnings };
}
