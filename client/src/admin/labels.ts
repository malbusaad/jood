import type { BookingStatus, Channel, PaymentMethod } from "./types";

export const STATUS: Record<BookingStatus, { label: string; className: string }> = {
  NEW: { label: "طلب جديد", className: "bg-sky-100 text-sky-900" },
  AWAITING_PAYMENT: { label: "بانتظار الدفع", className: "bg-amber-100 text-amber-900" },
  AWAITING_VERIFICATION: { label: "بانتظار التحقق", className: "bg-orange-100 text-orange-900" },
  CONFIRMED: { label: "مؤكد", className: "bg-emerald-100 text-emerald-900" },
  CANCELLED: { label: "ملغي", className: "bg-stone-200 text-stone-700" },
  REJECTED: { label: "مرفوض", className: "bg-stone-200 text-stone-700" },
  EXPIRED: { label: "منتهي", className: "bg-stone-200 text-stone-700" },
  COMPLETED: { label: "مكتمل", className: "bg-jood-green/10 text-jood-green" },
};

/** What the owner sees on the button that moves a booking to this status. */
export const ACTION_LABEL: Record<BookingStatus, string> = {
  NEW: "إعادة إلى طلب جديد",
  AWAITING_PAYMENT: "تم التواصل — بانتظار الدفع",
  AWAITING_VERIFICATION: "أبلغ الضيف بالتحويل — بانتظار التحقق",
  CONFIRMED: "تأكيد الحجز",
  CANCELLED: "إلغاء الحجز",
  REJECTED: "رفض الطلب",
  EXPIRED: "إنهاء",
  COMPLETED: "تم — الإقامة مكتملة",
};

export const CHANNEL: Record<Channel, string> = { WEBSITE: "الموقع", GATHERN: "جاذر إن", MANUAL: "يدوي" };
export const METHOD: Record<PaymentMethod, string> = { BANK_TRANSFER: "تحويل بنكي", GATHERN: "جاذر إن", CASH: "نقدًا" };
export const PURPOSE = { BOOKING: "مبلغ الحجز", SECURITY_DEPOSIT: "التأمين" } as const;
export const PLAN = { FULL: "كامل المبلغ مقدمًا", DEPOSIT: "عربون والباقي قبل الدخول" } as const;
export const DEPOSIT_TIMING = { WITH_FIRST_PAYMENT: "مع الدفعة الأولى", BEFORE_CHECKIN: "قبل الدخول" } as const;
export const DEPOSIT_STATUS = {
  NONE: "لا يوجد تأمين",
  UNPAID: "غير مدفوع",
  PARTIAL: "مدفوع جزئيًا",
  PAID: "مدفوع",
  REFUNDED: "مُسترد",
  PARTIALLY_REFUNDED: "مُسترد جزئيًا",
} as const;
export const PAYMENT_STATUS = { PENDING: "بانتظار التحقق", ACCEPTED: "متحقق منه", REJECTED: "مرفوض" } as const;
