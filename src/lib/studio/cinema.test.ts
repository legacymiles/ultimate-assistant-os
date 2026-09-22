import { describe, expect, it } from "vitest";
import {
  CINEMA_GROUPS,
  MOVES,
  cinemaContext,
  cleanMoves,
  cleanOutput,
  cleanSelection,
  groupSummary,
  isSet,
  moveById,
  moveQueryAt,
  movesIn,
  optionById,
  outputSummary,
  searchMoves,
  selectionCount,
  withMove,
  withoutMove,
} from "./cinema";

const ALL_OPTIONS = CINEMA_GROUPS.flatMap((g) => g.rails.flatMap((r) => r.options));

describe("the catalog", () => {
  it("has a unique id for every option and move", () => {
    const ids = [...ALL_OPTIONS.map((o) => o.id), ...MOVES.map((m) => m.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses ids that can be typed as tokens", () => {
    for (const id of [...ALL_OPTIONS.map((o) => o.id), ...MOVES.map((m) => m.id)]) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("gives every move real direction, not just a label", () => {
    for (const m of MOVES) expect(m.prompt.length).toBeGreaterThan(24);
  });

  it("leaves exactly the 'Auto' options without direction", () => {
    for (const o of ALL_OPTIONS) {
      if (o.prompt === "") expect(o.name).toBe("Auto");
      else expect(o.prompt.length).toBeGreaterThan(24);
    }
  });

  it("gives every palette a full swatch strip", () => {
    const palettes = CINEMA_GROUPS.find((g) => g.id === "color")!.rails[0].options;
    for (const p of palettes.filter((o) => o.prompt)) {
      expect(p.colors).toHaveLength(10);
      for (const c of p.colors!) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("the selection", () => {
  it("only keeps options that belong to the rail they were filed under", () => {
    expect(cleanSelection({ genre: "genre-horror", era: "genre-noir", nope: "x" })).toEqual({
      genre: "genre-horror",
    });
  });

  it("treats Auto as unset", () => {
    expect(isSet({ aperture: "ap-auto" }, "aperture")).toBe(false);
    expect(isSet({ aperture: "ap-f14" }, "aperture")).toBe(true);
    expect(selectionCount({ aperture: "ap-auto", genre: "genre-horror" })).toBe(1);
  });

  it("summarises a group in the order its rails are declared", () => {
    const film = CINEMA_GROUPS.find((g) => g.id === "film")!;
    expect(groupSummary(film, { era: "era-1990s", genre: "genre-horror" })).toBe("Horror, 1990s");
    expect(groupSummary(film, {})).toBe("");
  });

  it("survives junk from the client", () => {
    expect(cleanSelection(null)).toEqual({});
    expect(cleanSelection({ genre: 7 })).toEqual({});
    expect(cleanMoves(["dolly-in", "dolly-in", "nope", 4])).toEqual(["dolly-in"]);
  });
});

describe("#moves in the prompt box", () => {
  it("reads them in the order they were written, without repeats", () => {
    expect(movesIn("a #crane-up then #rack-focus and #crane-up again").map((m) => m.id)).toEqual([
      "crane-up",
      "rack-focus",
    ]);
  });

  it("ignores unknown and mid-word hashes", () => {
    expect(movesIn("#nope and email#dolly-in")).toEqual([]);
  });

  it("adds and removes without disturbing the rest of the text", () => {
    const one = withMove("a woman walks away", "crane-up");
    expect(one).toBe("a woman walks away #crane-up ");
    const two = withMove(one, "rack-focus");
    expect(movesIn(two).map((m) => m.id)).toEqual(["crane-up", "rack-focus"]);
    expect(withMove(two, "crane-up")).toBe(two);
    expect(withoutMove(two, "crane-up").trim()).toBe("a woman walks away #rack-focus");
    expect(withoutMove(two, "dolly-in")).toBe(two);
  });

  it("finds the half-typed token at the caret", () => {
    expect(moveQueryAt("go #cra", 7)).toEqual({ start: 3, query: "cra" });
    expect(moveQueryAt("go #cra", 5)).toEqual({ start: 3, query: "c" });
    expect(moveQueryAt("go #cra extra", 13)).toBeNull();
    expect(moveQueryAt("email#x", 7)).toBeNull();
  });

  it("puts name matches ahead of note matches", () => {
    expect(searchMoves("crane")[0].id).toBe("crane-up");
    expect(searchMoves("").length).toBe(MOVES.length);
    expect(searchMoves("zzzz")).toEqual([]);
  });
});

describe("what the model receives", () => {
  it("is empty when nothing was set", () => {
    expect(cinemaContext({}, [])).toBe("");
    expect(cinemaContext({ grade: "grade-auto" }, [])).toBe("");
  });

  it("carries the direction, not the label", () => {
    const spec = cinemaContext({ body: "cam-vhs" }, []);
    expect(spec).toContain(optionById("cam-vhs")!.prompt);
    expect(spec).toContain("Never paste the labels");
  });

  it("numbers several moves and keeps the owner's order", () => {
    const spec = cinemaContext({}, [moveById("rack-focus")!, moveById("crane-up")!]);
    expect(spec.indexOf("1. Rack focus")).toBeGreaterThan(-1);
    expect(spec.indexOf("1. Rack focus")).toBeLessThan(spec.indexOf("2. Crane up"));
  });

  it("does not number a single move", () => {
    const spec = cinemaContext({}, [moveById("static")!]);
    expect(spec).toContain("The camera move:");
    expect(spec).not.toContain("1. ");
  });
});

describe("output settings", () => {
  it("keeps only ratios and lengths the renderers accept", () => {
    expect(cleanOutput({ aspect: "16:9", duration: 10 })).toEqual({ aspect: "16:9", duration: 10 });
    expect(cleanOutput({ aspect: "7:3", duration: 99 })).toEqual({});
    expect(cleanOutput({ duration: "8" })).toEqual({ duration: 8 });
    expect(cleanOutput(null)).toEqual({});
  });

  it("reads back as one line", () => {
    expect(outputSummary({ aspect: "9:16", duration: 6 })).toBe("9:16 · 6s");
    expect(outputSummary({})).toBe("");
  });

  it("reaches the model as exact arguments, not as prose", () => {
    const spec = cinemaContext({}, [], { aspect: "9:16", duration: 10 });
    expect(spec).toContain('aspect_ratio: "9:16"');
    expect(spec).toContain("duration_sec: 10");
    expect(spec).toContain("Pass these to studio_generate exactly");
  });

  it("warns when a ratio only works for images", () => {
    expect(cinemaContext({}, [], { aspect: "21:9" })).toContain("images only");
    expect(cinemaContext({}, [], { aspect: "16:9" })).not.toContain("images only");
  });

  it("still says nothing when nothing at all was set", () => {
    expect(cinemaContext({}, [], {})).toBe("");
  });
});

describe("style outranks the rest", () => {
  it("prints the style first, and says so", () => {
    const spec = cinemaContext({ style: "style-papercraft", body: "cam-vhs" }, []);
    expect(spec.indexOf("THE STYLE")).toBeGreaterThan(-1);
    expect(spec.indexOf("THE STYLE")).toBeLessThan(spec.indexOf("VHS camcorder"));
    expect(spec).toContain("outranks every other line");
    expect(spec).toContain(optionById("style-papercraft")!.prompt);
  });

  it("tells the model to translate a clash rather than drop either side", () => {
    const spec = cinemaContext({ style: "style-kart-racer", lens: "lens-fisheye" }, []);
    expect(spec).toContain("translate that setting into the style");
    expect(spec).toContain("The rest, expressed in that style:");
    expect(spec).toContain(optionById("lens-fisheye")!.prompt);
  });

  it("falls back to the plain heading with no style set", () => {
    const spec = cinemaContext({ lens: "lens-fisheye" }, []);
    expect(spec).toContain("The look:");
    expect(spec).not.toContain("THE STYLE");
  });

  it("names a look the owner recognises without naming it in the prompt", () => {
    const styles = CINEMA_GROUPS.find((g) => g.id === "style")!.rails[0].options;
    expect(styles.length).toBeGreaterThan(30);
    for (const o of styles.filter((x) => x.prompt)) {
      expect(o.family).toBeTruthy();
      // The prompt is technique, never "in the style of <title>".
      expect(o.prompt.toLowerCase()).not.toContain("in the style of");
    }
  });
});
