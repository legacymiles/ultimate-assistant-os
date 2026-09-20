// ---------------------------------------------------------------------------
// Mashup — the decisions, separated from the screen that collects them.
//
// A mashup here is one sentence with a lot of knobs in it: "take THIS from song
// A, THAT from song B, and lean it this far towards one of them." Everything in
// this file is about turning those knobs into the two things downstream can
// actually act on — a prose brief for the writer, and a style line for YuE2 —
// plus the small amount of parsing needed to get two song titles out of a
// sentence when no AI key is configured.
//
// It is deliberately pure: no React, no fetch, no browser. That is what makes
// the blend rules testable, and the blend rules are the part that is easy to
// get subtly wrong.
//
// ----- the honesty that shapes the whole design ----------------------------
//
// There are exactly two things this app can do with two recordings, and they
// are completely different. The UI names both rather than blending them into
// one button that sometimes means one and sometimes the other:
//
//   GENERATED. SheetSage2 writes one song's melody down as a score; YuE2
//   performs that score inside a style line assembled from both songs. Nothing
//   of either ORIGINAL RECORDING survives — not a drum hit, not a voice. What
//   carries over is musical information: the tune, a chord progression, a
//   tempo, a description of a groove. Every knob works, because every knob is
//   just another clause in the style line or another choice about the score.
//
//   LAYERED. AuK splits A into its vocal and B into its backing, and ffmpeg
//   lays one over the other. This is the literal DJ mashup, made of the real
//   records. It is also crude: there is no beat-matching, no key-matching and
//   no time-stretching anywhere in this stack, so it only sounds right when the
//   two happen to sit near the same tempo and key. Most of the knobs below mean
//   nothing on this route, and `appliesTo` is how the screen knows to grey them
//   out instead of pretending.
//
// Saying which knobs are real on which route is the single most useful thing
// this module does. A control that looks live and does nothing is worse than no
// control at all.
// ---------------------------------------------------------------------------

import type { ArtistTrack } from "./types";

/** Which of the two songs. */
export type Side = "a" | "b";

/** How the two recordings are combined. See the note above. */
export type MashupMethod = "generated" | "layered";

/** One musical element, and where it should come from. */
export type ElementId = "melody" | "lyrics" | "harmony" | "drums" | "instruments" | "vocal" | "tempo";

export interface BlendSpec {
  /** 0 = entirely song A's record, 100 = entirely song B's. 50 = even. */
  dominance: number;
  melody: Side;
  /** "new" = write fresh words for the mashup rather than leaning on either. */
  lyrics: Side | "new";
  /** "model" = strip the chords and let YuE2 invent the harmony. */
  harmony: Side | "model";
  drums: Side;
  instruments: Side | "both";
  vocal: Side;
  /** "custom" = use `bpm` instead of either song's tempo. */
  tempo: Side | "custom";
  bpm?: number;
}

export function defaultBlend(): BlendSpec {
  return {
    dominance: 50,
    melody: "a",
    lyrics: "a",
    harmony: "b",
    drums: "b",
    instruments: "b",
    vocal: "a",
    tempo: "b",
  };
}

/**
 * The elements, in the order the screen shows them.
 *
 * `appliesTo` is the important column: a knob listed as "generated" only is
 * shown disabled on the layered route, with `layeredNote` saying why. Nothing
 * here silently does nothing.
 */
