import { describe, expect, it } from "vitest";
import { addDays, addMonths, dayOfWeek, diffDays, lastDayOfMonth, monthEndSafe, startOfWeek, todayKey } from "./dates";

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });
  it("crosses a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("goes backwards", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("handles a leap year", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("addMonths", () => {
  it("keeps the day when the target month is long enough", () => {
    expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
  });
  // The trap: naive date maths turns 31 Jan + 1 month into 3 March.
  it("clamps to the last day of a short month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("clamps to 29 February in a leap year", () => {
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
  it("crosses a year", () => {
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("lastDayOfMonth", () => {
  it("knows February in a common year", () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
  });
  it("knows February in a leap year", () => {
    expect(lastDayOfMonth(2028, 2)).toBe(29);
  });
  it("knows a 30-day month", () => {
    expect(lastDayOfMonth(2026, 4)).toBe(30);
  });
});

describe("monthEndSafe", () => {
  // A bill due "on the 31st" must fall on the last day of a short month.
  it("clamps day 31 in February", () => {
    expect(monthEndSafe(2026, 2, 31)).toBe("2026-02-28");
  });
  it("leaves a valid day alone", () => {
    expect(monthEndSafe(2026, 2, 12)).toBe("2026-02-12");
  });
});

describe("diffDays", () => {
  it("counts forward", () => {
    expect(diffDays("2026-09-01", "2026-09-30")).toBe(29);
  });
  it("counts backward as negative", () => {
    expect(diffDays("2026-09-30", "2026-09-01")).toBe(-29);
  });
  // Across a DST boundary, a naive millisecond division gives 30.958… and
  // floors to 30. These are calendar days, so the answer is 31.
  it("is immune to DST", () => {
    expect(diffDays("2026-10-01", "2026-11-01")).toBe(31);
  });
});

describe("dayOfWeek", () => {
  it("reports Sunday as 0", () => {
    expect(dayOfWeek("2026-09-27")).toBe(0);
  });
  it("reports Wednesday as 3", () => {
    expect(dayOfWeek("2026-09-30")).toBe(3);
  });
});

describe("startOfWeek", () => {
  it("walks back to Monday when the week starts on Monday", () => {
    expect(startOfWeek("2026-09-30", 1)).toBe("2026-09-28");
  });
  it("returns the day itself when it is already the start", () => {
    expect(startOfWeek("2026-09-28", 1)).toBe("2026-09-28");
  });
  it("walks back to Sunday when the week starts on Sunday", () => {
    expect(startOfWeek("2026-09-30", 0)).toBe("2026-09-27");
  });
});

describe("todayKey", () => {
  it("formats a local date, not a UTC one", () => {
    // 23:30 local on the 30th is still the 30th, which a toISOString would
    // report as the 1st for anyone east of UTC.
    expect(todayKey(new Date(2026, 8, 30, 23, 30))).toBe("2026-09-30");
  });
});
