import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** المرافق المعتمدة من المالك (لا مسبح). */
export const initialAmenities = [
  { slug: "tent", name: "الخيمة الأرضية", capacityText: "14 شخصًا", capacityMax: 14, note: null, icon: "tent" },
  { slug: "majlis", name: "المجلس", capacityText: "12 إلى 15 شخصًا", capacityMax: 15, note: null, icon: "majlis" },
  { slug: "dining", name: "طاولة الطعام", capacityText: "8 أشخاص", capacityMax: 8, note: null, icon: "dining" },
  { slug: "outdoor-1", name: "الجلسة الخارجية الأولى", capacityText: "12 إلى 18 شخصًا", capacityMax: 18, note: null, icon: "outdoor" },
  { slug: "outdoor-2", name: "الجلسة الخارجية الثانية", capacityText: "8 أشخاص", capacityMax: 8, note: null, icon: "outdoor" },
  { slug: "kitchen", name: "المطبخ", capacityText: null, capacityMax: null, note: "متكامل", icon: "kitchen" },
  { slug: "restrooms", name: "دورات المياه", capacityText: null, capacityMax: null, note: "العدد: 2", icon: "restroom" },
  { slug: "volleyball", name: "ملعب كرة الطائرة", capacityText: null, capacityMax: null, note: "متوفر", icon: "volleyball" },
  { slug: "coffee", name: "ركن القهوة", capacityText: null, capacityMax: null, note: "متوفر", icon: "coffee" },
  { slug: "kids", name: "الألعاب الخارجية للأطفال", capacityText: null, capacityMax: null, note: "متوفرة", icon: "kids" },
  { slug: "wifi", name: "الإنترنت", capacityText: null, capacityMax: null, note: "عالي السرعة", icon: "wifi" },
];

/**
 * Inserts the approved initial data. Idempotent and non-destructive: it only creates what is
 * missing, so it never overwrites changes the owner made from the admin panel.
 * No partial-booking parts or part prices are created — the owner defines those.
 */
export async function seedInitialData(db: Db) {
  await db.amenity.createMany({
    data: initialAmenities.map((a, i) => ({ ...a, sortOrder: (i + 1) * 10 })),
    skipDuplicates: true,
  });

  let full = await db.bookingResource.findFirst({ where: { kind: "FULL" } });
  if (!full) {
    full = await db.bookingResource.create({
      data: { slug: "full", name: "الاستراحة كاملة", kind: "FULL", sortOrder: 0 },
    });
    const amenities = await db.amenity.findMany({ select: { id: true } });
    await db.resourceAmenity.createMany({
      data: amenities.map((a) => ({ resourceId: full!.id, amenityId: a.id })),
      skipDuplicates: true,
    });
    await db.pricingRule.createMany({
      data: [
        { resourceId: full.id, kind: "WEEKDAY", label: "الأحد إلى الأربعاء", daysOfWeek: [0, 1, 2, 3], price: 950 },
        { resourceId: full.id, kind: "WEEKDAY", label: "الخميس إلى السبت", daysOfWeek: [4, 5, 6], price: 1200 },
      ],
    });
  }
  return full;
}
