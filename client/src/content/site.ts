/**
 * المحتوى المعتمد للموقع العام.
 *
 * هذه القيم هي القيم الأولية التي اعتمدها المالك. في المرحلة الثالثة تنتقل إلى قاعدة البيانات
 * لتُعدَّل من لوحة الإدارة، وتصل إلى الصفحات عبر useSiteContent() دون تغيير الصفحات نفسها.
 *
 * القيم الناقصة (null) لم يزوّدها المالك بعد ولا تُخترع؛ تعرض الصفحات مكانها تنبيهًا بأنها قيد الإعداد.
 */

export type AmenityIconName =
  | "tent"
  | "majlis"
  | "dining"
  | "outdoor"
  | "kitchen"
  | "restroom"
  | "volleyball"
  | "coffee"
  | "kids"
  | "wifi";

export interface Amenity {
  id: string;
  name: string;
  /** نص السعة كما اعتمده المالك، مثل «12 إلى 15 شخصًا». null إن لم تكن سعة أشخاص. */
  capacity: string | null;
  /** وصف قصير للحالة مثل «متكامل» أو «متوفر». */
  note: string | null;
  icon: AmenityIconName;
}

export interface Faq {
  q: string;
  a: string;
}

export interface SiteContent {
  name: string;
  location: { district: string; city: string; country: string };
  tagline: string;
  welcome: string;
  description: string;
  checkIn: string; // HH:mm
  checkOut: string; // HH:mm (اليوم التالي)
  currency: "SAR";
  /** سعر حجز الاستراحة كاملة لليوم حسب أيام الأسبوع */
  fullRestPrices: { sunToWed: number; thuToSat: number };
  amenities: Amenity[];
  houseRules: string[];
  gathern: { url: string | null; notice: string };
  contact: { phone: string | null; whatsapp: string | null; email: string | null; mapUrl: string | null };
  media: { logoUrl: string | null; heroImageUrl: string | null; videoUrl: string | null; gallery: GalleryImage[] };
  faqs: Faq[];
}

export interface GalleryImage {
  url: string;
  alt: string;
  amenityId: string | null;
}

export const siteContent: SiteContent = {
  name: "استراحة الجود",
  location: { district: "العزيزية", city: "الخبر", country: "المملكة العربية السعودية" },
  tagline: "العزيزية · الخبر",
  welcome: "أهلًا بكم في استراحة الجود",
  description:
    "مساحة هادئة تجمع العائلة والأصدقاء، بجلسات داخلية وخارجية ومطبخ متكامل وملعب وألعاب للأطفال، في أجواء راقية ومريحة.",
  checkIn: "14:00",
  checkOut: "04:00",
  currency: "SAR",
  fullRestPrices: { sunToWed: 950, thuToSat: 1200 },
  amenities: [
    { id: "tent", name: "الخيمة الأرضية", capacity: "14 شخصًا", note: null, icon: "tent" },
    { id: "majlis", name: "المجلس", capacity: "12 إلى 15 شخصًا", note: null, icon: "majlis" },
    { id: "dining", name: "طاولة الطعام", capacity: "8 أشخاص", note: null, icon: "dining" },
    { id: "outdoor-1", name: "الجلسة الخارجية الأولى", capacity: "12 إلى 18 شخصًا", note: null, icon: "outdoor" },
    { id: "outdoor-2", name: "الجلسة الخارجية الثانية", capacity: "8 أشخاص", note: null, icon: "outdoor" },
    { id: "kitchen", name: "المطبخ", capacity: null, note: "متكامل", icon: "kitchen" },
    { id: "restrooms", name: "دورات المياه", capacity: null, note: "العدد: 2", icon: "restroom" },
    { id: "volleyball", name: "ملعب كرة الطائرة", capacity: null, note: "متوفر", icon: "volleyball" },
    { id: "coffee", name: "ركن القهوة", capacity: null, note: "متوفر", icon: "coffee" },
    { id: "kids", name: "الألعاب الخارجية للأطفال", capacity: null, note: "متوفرة", icon: "kids" },
    { id: "wifi", name: "الإنترنت", capacity: null, note: "عالي السرعة", icon: "wifi" },
  ],
  houseRules: [
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
  gathern: {
    url: null,
    notice:
      "يمكنك إتمام الحجز عبر منصة جاذر إن، مع العلم بأن رسوم المنصة الإضافية قد تُطبق على السعر الأساسي وفقًا لشروط المنصة.",
  },
  contact: { phone: null, whatsapp: null, email: null, mapUrl: null },
  media: { logoUrl: null, heroImageUrl: null, videoUrl: null, gallery: [] },
  faqs: [
    {
      q: "ما أوقات الدخول والخروج؟",
      a: "الدخول الساعة 2:00 ظهرًا، والخروج الساعة 4:00 فجر اليوم التالي.",
    },
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
      a: "يتأكد الحجز بعد أن يتحقق المالك من وصول مبلغ التحويل فعليًا. إرسال الطلب أو رفع إثبات التحويل وحده لا يعني تأكيد الحجز.",
    },
    {
      q: "هل توجد رسوم إضافية عند الحجز عبر جاذر إن؟",
      a: "قد تطبق منصة جاذر إن رسومًا إضافية على السعر الأساسي وفقًا لشروطها، وتُعرض لك على المنصة نفسها.",
    },
    {
      q: "هل يُسمح باصطحاب الحيوانات؟",
      a: "لا، لا يُسمح باصطحاب الحيوانات.",
    },
    {
      q: "هل يُسمح بالتدخين؟",
      a: "يُمنع التدخين داخل الغرف والملاحق.",
    },
    {
      q: "هل يمكن استخدام مكبرات الصوت؟",
      a: "لا يُسمح باستخدام مكبرات الصوت في المناطق الخارجية، حرصًا على راحة الجيران.",
    },
    {
      q: "هل يتوفر إنترنت؟",
      a: "نعم، يتوفر إنترنت عالي السرعة، وتصلك بيانات الشبكة في رابطك الخاص بعد تأكيد الحجز.",
    },
  ],
};
