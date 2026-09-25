import { describe, expect, it } from "vitest";
import { blocked, preflight, summary, type Finding } from "./preflight";
import { cleanStoryboard, type Shot, type Storyboard } from "./storyboard";

/** A plan that passes cleanly, so each test can break exactly one thing. */
function board(over: Partial<Storyboard> = {}): Storyboard {
  const clean = cleanStoryboard({
    title: "The clearing",
    logline: "A man finds a door in the woods and does not walk away.",
    world: "Dense pine plantation at dusk, needle floor, no birdsong.",
    look: "live action, anamorphic 2.39",
    mood: "Slow-burn folk horror: long holds, the frame too wide for comfort.",
    aspect_ratio: "16:9",
    lens: "ANAMORPHIC PRIME SET",
    lighting: "failing blue daylight, no fill",
    grade: "desaturated green, crushed blacks",
    wardrobe: "olive work coat, mud to the knee",
    palette: ["#12170f", "#3c4a34", "#8b8674", "#d6cfc0"],
    soundscape: "Wind in high branches, no birds, boots on needle floor.",
    music: "none",
    cast: [{ id: "c1", name: "WALKER", look: "late 30s, lean, dark beard", subject: null }],
    shots: [shot({ id: "s1", link: "open" }), shot({ id: "s2", link: "cut" })],
    ...over,
  } as unknown as Record<string, unknown>);
  // cleanStoryboard returns null only for a board with no shots, which the
  // fixture always has; rawBoard() is the way to build one without shots.
  if (!clean) throw new Error("fixture did not survive cleanStoryboard");
  return clean;
}

function shot(over: Partial<Shot> = {}): Shot {
  return {
    id: `s${Math.random().toString(36).slice(2, 7)}`,
    title: "Cut 1",
    durationSec: 5,
    lensMm: 35,
    aperture: "f/2.8",
    move: "static",
    cameraNote: "",
    framing: "wide",
    location: "the clearing",
    action: "The walker stops and turns toward the treeline.",
    beats: [{ at: 0, text: "he stops" }],
    dialogue: "",
    link: "cut",
    carry: "the mud on his coat",
    endsOn: "his face half-turned, treeline behind",
    references: [],
    ...over,
  };
}

/**
 * A board that has NOT been through cleanStoryboard.
 *
 * cleanStoryboard is the first line of defence and it already clamps durations
 * into the window, defaults `music` to "none" and rejects a board with no shots
 * outright (it returns null). The gate still checks those, because a board can
 * reach it from a hand-edit, an older saved conversation or a direct API call —
 * so those checks are exercised here, on the raw shape.
 */
function rawBoard(over: Partial<Storyboard> = {}): Storyboard {
  return { ...board(), ...over } as Storyboard;
}

const has = (f: Finding[], needle: string) => f.some((x) => x.what.includes(needle));
const at = (f: Finding[], where: string) => f.filter((x) => x.where === where);

