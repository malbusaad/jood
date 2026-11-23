import type { BookingDetail } from "./types";
import { formatDateAr } from "../lib/format";
import { money, nightsBetween } from "./ui";

/** Opens WhatsApp on the guest's chat; without a number, WhatsApp asks which chat to use. */
export function waLink(phone: string | null, text?: string) {
  return `https://wa.me/${(phone ?? "").replace(/\D/g, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Ready-made WhatsApp messages for each step of the owner's flow. */
export function waMessages(b: BookingDetail) {
  const name = b.guest.name.split(" ")[0];
  const what = [...new Map(b.items.map((i) => [i.resource.id, i.resource.name])).values()].join("، ");
  const days = nightsBetween(b.startDate, b.endDate);
  const when = `${formatDateAr(b.startDate)}${days > 1 ? ` (${days} أيام)` : ""}`;
  const amounts = `مبلغ الحجز ${money(b.totalAmount)}${Number(b.depositAmount) > 0 ? ` + تأمين ${money(b.depositAmount)} يُسترد بعد المغادرة` : ""}`;
  const total = Number(b.totalAmount);
  // The deposit asked for: the agreed one if set, otherwise half the booking amount.
  const deposit = b.payment?.plan === "DEPOSIT" ? Number(b.payment.upfrontAmount) : Math.round(total / 2);
  const ps = b.payment;
  const bookingLeft = Number(ps?.bookingRemaining ?? total - Number(b.paid));
  const depositLeft = Number(ps?.depositRemaining ?? 0);
  const leftParts = [
    bookingLeft > 0 ? `المتبقي من مبلغ الحجز ${money(bookingLeft)}` : null,
    depositLeft > 0 ? `التأمين ${money(depositLeft)} (يُسترد بعد المغادرة)` : null,
  ].filter(Boolean);
  return [
    {
      key: "deposit",
      label: "المطالبة بدفع العربون",
      text: `مرحبًا ${name}، معك استراحة الجود بخصوص طلب الحجز رقم ${b.reference}.\n${what} — ${when}.\n${amounts}.\nلتأكيد الحجز نرجو تحويل العربون ${money(deposit)} وإرسال صورة الإيصال هنا، ويتأكد الحجز مباشرة بعد وصوله.`,
    },
    {
      key: "contract",
      label: "إرسال العقد",
      text: `مرحبًا ${name}، وصلنا العربون لحجزك رقم ${b.reference} — ${when}، شكرًا لك.\nأرفقت لك عقد الحجز للاطلاع والاحتفاظ به.`,
    },
    {
      key: "balance",
      label: "المطالبة بالمتبقي والتأمين",
      text: `مرحبًا ${name}، نذكّرك بسداد ${leftParts.join(" و")}${leftParts.length > 1 ? `، بإجمالي ${money(bookingLeft + depositLeft)}` : ""} لحجزك رقم ${b.reference} قبل موعد الدخول، وإرسال صورة الإيصال هنا. بعد وصوله يصلك رابط الدخول والتعليمات.`,
    },
  ];
}

/** Message carrying the guest's private portal link. */
export function waPortalMessage(b: BookingDetail, url: string) {
  const name = b.guest.name.split(" ")[0];
  return `أهلًا ${name}، حياك الله في استراحة الجود.\nرقم حجزك ${b.reference}.\nهذا رابطك الخاص، وفيه تفاصيل الحجز والتعليمات، ويظهر فيه رمز الدخول والواي فاي يوم وصولك:\n${url}\nالرابط خاص بك، فلا تشاركه مع غيرك.`;
}
