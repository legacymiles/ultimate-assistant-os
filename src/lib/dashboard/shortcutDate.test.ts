import { describe, expect, it } from "vitest";
import { parseShortcutDate } from "./shortcutDate";

describe("parseShortcutDate", () => {
  it("reads the formats an iPhone sends, in the right order", () => {
    const us = parseShortcutDate("Oct 16, 2026 at 11:03 PM");
    const us2 = parseShortcutDate("Oct 16, 2026 at 11:05 PM");
    const intl = parseShortcutDate("16 Oct 2026 at 23:07");
    const iso = parseShortcutDate("2026-10-16T23:09:00");
    for (const t of [us, us2, intl, iso]) expect(Number.isFinite(t)).toBe(true);
    expect(us).toBeLessThan(us2);
    expect(us2).toBeLessThan(intl);
    expect(intl).toBeLessThan(iso);
  });
  it("handles day-first numeric dates and rejects junk", () => {
    expect(parseShortcutDate("16/10/2026, 23:03")).toBe(Date.UTC(2026, 9, 16, 23, 3));
    expect(parseShortcutDate("not a date")).toBeNaN();
    expect(parseShortcutDate("")).toBeNaN();
  });
});
