import type { CalendarDay, SiteContent } from "../content/types";

/** Mirrors what GET /api/public/site returns right after the initial seed. */
export const siteFixture: SiteContent = {
  general: {
    name: "استراحة الجود",
    tagline: "العزيزية · الخبر",
    welcome: "أهلًا بكم في استراحة الجود",
    description: "مساحة هادئة تجمع العائلة والأصدقاء.",
    location: { district: "العزيزية", city: "الخبر", country: "المملكة العربية السعودية" },
  },
  stay: { checkIn: "14:00", checkOut: "04:00" },
  houseRules: [
    "المحافظة على نظافة الاستراحة.",
    "يتحمل المستأجر قيمة الأضرار الناتجة عن الاستخدام.",
    "عدم اصطحاب الحيوانات.",
  ],
  faqs: [
    { q: "ما أوقات الدخول والخروج؟", a: "الدخول الساعة 2:00 ظهرًا." },
    { q: "ما طرق الدفع المتاحة؟", a: "التحويل البنكي أو جاذر إن." },
  ],
  contact: { phone: null, whatsapp: null, email: null, mapUrl: null },
  gathern: {
    url: null,
    notice: "يمكنك إتمام الحجز عبر منصة جاذر إن، مع العلم بأن رسوم المنصة الإضافية قد تُطبق على السعر الأساسي وفقًا لشروط المنصة.",
  },
  cancellationPolicy: { text: null },
  amenities: [
    { id: "a1", slug: "tent", name: "الخيمة الأرضية", description: null, capacityText: "14 شخصًا", note: null, icon: "tent", available: true },
    { id: "a2", slug: "majlis", name: "المجلس", description: null, capacityText: "12 إلى 15 شخصًا", note: null, icon: "majlis", available: true },
    { id: "a3", slug: "outdoor-2", name: "الجلسة الخارجية الثانية", description: null, capacityText: "8 أشخاص", note: null, icon: "outdoor", available: false },
    { id: "a4", slug: "kitchen", name: "المطبخ", description: null, capacityText: null, note: "متكامل", icon: "kitchen", available: true },
  ],
  weekdayPrices: [950, 950, 950, 950, 1200, 1200, 1200],
  media: { logoUrl: null, heroImageUrl: null, videoUrl: null, gallery: [] },
};

/** Builds a calendar response for [from, to) using weekday prices; dates in `booked` are unavailable. */
export function calendarFixture(from: string, to: string, prices = siteFixture.weekdayPrices, booked: string[] = []) {
  const days: CalendarDay[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d < new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const price = prices[d.getUTCDay()] ?? null;
    days.push({ date, price, available: price !== null && !booked.includes(date) });
  }
  return { days };
}
