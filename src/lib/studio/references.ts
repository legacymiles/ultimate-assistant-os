// ---------------------------------------------------------------------------
// Referring to an upload from inside the prompt.
//
// The render pipeline has always numbered uploads — Subject 1 is the first
// picture attached in the conversation, and src/lib/studio/render.ts hands a
// job exactly the Subjects its prompt names. That numbering was invisible: the
// owner had to remember which photo was which and type "Subject 3" from memory.
//
// So the same @ menu that offers workflows now offers the uploads themselves,
// as "@Subject 2". The token is plain enough that the model reads it as prose
// and `pick()` still matches it, which is why it is a readable phrase rather
// than an opaque id.
//
// Sound is numbered SEPARATELY, as "@Audio 1". Two families rather than one
// list, because they are not interchangeable: a Subject is a picture a render
// looks at, and an Audio is a track that gets laid under the cut. Sharing one
// counter would mean dropping a photo renumbered the soundtrack, and the two
// numbers already exist apart — "[Audio 2]" is the label the measured note
// carries into the message, so "@Audio2" names the same track the model was
// told about.
// ---------------------------------------------------------------------------

export type ReferenceKind = "image" | "video" | "audio";

export interface ReferenceMention {
  /** 1-based within its own family, and stable for the whole conversation. */
  n: number;
  /** What goes after @, with no space so one word is one token. */
  token: string;
  /** "Subject 2", "Audio 1" — what the model reads. */
  label: string;
  kind: ReferenceKind;
  /** A picture, a frame out of a clip, or a track's waveform. */
  thumb: string;
  name: string;
  /**
   * Set only for something still in the composer, so its tile can find its own
   * row. A reference already sent has no id here, and needs none: nothing on
   * screen points back at it.
   */
  id?: string;
  durationSec?: number;
  /** Audio: what was measured from it, so a menu row can say what it heard. */
  note?: string;
}

/** Matches "@Subject2", "@subject 2" and the bare "Subject 2" the skills write. */
export const REFERENCE_PATTERN = /@?\bSubject[\s-]*(\d+)\b/gi;
/** The same again for sound: "@Audio1", "Audio 1". */
export const TRACK_PATTERN = /@?\bAudio[\s-]*(\d+)\b/gi;

export function referenceToken(n: number): string {
  return `Subject${n}`;
}

export function trackToken(n: number): string {
  return `Audio${n}`;
}

