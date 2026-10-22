import { describe, expect, it } from "vitest";

import { shortcutDateLocal } from "./shortcutDate";

const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).getTime();

describe("shortcutDateLocal — the iPhone's own date text", () => {
  it("reads the US Shortcut format with the narrow space before PM", () => {
    expect(shortcutDateLocal("Oct 21, 2026 at 11:34 PM")).toBe(local(2026, 9, 21, 23, 34));
    expect(shortcutDateLocal("October 3, 2026 at 12:05 AM")).toBe(local(2026, 9, 3, 0, 5));
  });
  it("reads day-first and numeric forms", () => {
    expect(shortcutDateLocal("21 Oct 2026 at 23:34")).toBe(local(2026, 9, 21, 23, 34));
    expect(shortcutDateLocal("10/21/2026, 11:34 PM")).toBe(local(2026, 9, 21, 23, 34));
    expect(shortcutDateLocal("21/10/2026, 23:34")).toBe(local(2026, 9, 21, 23, 34));
  });
  it("keeps ISO exact and refuses junk", () => {
    expect(shortcutDateLocal("2026-10-21T03:34:00Z")).toBe(Date.UTC(2026, 9, 21, 3, 34));
    expect(shortcutDateLocal("not a date")).toBeNaN();
    expect(shortcutDateLocal("")).toBeNaN();
  });
});