export const ELEMENTS: {
  id: ElementId;
  label: string;
  hint: string;
  /** Extra choice beyond A and B, when the element has one. */
  extra?: { value: string; label: string; hint: string };
  appliesTo: MashupMethod[];
  /** What this knob does on the layered route, when it does anything. */
  layeredHint?: string;
  /** Why this knob is dead on the layered route, when it is. */
  layeredNote?: string;
}[] = [
  {
    id: "melody",
    label: "Melody",
    hint: "The tune itself. This song gets transcribed to a score, and that score is what gets performed.",
    appliesTo: ["generated"],
    layeredNote: "Layered keeps whichever melody is already in the vocal you kept — nothing is transcribed.",
  },
  {
    id: "lyrics",
    label: "Lyrics",
    hint: "Whose words ride the melody.",
    extra: { value: "new", label: "New words", hint: "Written for this mashup from your prompt." },
    appliesTo: ["generated"],
    layeredNote: "Layered uses the real vocal from the record, so the words are whatever was sung on it.",
  },
  {
    id: "harmony",
    label: "Chords",
    hint: "The progression underneath.",
    extra: { value: "model", label: "Let YuE2 decide", hint: "No chords are supplied; the model writes its own." },
    appliesTo: ["generated"],
    layeredNote: "Layered inherits the backing track's chords, because it IS the backing track.",
  },
  {
    id: "drums",
    label: "Drums & groove",
    hint: "The rhythm section's feel. Described in the style line — no drums are lifted off either record.",
    appliesTo: ["generated"],
    layeredNote: "Layered inherits the backing track's drums, because it IS the backing track.",
  },
  {
    id: "instruments",
    label: "Instruments",
    hint: "What is playing.",
    extra: { value: "both", label: "Both", hint: "Instruments from each, in one arrangement." },
    appliesTo: ["generated"],
    layeredNote: "Layered inherits the backing track's instruments.",
  },
  {
    // The one knob that is live on both routes, because it is the one question
    // both routes have to answer: whose voice is this? On the generated route
    // that is a description; on the layered route it decides which record gets
    // split for its vocal and which for its backing. Disabling it there would
    // leave no way at all to swap the two round.
    id: "vocal",
    label: "Vocal character",
    hint: "The kind of voice singing it. A description, not a clone — see the note at the top of the tool.",
    appliesTo: ["generated", "layered"],
    layeredHint: "Which record's actual vocal is lifted out. The other one gives the backing track.",
  },
  {
    id: "tempo",
    label: "Tempo",
    hint: "The speed it runs at.",
    extra: { value: "custom", label: "Set it myself", hint: "A BPM of your own." },
    appliesTo: ["generated"],
    layeredNote: "Nothing in this stack time-stretches, so a layered mashup runs at both songs' original tempos at once.",
  },
];

/** True when this knob does something on the chosen route. */
export function appliesTo(id: ElementId, method: MashupMethod): boolean {
  return ELEMENTS.find((e) => e.id === id)?.appliesTo.includes(method) ?? false;
}

// ----- naming the two songs -------------------------------------------------

export interface SongPick {
  /** What the user typed or the AI extracted, before any catalogue lookup. */
  query: string;
  /** The catalogue match, once one has been chosen. */
  track?: ArtistTrack;
  /** An uploaded file's name, when the song came from disk instead. */
  fileName?: string;
}

/** How to refer to one side in prose: the real title when known, else the query. */
export function nameOf(pick: SongPick | undefined, side: Side): string {
  if (!pick) return side === "a" ? "song A" : "song B";
  if (pick.track) return `${pick.track.title} — ${pick.track.artist}`;
  return pick.fileName || pick.query || (side === "a" ? "song A" : "song B");
}

/**
 * Just the title, for places where the full "Title — Artist" does not fit or
 * reads badly: a possessive ("Toxic — Britney Spears's vocal") and the
 * segmented buttons, which are too narrow for both.
 */
export function shortName(pick: SongPick | undefined, side: Side): string {
  const full = nameOf(pick, side);
  const title = full.split(" — ")[0];
  return title.length > 24 ? `${title.slice(0, 23)}…` : title;
}

/** Everything known about one side, for the writer's turn. */
export function describeSong(pick: SongPick | undefined, side: Side): string {
  if (!pick) return "";
  const t = pick.track;
  if (!t) return pick.fileName || pick.query;
  const bits = [`"${t.title}" by ${t.artist}`];
  if (t.album) bits.push(`from "${t.album}"`);
  if (t.releaseYear) bits.push(`(${t.releaseYear})`);
  return bits.join(" ") + (side === "a" ? "" : "");
}

/**
 * Get two song titles out of a sentence, with no model involved.
 *
 * The fallback for "no AI key configured", and the reason it is worth having:
 * without it the first field on the screen does nothing at all offline, which
 * would make the tool look broken rather than degraded. It handles the shapes
 * people actually type — "X and Y", "X with Y", "X x Y", "X vs Y", "X / Y" —
 * and gives up honestly rather than guessing when it cannot see two sides.
 */
