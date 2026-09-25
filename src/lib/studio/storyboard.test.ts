import { describe, expect, it } from "vitest";
import {
  blankShot,
  castOf,
  cleanStoryboard,
  boardBrief,
  boardNotes,
  oneTake,
  scoreFor,
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

// ---------------------------------------------------------------------------
// The faults that actually produced a bad cut, each pinned to a test.
// ---------------------------------------------------------------------------

describe("the genre reaches every shot", () => {
  it("weaves the mood into each prompt, ahead of the light and the grade", () => {
    const b = cleanStoryboard({ ...raw, mood: "Horror: dread built from what is out of frame." })!;
    for (let i = 0; i < b.shots.length; i += 1) {
      expect(shotPrompt(b, i)).toContain("Horror: dread built from what is out of frame");
    }
    const p = shotPrompt(b, 0);
    expect(p.indexOf("Horror:")).toBeLessThan(p.indexOf("shattered canopy gold"));
  });

  it("says so when a film has no genre at all", () => {
    expect(boardNotes(board()).some((n) => /No genre set/.test(n.text))).toBe(true);
  });
});

describe("a character who changes", () => {
  const turning = () =>
    cleanStoryboard({
      ...raw,
      cast: [{ id: "f", name: "FATHER", look: "a calm man", subject: 1, turns_at: 2, turns_into: "grey, clouded eyes" }],
      shots: [raw.shots[0], { ...raw.shots[1], link: "cut", references: [1] }],
    })!;

  it("keeps the original look before the turn", () => {
    expect(shotPrompt(turning(), 0)).toContain("a calm man");
    expect(shotPrompt(turning(), 0)).not.toContain("grey, clouded eyes");
  });

  it("describes the turn as an event in the shot it happens in", () => {
    const p = shotPrompt(turning(), 1);
    expect(p).toContain("FATHER CHANGES");
    expect(p).toContain("grey, clouded eyes");
  });

  it("loosens retention on a turned subject so the new look is not overruled", () => {
    expect(shotPrompt(turning(), 1)).toContain("partially_preserved");
    expect(shotPrompt(board(), 0)).toContain("fully_preserved");
  });

  it("drops a half-written turn rather than changing someone into nothing", () => {
    const b = cleanStoryboard({ ...raw, cast: [{ name: "FATHER", look: "a calm man", turns_at: 2 }] })!;
    expect(b.cast[0].turnsAt).toBeNull();
  });
});

describe("the camera's mechanics", () => {
  it("carries the geometry into the prompt, not just the move's name", () => {
    const b = cleanStoryboard({
      ...raw,
      shots: [{ ...raw.shots[0], move: "dolly zoom", camera_note: "dolly in 2 m while the lens goes 50mm to 25mm" }],
    })!;
    expect(shotPrompt(b, 0)).toContain("dolly in 2 m while the lens goes 50mm to 25mm");
  });

  it("flags a named trick move that arrived with no geometry", () => {
    const b = cleanStoryboard({ ...raw, shots: [{ ...raw.shots[0], move: "hitchcock dolly zoom" }] })!;
    expect(boardNotes(b).some((n) => /no camera geometry/.test(n.text))).toBe(true);
  });
});

describe("the clock inside a shot", () => {
  it("writes the beats as a timeline with spans", () => {
    const b = cleanStoryboard({
      ...raw,
      shots: [{ ...raw.shots[0], duration_sec: 6, beats: [{ at: 2, text: "he stops" }, { at: 0, text: "he wades" }] }],
    })!;
    const p = shotPrompt(b, 0);
    expect(p).toContain("0.0–2.0s: he wades");
    expect(p).toContain("2.0–6.0s: he stops");
  });

  it("flags a long shot with nothing scheduled in it", () => {
    const b = cleanStoryboard({ ...raw, shots: [{ ...raw.shots[0], duration_sec: 12 }] })!;
    expect(boardNotes(b).some((n) => /no beats/.test(n.text))).toBe(true);
  });
});

describe("where a shot is", () => {
  it("forbids re-staging on a cut that stays put", () => {
    const b = cleanStoryboard({
      ...raw,
      shots: [{ ...raw.shots[0], location: "the hallway" }, { ...raw.shots[1], link: "cut", location: "the hallway" }],
    })!;
    expect(shotPrompt(b, 1)).toContain("Do not change room, building, time of day or weather");
    expect(shotPrompt(b, 1)).toContain("The location is unchanged: the hallway");
  });

  it("states a real move instead of letting it happen by accident", () => {
    const b = cleanStoryboard({
      ...raw,
      shots: [{ ...raw.shots[0], location: "the hallway" }, { ...raw.shots[1], link: "cut", location: "the front lawn" }],
    })!;
    expect(shotPrompt(b, 1)).toContain("MOVES to a new place: the front lawn");
    expect(shotPrompt(b, 1)).not.toContain("Do not change room");
  });

  it("renders a take that travels between rooms as one journey, not a jump", () => {
    const b = cleanStoryboard({
      ...raw,
      shots: [
        { ...raw.shots[0], location: "the hallway" },
        { ...raw.shots[1], link: "continuous", location: "the front lawn" },
      ],
    })!;
    const p = shotPrompt(b, 1);
    expect(p).toContain("The take TRAVELS: it opens in the hallway and moves through into the front lawn");
    // The contradiction that a naive weave produces: telling the same shot to
    // stay put AND to move. A travelling take must never be told both.
    expect(p).not.toContain("Do not change location");
    const note = boardNotes(b).find((n) => /One take travelling/.test(n.text));
    expect(note?.severity).toBe("info");
  });

  it("still pins a continuous shot that stays put", () => {
    const b = cleanStoryboard({
      ...raw,
      shots: [
        { ...raw.shots[0], location: "the hallway" },
        { ...raw.shots[1], link: "continuous", location: "the hallway" },
      ],
    })!;
    expect(shotPrompt(b, 1)).toContain("Do not change location");
  });
});

describe("a film that is really a pile of clips", () => {
  it("counts the cold joins and says what they cost", () => {
    const b = cleanStoryboard({
      ...raw,
      shots: [0, 1, 2, 3, 4].map((i) => ({ title: `Cut ${i + 1}`, action: "something", link: "cut" })),
    })!;
    const note = boardNotes(b).find((n) => /hard cuts/.test(n.text));
    expect(note?.text).toContain("4 of 4 joins are hard cuts");
  });

  it("stays quiet about a film that is mostly one take", () => {
    const b = cleanStoryboard({
      ...raw,
      shots: [0, 1, 2, 3, 4].map((i) => ({ title: `Cut ${i + 1}`, action: "something", link: "continuous" })),
    })!;
    expect(boardNotes(b).some((n) => /hard cuts/.test(n.text))).toBe(false);
  });
});

describe("a continued shot still knows who is in it", () => {
  // A continued shot is handed real frames of the people and gets no reference
  // photos, which is right — but it used to carry the world, the wardrobe and
  // the action while never once saying WHO was on screen. Over a run of them
  // the faces had nothing holding them.
  it("names the cast and carries their description, with no photo attached", () => {
    const b = cleanStoryboard(raw)!;
    expect(h3Form(b, 1)).toBe("fl2va");
    const p = shotPrompt(b, 1);
    expect(p).toContain("FATHER");
    expect(p).toContain("shaved head");
  });

  it("describes someone who has already transformed as they are now, not as their photo", () => {
    const b = cleanStoryboard({
      ...raw,
      cast: [{ ...raw.cast[0], turns_at: 1, turns_into: "hollow-eyed, grey-skinned, jaw slack" }],
      shots: [raw.shots[0], { ...raw.shots[1], link: "continuous", references: [1] }],
    })!;
    const p = shotPrompt(b, 1);
    expect(p).toContain("hollow-eyed");
    expect(p).not.toContain("wet shoulders");
  });

  it("falls back to the whole cast when a continued shot names nobody", () => {
    const b = cleanStoryboard({
      ...raw,
      shots: [raw.shots[0], { ...raw.shots[1], link: "continuous", references: [] }],
    })!;
    expect(shotPrompt(b, 1)).toContain("FATHER");
  });

  it("does not describe the cast twice on the reference path", () => {
    const b = cleanStoryboard(raw)!;
    expect(h3Form(b, 0)).toBe("ref2va");
    const p = shotPrompt(b, 0);
    // subject_definitions already describes everyone at length there; a second
    // pass would only crowd out the shot itself.
    expect(p.match(/The people in this shot are the same people/g)).toBeNull();
  });
});

describe("the score across cuts", () => {
  const withMusic = (links: ("open" | "continuous" | "cut")[]) =>
    cleanStoryboard({
      ...raw,
      music: "Low sustained cello, no percussion until the turn.",
      shots: links.map((link, i) => ({ ...raw.shots[0], id: `s${i}`, link })),
    } as unknown as Record<string, unknown>)!;

  it("keeps the score when the whole film is one take", () => {
    const board = withMusic(["open", "continuous", "continuous"]);
    expect(oneTake(board)).toBe(true);
    expect(scoreFor(board)).toMatch(/cello/);
    expect(shotPrompt(board, 1)).toMatch(/non_diegetic_music: Low sustained cello/);
  });

  // Each shot would otherwise generate its own performance of the description,
  // so the film would change music at every join.
  it("drops the score from the shots as soon as there is a hard cut", () => {
    const board = withMusic(["open", "cut", "continuous"]);
    expect(oneTake(board)).toBe(false);
    expect(scoreFor(board)).toBe("none");
    expect(shotPrompt(board, 0)).toMatch(/non_diegetic_music: none/);
  });

  it("says so on the sheet rather than dropping it silently", () => {
    const notes = boardNotes(withMusic(["open", "cut"]));
    expect(notes.some((n) => n.text.includes("under the finished cut"))).toBe(true);
    // ...and stays quiet when there was never a score to drop.
    expect(boardNotes(withMusic(["open", "continuous"])).some((n) => n.text.includes("under the finished cut"))).toBe(false);
  });

  it("leaves a deliberate none alone", () => {
    const board = cleanStoryboard({ ...raw, music: "none" } as unknown as Record<string, unknown>)!;
    expect(scoreFor(board)).toBe("none");
    expect(boardNotes(board).some((n) => n.text.includes("under the finished cut"))).toBe(false);
  });
});

describe("framing survives the trust boundary", () => {
  // A compensated move states its framing at both ends; cutting that in half
  // takes the effect out of the prompt without saying so.
  it("keeps a two-ended framing whole", () => {
    const framing =
      "medium close-up at the start and medium close-up at the end — his size in frame does not change, and that is the entire effect";
    const b = cleanStoryboard({
      ...raw,
      shots: [{ ...raw.shots[0], framing }],
    } as unknown as Record<string, unknown>)!;
    expect(b.shots[0].framing).toBe(framing);
    expect(shotPrompt(b, 0)).toContain("that is the entire effect");
  });

  it("still clamps something absurd", () => {
    const b = cleanStoryboard({
      ...raw,
      shots: [{ ...raw.shots[0], framing: "x".repeat(900) }],
    } as unknown as Record<string, unknown>)!;
    expect(b.shots[0].framing.length).toBe(220);
  });
});
