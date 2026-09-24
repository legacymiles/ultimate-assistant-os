import { describe, expect, it } from "vitest";
import {
  blankScore,
  cleanScore,
  coverage,
  gaps,
  placeShots,
  renderSec,
  scoreNotes,
  shotPrompt,
  sungShots,
  toStoryboard,
  type Score,
  type ScoreShot,
} from "./score";
import { beatGrid } from "./audio/grid";
import { labelSections, type AudioTimeline, type Line } from "./audio/timeline";

// ----- fixtures --------------------------------------------------------------

/** A 60-second track at 120 BPM with a solid grid, so bar lines land every 2 s. */
function timeline(over: Partial<AudioTimeline> = {}): AudioTimeline {
  const frameRate = 86;
  // A synthetic envelope with energy exactly on every half-second beat, so the
  // grid locks and the bar lines are predictable.
  const curve = new Array(Math.round(60 * frameRate)).fill(0);
  for (let t = 0; t < 60; t += 0.5) curve[Math.round(t * frameRate)] = 1;
  const grid = beatGrid({ curve, frameRate }, 120, { durationSec: 60 });
  const lines: Line[] = [
    { startSec: 8, endSec: 12, text: "I woke up thinking about you" },
    { startSec: 12, endSec: 16, text: "Now I'm driving through the city" },
    { startSec: 30, endSec: 34, text: "Trying to find somewhere to go" },
  ];
  const raw = [
    { startSec: 0, endSec: 8, energy: 0.2, level: "low" as const, bars: 4 },
    { startSec: 8, endSec: 28, energy: 0.6, level: "mid" as const, bars: 10 },
    { startSec: 28, endSec: 60, energy: 0.95, level: "peak" as const, bars: 16 },
  ];
  const labels = labelSections(raw, lines);
  return {
    name: "Test track",
    durationSec: 60,
    bpm: 120,
    bpmConfidence: 0.9,
    key: "A minor",
    keyConfidence: 0.7,
    brightness: "bright",
    percussion: "a full kit",
    dynamics: "punchy",
    density: "dense",
    analyzer: "dsp",
    grid,
    sections: raw.map((s, i) => ({
      ...s,
      id: `s${i + 1}`,
      provisional: labels[i],
      lines: lines.filter((l) => l.endSec > s.startSec && l.startSec < s.endSec),
    })),
    hits: [
      { atSec: 28, strength: 4.2, drop: true },
      { atSec: 44, strength: 3.1, drop: false },
    ],
    lines,
    lyricSource: "heard",
    ...over,
  };
}

function shot(over: Partial<ScoreShot> = {}): ScoreShot {
  return {
    id: "shot-1",
    title: "Cut 1",
    atSec: 0,
    action: "A woman walks down a wet street",
    because: "the intro's low energy",
    framing: "medium",
    move: "slow push-in",
    cameraNote: "",
    lensMm: 35,
    aperture: "f/2.0",
    location: "the street",
    beats: [],
    link: "cut",
    carry: "",
    endsOn: "her hand on the door",
    references: [],
    cast: [],
    locked: false,
    ...over,
  };
}

function score(over: Partial<Score> = {}): Score {
  return {
    ...blankScore(timeline()),
    cast: [{ id: "c1", name: "MAYA", look: "mid-20s, shaved head, silver jacket", subject: 1, turnsAt: null, turnsInto: "" }],
    places: [{ id: "p1", name: "the street", look: "wet asphalt under sodium lamps, steam from a grate" }],
    world: "one rain-soaked city block at 3am",
    wardrobe: "silver jacket, black jeans",
    lighting: "sodium orange from above, blue spill from a window",
    grade: "teal shadows, warm highlights",
    mood: "late-night longing, shot like a noir",
    look: "live action, anamorphic, photoreal",
    lens: "anamorphic prime set",
    soundscape: "rain on metal, a distant siren",
    ...over,
  };
}

