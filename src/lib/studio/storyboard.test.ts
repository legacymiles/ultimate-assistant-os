import { describe, expect, it } from "vitest";
import {
  blankShot,
  castOf,
  cleanStoryboard,
  boardBrief,
  etaSeconds,
  filmProgress,
  fitRuntime,
  formatEta,
  framesFor,
  h3Form,
  normalise,
  parseRuntime,
  runtimeRange,
  runtimeSec,
  shotPrompt,
  timecode,
  type Storyboard,
} from "./storyboard";

const raw = {
  title: "What the jungle keeps",
  logline: "A father carries his baby out of the rainforest.",
  world: "Dripping equatorial rainforest floor, buttress roots, wet black mud.",
  look: "live action, anamorphic 2.39",
  aspect_ratio: "16:9",
  lens: "ANAMORPHIC PRIME SET",
  lighting: "shattered canopy gold",
  grade: "deep canopy green, wet-bark contrast",
  palette: ["#0d1a12", "#c79a4a", "#2b3a2a", "nonsense"],
  wardrobe: "FATHER in a soaked olive tank top; BABY in a white hooded wrap",
  soundscape: "insect wall, dripping leaves, sucking mud",
  music: "one low bowed cello note",
  cast: [{ id: "f", name: "FATHER", look: "black man, early thirties, shaved head, wet shoulders", subject: 1 }],
  shots: [
    {
      id: "a",
      title: "Cut 1",
      duration_sec: 5,
      lens_mm: 24,
      move: "handheld track",
      framing: "wide",
      action: "FATHER wades through knee-deep water.",
      ends_on: "his back, half-lit",
      link: "cut",
      references: [1],
    },
    {
      id: "b",
      title: "Cut 2",
      duration_sec: 6,
      lens_mm: 85,
      move: "slow push-in",
      framing: "close-up",
      action: "BABY opens her eyes.",
      link: "continuous",
      carry: "the same mud on his shoulder",
      dialogue: "FATHER: almost there",
    },
    { title: "", action: "" },
  ],
};

const board = () => cleanStoryboard(raw)!;

describe("cleanStoryboard", () => {
  it("keeps the film and drops the blank row", () => {
    const b = board();
    expect(b.shots).toHaveLength(2);
    expect(b.title).toBe("What the jungle keeps");
    expect(b.palette).toEqual(["#0d1a12", "#c79a4a", "#2b3a2a"]);
    expect(b.cast[0].subject).toBe(1);
  });

  it("forces the first shot to be an opening, whatever the model said", () => {
    expect(board().shots[0].link).toBe("open");
  });

  it("clamps a shot to the window H3 can actually render", () => {
    expect(cleanStoryboard({ shots: [{ action: "x", duration_sec: 40 }] })!.shots[0].durationSec).toBe(15);
    expect(cleanStoryboard({ shots: [{ action: "x", duration_sec: 1 }] })!.shots[0].durationSec).toBe(4);
  });

  it("throws out a reference number no upload can have", () => {
    const b = cleanStoryboard({ shots: [{ action: "x", references: [1, 1, 99, -3, 2] }] })!;
    expect(b.shots[0].references).toEqual([1, 2]);
  });

  it("is null when there is no film in it", () => {
    expect(cleanStoryboard({ title: "Nothing" })).toBeNull();
    expect(cleanStoryboard(null)).toBeNull();
  });
});

describe("which H3 renders the shot", () => {
  it("sends a shot with references to Ref2VA, which is what holds the face", () => {
    expect(h3Form(board(), 0)).toBe("ref2va");
  });

  it("sends a continuous shot to FL2VA, because the chained frame IS the person", () => {
    expect(h3Form(board(), 1)).toBe("fl2va");
  });

  it("sends a referenceless cut to FL2VA text-only", () => {
    const b = cleanStoryboard({ shots: [{ action: "an empty road" }] })!;
    expect(h3Form(b, 0)).toBe("fl2va");
  });
});