describe("preflight", () => {
  it("passes a complete plan", () => {
    const findings = preflight(board());
    expect(findings).toEqual([]);
    expect(blocked(findings)).toBe(false);
    expect(summary(findings)).toBe("Pre-flight clear.");
  });

  it("blocks a plan with no shots", () => {
    const findings = preflight(rawBoard({ shots: [] }));
    expect(blocked(findings)).toBe(true);
    expect(findings).toHaveLength(1);
  });

  // The single largest defect measured on real films: a shot describing a
  // situation that already exists renders as a still photograph.
  it("flags a held pose and passes a shot that changes state", () => {
    const held = preflight(board({ shots: [shot({ action: "A man is in a clearing at dusk." })] }));
    expect(has(held, "Held pose")).toBe(true);
    expect(blocked(held)).toBe(true);

    const moving = preflight(board({ shots: [shot({ action: "He drops the lamp and runs." })] }));
    expect(has(moving, "Held pose")).toBe(false);
  });

  it("flags shots outside the model's window", () => {
    // Raw: cleanStoryboard would have clamped these back into 4–15.
    expect(has(preflight(rawBoard({ shots: [shot({ durationSec: 2 })] })), "outside the")).toBe(true);
    expect(has(preflight(rawBoard({ shots: [shot({ durationSec: 30 })] })), "outside the")).toBe(true);
    expect(has(preflight(board({ shots: [shot({ durationSec: 15 })] })), "outside the")).toBe(false);
  });

  it("warns when a long shot has no clock", () => {
    const findings = preflight(board({ shots: [shot({ durationSec: 12, beats: [] })] }));
    expect(has(findings, "beat(s)")).toBe(true);
    expect(blocked(findings)).toBe(false);
  });

  // A continued shot takes no references, so a long run has nothing holding
  // identity. Two is the measured limit.
  it("blocks a chain longer than two, and allows exactly two", () => {
    const three = preflight(board({
      shots: [
        shot({ link: "open" }),
        shot({ link: "continuous" }),
        shot({ link: "continuous" }),
        shot({ link: "continuous" }),
      ],
    }));
    expect(has(three, "Chain of 3")).toBe(true);
    expect(blocked(three)).toBe(true);

    const two = preflight(board({
      shots: [shot({ link: "open" }), shot({ link: "continuous" }), shot({ link: "continuous" })],
    }));
    expect(has(two, "Chain of")).toBe(false);
  });

  it("resets the chain after a cut", () => {
    const findings = preflight(board({
      shots: [
        shot({ link: "open" }),
        shot({ link: "continuous" }),
        shot({ link: "continuous" }),
        shot({ link: "cut" }),
        shot({ link: "continuous" }),
        shot({ link: "continuous" }),
      ],
    }));
    expect(has(findings, "Chain of")).toBe(false);
  });

  // The fix that mattered most: an invented cast is a first-class film. It
  // cannot be told to keep a face it was never given.
  it("does not demand references for a cast with no uploads", () => {
    const findings = preflight(board({
      cast: [{ id: "c1", name: "WALKER", look: "late 30s, lean", subject: null }],
      shots: [shot({ link: "open", references: [] }), shot({ link: "cut", references: [] })],
    } as unknown as Partial<Storyboard>));
    expect(has(findings, "starts cold")).toBe(false);
    expect(blocked(findings)).toBe(false);
  });

  it("demands references on a cut once the cast has uploads", () => {
    const findings = preflight(board({
      cast: [{ id: "c1", name: "WALKER", look: "late 30s, lean", subject: 1 }],
      shots: [shot({ link: "open", references: [1] }), shot({ link: "cut", references: [] })],
    } as unknown as Partial<Storyboard>));
    expect(at(findings, "shot 2").some((f) => f.what.includes("no references"))).toBe(true);
    expect(blocked(findings)).toBe(true);
  });

  it("warns when a continued shot also carries references", () => {
    const findings = preflight(board({
      cast: [{ id: "c1", name: "WALKER", look: "lean", subject: 1 }],
      shots: [shot({ link: "open", references: [1] }), shot({ link: "continuous", references: [1] })],
    } as unknown as Partial<Storyboard>));
    expect(has(findings, "continued shot carrying references")).toBe(true);
  });

  // A word cut off at the source stays cut off — it is a length problem.
  it("blocks a line too long for its shot and allows one that fits", () => {
    const long = preflight(board({
      shots: [shot({ durationSec: 4, dialogue: "WALKER: " + "word ".repeat(30) })],
    }));
    expect(has(long, "words in 4s")).toBe(true);
    expect(blocked(long)).toBe(true);

    const fits = preflight(board({ shots: [shot({ durationSec: 8, dialogue: "WALKER: don't open it." })] }));
    expect(has(fits, "words in")).toBe(false);
  });

  it("does not count the speaker's name as spoken words", () => {
    const findings = preflight(board({
      shots: [shot({ durationSec: 4, dialogue: "A VERY LONG CHARACTER NAME INDEED: go." })],
    }));
    expect(has(findings, "words in")).toBe(false);
  });

  // The render makes its own audio. Empty means the model chose.
  it("blocks empty sound fields but accepts a deliberate none", () => {
    expect(has(preflight(board({ soundscape: "" })), "No soundscape")).toBe(true);
    // cleanStoryboard already defaults music to "none"; the gate still checks,
    // for a board that reached it another way.
    expect(has(preflight(rawBoard({ music: "" })), "No music decided")).toBe(true);
    expect(has(preflight(board({ music: "none" })), "No music decided")).toBe(false);
  });

  it("errors on a missing genre and only warns on the other film-wide fields", () => {
    const noMood = preflight(board({ mood: "" }));
    expect(noMood.some((f) => f.what.includes("No genre") && f.severity === "error")).toBe(true);

    const noGrade = preflight(board({ grade: "" }));
    expect(noGrade.some((f) => f.what.includes("No grade") && f.severity === "warn")).toBe(true);
    expect(blocked(noGrade)).toBe(false);
  });

  it("warns when a trick move has no mechanics", () => {
    expect(has(preflight(board({ shots: [shot({ move: "dolly zoom", cameraNote: "" })] })), "no mechanics")).toBe(true);
    expect(
      has(preflight(board({ shots: [shot({ move: "dolly zoom", cameraNote: "track back 2m, 24→85mm" })] })), "no mechanics"),
    ).toBe(false);
  });

  it("warns about a missing end frame except on the last shot", () => {
    const findings = preflight(board({ shots: [shot({ endsOn: "" }), shot({ endsOn: "" })] }));
    expect(at(findings, "shot 1").some((f) => f.what.includes("No end frame"))).toBe(true);
    expect(at(findings, "shot 2").some((f) => f.what.includes("No end frame"))).toBe(false);
  });

  it("warns when almost nothing is carried forward", () => {
    const findings = preflight(board({
      shots: [shot({ carry: "" }), shot({ carry: "" }), shot({ carry: "" }), shot({ carry: "" })],
    }));
    expect(has(findings, "carry anything forward")).toBe(true);
  });

  it("sorts errors before warnings and summarises them", () => {
    const findings = preflight(board({ grade: "", shots: [shot({ action: "A man stands there." })] }));
    expect(findings[0].severity).toBe("error");
    expect(summary(findings)).toMatch(/problem/);
  });
});