// ----- placement -------------------------------------------------------------

describe("placeShots", () => {
  it("runs each shot to the next cut, and the last to the end of the song", () => {
    const s = score({
      shots: [shot({ id: "a", atSec: 0 }), shot({ id: "b", atSec: 8 }), shot({ id: "c", atSec: 50 })],
    });
    const placed = placeShots(s);
    expect(placed.map((p) => [p.startSec, p.durationSec])).toEqual([
      [0, 8],
      [8, 42],
      [50, 10],
    ]);
    expect(placed[2].endSec).toBe(60);
  });

  it("sorts by time, so a shot added out of order still lands correctly", () => {
    const s = score({ shots: [shot({ id: "b", atSec: 20 }), shot({ id: "a", atSec: 4 })] });
    expect(placeShots(s).map((p) => p.shot.id)).toEqual(["a", "b"]);
  });

  it("flags a slot the renderer cannot make", () => {
    const s = score({
      shots: [shot({ atSec: 0 }), shot({ id: "b", atSec: 2 }), shot({ id: "c", atSec: 8 })],
    });
    const placed = placeShots(s);
    // 0-2 s is under the 4 s floor; 8-60 s is over the 15 s ceiling.
    expect(placed[0].fault).toBe("short");
    expect(placed[1].fault).toBe(null);
    expect(placed[2].fault).toBe("long");
  });

  it("reads the words and the section off the timeline", () => {
    const s = score({ shots: [shot({ atSec: 8 }), shot({ id: "b", atSec: 16 })] });
    const placed = placeShots(s);
    expect(placed[0].words).toBe("I woke up thinking about you / Now I'm driving through the city");
    expect(placed[0].section?.provisional).toBe("verse");
  });

  it("survives having no timeline at all", () => {
    const s = { ...score({ shots: [shot()] }), timeline: null };
    const placed = placeShots(s);
    expect(placed).toHaveLength(1);
    expect(placed[0].words).toBe("");
    expect(placed[0].section).toBe(null);
  });
});

describe("lip sync", () => {
  it("makes a shot sing when a range covers enough of it", () => {
    const s = score({
      shots: [shot({ atSec: 0 }), shot({ id: "b", atSec: 8 }), shot({ id: "c", atSec: 16 })],
      lipsync: [{ id: "l1", startSec: 8, durationSec: 8 }],
    });
    const placed = placeShots(s);
    expect(placed.map((p) => p.sings)).toEqual([false, true, false]);
    expect(placed[1].sungSec).toBe(8);
  });

  it("ignores a range that only clips the edge of a shot", () => {
    const s = score({
      shots: [shot({ atSec: 0 }), shot({ id: "b", atSec: 10 })],
      // Half a second of overlap into a 10 s shot is not a performance.
      lipsync: [{ id: "l1", startSec: 9.5, durationSec: 0.5 }],
    });
    expect(placeShots(s).map((p) => p.sings)).toEqual([false, false]);
  });

  it("sungShots is the lip-sync board on its own, keeping the real indices", () => {
    const s = score({
      shots: [shot({ atSec: 0 }), shot({ id: "b", atSec: 8 }), shot({ id: "c", atSec: 20 })],
      lipsync: [{ id: "l1", startSec: 20, durationSec: 20 }],
    });
    const sung = sungShots(placeShots(s));
    expect(sung).toHaveLength(1);
    expect(sung[0].index).toBe(2);
  });
});

describe("gaps and coverage", () => {
  it("finds the stretch of song nothing covers", () => {
    const s = score({ shots: [shot({ atSec: 10 })] });
    expect(gaps(s)).toEqual([{ startSec: 0, endSec: 10 }]);
  });

  it("is fully covered when a shot starts at zero", () => {
    const s = score({ shots: [shot({ atSec: 0 }), shot({ id: "b", atSec: 10 })] });
    expect(gaps(s)).toEqual([]);
    expect(coverage(s)).toBe(1);
  });

  it("reports coverage as a share of the song", () => {
    expect(coverage(score({ shots: [shot({ atSec: 30 })] }))).toBeCloseTo(0.5, 2);
    expect(coverage(score({ shots: [] }))).toBe(0);
  });
});