function numbersIn(text: string, pattern: RegExp): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(pattern)) {
    const n = Number(m[1]);
    if (n >= 1 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The Subject numbers a piece of text names, in order, without repeats. */
export function referencesIn(text: string): number[] {
  return numbersIn(text, REFERENCE_PATTERN);
}

/** The Audio numbers a piece of text names, in order, without repeats. */
export function tracksIn(text: string): number[] {
  return numbersIn(text, TRACK_PATTERN);
}

/** The words that find a row besides its own file name. */
function keysFor(r: ReferenceMention): string[] {
  return r.kind === "audio"
    ? [`audio${r.n}`, `track${r.n}`, `sound${r.n}`]
    : [`subject${r.n}`, r.kind === "video" ? `clip${r.n}` : `photo${r.n}`];
}

/** Menu matches for a half-typed "@sub", "@aud", "@2" or "@subject 3". */
export function searchReferences(query: string, all: ReferenceMention[]): ReferenceMention[] {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q) return all;
  // A number means the number, in both families — "@2" offers Subject 2 and
  // Audio 2. Falling through to the file name would make it offer photo-12.jpg,
  // which is never what typing a reference number means.
  if (/^\d+$/.test(q)) return all.filter((r) => String(r.n).startsWith(q));
  return all.filter(
    (r) =>
      keysFor(r).some((k) => k.startsWith(q)) ||
      r.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(q),
  );
}

/**
 * Which track a film should be scored with.
 *
 * `texts` is the conversation's own turns, newest first, so the most recent
 * "@Audio2" wins. When nothing has been named the newest track is used — that
 * was the behaviour before tracks could be named at all, and it is still the
 * right guess for the common case of exactly one.
 */
export function pickTrack<T extends { n: number }>(texts: string[], tracks: T[]): T | undefined {
  for (const text of texts) {
    for (const n of tracksIn(text)) {
      const hit = tracks.find((t) => t.n === n);
      if (hit) return hit;
    }
  }
  return tracks[tracks.length - 1];
}

// ---------------------------------------------------------------------------
// Counting a conversation's uploads.
//
// The numbering used to be written out inside the chat component, which meant
// the Studio idea box — a composer for the same conversation — had no way to
// know what "@Subject 3" would mean, and so could not offer it. Three surfaces
// now count with the same two functions, so a token always names the same file
// wherever it is typed.
// ---------------------------------------------------------------------------

/** As far as Subject numbers reach, which is as far as the render hands pictures. */
export const MAX_SUBJECTS = 24;
/** Tracks kept nameable. Nobody picks a score for a cut out of more than this. */
export const MAX_TRACKS = 12;

/** One upload, before the conversation has counted it. */
export interface ReferenceSource {
  kind: ReferenceKind;
  thumb: string;
  name: string;
  durationSec?: number;
  note?: string;
  /** Set only while it is still in a composer, so its tile can find its row. */
  id?: string;
}

/**
 * Give every upload the name the prompt calls it by.
 *
 * Pictures and tracks count separately, because they are spent separately —
 * pictures in the order render.ts hands the jobs, tracks in the order the
 * measured notes were labelled — so dropping a photo never renumbers the
 * soundtrack.
 */
export function numberReferences(sources: ReferenceSource[]): ReferenceMention[] {
  const out: ReferenceMention[] = [];
  let seen = 0;
  let heard = 0;
  for (const s of sources) {
    const audio = s.kind === "audio";
    if (audio ? heard >= MAX_TRACKS : seen >= MAX_SUBJECTS) continue;
    let n: number;
    if (audio) {
      heard += 1;
      n = heard;
    } else {
      seen += 1;
      n = seen;
    }
    out.push({
      n,
      token: audio ? trackToken(n) : referenceToken(n),
      label: audio ? `Audio ${n}` : `Subject ${n}`,
      kind: s.kind,
      thumb: s.thumb,
      name: s.name,
      ...(s.durationSec ? { durationSec: s.durationSec } : {}),
      ...(s.note ? { note: s.note } : {}),
      ...(s.id ? { id: s.id } : {}),
    });
  }
  return out;
}

/** The shape of a saved Jarvis turn, as far as its uploads go. */
export interface TurnUploads {
  role: string;
  images?: string[];
  imageInfo?: { name: string; kind: "image" | "video"; durationSec?: number }[];
  audio?: { thumb: string; name: string; durationSec?: number; note?: string }[];
}

/**
 * The uploads a conversation has already carried, oldest first.
 *
 * Only the owner's own turns count: a picture Jarvis rendered back is an
 * answer, not a reference, and numbering it would shift every token the owner
 * has already typed.
 */
export function turnSources(turns: TurnUploads[]): ReferenceSource[] {
  const out: ReferenceSource[] = [];
  for (const t of turns) {
    if (t.role !== "you") continue;
    (t.images ?? []).forEach((thumb, i) => {
      // Turns saved before imageInfo existed say only that a picture was here.
      const was = t.imageInfo?.[i];
      out.push({
        thumb,
        name: was?.name ?? "from an earlier message",
        kind: was?.kind ?? "image",
        ...(was?.durationSec ? { durationSec: was.durationSec } : {}),
      });
    });
    for (const a of t.audio ?? []) {
      out.push({
        kind: "audio",
        thumb: a.thumb,
        name: a.name,
        ...(a.durationSec ? { durationSec: a.durationSec } : {}),
        ...(a.note ? { note: a.note } : {}),
      });
    }
  }
  return out;
}

/** An upload still in a composer, as something the numbering can take. */
export function draftSource(a: {
  id: string;
  kind: ReferenceKind;
  thumb: string;
  name: string;
  durationSec?: number;
  note?: string;
}): ReferenceSource {
  return {
    id: a.id,
    kind: a.kind,
    thumb: a.thumb,
    name: a.name,
    ...(a.durationSec ? { durationSec: a.durationSec } : {}),
    ...(a.note ? { note: a.note } : {}),
  };
}
