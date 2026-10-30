import { describe, expect, it } from "vitest";
import { groupWeekdayPrices } from "./pricing";
import { formatSAR, formatTimeAr } from "./format";

describe("groupWeekdayPrices", () => {
  it("groups the approved prices into Sun–Wed and Thu–Sat", () => {
    expect(groupWeekdayPrices([950, 950, 950, 950, 1200, 1200, 1200])).toEqual([
      { label: "الأحد إلى الأربعاء", price: 950, days: [0, 1, 2, 3] },
      { label: "الخميس إلى السبت", price: 1200, days: [4, 5, 6] },
    ]);
  });

  it("follows whatever the owner sets, including single days", () => {
    expect(groupWeekdayPrices([900, 900, 900, 900, 1100, 1300, 1100]).map((g) => [g.label, g.price])).toEqual([
      ["الأحد إلى الأربعاء", 900],
      ["الخميس", 1100],
      ["الجمعة", 1300],
      ["السبت", 1100],
    ]);
  });

  it("leaves out days without an approved price", () => {
    expect(groupWeekdayPrices([null, null, null, null, 1200, 1200, null])).toEqual([
      { label: "الخميس إلى الجمعة", price: 1200, days: [4, 5] },
    ]);
    expect(groupWeekdayPrices([null, null, null, null, null, null, null])).toEqual([]);
  });
});

describe("format helpers", () => {
  it("formats SAR with thousands separator", () => {
    expect(formatSAR(1200)).toBe("1,200 ريال");
    expect(formatSAR(950)).toBe("950 ريال");
  });

  it("formats times in Arabic", () => {
    expect(formatTimeAr("14:00")).toBe("2:00 ظهرًا");
    expect(formatTimeAr("04:00")).toBe("4:00 فجرًا");
    expect(formatTimeAr("00:30")).toBe("12:30 فجرًا");
    expect(formatTimeAr("20:15")).toBe("8:15 مساءً");
  });
});