export function parseSongPair(prompt: string): { songA: string; songB: string; rest: string } {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return { songA: "", songB: "", rest: "" };

  // Strip a leading instruction so "mash up X and Y" leaves "X and Y".
  const body = text.replace(/^(?:please\s+)?(?:make|build|create|do)?\s*(?:me\s+)?(?:a\s+)?(?:mash[- ]?up|mashup|remix|blend|mix)\s*(?:of|between)?\s*/i, "");

  // Everything after the first sentence-ending punctuation is direction, not a
  // title: "X and Y. make it slow" must not put "make it slow" in song B. The
  // lookbehind keeps that punctuation on the head, so it is trimmed off the
  // titles below — a query ending in "." finds nothing in the catalogue.
  const split = body.split(/(?<=[.;!?])\s+/);
  const head = (split[0] ?? body).replace(/[.;!?]+$/, "").trim();
  const rest = split.slice(1).join(" ").trim();

  const separators = [/\s+with\s+/i, /\s+and\s+/i, /\s+vs\.?\s+/i, /\s+x\s+/i, /\s*\/\s*/, /\s*\+\s*/];
  for (const sep of separators) {
    const parts = head.split(sep);
    if (parts.length >= 2) {
      const songA = parts[0].trim();
      // A trailing "in the style of…" clause belongs to the direction, not the title.
      const tail = parts.slice(1).join(" ").trim();
      const [songB, ...after] = tail.split(/\s*,\s*(?=(?:but|make|keep|with the|in the)\b)/i);
      if (songA && songB) {
        return { songA, songB: songB.trim(), rest: [after.join(", ").trim(), rest].filter(Boolean).join(" ") };
      }
    }
  }
  return { songA: head.trim(), songB: "", rest };
}

// ----- turning the knobs into words -----------------------------------------

function sideName(side: Side, a: string, b: string): string {
  return side === "a" ? a : b;
}

/**
 * The blend, written out as lines a person can check and a model can read.
 *
 * Used in two places on purpose: shown on the screen as the plan, and sent to
 * the writer verbatim. One string means the user cannot be shown one thing and
 * the model told another.
 */
export function describeBlend(spec: BlendSpec, aName: string, bName: string, method: MashupMethod): string[] {
  const lines: string[] = [];
  const pick = (side: Side) => sideName(side, aName, bName);

  if (method === "layered") {
    lines.push(`Vocal lifted from ${pick(spec.vocal)}.`);
    lines.push(`Backing track lifted from ${pick(spec.vocal === "a" ? "b" : "a")}.`);
    lines.push("Nothing is transcribed, re-sung or re-played — these are the two records, laid on top of each other.");
    return lines;
  }

  lines.push(`Melody transcribed from ${pick(spec.melody)}.`);
  lines.push(
    spec.lyrics === "new"
      ? "Lyrics written fresh for this mashup."
      : `Lyrics in the manner of ${pick(spec.lyrics)}: written to fit the melody's phrasing, not copied from the record.`,
  );
  lines.push(
    spec.harmony === "model"
      ? "Chords left to YuE2: the score's chord symbols are stripped, so it writes its own accompaniment."
      : `Chord progression taken from ${pick(spec.harmony)}.`,
  );
  lines.push(`Drums and groove in the feel of ${pick(spec.drums)}.`);
  lines.push(
    spec.instruments === "both"
      ? `Instruments drawn from both records into one arrangement.`
      : `Instrumentation from ${pick(spec.instruments)}.`,
  );
  lines.push(`Vocal character like ${pick(spec.vocal)}.`);
  lines.push(
    spec.tempo === "custom"
      ? `Tempo set to ${spec.bpm ?? 120} BPM.`
      : `Tempo taken from ${pick(spec.tempo)}.`,
  );
  lines.push(dominanceLine(spec.dominance, aName, bName));
  return lines;
}

/** The slider, in words. Its whole job is to break ties the knobs leave open. */
export function dominanceLine(dominance: number, aName: string, bName: string): string {
  const d = Math.round(Math.min(100, Math.max(0, dominance)));
  if (d <= 10) return `It should read as ${aName} almost entirely, with only a trace of the other.`;
  if (d <= 30) return `It should read clearly as ${aName}, coloured by ${bName}.`;
  if (d < 45) return `It leans towards ${aName}.`;
  if (d <= 55) return `Neither record wins: an even meeting of the two.`;
  if (d < 70) return `It leans towards ${bName}.`;
  if (d < 90) return `It should read clearly as ${bName}, coloured by ${aName}.`;
  return `It should read as ${bName} almost entirely, with only a trace of the other.`;
}

