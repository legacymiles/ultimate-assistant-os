import { describe, expect, it } from "vitest";
import {
  type BlendSpec,
  ELEMENTS,
  appliesTo,
  blendBrief,
  chordsFromAbc,
  defaultBlend,
  describeBlend,
  dominanceLine,
  nameOf,
  nextVersionNumber,
  offlineMashupStyle,
  parseSongPair,
  readVersions,
  shortName,
} from "./mashup";
import { offlineDraft } from "./write";

const A = { query: "take on me", track: { id: "1", title: "Take On Me", artist: "a-ha", previewUrl: null } };
const B = { query: "blinding lights", track: { id: "2", title: "Blinding Lights", artist: "The Weeknd", previewUrl: null } };

describe("parseSongPair", () => {
  it("splits the shapes people actually type", () => {
    for (const joiner of [" and ", " with ", " x ", " vs ", " / ", " + "]) {
      const pair = parseSongPair(`Take On Me${joiner}Blinding Lights`);
      expect(pair.songA).toBe("Take On Me");
      expect(pair.songB).toBe("Blinding Lights");
    }
  });

  it("strips the instruction in front of the two titles", () => {
    expect(parseSongPair("make me a mashup of Toxic and Seven Nation Army").songA).toBe("Toxic");
    expect(parseSongPair("mash up Toxic and Seven Nation Army").songB).toBe("Seven Nation Army");
  });

  // The failure that matters: direction ending up inside a catalogue query
  // finds nothing, and the user sees "no results" for a song that exists.
  it("keeps direction out of the song names", () => {
    const pair = parseSongPair("Toxic and Seven Nation Army. make it slow and moody");
    expect(pair.songB).toBe("Seven Nation Army");
    expect(pair.rest).toContain("slow and moody");

    const clause = parseSongPair("Toxic and Seven Nation Army, but keep the rap");
    expect(clause.songB).toBe("Seven Nation Army");
    expect(clause.rest).toContain("keep the rap");
  });

  it("leaves song B empty rather than inventing a partner", () => {
    const pair = parseSongPair("Take On Me");
    expect(pair.songA).toBe("Take On Me");
    expect(pair.songB).toBe("");
  });

  it("returns nothing from nothing", () => {
    expect(parseSongPair("   ")).toEqual({ songA: "", songB: "", rest: "" });
  });
});

describe("appliesTo", () => {
  // The whole reason the layered route has greyed-out controls: a knob that
  // looks live and does nothing is worse than no knob at all.
  it("says every knob is live on the generated route", () => {
    for (const element of ELEMENTS) expect(appliesTo(element.id, "generated")).toBe(true);
  });

  // Vocal is the exception, and it has to be: on the layered route it is the
  // only way to say which record gets split for its vocal.
  it("keeps only the vocal knob live on the layered route", () => {
    expect(appliesTo("vocal", "layered")).toBe(true);
    for (const element of ELEMENTS) {
      if (element.id === "vocal") continue;
      expect(appliesTo(element.id, "layered")).toBe(false);
    }
  });

  it("gives every knob something to say on the layered route", () => {
    for (const element of ELEMENTS) {
      expect(element.layeredNote || element.layeredHint).toBeTruthy();
    }
  });
});

describe("describeBlend", () => {
  it("names a source for every element the user chose", () => {
    const spec: BlendSpec = { ...defaultBlend(), melody: "a", lyrics: "b", harmony: "a", drums: "b", vocal: "a" };
    const lines = describeBlend(spec, "Take On Me", "Blinding Lights", "generated").join("\n");
    expect(lines).toContain("Melody transcribed from Take On Me");
    expect(lines).toContain("Lyrics in the manner of Blinding Lights");
    expect(lines).toContain("Chord progression taken from Take On Me");
    expect(lines).toContain("Drums and groove in the feel of Blinding Lights");
  });

  it("describes the two extra choices as themselves, not as a side", () => {
    const spec: BlendSpec = { ...defaultBlend(), lyrics: "new", harmony: "model", tempo: "custom", bpm: 92 };
    const lines = describeBlend(spec, "A", "B", "generated").join("\n");
    expect(lines).toMatch(/written fresh/i);
    expect(lines).toMatch(/left to YuE2/i);
    expect(lines).toContain("92 BPM");
  });

  // The layered plan must not promise transcription or re-performance — that
  // route does neither, and the whole panel is built on saying so.
  it("describes the layered route as two real records, not a performance", () => {
    const lines = describeBlend(defaultBlend(), "A", "B", "layered").join("\n");
    expect(lines).toContain("Vocal lifted from A");
    expect(lines).toContain("Backing track lifted from B");
    // The knob decides which record gets split for its vocal, so the plan has
    // to follow it rather than always naming A.
    const swapped = describeBlend({ ...defaultBlend(), vocal: "b" }, "A", "B", "layered").join("\n");
    expect(swapped).toContain("Vocal lifted from B");
    expect(swapped).toContain("Backing track lifted from A");
    // It may only mention transcription to deny it.
    expect(lines).not.toMatch(/Melody transcribed|Lyrics in the manner|Chord progression taken/);
    expect(lines).toMatch(/Nothing is transcribed/);
  });

  it("never sends an empty brief", () => {
    expect(blendBrief(defaultBlend(), undefined, undefined, "generated").length).toBeGreaterThan(0);
  });
});