// ----- the render window -----------------------------------------------------

describe("renderSec", () => {
  it("reports the LONGER clip the renderer really makes, not what was asked", () => {
    // 107 frames at 24 fps is the floor, and windows are 17 frames after it.
    expect(renderSec(4)).toBeCloseTo(107 / 24, 3);
    expect(renderSec(5)).toBeCloseTo(124 / 24, 3);
    expect(renderSec(5)).toBeGreaterThan(5);
  });

  it("never comes back shorter than the slot, so a clip can always be trimmed to fit", () => {
    for (let s = 4; s <= 15; s += 0.25) expect(renderSec(s)).toBeGreaterThanOrEqual(s);
  });
});

// ----- the weave -------------------------------------------------------------

describe("shotPrompt", () => {
  it("repeats the bibles verbatim into every shot", () => {
    const s = score({ shots: [shot({ atSec: 0 }), shot({ id: "b", atSec: 8 })] });
    for (const i of [0, 1]) {
      const p = shotPrompt(s, i);
      expect(p).toContain("one rain-soaked city block at 3am");
      expect(p).toContain("silver jacket, black jeans");
      expect(p).toContain("teal shadows, warm highlights");
      expect(p).toContain("anamorphic prime set");
    }
  });

  it("carries the song's own timecode and section into the shot", () => {
    const s = score({ shots: [shot({ atSec: 0 }), shot({ id: "b", atSec: 8 })] });
    expect(shotPrompt(s, 1)).toContain("0:08–1:00");
    expect(shotPrompt(s, 1)).toContain("the verse");
  });

  it("expands a location from the bible instead of repeating its name", () => {
    expect(shotPrompt(score({ shots: [shot()] }), 0)).toContain("wet asphalt under sodium lamps");
  });

  it("describes the cast rather than naming them, so a stranger renders right", () => {
    const s = score({ shots: [shot({ cast: ["MAYA"] })] });
    expect(shotPrompt(s, 0)).toContain("shaved head, silver jacket");
  });

  it("tells a non-singing shot that nobody sings in it", () => {
    const p = shotPrompt(score({ shots: [shot()] }), 0);
    expect(p).toContain("Nobody in this shot speaks or sings");
    expect(p).not.toContain("SUNG PERFORMANCE");
  });

  describe("when the shot sings", () => {
    const s = score({
      shots: [shot({ atSec: 8, action: "Maya sings in the doorway", cast: ["MAYA"] })],
      lipsync: [{ id: "l1", startSec: 8, durationSec: 52 }],
    });

    it("states the exact words as the subject of the frame", () => {
      const p = shotPrompt(s, 0);
      expect(p).toContain("SUNG PERFORMANCE");
      expect(p).toContain("I woke up thinking about you");
      expect(p).toContain("mouth shapes these words");
    });

    it("constrains the framing so the sync can be read", () => {
      const p = shotPrompt(s, 0);
      expect(p).toContain("no wider than a medium shot");
      expect(p).toContain("mouth is clearly visible");
    });

    it("demotes the visual idea to the world the performance happens in", () => {
      expect(shotPrompt(s, 0)).toContain("WORLD THIS PERFORMANCE");
    });

    it("renders singing without inventing lyrics when none were transcribed", () => {
      const silent = {
        ...s,
        timeline: timeline({ lines: null, lyricSource: "none" as const }),
      };
      const p = shotPrompt(silent, 0);
      expect(p).toContain("do not put specific lyrics in their mouth");
      expect(p).not.toContain('sings these exact words');
    });

    it("never asks the clip for music, because the real track is laid under it", () => {
      expect(shotPrompt(s, 0)).toContain("non_diegetic_music: none");
    });
  });

  it("hands back a hand-edited prompt untouched", () => {
    const s = score({ shots: [shot({ prompt: "MY OWN PROMPT" })] });
    expect(shotPrompt(s, 0)).toBe("MY OWN PROMPT");
  });

  it("says a continuous shot opens on the previous frame", () => {
    const s = score({
      shots: [shot({ atSec: 0, endsOn: "her hand on the door" }), shot({ id: "b", atSec: 8, link: "continuous" })],
    });
    expect(shotPrompt(s, 1)).toContain("SAME TAKE");
    expect(shotPrompt(s, 1)).toContain("her hand on the door");
  });
});