describe("shotPrompt", () => {
  it("repeats the film's fixed facts verbatim in every shot", () => {
    const b = board();
    for (const [i] of b.shots.entries()) {
      const p = shotPrompt(b, i);
      expect(p).toContain("FATHER in a soaked olive tank top");
      expect(p).toContain("ANAMORPHIC PRIME SET");
      expect(p).toContain("shattered canopy gold");
      expect(p).toContain("deep canopy green");
      expect(p).toContain("overall_soundscape: insect wall");
      expect(p).toContain("non_diegetic_music: one low bowed cello note");
    }
  });

  it("writes a referenced shot in Ref2VA's sections, naming who must be preserved", () => {
    const p = shotPrompt(board(), 0);
    expect(p).toContain("subject_definitions:");
    expect(p).toContain("retention_analysis:");
    expect(p).toContain("detailed_description:");
    expect(p).toContain("<Subject 1> is FATHER, the person in <Picture 1>");
    expect(p).toContain("fully_preserved");
  });

  it("writes a chained shot in FL2VA's one section", () => {
    const p = shotPrompt(board(), 1);
    expect(p).toContain("integrated_multimodal_description:");
    expect(p).not.toContain("subject_definitions:");
  });

  it("tells a continuous shot it may not cut, and names the frame it opens on", () => {
    const p = shotPrompt(board(), 1);
    expect(p).toContain("CONTINUES that take with no cut");
    expect(p).toContain("his back, half-lit");
    expect(p).toContain("the same mud on his shoulder");
  });

  it("tells a matched cut that only the camera moved", () => {
    const b = board();
    const cut = { ...b, shots: [b.shots[0], { ...b.shots[1], link: "cut" as const, references: [1] }] };
    const p = shotPrompt(cut, 1);
    expect(p).toContain("MATCHED CUT");
    expect(p).not.toContain("CONTINUES that take");
  });

  it("says the opening shot is the one everything else matches", () => {
    expect(shotPrompt(board(), 0)).toContain("opening shot of the film");
  });

  it("writes dialogue the way H3 reads it", () => {
    expect(shotPrompt(board(), 1)).toContain("<d>[English] almost there</d>");
  });

  it("forbids the artefacts that betray a stitched film", () => {
    expect(shotPrompt(board(), 0)).toContain("no split screen");
  });

  it("hands back an owner-edited prompt untouched", () => {
    const b = board();
    const edited = { ...b, shots: [{ ...b.shots[0], prompt: "MY WORDS ONLY" }, b.shots[1]] };
    expect(shotPrompt(edited, 0)).toBe("MY WORDS ONLY");
  });

  it("knows which cast a shot actually attaches", () => {
    expect(castOf(board(), 0).map((c) => c.name)).toEqual(["FATHER"]);
    expect(castOf(board(), 1)).toEqual([]);
  });
});

describe("timing", () => {
  it("rounds to H3's latent windows", () => {
    expect(framesFor(5)).toBe(124);
    expect(framesFor(4)).toBe(107);
    expect(framesFor(15)).toBe(362);
  });

  it("adds the runtime up", () => {
    expect(runtimeSec(board())).toBe(11);
    expect(timecode(75)).toBe("1:15");
  });

  it("counts down as shots finish", () => {
    const b = board();
    const start = etaSeconds(b);
    const half = etaSeconds(b, undefined, { doneShots: 1 });
    expect(half).toBeLessThan(start);
    expect(etaSeconds(b, undefined, { doneShots: 2 })).toBeLessThan(half);
  });

  it("never lets the clock on the running shot claim the shot is done", () => {
    const b = board();
    expect(filmProgress(b, { doneShots: 0, elapsedOnCurrentSec: 100000 })).toBeLessThan(
      filmProgress(b, { doneShots: 1 }),
    );
  });

  it("is a real fraction across the film, weighted by frames", () => {
    const b = board();
    expect(filmProgress(b)).toBe(0);
    expect(filmProgress(b, { doneShots: 2 })).toBe(1);
    // Cut 1 is 124 frames of 124 + 158.
    expect(filmProgress(b, { doneShots: 1 })).toBeCloseTo(124 / 282, 3);
  });

  it("writes a wait the owner can plan around", () => {
    expect(formatEta(0)).toBe("any moment now");
    expect(formatEta(20)).toBe("20 s left");
    expect(formatEta(380)).toBe("6 min 20 s left");
    expect(formatEta(4000)).toBe("1 h 6 min left");
  });
});

