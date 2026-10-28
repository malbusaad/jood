import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PriceCalendar from "./PriceCalendar";

describe("PriceCalendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 10, 12)); // Tuesday 10 Nov 2026
  });
  afterEach(() => vi.useRealTimers());

  it("shows the weekday price under each upcoming day and none for past days", () => {
    render(<PriceCalendar prices={{ sunToWed: 950, thuToSat: 1200 }} />);
    const cell = (label: RegExp) => screen.getByRole("gridcell", { name: label });

    expect(cell(/الأربعاء، 11 نوفمبر 2026/)).toHaveTextContent("11950");
    expect(cell(/الخميس، 12 نوفمبر 2026/)).toHaveTextContent("121,200");
    expect(cell(/السبت، 14 نوفمبر 2026/)).toHaveTextContent("141,200");
    expect(cell(/الأحد، 15 نوفمبر 2026/)).toHaveTextContent("15950");
    // Past day: no price.
    expect(cell(/، 9 نوفمبر 2026/).textContent).toBe("9");
  });
});
