import { describe, expect, it } from "vitest";
import { baseFullRestPrice, isThuToSat } from "./pricing";
import { formatSAR, formatTimeAr } from "./format";

const prices = { sunToWed: 950, thuToSat: 1200 };
// 2026-11-01 is a Sunday.
const day = (offset: number) => new Date(2026, 10, 1 + offset);

describe("baseFullRestPrice", () => {
  it.each([
    [0, "Sunday", 950],
    [1, "Monday", 950],
    [2, "Tuesday", 950],
    [3, "Wednesday", 950],
    [4, "Thursday", 1200],
    [5, "Friday", 1200],
    [6, "Saturday", 1200],
  ])("offset %i (%s) → %i SAR", (offset, _name, expected) => {
    expect(day(offset).getDay()).toBe(offset);
    expect(baseFullRestPrice(day(offset), prices)).toBe(expected);
  });

  it("flags Thursday–Saturday only", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((o) => isThuToSat(day(o)))).toEqual([false, false, false, false, true, true, true]);
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
