import { Prisma, type PricingRule, type PrismaClient } from "@prisma/client";
import { dayOfWeek, fromIsoDate } from "../lib/dates.js";

type Db = PrismaClient | Prisma.TransactionClient;

const KIND_RANK = { SPECIAL: 3, SEASON: 2, WEEKDAY: 1 } as const;

function ruleApplies(rule: PricingRule, date: string): boolean {
  if (!rule.active) return false;
  if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(dayOfWeek(date))) return false;
  if (rule.kind !== "WEEKDAY") {
    const d = fromIsoDate(date);
    if (!rule.startDate || !rule.endDate || d < rule.startDate || d > rule.endDate) return false;
  }
  return true;
}

/**
 * Picks the price rule for one resource on one date:
 * SPECIAL beats SEASON beats WEEKDAY; then higher priority; then the most recently created.
 * Returns null when no rule applies — the resource then has no approved price that day.
 */
export function resolveRule(rules: PricingRule[], date: string): PricingRule | null {
  let best: PricingRule | null = null;
  for (const rule of rules) {
    if (!ruleApplies(rule, date)) continue;
    if (
      !best ||
      KIND_RANK[rule.kind] > KIND_RANK[best.kind] ||
      (KIND_RANK[rule.kind] === KIND_RANK[best.kind] &&
        (rule.priority > best.priority ||
          (rule.priority === best.priority && rule.createdAt > best.createdAt)))
    ) {
      best = rule;
    }
  }
  return best;
}

export interface QuoteLine {
  date: string;
  resourceId: string;
  resourceName: string;
  price: string; // decimal string, e.g. "950.00"
  ruleKind: PricingRule["kind"];
  ruleLabel: string | null;
}

export interface Quote {
  lines: QuoteLine[];
  total: string;
  /** Resource/date combinations with no approved price (not bookable). */
  missing: { date: string; resourceId: string; resourceName: string }[];
}

export async function quote(db: Db, resourceIds: string[], dates: string[]): Promise<Quote> {
  const resources = await db.bookingResource.findMany({
    where: { id: { in: resourceIds } },
    include: { pricingRules: { where: { active: true } } },
    orderBy: { sortOrder: "asc" },
  });

  const lines: QuoteLine[] = [];
  const missing: Quote["missing"] = [];
  let total = new Prisma.Decimal(0);

  for (const date of dates) {
    for (const r of resources) {
      const rule = resolveRule(r.pricingRules, date);
      if (!rule) {
        missing.push({ date, resourceId: r.id, resourceName: r.name });
        continue;
      }
      total = total.add(rule.price);
      lines.push({
        date,
        resourceId: r.id,
        resourceName: r.name,
        price: rule.price.toFixed(2),
        ruleKind: rule.kind,
        ruleLabel: rule.label,
      });
    }
  }
  return { lines, total: total.toFixed(2), missing };
}