/** The whole plan as one block for the writer's user turn. */
export function blendBrief(
  spec: BlendSpec,
  a: SongPick | undefined,
  b: SongPick | undefined,
  method: MashupMethod,
): string {
  return describeBlend(spec, nameOf(a, "a"), nameOf(b, "b"), method).join("\n");
}

// ----- the offline style line ------------------------------------------------

/**
 * A style line assembled from the knobs alone, for when no AI key is set.
 *
 * Not a pretend producer: every clause is a restatement of a choice the user
 * made, in the order YuE2's guide asks for. It renders, and it is honest about
 * being a scaffold rather than a written line.
 */
export function offlineMashupStyle(spec: BlendSpec, a: SongPick | undefined, b: SongPick | undefined): string {
  const aName = nameOf(a, "a");
  const bName = nameOf(b, "b");
  const pick = (side: Side) => sideName(side, aName, bName);
  const parts = [
    `in the style of ${pick(spec.instruments === "both" ? (spec.dominance >= 50 ? "b" : "a") : spec.instruments)}`,
    `${pick(spec.drums)}-style drums and groove`,
    `vocal like ${pick(spec.vocal)}`,
  ];
  if (spec.harmony !== "model") parts.push(`${pick(spec.harmony)}'s harmony`);
  parts.push(spec.tempo === "custom" ? `${spec.bpm ?? 120} BPM` : `${pick(spec.tempo)}'s tempo`);
  return parts.join(", ");
}

// ----- chord progressions out of a score -------------------------------------

/**
 * The chord symbols of an ABC score, in order, de-duplicated run-wise.
 *
 * Why this and not a chord graft: grafting one song's chords onto another's
 * melody means aligning bar counts, and two transcriptions of two different
 * records will not agree on bar counts. A graft that half-works produces
 * plausible notation that quietly ruins a bar — the same trap RemixStems
 * refuses to walk into. So the progression travels as PROSE in the style line,
 * where being approximate is fine and being wrong is visible.
 *
 * ABC puts a chord symbol in double quotes before the note it lands on:
 *   |"Am" A2 B2 "F" c4 |
 * Annotations placed with ^ _ < > @ are text, not chords, and are skipped.
 */
export function chordsFromAbc(abc: string, limit = 12): string[] {
  const found: string[] = [];
  for (const match of abc.matchAll(/"([^"]{1,18})"/g)) {
    const raw = match[1].trim();
    if (!raw || /^[\^_<>@]/.test(raw)) continue;
    if (!/^[A-G](#|b)?(maj|min|m|M|aug|dim|sus|add|°|\+)?[0-9]*(\/[A-G](#|b)?)?$/.test(raw)) continue;
    if (found[found.length - 1] !== raw) found.push(raw);
    if (found.length >= limit) break;
  }
  return found;
}

// ----- the session's versions -------------------------------------------------

/**
 * One finished attempt inside a mashup session.
 *
 * The user's requirement in their words: "all edits that create a finished song
 * in 1 session will be in that project session". So a revision never opens a
 * new project — it appends here, keeping the exact style and lyrics that
 * produced it. That is what makes v3 reproducible after v4 replaced it on the
 * screen, and what lets any version be re-rendered or downloaded later.
 */
export interface MashupVersion {
  n: number;
  /** The `Render` on this project that this version is. */
  renderId: string;
  title: string;
  /** The prompt that asked for this version. Empty on v1. */
  change: string;
  method: MashupMethod;
  style: string;
  lyrics: string;
  at: number;
}

export function readVersions(data: Record<string, unknown> | undefined): MashupVersion[] {
  const raw = data?.versions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is MashupVersion => !!v && typeof v === "object" && typeof (v as MashupVersion).renderId === "string")
    .map((v) => ({ ...v, n: Number(v.n) || 0 }))
    .sort((x, y) => y.n - x.n);
}

/** The next version number in a session. Always one past the highest seen. */
export function nextVersionNumber(versions: MashupVersion[]): number {
  return versions.reduce((max, v) => Math.max(max, v.n), 0) + 1;
}
