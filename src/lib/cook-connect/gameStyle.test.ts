import { describe, it, expect } from "vitest";
import {
  activeTheme, cleanStyleDoc, defaultStyleDoc, duplicateTheme, inRange, monthDay, resetTheme,
  scheduledFor, PRESETS,
} from "./gameStyle";

const day = (m: number, d: number) => new Date(2026, m - 1, d, 12);

describe("which theme the table wears", () => {
  it("uses the holiday on its dates, Classic the rest of the year", () => {
    const doc = defaultStyleDoc();
    expect(activeTheme(doc, day(10, 31)).id).toBe("halloween");
    expect(activeTheme(doc, day(12, 25)).id).toBe("christmas");
    expect(activeTheme(doc, day(3, 3)).id).toBe("classic");
  });

  it("handles a range that wraps past New Year", () => {
    expect(inRange("12-31", "12-30", "01-02")).toBe(true);
    expect(inRange("01-01", "12-30", "01-02")).toBe(true);
    expect(inRange("01-03", "12-30", "01-02")).toBe(false);
    expect(activeTheme(defaultStyleDoc(), day(1, 1)).id).toBe("new-year");
  });

  it("ignores the schedule when it is switched off", () => {
    const doc = { ...defaultStyleDoc(), scheduleOn: false, activeId: "valentines" };
    expect(scheduledFor(doc, day(10, 31))).toBeNull();
    expect(activeTheme(doc, day(10, 31)).id).toBe("valentines");
  });

  it("formats month-day with leading zeros", () => {
    expect(monthDay(day(7, 4))).toBe("07-04");
  });
});

describe("a stored doc is repaired, never trusted", () => {
  it("falls back to the defaults for junk", () => {
    expect(cleanStyleDoc(null).themes).toHaveLength(PRESETS.length);
    expect(cleanStyleDoc({ themes: "nope" }).activeId).toBe("classic");
  });

  it("keeps good edits and repairs bad colours and kinds", () => {
    const doc = defaultStyleDoc();
    const t = doc.themes[0] as unknown as Record<string, unknown>;
    (t.suits as Record<string, Record<string, unknown>>).H = { attack: "Big Love", kind: "laser", color: "red" };
    (t.set as Record<string, unknown>).text = "GOT SET";
    const clean = cleanStyleDoc(JSON.parse(JSON.stringify(doc)));
    expect(clean.themes[0].suits.H.attack).toBe("Big Love");
    expect(clean.themes[0].suits.H.kind).toBe("fire");
    expect(clean.themes[0].suits.H.color).toBe("#fb7185");
    expect(clean.themes[0].set.text).toBe("GOT SET");
  });

  it("drops duplicate theme ids and bad schedule dates", () => {
    const doc = defaultStyleDoc();
    const clean = cleanStyleDoc({
      ...doc,
      themes: [...doc.themes, doc.themes[0]],
      schedule: [{ themeId: "classic", from: "13-01", to: "01-01" }],
    });
    expect(clean.themes).toHaveLength(PRESETS.length);
    expect(clean.schedule).toHaveLength(0);
  });
});

describe("editing themes", () => {
  it("duplicates under a fresh id and resets a preset", () => {
    let doc = duplicateTheme(defaultStyleDoc(), "christmas", "Office party");
    const copy = doc.themes.at(-1)!;
    expect(copy.id).toBe("christmas-2");
    expect(copy.name).toBe("Office party");
    doc = { ...doc, themes: doc.themes.map((t) => (t.id === "christmas" ? { ...t, name: "X" } : t)) };
    expect(resetTheme(doc, "christmas").themes.find((t) => t.id === "christmas")!.name).toBe("Christmas");
  });
});

describe("renig call words", () => {
  it("every theme has words for a right call and a wrong one, and none mention a trick penalty", () => {
    for (const t of PRESETS) {
      expect(t.renege.text.length).toBeGreaterThan(0);
      expect(t.renege.wrong).toMatch(/WRONG CALL/);
      expect(`${t.renege.text} ${t.renege.wrong}`).not.toMatch(/trick/i);
    }
  });

  it("repairs a stored theme with no wrong-call words, and keeps custom ones", () => {
    const doc = defaultStyleDoc();
    const old = { ...doc.themes[0], renege: { on: true, text: "GOTCHA" } };
    expect(cleanStyleDoc({ ...doc, themes: [old] }).themes[0].renege).toEqual({ on: true, text: "GOTCHA", wrong: "WRONG CALL!" });
    const custom = { ...doc.themes[0], renege: { on: true, text: "GOTCHA", wrong: "NOPE" } };
    expect(cleanStyleDoc({ ...doc, themes: [custom] }).themes[0].renege.wrong).toBe("NOPE");
  });
});