// The defect that ruined the first two films: a prompt-only cast had no
// picture holding it, so every separately-generated shot re-imagined the face.
describe("anchoring an invented cast", () => {
  const nine = (over: Record<string, unknown>) =>
    board({
      cast: [{ id: "c1", name: "WALKER", look: "late 30s, lean, dark beard", subject: null, ...over }],
      shots: Array.from({ length: 9 }, (_, i) => shot({ link: i === 0 ? "open" : "cut" })),
    } as unknown as Partial<Storyboard>);

  it("blocks a long film whose invented cast has no sheet", () => {
    const findings = preflight(nine({}));
    expect(has(findings, "holding WALKER's face")).toBe(true);
    expect(blocked(findings)).toBe(true);
  });

  it("clears once the sheet is drawn", () => {
    const findings = preflight(nine({ sheet: "data:image/jpeg;base64,AAAA" }));
    expect(has(findings, "holding WALKER's face")).toBe(false);
  });

  it("leaves an uploaded face alone — it is already anchored", () => {
    const findings = preflight(
      board({
        cast: [{ id: "c1", name: "WALKER", look: "lean", subject: 1 }],
        shots: Array.from({ length: 9 }, (_, i) => shot({ link: i === 0 ? "open" : "cut", references: [1] })),
      } as unknown as Partial<Storyboard>),
    );
    expect(has(findings, "holding WALKER's face")).toBe(false);
  });

  // A two-shot film is not where identity drifts, and demanding a drawn sheet
  // for one would be a gate that cries wolf.
  it("does not ask for a sheet on a short film", () => {
    const findings = preflight(
      board({ cast: [{ id: "c1", name: "WALKER", look: "lean", subject: null }], shots: [shot(), shot()] } as unknown as Partial<Storyboard>),
    );
    expect(has(findings, "holding WALKER's face")).toBe(false);
  });
});