describe("dominanceLine", () => {
  it("leans the way the slider points, and calls the middle even", () => {
    expect(dominanceLine(0, "A", "B")).toContain("A");
    expect(dominanceLine(100, "A", "B")).toContain("B");
    expect(dominanceLine(50, "A", "B")).toMatch(/even/i);
  });

  it("clamps a value that arrived out of range", () => {
    expect(dominanceLine(-40, "A", "B")).toBe(dominanceLine(0, "A", "B"));
    expect(dominanceLine(400, "A", "B")).toBe(dominanceLine(100, "A", "B"));
  });
});

describe("nameOf", () => {
  it("prefers the catalogue's real title over what was typed", () => {
    expect(nameOf(A, "a")).toBe("Take On Me — a-ha");
    expect(nameOf({ query: "", fileName: "demo.mp3" }, "b")).toBe("demo.mp3");
    expect(nameOf(undefined, "b")).toBe("song B");
  });
});

describe("offlineMashupStyle", () => {
  it("restates the user's own choices rather than inventing a production", () => {
    const spec: BlendSpec = { ...defaultBlend(), instruments: "b", drums: "a", vocal: "a", tempo: "custom", bpm: 140 };
    const style = offlineMashupStyle(spec, A, B);
    expect(style).toContain("Blinding Lights");
    expect(style).toContain("Take On Me");
    expect(style).toContain("140 BPM");
  });
});

describe("chordsFromAbc", () => {
  it("reads the chord symbols in order, collapsing repeats", () => {
    const abc = '|"Am" A2 B2 "Am" c4 |"F" d4 "C" e4 |"G7" f4 |';
    expect(chordsFromAbc(abc)).toEqual(["Am", "F", "C", "G7"]);
  });

  it("skips ABC annotations, which are text and not chords", () => {
    expect(chordsFromAbc('|"^slowly" A4 "Dm" B4 |')).toEqual(["Dm"]);
  });

  it("reads a slash chord and refuses a stray lyric", () => {
    expect(chordsFromAbc('|"C/G" A4 "hold on" B4 |')).toEqual(["C/G"]);
  });

  it("stops at the limit rather than pasting a whole song into a style line", () => {
    const abc = Array.from({ length: 40 }, (_, i) => `"${"ABCDEFG"[i % 7]}" A4`).join(" ");
    expect(chordsFromAbc(abc, 6)).toHaveLength(6);
  });

  it("finds nothing in a melody-only score", () => {
    expect(chordsFromAbc("X:1\nK:C\n| CDEF GABc |")).toEqual([]);
  });
});

describe("versions", () => {
  const version = (n: number) => ({
    n,
    renderId: `r${n}`,
    title: "t",
    change: "",
    method: "generated" as const,
    style: "s",
    lyrics: "l",
    at: n,
  });

  it("shows the newest version first and numbers the next one past the highest", () => {
    const list = readVersions({ versions: [version(1), version(2), version(3)] });
    expect(list.map((v) => v.n)).toEqual([3, 2, 1]);
    expect(nextVersionNumber(list)).toBe(4);
  });

  it("starts at v1 on an empty session", () => {
    expect(nextVersionNumber(readVersions(undefined))).toBe(1);
    expect(nextVersionNumber(readVersions({ versions: "not a list" }))).toBe(1);
  });

  it("drops junk rather than rendering a version with no take", () => {
    expect(readVersions({ versions: [version(1), null, { n: 2 }] })).toHaveLength(1);
  });
});

describe("the mashup tasks with no AI key", () => {
  it("splits the prompt itself rather than doing nothing", () => {
    const result = offlineDraft("mashup-find", { prompt: "mash up Toxic and Seven Nation Army" });
    expect(result.songA).toBe("Toxic");
    expect(result.songB).toBe("Seven Nation Army");
    expect(String(result.title)).toContain("Toxic");
  });

  it("hands back the user's own blend plan as the style line", () => {
    const result = offlineDraft("mashup-blend", { blend: "Melody from A.\nDrums from B.", title: "Night Drive" });
    expect(result.title).toBe("Night Drive");
    expect(String(result.style)).toContain("Melody from A");
    expect(String(result.style)).toContain("Drums from B");
    expect(String(result.lyrics)).toContain("[Chorus]");
  });

  // Silently returning something slightly different is the worse outcome: the
  // user would render it and blame the change they asked for.
  it("refuses to revise anything without a model, and says so", () => {
    const result = offlineDraft("mashup-revise", { style: "synthpop, 92 BPM", lyrics: "[Verse]\nok", change: "faster" });
    expect(result.style).toBe("synthpop, 92 BPM");
    expect(result.lyrics).toBe("[Verse]\nok");
    expect(String(result.changed)).toMatch(/no AI key/i);
  });
});

describe("shortName", () => {
  // "Take On Me — a-ha's vocal" reads as nonsense; "Take On Me's vocal" does not.
  it("drops the artist so a possessive and a narrow button still read", () => {
    expect(shortName(A, "a")).toBe("Take On Me");
    expect(shortName(B, "b")).toBe("Blinding Lights");
    expect(shortName({ query: "x", fileName: "a-very-long-file-name-indeed.mp3" }, "b").length).toBeLessThanOrEqual(24);
  });
});
