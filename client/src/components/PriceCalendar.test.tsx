import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PriceCalendar from "./PriceCalendar";
import { mockApi } from "../test/render";

describe("PriceCalendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 10, 12)); // Tuesday 10 Nov 2026
  });
  afterEach(() => vi.useRealTimers());

  it("shows the server's price under each upcoming day, booked days, and nothing for past days", async () => {
    const fetchMock = mockApi({ booked: ["2026-11-13"] });
    render(<PriceCalendar />);
    const cell = (label: RegExp) => screen.getByRole("gridcell", { name: label });

    await screen.findAllByText("1,200");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/public/calendar?from=2026-11-01&to=2026-12-01"), expect.anything());
    expect(cell(/الأربعاء، 11 نوفمبر 2026/)).toHaveTextContent("11950");
    expect(cell(/الخميس، 12 نوفمبر 2026/)).toHaveTextContent("121,200");
    expect(cell(/الجمعة، 13 نوفمبر 2026/)).toHaveTextContent("13محجوز");
    expect(cell(/الأحد، 15 نوفمبر 2026/)).toHaveTextContent("15950");
    expect(cell(/، 9 نوفمبر 2026/).textContent).toBe("9");
  });
});
