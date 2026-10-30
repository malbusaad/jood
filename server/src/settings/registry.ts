import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "الوقت بصيغة HH:mm");
const nullableUrl = z.url().max(500).nullable();
const text = (max: number) => z.string().trim().min(1).max(max);
/** Saudi/international phone in digits only, e.g. 9665XXXXXXXX */
export const phoneSchema = z
  .string()
  .transform((v) => v.replace(/[\s\-+()]/g, ""))
  .transform((v) => (v.startsWith("05") && v.length === 10 ? `966${v.slice(1)}` : v))
  .pipe(z.string().regex(/^\d{9,15}$/, "رقم الجوال غير صحيح"));

/**
 * Every site setting: its schema, its initial value, and whether it may be sent to the public site.
 * Private settings (bank details, guest portal codes, notification config, contract) are only
 * readable by admins, or by a guest through their own booking/portal endpoints.
 *
 * Initial values are those approved by the owner; anything not yet provided is null.
 */
export const settingDefinitions = {
  general: {
    public: true,
    schema: z.object({
      name: text(120),
      tagline: text(120),
      welcome: text(200),
      description: text(1000),
      location: z.object({ district: text(80), city: text(80), country: text(80) }),
    }),
    initial: {
      name: "استراحة الجود",
      tagline: "العزيزية · الخبر",
      welcome: "أهلًا بكم في استراحة الجود",
      description:
        "مساحة هادئة تجمع العائلة والأصدقاء، بجلسات داخلية وخارجية ومطبخ متكامل وملعب وألعاب للأطفال، في أجواء راقية ومريحة.",
      location: { district: "العزيزية", city: "الخبر", country: "المملكة العربية السعودية" },
    },
  },
  stay: {
    public: true,
    schema: z.object({ checkIn: hhmm, checkOut: hhmm }),
    initial: { checkIn: "14:00", checkOut: "04:00" },
  },
  houseRules: {
    public: true,
    schema: z.array(text(300)).max(50),
    initial: [
      "المحافظة على نظافة الاستراحة.",
      "تسليم الاستراحة بحالة جيدة.",
      "يتحمل المستأجر قيمة الأضرار الناتجة عن الاستخدام.",
      "عدم استخدام الاستراحة في أنشطة مخالفة للأنظمة أو الآداب العامة.",
      "عدم إزعاج الجيران.",
      "عدم استخدام مكبرات الصوت في المناطق الخارجية.",
      "عدم اصطحاب الحيوانات.",
      "منع التدخين داخل الغرف والملاحق.",
      "إبقاء الأبواب مغلقة لحماية الغرف وأجهزة التكييف من الحشرات.",
      "إطفاء الأنوار وإغلاق الأبواب عند المغادرة.",
      "المحافظة على الأجهزة والمرافق.",
      "الالتزام بتعليمات السلامة.",
    ],
  },
  faqs: {
    public: true,
    schema: z.array(z.object({ q: text(300), a: text(2000) })).max(50),
    initial: [
      { q: "ما أوقات الدخول والخروج؟", a: "الدخول الساعة 2:00 ظهرًا، والخروج الساعة 4:00 فجر اليوم التالي." },
      {
        q: "كم سعر حجز الاستراحة كاملة؟",
        a: "950 ريالًا لليوم من الأحد إلى الأربعاء، و1,200 ريال لليوم من الخميس إلى السبت. قد تختلف الأسعار في المواسم والتواريخ الخاصة، ويظهر لك السعر النهائي قبل إرسال طلب الحجز.",
      },
      {
        q: "هل يمكن حجز جزء من الاستراحة فقط؟",
        a: "نعم، يمكن حجز بعض الأجزاء بصورة مستقلة حسب الإتاحة. يحدد المالك الأجزاء القابلة للحجز المستقل وأسعارها، ويظهر المتاح منها وسعره عند الحجز.",
      },
      {
        q: "ما طرق الدفع المتاحة؟",
        a: "التحويل البنكي، أو الحجز عبر منصة جاذر إن. تظهر بيانات التحويل البنكي بعد إرسال طلب الحجز.",
      },
      {
        q: "متى يتأكد الحجز؟",
        a: "بعد إرسال الطلب يتواصل معك المالك عبر واتساب لتأكيد التفاصيل وإرسال العقد. ويتأكد الحجز بعد أن يتحقق المالك من وصول مبلغ التحويل فعليًا.",
      },
      {
        q: "هل توجد رسوم إضافية عند الحجز عبر جاذر إن؟",
        a: "قد تطبق منصة جاذر إن رسومًا إضافية على السعر الأساسي وفقًا لشروطها، وتُعرض لك على المنصة نفسها.",
      },
      { q: "هل يُسمح باصطحاب الحيوانات؟", a: "لا، لا يُسمح باصطحاب الحيوانات." },
      { q: "هل يُسمح بالتدخين؟", a: "يُمنع التدخين داخل الغرف والملاحق." },
      {
        q: "هل يمكن استخدام مكبرات الصوت؟",
        a: "لا يُسمح باستخدام مكبرات الصوت في المناطق الخارجية، حرصًا على راحة الجيران.",
      },
      {
        q: "هل يتوفر إنترنت؟",
        a: "نعم، يتوفر إنترنت عالي السرعة، وتصلك بيانات الشبكة في رابطك الخاص بعد تأكيد الحجز.",
      },
    ],
  },
  contact: {
    public: true,
    schema: z.object({
      phone: phoneSchema.nullable(),
      whatsapp: phoneSchema.nullable(),
      email: z.email().max(254).nullable(),
      mapUrl: nullableUrl,
    }),
    initial: { phone: null, whatsapp: null, email: null, mapUrl: null },
  },
  gathern: {
    public: true,
    schema: z.object({
      url: nullableUrl.refine((u) => u === null || u.startsWith("https://"), "يجب أن يبدأ الرابط بـ https://"),
      notice: text(500),
    }),
    initial: {
      url: null,
      notice:
        "يمكنك إتمام الحجز عبر منصة جاذر إن، مع العلم بأن رسوم المنصة الإضافية قد تُطبق على السعر الأساسي وفقًا لشروط المنصة.",
    },
  },
  cancellationPolicy: {
    public: true,
    schema: z.object({ text: z.string().trim().max(5000).nullable() }),
    initial: { text: null },
  },
  // ─── خاصة ───
  bank: {
    public: false,
    schema: z.object({
      bankName: z.string().trim().max(120).nullable(),
      accountHolder: z.string().trim().max(120).nullable(),
      iban: z
        .string()
        .transform((v) => v.replace(/\s/g, "").toUpperCase())
        .pipe(z.string().regex(/^SA\d{22}$/, "رقم الآيبان السعودي يتكون من SA و22 رقمًا"))
        .nullable(),
      instructions: z.string().trim().max(1000).nullable(),
    }),
    initial: { bankName: null, accountHolder: null, iban: null, instructions: null },
  },
  bookingPolicy: {
    public: false,
    schema: z.object({
      /** ساعات صلاحية الطلب غير المدفوع قبل انتهائه تلقائيًا. null = لا ينتهي تلقائيًا */
      unpaidExpiryHours: z.number().int().min(1).max(24 * 30).nullable(),
      allowProofUpload: z.boolean(),
      /** أقصى عدد أيام مقدمًا يمكن الحجز فيه */
      maxAdvanceDays: z.number().int().min(1).max(730),
      maxNights: z.number().int().min(1).max(30),
    }),
    initial: { unpaidExpiryHours: 24, allowProofUpload: true, maxAdvanceDays: 365, maxNights: 7 },
  },
  guestPortal: {
    public: false,
    schema: z.object({
      entryCode: z.string().trim().max(50).nullable(),
      wifiName: z.string().trim().max(100).nullable(),
      wifiPassword: z.string().max(100).nullable(),
      departureInstructions: z.array(text(300)).max(30),
      /** ساعات بقاء رابط الضيف صالحًا بعد وقت الخروج */
      linkGraceHours: z.number().int().min(0).max(24 * 14),
    }),
    initial: {
      entryCode: null,
      wifiName: null,
      wifiPassword: null,
      departureInstructions: [
        "إطفاء الأنوار وإغلاق الأبواب عند المغادرة.",
        "تسليم الاستراحة بحالة جيدة.",
      ],
      linkGraceHours: 12,
    },
  },
  notifications: {
    public: false,
    schema: z.object({
      ownerWhatsapp: phoneSchema.nullable(),
      whatsappEnabled: z.boolean(),
    }),
    initial: { ownerWhatsapp: null, whatsappEnabled: false },
  },
  contract: {
    public: false,
    schema: z.object({ template: z.string().max(20000).nullable() }),
    initial: { template: null },
  },
} as const;

export type SettingKey = keyof typeof settingDefinitions;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingDefinitions)[K]["schema"]>;

export const settingKeys = Object.keys(settingDefinitions) as SettingKey[];
export const publicSettingKeys = settingKeys.filter((k) => settingDefinitions[k].public);

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(settingDefinitions, key);
}

type Db = PrismaClient | Prisma.TransactionClient;

/** Reads a setting, falling back to its initial value when not stored yet. */
export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<SettingValue<K>> {
  const row = await db.siteSetting.findUnique({ where: { key } });
  const def = settingDefinitions[key];
  if (!row) return def.initial as SettingValue<K>;
  const parsed = def.schema.safeParse(row.value);
  return (parsed.success ? parsed.data : def.initial) as SettingValue<K>;
}

export async function getSettings<K extends SettingKey>(db: Db, keys: readonly K[]) {
  const rows = await db.siteSetting.findMany({ where: { key: { in: [...keys] } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    keys.map((k) => {
      const def = settingDefinitions[k];
      const parsed = byKey.has(k) ? def.schema.safeParse(byKey.get(k)) : null;
      return [k, parsed?.success ? parsed.data : def.initial];
    }),
  ) as { [P in K]: SettingValue<P> };
}
