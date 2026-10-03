import { describe, expect, it } from "vitest";
import {
  ELEMENT_STEM,
  type StemCut,
  type StemLib,
  anyStems,
  cutCount,
  emptyStemLib,
  layeredPair,
  readStemLib,
  stemById,
  stemsFor,
  withCut,
} from "./stems";
import { ELEMENTS } from "./mashup";

function cut(stemId: StemCut["stemId"], renderId = "r1"): StemCut {
  return { stemId, renderId, fileId: `f_${stemId}`, at: 1 };
}

describe("stemsFor", () => {
  it("offers all four separate stems when Demucs is installed", () => {
    const offers = stemsFor({ demucs: true });
    expect(offers.filter((o) => o.by === "demucs").map((o) => o.stem.id)).toEqual([
      "vocals",
      "drums",
      "bass",
      "other",
      "backing",
    ]);
    expect(offers.every((o) => !o.why)).toBe(true);
  });

  it("refuses a drum stem on an AuK-only server, and says why", () => {
    const offers = stemsFor({ auk: true });
    const drums = offers.find((o) => o.stem.id === "drums")!;
    expect(drums.by).toBeNull();
    expect(drums.why).toMatch(/Demucs/);
    // The two AuK really makes are still offered.
    expect(offers.filter((o) => o.by === "auk").map((o) => o.stem.id)).toEqual(["vocals", "backing"]);
  });

  it("prefers Demucs for the vocal when both are installed", () => {
    const offers = stemsFor({ auk: true, demucs: true });
    expect(offers.find((o) => o.stem.id === "vocals")!.by).toBe("demucs");
  });

  it("offers nothing with no separator, without throwing", () => {
    const offers = stemsFor({});
    expect(offers).toHaveLength(5);
    expect(offers.every((o) => o.by === null && !!o.why)).toBe(true);
    expect(anyStems({})).toBe(false);
    expect(anyStems({ auk: true })).toBe(true);
  });
});

describe("the element to stem mapping", () => {
  it("names a real stem for every element the blend panel has", () => {
    for (const element of ELEMENTS) {
      const mapped = ELEMENT_STEM[element.id];
      expect(mapped, element.id).toBeTruthy();
      expect(stemById(mapped.stem), `${element.id} -> ${mapped.stem}`).toBeTruthy();
      // The sentence is what stops "hear the melody" reading as melody isolation.
      expect(mapped.hearing.length).toBeGreaterThan(10);
    }
  });

  it("sends melody, lyrics and vocal to the voice, and tempo to the kit", () => {
    expect(ELEMENT_STEM.melody.stem).toBe("vocals");
    expect(ELEMENT_STEM.lyrics.stem).toBe("vocals");
    expect(ELEMENT_STEM.vocal.stem).toBe("vocals");
    expect(ELEMENT_STEM.tempo.stem).toBe("drums");
  });
});

describe("the stem cache", () => {
  it("keeps one cut per stem per side", () => {
    let lib = emptyStemLib();
    lib = withCut(lib, "a", cut("vocals"));
    lib = withCut(lib, "b", cut("drums"));
    lib = withCut(lib, "a", cut("vocals", "r2"));
    expect(cutCount(lib, "a")).toBe(1);
    expect(lib.a.vocals?.renderId).toBe("r2");
    expect(lib.b.drums?.renderId).toBe("r1");
  });

  it("does not mutate the library it is given", () => {
    const lib = emptyStemLib();
    const next = withCut(lib, "a", cut("bass"));
    expect(cutCount(lib, "a")).toBe(0);
    expect(cutCount(next, "a")).toBe(1);
  });

  it("reads a stored bag back, dropping anything unusable", () => {
    const lib = readStemLib({
      a: {
        vocals: { stemId: "vocals", renderId: "r1", fileId: "f1", at: 1 },
        drums: { stemId: "drums", fileId: "f2" }, // no renderId: unplayable
        kazoo: { stemId: "kazoo", renderId: "r3", fileId: "f3" }, // not a stem
      },
      b: "nonsense",
    });
    expect(Object.keys(lib.a)).toEqual(["vocals"]);
    expect(cutCount(lib, "b")).toBe(0);
  });

  it("survives a missing or wrong-shaped bag", () => {
    expect(cutCount(readStemLib(undefined), "a")).toBe(0);
    expect(cutCount(readStemLib("x"), "b")).toBe(0);
  });

  it("re-labels a cut with the key it was stored under", () => {
    // A hand-edited bag whose key and stemId disagree must follow the key, or
    // the rack would play the wrong row.
    const lib = readStemLib({ a: { drums: { stemId: "vocals", renderId: "r1", fileId: "f1", at: 1 } } });
    expect(lib.a.drums?.stemId).toBe("drums");
  });
});

describe("layeredPair", () => {
  const full: StemLib = { a: { vocals: cut("vocals") }, b: { backing: cut("backing") } };

  it("finds the vocal and the other side's backing", () => {
    expect(layeredPair(full, "a")).toEqual({ vocal: full.a.vocals, backing: full.b.backing });
  });

  it("returns nothing when the sides are the wrong way round", () => {
    expect(layeredPair(full, "b")).toBeNull();
  });

  it("returns nothing when only one side has been split", () => {
    expect(layeredPair({ a: { vocals: cut("vocals") }, b: {} }, "a")).toBeNull();
  });
});