describe("editing", () => {
  it("adds a shot that already matches the film", () => {
    const next = blankShot(board(), 2);
    expect(next.lensMm).toBe(85);
    expect(next.link).toBe("cut");
  });

  it("renumbers auto-named cuts and never leaves an orphan opening", () => {
    const b = board() as Storyboard;
    const reordered = normalise({ ...b, shots: [b.shots[1], b.shots[0]] });
    expect(reordered.shots[0].link).toBe("open");
    expect(reordered.shots.map((s) => s.title)).toEqual(["Cut 1", "Cut 2"]);
  });
});

describe("parseRuntime", () => {
  it("reads the ways a runtime gets typed", () => {
    expect(parseRuntime("45")).toBe(45);
    expect(parseRuntime("0:45")).toBe(45);
    expect(parseRuntime("1:30")).toBe(90);
    expect(parseRuntime("90s")).toBe(90);
    expect(parseRuntime("1m30s")).toBe(90);
    expect(parseRuntime("2 min")).toBe(120);
    expect(parseRuntime(" 60 ")).toBe(60);
  });

  it("refuses what is not a time, so a half-typed field does nothing", () => {
    expect(parseRuntime("")).toBeNull();
    expect(parseRuntime("1:")).toBeNull();
    expect(parseRuntime("1:75")).toBeNull();
    expect(parseRuntime("soon")).toBeNull();
    expect(parseRuntime("m")).toBeNull();
  });
});

describe("runtimeRange", () => {
  it("is what H3's 4-15 s window allows across that many cuts", () => {
    expect(runtimeRange(1)).toEqual({ min: 4, max: 15 });
    expect(runtimeRange(12)).toEqual({ min: 48, max: 180 });
    expect(runtimeRange(0)).toEqual({ min: 0, max: 0 });
  });
});

describe("fitRuntime", () => {
  it("hits the target exactly", () => {
    const { min, max } = runtimeRange(board().shots.length);
    for (let target = min; target <= max; target += 1) {
      expect(runtimeSec(fitRuntime(board(), target))).toBe(target);
    }
  });

  it("clamps to what these cuts can hold rather than inventing shots", () => {
    const b = board();
    const { min, max } = runtimeRange(b.shots.length);
    expect(runtimeSec(fitRuntime(b, 1))).toBe(min);
    expect(runtimeSec(fitRuntime(b, 10_000))).toBe(max);
  });

  it("keeps every shot inside H3's window", () => {
    const { min, max } = runtimeRange(board().shots.length);
    for (let target = min; target <= max; target += 1) {
      for (const shot of fitRuntime(board(), target).shots) {
        expect(shot.durationSec).toBeGreaterThanOrEqual(4);
        expect(shot.durationSec).toBeLessThanOrEqual(15);
      }
    }
  });

  it("keeps the long shot the long one", () => {
    const b = board();
    b.shots[0].durationSec = 4;
    b.shots[b.shots.length - 1].durationSec = 15;
    const fitted = fitRuntime(b, runtimeSec(b) + 6);
    expect(fitted.shots[fitted.shots.length - 1].durationSec).toBeGreaterThanOrEqual(
      fitted.shots[0].durationSec,
    );
  });

  it("changes nothing else about the sheet", () => {
    const b = board();
    const fitted = fitRuntime(b, 30);
    expect(fitted.title).toBe(b.title);
    expect(fitted.shots.map((s) => s.action)).toEqual(b.shots.map((s) => s.action));
    expect(fitted.shots.map((s) => s.link)).toEqual(b.shots.map((s) => s.link));
  });
});

describe("boardBrief", () => {
  it("carries the film-wide fields a re-plan must not lose", () => {
    const text = boardBrief(board());
    const b = board();
    expect(text).toContain(b.title);
    expect(text).toContain(b.wardrobe);
    expect(text).toContain(b.grade);
    expect(text).toContain(b.shots[0].action);
    expect(text).toContain(`${runtimeSec(b)} s total`);
  });
});
