/**
 * WhatsApp message texts the owner edits in the admin panel, with {variables}.
 * Business-initiated WhatsApp messages must use a template approved by Meta: the template text in
 * Meta is the same text with each variable replaced by {{1}}, {{2}}, … in order of appearance.
 */
export const WA_KINDS = ["REQUEST_RECEIVED", "BOOKING_ACCEPTED", "PAYMENT_CONFIRMED", "REMINDER", "ACCESS", "PAYMENT_PENDING", "THANK_YOU"] as const;
export type WaKind = (typeof WA_KINDS)[number];

export const WA_VARIABLES: Record<string, string> = {
  customer_name: "اسم الضيف",
  booking_reference: "رقم الحجز",
  booking_date: "تاريخ الدخول",
  booking_items: "المحجوز (الباقة)",
  booking_amount: "مبلغ الحجز",
  amount_due_now: "المطلوب الآن لتأكيد الحجز",
  remaining_amount: "المتبقي من مبلغ الحجز",
  security_deposit: "مبلغ التأمين",
  deposit_remaining: "المتبقي من التأمين",
  payment_instructions: "وسيلة الدفع وتعليماته",
  payment_status_note: "حالة السداد (جملة جاهزة)",
  balance_due_by: "آخر موعد لسداد المتبقي",
  check_in_time: "وقت الدخول",
  check_out_time: "وقت الخروج",
  door_code: "رمز الدخول (TTLock)",
  wifi_name: "اسم الواي فاي",
  wifi_password: "كلمة مرور الواي فاي",
  arrival_instructions: "تعليمات الوصول",
  location_url: "رابط الموقع على الخريطة",
};

const VAR_RE = /\{([a-z_]+)\}/g;

export function variablesIn(text: string): string[] {
  return [...text.matchAll(VAR_RE)].map((m) => m[1]!);
}

export function unknownVariables(text: string): string[] {
  return variablesIn(text).filter((v) => !Object.hasOwn(WA_VARIABLES, v));
}

/** The text to paste when creating the template in Meta: {name} → {{1}}, {{2}}, … */
export function metaTemplateText(text: string): string {
  let n = 0;
  return text.replace(VAR_RE, () => `{{${++n}}}`);
}

/** Meta refuses template values with new lines, tabs or more than 4 spaces in a row. */
export function cleanParam(v: string): string {
  return v.replace(/[\r\n\t]+/g, " — ").replace(/ {4,}/g, "   ").trim() || "—";
}

/** Fills the text; returns the readable text and the template values in order. */
export function render(text: string, vars: Record<string, string>) {
  const params: string[] = [];
  const out = text.replace(VAR_RE, (_m, name: string) => {
    const v = cleanParam(vars[name] ?? "—");
    params.push(v);
    return v;
  });
  return { text: out, params };
}

export const DEFAULT_WA_MESSAGES: Record<WaKind, { title: string; text: string; when: string }> = {
  REQUEST_RECEIVED: {
    title: "استلام طلب الحجز",
    when: "فور إرسال الضيف للطلب",
    text: "أهلًا {customer_name}، استلمنا طلب حجزك رقم {booking_reference} في استراحة الجود ليوم {booking_date}. الطلب بانتظار المراجعة والتأكيد، وسنتواصل معك قريبًا.",
  },
  BOOKING_ACCEPTED: {
    title: "قبول طلب الحجز",
    when: "عند تحويل الطلب إلى «بانتظار الدفع»",
    text: "أهلًا {customer_name}، تم قبول طلب حجزك {booking_reference} ليوم {booking_date} ({booking_items}). مبلغ الحجز {booking_amount}، والمطلوب الآن لتأكيد الحجز {amount_due_now}، ومبلغ التأمين المسترد {security_deposit}. طريقة الدفع: {payment_instructions}. أرسل لنا إيصال التحويل هنا بعد الدفع.",
  },
  PAYMENT_CONFIRMED: {
    title: "اعتماد الدفع وتأكيد الحجز",
    when: "عند تأكيد الحجز",
    text: "أهلًا {customer_name}، استلمنا دفعتك وتم تأكيد حجزك {booking_reference} ليوم {booking_date}. {payment_status_note}",
  },
  REMINDER: {
    title: "تذكير قبل الموعد",
    when: "قبل وقت الدخول بالساعات المحددة",
    text: "تذكير: موعد حجزك {booking_reference} في استراحة الجود يوم {booking_date}، الدخول الساعة {check_in_time}. {payment_status_note}",
  },
  ACCESS: {
    title: "رمز الدخول",
    when: "قبل وقت الدخول بالساعات المحددة — فقط بعد اكتمال السداد",
    text: "حياك الله {customer_name} في استراحة الجود. الدخول الساعة {check_in_time} والخروج الساعة {check_out_time}. رمز الدخول: {door_code}. الواي فاي: {wifi_name} — كلمة المرور: {wifi_password}. {arrival_instructions} الموقع: {location_url}",
  },
  PAYMENT_PENDING: {
    title: "تنبيه عدم اكتمال السداد",
    when: "بدل رسالة رمز الدخول إذا لم يكتمل السداد",
    text: "أهلًا {customer_name}، موعد حجزك {booking_reference} الساعة {check_in_time} ولم يكتمل السداد بعد: {payment_status_note} يُرسل رمز الدخول بعد اكتمال السداد والتحقق منه.",
  },
  THANK_YOU: {
    title: "الشكر بعد المغادرة",
    when: "بعد وقت الخروج بالساعات المحددة",
    text: "شكرًا لك {customer_name} على اختيار استراحة الجود، سعدنا بزيارتك. يسعدنا سماع رأيك في تجربتك.",
  },
};
