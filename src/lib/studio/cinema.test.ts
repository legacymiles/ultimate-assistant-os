import { describe, expect, it } from "vitest";
import {
  CINEMA_GROUPS,
  MOVES,
  cinemaContext,
  cleanMoves,
  clipsFor,
  cleanOutput,
  cleanSelection,
  groupSummary,
  isSet,
  moveById,
  moveQueryAt,
  movesIn,
  optionById,
  outputSummary,
  prettyDuration,
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
    // The move itself, not the prose around it: the spec numbers its
    // precedence order too, and that list is not a list of moves.
    expect(spec).toContain(`- ${moveById("static")!.name}:`);
    expect(spec).not.toContain(`1. ${moveById("static")!.name}`);
  });
});

// A genre that reaches only the grade produces a correctly-lit film of the
// wrong story — the failure that made these tests exist.
describe("the genre doctrine", () => {
  const GENRES = CINEMA_GROUPS.flatMap((g) => g.rails).find((r) => r.id === "genre")!.options;

  it("gives every real genre a story, not only a look", () => {
    const missing = GENRES.filter((o) => o.id !== "genre-auto" && !o.story).map((o) => o.id);
    expect(missing).toEqual([]);
  });

  it("keeps the story off every other rail", () => {
    const strays = ALL_OPTIONS.filter((o) => o.story && !o.id.startsWith("genre-")).map((o) => o.id);
    expect(strays).toEqual([]);
  });

  it("says what happens, not how it is lit", () => {
    const spec = cinemaContext({ genre: "genre-horror" }, []);
    expect(spec).toContain(optionById("genre-horror")!.story!);
    expect(spec).toContain("obligations on WHAT HAPPENS");
    // The two rules that stop a held pose and a flat film.
    expect(spec).toContain("NO SHOT IS A HELD POSE");
    expect(spec).toContain("EVERY CUT COSTS SOMETHING");
  });

  it("still carries the genre's look alongside its story", () => {
    const spec = cinemaContext({ genre: "genre-horror" }, []);
    expect(spec).toContain(optionById("genre-horror")!.prompt);
  });

  it("stays silent when the genre is left on Auto", () => {
    expect(cinemaContext({ genre: "genre-auto" }, [])).not.toContain("obligations on WHAT HAPPENS");
  });

  it("no longer asks horror to hold a beat on nothing", () => {
    // This exact clause planned a six-second frozen opening shot.
    expect(optionById("genre-horror")!.prompt).not.toContain("before anything moves");
  });
});

describe("output settings", () => {
  it("keeps only ratios and lengths the renderers accept", () => {
    expect(cleanOutput({ aspect: "16:9", duration: 10 })).toEqual({ aspect: "16:9", duration: 10 });
    // 99 is a real length now, so the out-of-range case has to be truly out.
    expect(cleanOutput({ aspect: "7:3", duration: 9999 })).toEqual({});
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

describe("length beyond one clip", () => {
  it("accepts up to five minutes now, and still rejects nonsense", () => {
    expect(cleanOutput({ duration: 300 })).toEqual({ duration: 300 });
    expect(cleanOutput({ duration: 3 })).toEqual({});
    expect(cleanOutput({ duration: 301 })).toEqual({});
  });

  it("reads minutes as minutes", () => {
    expect(prettyDuration(8)).toBe("8s");
    expect(prettyDuration(60)).toBe("1:00");
    expect(prettyDuration(90)).toBe("1:30");
    expect(prettyDuration(300)).toBe("5:00");
    expect(outputSummary({ aspect: "9:16", duration: 120 })).toBe("9:16 · 2:00");
  });

  it("is one clip at or under the engine limit, several above it", () => {
    expect(clipsFor(15)).toBe(1);
    expect(clipsFor(4)).toBe(1);
    expect(clipsFor(30)).toBeGreaterThan(1);
    expect(clipsFor(300)).toBe(30);
  });

  it("asks for a single clip when it fits in one", () => {
    const spec = cinemaContext({}, [], { duration: 10 });
    expect(spec).toContain("duration_sec: 10");
    expect(spec).toContain("one clip");
    expect(spec).not.toContain("SEQUENCE");
  });

  it("asks for a sequence when it does not, rather than a too-long clip", () => {
    const spec = cinemaContext({}, [], { duration: 300 });
    expect(spec).toContain("5:00");
    expect(spec).toContain("SEQUENCE");
    expect(spec).toContain("at most 15 seconds");
    // The thing that makes the clips usable together.
    expect(spec).toContain("cut together");
  });
});

// ---------------------------------------------------------------------------
// The deck has to reach a FILM, not only a single clip. Every setting the
// owner touched gets a field on the shot plan, and when two of them pull
// against each other the spec says which one wins the pixels.
// ---------------------------------------------------------------------------

describe("the deck reaching a shot plan", () => {
  const spec = () =>
    cinemaContext(
      { genre: "genre-horror", style: "style-folk-horror", light: "light-practical", era: "era-70s" },
      [],
    );

  it("tells the planner which board field each rail becomes", () => {
    const s = spec();
    for (const field of ["`mood`", "`look`", "`lighting`", "`grade`", "`lens`", "`camera_note`"]) {
      expect(s).toContain(field);
    }
  });

  it("puts tempo on the cutting rather than on the look", () => {
    expect(spec()).toContain("Tempo      → the CUTTING");
  });

  it("ranks tempo first, then style, genre, era, light and the camera", () => {
    const s = spec();
    const order = ["1. TEMPO", "2. STYLE", "3. GENRE", "4. ERA", "5. LIGHTING", "6. CAMERA"];
    const at = order.map((k) => s.indexOf(k));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("says era mixes rather than competing", () => {
    expect(spec()).toContain("4. ERA — mixes with nearly everything");
  });

  it("never calls the camera rails \"glass\"", () => {
    expect(spec().toLowerCase()).not.toContain("glass");
  });

  it("warns that an unspecified move renders as an ordinary one", () => {
    expect(spec()).toContain("comes back a plain zoom");
  });
});
