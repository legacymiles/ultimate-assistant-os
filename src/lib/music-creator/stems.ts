// ---------------------------------------------------------------------------
// Stems — what can be lifted off a record on its own, and what it costs.
//
// The whole value of this file is that it refuses to promise a stem the server
// cannot actually produce. Two separators sit behind the same job endpoint and
// they are not equivalent:
//
//   DEMUCS (htdemucs) splits a recording four ways — vocals, drums, bass and
//   everything else. These are genuinely separate files, so "play B's drums"
//   means B's drums and nothing else.
//
//   AuK splits two ways: the voice, and everything that is not the voice. On an
//   AuK-only server there is no such thing as a drum stem. The honest answer is
//   to offer the two stems it really makes and say why the others are missing —
//   not to hand back a backing track with "drums" written on it.
//
// `stemsFor()` is where that decision lives, and it reads the server's own
// /health rather than guessing. Everything else here is naming and bookkeeping:
// which stem carries which blend element (a melody is not a stem — it is the
// line the vocal sings, and saying so is the difference between a label and a
// lie), and the per-side cache that stops a comparison costing GPU twice.
// ---------------------------------------------------------------------------

import type { ElementId, Side } from "./mashup";

/** A separated file the server can produce. */
export type StemId = "vocals" | "drums" | "bass" | "other" | "backing";

/** Which separator a stem needs. */
export type Separator = "demucs" | "auk";

export interface StemDef {
  id: StemId;
  /** What the rack calls it. */
  label: string;
  /** The `mode` the server's /jobs/separate is asked for. */
  mode: string;
  /** What is actually in the file. */
  what: string;
  /** Separators that can make it, best first. */
  from: Separator[];
  /** Three letters for the plate. */
  tag: string;
}

/**
 * The five stems, in the order the rack shows them.
 *
 * `backing` is last on purpose: it is the coarse one, and on a four-stem server
 * it is the sum of the three above it rather than a thing of its own. It stays
 * because the layered mashup is built from it, and because it is the only
 * instrumental an AuK-only server can make.
 */
export const STEMS: StemDef[] = [
  {
    id: "vocals",
    label: "Vocal",
    mode: "vocals",
    what: "The voice alone — the words, the melody as sung, the ad-libs. Nothing else.",
    from: ["demucs", "auk"],
    tag: "VOX",
  },
  {
    id: "drums",
    label: "Drums",
    mode: "drums",
    what: "The kit on its own: kick, snare, hats, percussion. This is where the groove and the tempo live.",
    from: ["demucs"],
    tag: "DRM",
  },
  {
    id: "bass",
    label: "Bass",
    mode: "bass",
    what: "The bass line alone — the root of every chord, and half of what makes a record feel like itself.",
    from: ["demucs"],
    tag: "BAS",
  },
  {
    id: "other",
    label: "Instruments",
    mode: "other",
    what: "Everything that is not voice, drums or bass: keys, guitars, synths, strings, pads. The chords are in here.",
    from: ["demucs"],
    tag: "INS",
  },
  {
    id: "backing",
    label: "Full backing",
    mode: "music",
    what: "The whole record with the voice removed — an instrumental to sing over.",
    from: ["demucs", "auk"],
    tag: "BCK",
  },
];

export function stemById(id: string): StemDef | undefined {
  return STEMS.find((s) => s.id === id);
}

/** Just enough of `/health` to decide what can be split. Keeps this file pure. */
export interface SeparatorState {
  demucs?: boolean;
  auk?: boolean;
}

export interface StemOffer {
  stem: StemDef;
  /** The separator that will actually run, or null when none can. */
  by: Separator | null;
  /** Why it cannot be made, when it cannot. Written to be read by the user. */
  why?: string;
}

/**
 * What this server can really hand back, stem by stem.
 *
 * Called with both engines absent too — the rack is then shown with every row
 * disabled and its reason, which is more use than an empty panel, because the
 * reason says what to install.
 */
export function stemsFor(state: SeparatorState): StemOffer[] {
  return STEMS.map((stem) => {
    const by = stem.from.find((sep) => state[sep]) ?? null;
    if (by) return { stem, by };
    const demucsOnly = stem.from.length === 1 && stem.from[0] === "demucs";
    return {
      stem,
      by: null,
      why: demucsOnly
        ? "Needs Demucs on the GPU server — it is the only separator here that splits a record four ways. AuK can " +
          "lift the voice out and leave the backing, but it cannot pull a kit out of a mix."
        : "Needs Demucs or AuK on the GPU server. Neither is installed on the one this hub points at.",
    };
  });
}

