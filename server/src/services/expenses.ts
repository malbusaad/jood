import type { PrismaClient } from "@prisma/client";
import { fromIsoDate, toIsoDate, todayInRiyadh } from "../lib/dates.js";

export const OTHER = "أخرى";

/**
 * Automatic categories: words in the expense description → category. The first matching rule wins,
 * so more specific words come first (e.g. «فني مكيف» is maintenance, not wages). The owner can always
 * change the category by hand.
 */
export const CATEGORY_RULES: { category: string; words: string[] }[] = [
  { category: "صيانة", words: ["صيانه", "تصليح", "اصلاح", "سباك", "سباكه", "فني", "مكيف", "تكييف", "دهان", "بويه", "نجار", "لحام", "حداد", "عطل", "قطع غيار", "مضخه", "ماطور", "سخان", "بلاط", "ترميم"] },
  { category: "كهرباء ومياه", words: ["كهرباء", "فاتوره الكهرباء", "مياه", "فاتوره المياه", "وايت", "صهريج", "سقيا", "غاز"] },
  { category: "نظافة", words: ["نظافه", "تنظيف", "منظفات", "مطهر", "معطر", "مناديل", "اكياس نفايات", "غسيل", "مغسله", "شامبو", "صابون", "مكافحه حشرات", "رش"] },
  { category: "رواتب", words: ["راتب", "رواتب", "اجره", "اجور", "حارس", "عامل", "عماله", "سائق", "مكافاه", "اقامه"] },
  { category: "تسويق", words: ["اعلان", "تسويق", "سناب", "انستقرام", "تيك توك", "قوقل", "تصوير", "مصور", "مشهور"] },
  { category: "رسوم واشتراكات", words: ["رسوم", "عموله", "اشتراك", "انترنت", "نت", "واي فاي", "رخصه", "ترخيص", "بلديه", "تامين", "زكاه", "ضريبه", "جاذر"] },
  { category: "مشتريات", words: ["شراء", "مشتريات", "اثاث", "فرش", "مفارش", "كنب", "اواني", "ادوات", "مستلزمات", "ثلاجه", "شاشه", "جهاز", "العاب", "بقاله", "ماء شرب", "قهوه", "شاي"] },
];

export const EXPENSE_CATEGORIES = [...CATEGORY_RULES.map((r) => r.category), OTHER];

/** Arabic text folded for matching: letter variants, diacritics and tatweel ignored. */
export function normalizeAr(s: string) {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/** The category for a description, or «أخرى» when nothing matches. */
export function categorize(title: string): string {
  const t = ` ${normalizeAr(title)} `;
  for (const r of CATEGORY_RULES) {
    // Whole words or word starts (e.g. «الكهرباء», «للصيانه»), never inside another word.
    // Short words («نت», «رش») must be whole words, so they never match inside a longer one.
    if (r.words.some((w) => new RegExp(`(^|[\\s،,.-])(ال|لل|بال|و|ب|ل)?${w}${w.length <= 3 ? "(?=$|[\\s،,.-])" : ""}`).test(t))) return r.category;
  }
  return OTHER;
}

function addMonth(iso: string, day: number): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/**
 * «مصروف دائم»: each recurring expense is added again every month on the same day (the last day of a
 * shorter month), copying the latest entry of its series — so a changed amount carries forward, and
 * turning «دائم» off on the latest entry stops the series. Catches up missed months; never adds future ones.
 */
export async function ensureRecurringExpenses(db: PrismaClient, today = todayInRiyadh()) {
  const recurring = await db.expense.findMany({ where: { recurring: true }, orderBy: { date: "desc" } });
  // Latest entry of each series (a series is identified by its first expense).
  const latest = new Map<string, (typeof recurring)[number]>();
  for (const e of recurring) {
    const key = e.seriesId ?? e.id;
    if (!latest.has(key)) latest.set(key, e);
  }
  let added = 0;
  for (const [seriesId, e] of latest) {
    // A newer entry of the same series with «دائم» turned off means the series was stopped.
    const newer = await db.expense.findFirst({ where: { seriesId, date: { gt: e.date }, recurring: false } });
    if (newer) continue;
    // The day of the month comes from the first entry (so 31 Jan → 28 Feb → 31 Mar, not 28 forever).
    const first = seriesId === e.id ? e : await db.expense.findUnique({ where: { id: seriesId } });
    const day = Number(toIsoDate((first ?? e).date).slice(8, 10));
    let next = addMonth(toIsoDate(e.date), day);
    let prev = e;
    for (let i = 0; i < 24 && next <= today; i++) {
      // A unique series/date pair keeps two servers (or a restart) from adding the same month twice.
      const exists = await db.expense.findFirst({ where: { seriesId, date: fromIsoDate(next) } });
      if (!exists) {
        prev = await db.expense.create({
          data: { title: prev.title, category: prev.category, amount: prev.amount, date: fromIsoDate(next), notes: prev.notes, recurring: true, seriesId },
        });
        added++;
      }
      next = addMonth(next, day);
    }
    if (!e.seriesId) await db.expense.update({ where: { id: e.id }, data: { seriesId } });
  }
  return added;
}