// ----- projection ------------------------------------------------------------

describe("toStoryboard", () => {
  const s = score({
    shots: [shot({ atSec: 0 }), shot({ id: "b", atSec: 8, link: "continuous" }), shot({ id: "c", atSec: 16 })],
  });
  const board = toStoryboard(s);

  it("bakes the woven prompt in, so the render pipeline uses the audio-aware one", () => {
    expect(board.shots[0].prompt).toBe(shotPrompt(s, 0));
    expect(board.shots[0].prompt).toContain("of the track");
  });

  it("opens the film rather than continuing from nothing", () => {
    expect(board.shots[0].link).toBe("open");
    expect(board.shots[1].link).toBe("continuous");
  });

  it("clamps a slot the renderer cannot make, so a faulty board still renders", () => {
    // 16-60 s is 44 s; the clip has to be asked for as 15.
    expect(board.shots[2].durationSec).toBe(15);
  });

  it("asks for no score, because the song is laid under the cut by the renderer", () => {
    expect(board.music).toBe("none");
  });

  it("carries the bibles onto the board", () => {
    expect(board.wardrobe).toBe("silver jacket, black jeans");
    expect(board.cast[0].name).toBe("MAYA");
  });
});

// ----- the trust boundary ----------------------------------------------------

describe("cleanScore", () => {
  const t = timeline();

  it("takes the director's JSON in snake_case and makes it safe", () => {
    const s = cleanScore(
      {
        title: "Night Drive",
        mode: "story",
        aspect_ratio: "9:16",
        palette: ["#0a0a0f", "not-a-colour", "#e8b4a0"],
        cast: [{ name: "MAYA", look: "mid-20s", subject: 2 }],
        places: [{ name: "the car", look: "cracked dashboard" }],
        shots: [
          { title: "Cut 2", at_sec: 20, action: "later", link: "continuous", ends_on: "a door" },
          { title: "Cut 1", at_sec: 4, action: "first", duration_sec: 99, references: [1, 1, 99] },
        ],
        lipsync: [{ start_sec: 20, duration_sec: 8 }],
      },
      t,
    )!;

    expect(s.name).toBe("Night Drive");
    expect(s.mode).toBe("story");
    expect(s.aspectRatio).toBe("9:16");
    expect(s.palette).toEqual(["#0a0a0f", "#e8b4a0"]);
    expect(s.places[0].name).toBe("the car");
    // Sorted by time, and the opening cut cannot continue from nothing.
    expect(s.shots.map((x) => x.atSec)).toEqual([4, 20]);
    expect(s.shots[0].link).toBe("cut");
    expect(s.shots[0].references).toEqual([1]);
    expect(s.lipsync).toHaveLength(1);
  });

  it("returns null when there is no film in it", () => {
    expect(cleanScore({ title: "Empty", shots: [] }, t)).toBe(null);
    expect(cleanScore(null, t)).toBe(null);
    expect(cleanScore({ shots: [{ id: "x" }] }, t)).toBe(null);
  });

  it("clamps a shot time to the song rather than trusting it", () => {
    const s = cleanScore({ shots: [{ title: "a", action: "a", at_sec: 9999 }] }, t)!;
    expect(s.shots[0].atSec).toBeLessThanOrEqual(60);
  });

  it("drops half a transformation, which would never happen", () => {
    const s = cleanScore(
      { shots: [{ title: "a", action: "a" }], cast: [{ name: "X", look: "y", turns_at: 3 }] },
      t,
    )!;
    expect(s.cast[0].turnsAt).toBe(null);
  });

  it("falls back to a sane mode and ratio for nonsense", () => {
    const s = cleanScore({ mode: "interpretive-dance", aspect_ratio: "7:3", shots: [{ title: "a", action: "a" }] }, t)!;
    expect(s.mode).toBe("music-video");
    expect(s.aspectRatio).toBe("16:9");
  });
});