/** True when at least one stem can be made. */
export function anyStems(state: SeparatorState): boolean {
  return stemsFor(state).some((o) => o.by);
}

// ----- which stem answers which blend element -------------------------------

/**
 * The blend panel talks about melody, chords and tempo. None of those is a
 * file. Each one is carried BY a stem, and the mapping is stated rather than
 * implied, so "hear the melody" cannot be mistaken for melody isolation.
 */
export const ELEMENT_STEM: Record<ElementId, { stem: StemId; hearing: string }> = {
  melody: {
    stem: "vocals",
    hearing:
      "the vocal, because the melody is the line it sings — nothing isolates a tune away from the voice carrying it",
  },
  lyrics: { stem: "vocals", hearing: "the vocal, which is where the words are" },
  harmony: {
    stem: "other",
    hearing: "the keys, guitars and synths, which is where the chords are played (the bass holds their roots)",
  },
  drums: { stem: "drums", hearing: "the kit on its own" },
  instruments: { stem: "other", hearing: "everything that is not voice, drums or bass" },
  vocal: { stem: "vocals", hearing: "the voice alone" },
  tempo: { stem: "drums", hearing: "the kit, because the tempo is whatever the kit is doing" },
};

// ----- the per-side cache ---------------------------------------------------

/**
 * One separation that has already been paid for.
 *
 * `renderId` matters more than `fileId`: a take is copied into the account's
 * library as soon as it lands, so playing by render means a stem keeps playing
 * after the GPU pod goes to sleep. The file id is kept beside it because the
 * layered mix is a server-side operation and wants the server's own handle.
 */
export interface StemCut {
  stemId: StemId;
  renderId: string;
  fileId: string;
  /** Which separator made it, as the server reported. */
  by?: string;
  /** True when it came off a 30-second catalogue preview rather than a whole file. */
  preview?: boolean;
  at: number;
}

/** Every stem split so far, per side. */
export type StemLib = Record<Side, Partial<Record<StemId, StemCut>>>;

export function emptyStemLib(): StemLib {
  return { a: {}, b: {} };
}

/**
 * Read the cache back out of the project bag.
 *
 * Tolerant on purpose: this is the one structure in the tool that survives a
 * reload, so a half-written or hand-edited bag must degrade to "nothing split
 * yet" rather than throwing inside a render.
 */
export function readStemLib(value: unknown): StemLib {
  const lib = emptyStemLib();
  if (!value || typeof value !== "object") return lib;
  for (const side of ["a", "b"] as Side[]) {
    const raw = (value as Record<string, unknown>)[side];
    if (!raw || typeof raw !== "object") continue;
    for (const [key, cut] of Object.entries(raw as Record<string, unknown>)) {
      if (!cut || typeof cut !== "object") continue;
      const c = cut as StemCut;
      if (!stemById(key) || typeof c.renderId !== "string" || !c.renderId) continue;
      lib[side][key as StemId] = { ...c, stemId: key as StemId };
    }
  }
  return lib;
}

export function withCut(lib: StemLib, side: Side, cut: StemCut): StemLib {
  return { ...lib, [side]: { ...lib[side], [cut.stemId]: cut } } as StemLib;
}

export function findCut(lib: StemLib, side: Side, stemId: StemId): StemCut | undefined {
  return lib[side]?.[stemId];
}

/** How many of this side's stems are already on the server. */
export function cutCount(lib: StemLib, side: Side): number {
  return Object.keys(lib[side] ?? {}).length;
}

/**
 * The two files a layered mashup is made of, if they have already been split.
 *
 * The layered route is a vocal over a backing track, and both of those are
 * ordinary rack stems — so a mashup built after a comparison costs no GPU at
 * all. Returns nothing when either side is missing; the caller splits then.
 */
export function layeredPair(
  lib: StemLib,
  vocalSide: Side,
): { vocal: StemCut; backing: StemCut } | null {
  const other: Side = vocalSide === "a" ? "b" : "a";
  const vocal = findCut(lib, vocalSide, "vocals");
  const backing = findCut(lib, other, "backing");
  return vocal && backing ? { vocal, backing } : null;
}
