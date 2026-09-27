import { describe, expect, it } from "vitest";
import { DEFAULT_SKILLS } from "./engine";
import { HOUSE, SKINS, SKIN_ORDER, skinFor, skinVars } from "./skins";

// ---------------------------------------------------------------------------
// A skin that looks wrong is a judgement call. A skin nobody can READ is a
// bug — and the light skins are exactly where an ink step tuned on black
// quietly stops working. These check the two things a human eye misses at
// 3am: that every skill in the dropdown has a skin, and that the text on it
// clears WCAG against its own surface.
// ---------------------------------------------------------------------------

function lum(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** What `color-mix(in srgb, ink X%, transparent)` actually paints over void. */
function over(ink: string, alpha: number, voidHex: string): string {
  const f = parseInt(ink.replace("#", ""), 16);
  const b = parseInt(voidHex.replace("#", ""), 16);
  const mix = (sh: number) => {
    const a = (f >> sh) & 255;
    const c = (b >> sh) & 255;
    return Math.round(a * alpha + c * (1 - alpha));
  };
  return `#${[16, 8, 0].map((sh) => mix(sh).toString(16).padStart(2, "0")).join("")}`;
}

const ALL = [HOUSE, ...Object.values(SKINS)];

describe("skins", () => {
  it("covers every design skill the dropdown can show", () => {
    const missing = DEFAULT_SKILLS.map((s) => s.name).filter((n) => !(n in SKINS));
    expect(missing).toEqual([]);
    expect(SKIN_ORDER.length).toBe(DEFAULT_SKILLS.length);
  });

  it("falls back to the house skin for anything unknown", () => {
    expect(skinFor(null).id).toBe("house");
    expect(skinFor("not-a-skill").id).toBe("house");
    expect(skinFor("brutalist-skill").id).toBe("brutalist-skill");
  });

  it("keeps every step of the ink ladder readable on its own surface", () => {
    for (const skin of ALL) {
      const v = skinVars(skin) as Record<string, string>;
      const step = (key: string) => parseFloat(v[key]) / 100;
      expect(contrast(skin.ink, skin.void), `${skin.id} ink`).toBeGreaterThanOrEqual(4.5);
      // --ink-2 carries the lede and most secondary copy.
      expect(
        contrast(over(skin.ink, step("--a2"), skin.void), skin.void),
        `${skin.id} ink-2`,
      ).toBeGreaterThanOrEqual(4.5);
      // --ink-3 and --ink-4 carry micro-labels and hints. This is the step a
      // light skin silently loses: 42% ink reads on black and smudges on paper.
      expect(
        contrast(over(skin.ink, step("--a3"), skin.void), skin.void),
        `${skin.id} ink-3`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(over(skin.ink, step("--a4"), skin.void), skin.void),
        `${skin.id} ink-4`,
      ).toBeGreaterThanOrEqual(3.5);
    }
  });

  it("keeps the accent readable — it labels live state, not decoration", () => {
    for (const skin of ALL) {
      expect(contrast(skin.sig, skin.void), `${skin.id} sig`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives each skin its own look, not a recolour of one template", () => {
    const fingerprints = new Set(
      ALL.map((s) => [s.void, s.sig, s.display, s.radius, s.field].join("|")),
    );
    expect(fingerprints.size).toBe(ALL.length);
  });

  it("emits the tokens the stylesheet reads", () => {
    const vars = skinVars(SKINS["brutalist-skill"]) as Record<string, string>;
    expect(vars["--void"]).toBe("#e7e4dc");
    expect(vars["--bw"]).toBe("2px");
    expect(vars["--radius"]).toBe("0px");
    expect(vars["--display"]).toBe("var(--f-black)");
    // A skin must never leave a control with a radius bigger than the control.
    for (const skin of ALL) {
      const v = skinVars(skin) as Record<string, string>;
      expect(parseFloat(v["--radius-sm"])).toBeLessThanOrEqual(6);
    }
  });
});