// ----- the board's own review ------------------------------------------------

describe("scoreNotes", () => {
  it("errors on a slot outside the render window", () => {
    const s = score({ shots: [shot({ atSec: 0 }), shot({ id: "b", atSec: 2 })] });
    const notes = scoreNotes(s);
    expect(notes[0].kind).toBe("error");
    expect(notes.some((n) => /shorter than/.test(n.text))).toBe(true);
  });

  it("errors on a stretch of song with nothing over it", () => {
    const notes = scoreNotes(score({ shots: [shot({ atSec: 10 })] }));
    expect(notes.some((n) => n.kind === "error" && /renders as black/.test(n.text))).toBe(true);
  });

  it("warns when a cut misses the bar line", () => {
    const s = score({ shots: [shot({ atSec: 0 }), shot({ id: "b", atSec: 8.2 })] });
    expect(scoreNotes(s).some((n) => /off the bar line/.test(n.text))).toBe(true);
  });

  it("does not nag when a cut is on the bar line", () => {
    const s = score({ shots: [shot({ atSec: 0 }), shot({ id: "b", atSec: 8 })] });
    expect(scoreNotes(s).some((n) => /off the bar line/.test(n.text))).toBe(false);
  });

  it("warns when a singing shot has nobody in it", () => {
    const s = score({
      shots: [shot({ atSec: 0, cast: [] }), shot({ id: "b", atSec: 8, action: "an empty aerial of the city", cast: [] })],
      lipsync: [{ id: "l1", startSec: 8, durationSec: 40 }],
    });
    const notes = scoreNotes(s);
    expect(notes.some((n) => /no face to put the words in/.test(n.text))).toBe(true);
    expect(notes.some((n) => /performance wins/.test(n.text))).toBe(true);
  });

  it("warns when a long shot has no clock inside it", () => {
    const s = score({ shots: [shot({ atSec: 0, beats: [] }), shot({ id: "b", atSec: 10 })] });
    expect(scoreNotes(s).some((n) => /held pose/.test(n.text))).toBe(true);
  });

  it("says so when there are no words to sync to", () => {
    const s = { ...score({ shots: [shot({ atSec: 0 })] }), timeline: timeline({ lines: null, lyricSource: "none" }) };
    expect(scoreNotes(s).some((n) => /Paste\s+the lyrics/.test(n.text))).toBe(true);
  });

  it("is quiet about a clean board", () => {
    const s = score({
      shots: [
        shot({ atSec: 0, beats: [{ at: 2, text: "she turns" }], because: "the intro" }),
        shot({ id: "b", atSec: 8, beats: [{ at: 3, text: "the door opens" }], because: "the first line" }),
        shot({ id: "c", atSec: 20, beats: [{ at: 4, text: "headlights" }], because: "the drop at 28" }),
        shot({ id: "d", atSec: 32, beats: [{ at: 5, text: "she drives" }], because: "the chorus" }),
        shot({ id: "e", atSec: 46, beats: [{ at: 6, text: "the city goes past" }], because: "the outro" }),
      ],
    });
    expect(scoreNotes(s).filter((n) => n.kind === "error")).toEqual([]);
  });
});
