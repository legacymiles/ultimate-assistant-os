// ---------------------------------------------------------------------------
// The audio timeline — everything known about a track, on one clock.
//
// This is the handoff between the two halves of the engine. Below it everything
// is MEASUREMENT: DSP on the owner's own file, in their own browser, free, and
// true whether or not an API key exists. Above it everything is INTERPRETATION:
// a model reading these numbers and deciding what the film does with them.
//
// Keeping the line that sharp is the point. A director stage that measures, and
// a measuring stage that directs, are the two ways this kind of pipeline rots:
// the first invents tempo, the second invents meaning. So nothing in this file
// claims to know what a section MEANS — `level` is a number's neighbourhood,
// and `provisional` is openly a guess from energy and position that exists only
// so the app reads correctly before any AI has run.
//
// Pure on purpose: no Web Audio, no fetch. `analyze.client.ts` does the
// decoding and calls in here, so the shape, the labelling and the brief can all
// be tested without a browser.
// ---------------------------------------------------------------------------

import type { BeatGrid, Hit, Section } from "./grid";

/**
 * m:ss.
 *
 * Deliberately defined here rather than imported from Soundprint's analyzer,
 * even though that module has the identical four lines: it is a "use client"
 * module, and this one has to work on the server too — the chat route turns a
 * timeline into a brief. Importing it there fails at runtime, not at build
 * time, which is exactly the kind of break that reaches a person first.
 */
export function fmt(sec: number): string {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

/** What kind of piece the audio is being turned into. The owner's choice. */
export type VisualMode =
  | "music-video"
  | "lyric-video"
  | "story"
  | "voiceover"
  | "reaction"
  | "cinematic";

export const VISUAL_MODES: { id: VisualMode; label: string; note: string }[] = [
  { id: "music-video", label: "Music video", note: "Lyrics drive cinematic scenes." },
  { id: "lyric-video", label: "Lyric video", note: "Typography and effects land on the words." },
  { id: "story", label: "Story", note: "The audio tells one continuous narrative." },
  { id: "voiceover", label: "Voiceover", note: "Visuals illustrate what the speaker says." },
  { id: "reaction", label: "Reaction", note: "Visuals change with the spoken content." },
  { id: "cinematic", label: "Cinematic audio", note: "Abstract visuals answer rhythm and emotion." },
];

/** What a section is probably called. A guess from shape, never from meaning. */
export type SectionLabel =
  | "intro"
  | "verse"
  | "build"
  | "chorus"
  | "bridge"
  | "outro"
  | "instrumental";

/** One line of words, on the track's clock. */
export interface Line {
  startSec: number;
  endSec: number;
  text: string;
  /**
   * Word-level timing, when the transcriber gave it. This is what a lyric video
   * and a tight lip-sync are made of; without it a line is only a range.
   */
  words?: { atSec: number; text: string }[];
  /** True when the owner wrote or corrected this line rather than a model hearing it. */
  owned?: boolean;
}

export interface TimelineSection extends Section {
  id: string;
  /**
   * The provisional name, from energy and position ALONE.
   *
   * It is not a musical analysis and must never be presented as one: a quiet
   * opening is called an intro because it is quiet and first, not because
   * anything recognised an intro. The director is given this next to the
   * measurements and the words, and the words are what actually separate a
   * verse from a chorus — so it is expected to overrule this.
   */
  provisional: SectionLabel;
  /** The lines of the transcript that fall inside this section. */
  lines: Line[];
}

export interface AudioTimeline {
  name: string;
  durationSec: number;
  // ----- measured, whole-track -----
  bpm: number;
  bpmConfidence: number;
  key: string;
  keyConfidence: number;
  brightness: string;
  percussion: string;
  dynamics: string;
  density: string;
  /** Which engine measured tempo and key. */
  analyzer: "dsp" | "essentia";
  grid: BeatGrid;
  sections: TimelineSection[];
  hits: Hit[];
  // ----- words -----
  /** Null when nothing has transcribed it and the owner pasted nothing. */
  lines: Line[] | null;
  /** How the words arrived, so the UI and the model can both be honest about them. */
  lyricSource: "none" | "heard" | "pasted";
  /** Set when transcription was attempted and could not run. */
  lyricNote?: string;
}

/** Bar lines, in seconds. The safe places to cut. */
export function barTimes(grid: BeatGrid): number[] {
  return grid.downbeats.map((i) => grid.beats[i]).filter((t) => typeof t === "number");
}

/** Seconds per bar, or 0 without a grid. */
export function barSec(grid: BeatGrid): number {
  return grid.period * grid.beatsPerBar;
}

/**
 * Which section a moment is in. Returns null past the end rather than clamping,
 * because a shot placed past the end of the song is a fault to surface, not one
 * to quietly round away.
 */
export function sectionAt(timeline: AudioTimeline, sec: number): TimelineSection | null {
  return timeline.sections.find((s) => sec >= s.startSec && sec < s.endSec) ?? null;
}

/** The lines that overlap a stretch of the track, in order. */
export function linesIn(timeline: AudioTimeline, startSec: number, endSec: number): Line[] {
  return (timeline.lines ?? []).filter((l) => l.endSec > startSec && l.startSec < endSec);
}

/** The words of those lines, joined the way they are sung. */
export function wordsIn(timeline: AudioTimeline, startSec: number, endSec: number): string {
  return linesIn(timeline, startSec, endSec)
    .map((l) => l.text.trim())
    .filter(Boolean)
    .join(" / ");
}

// ----- provisional labels ----------------------------------------------------

/**
 * Names for the sections, from shape alone.
 *
 * The rules are deliberately few and deliberately dumb, because a clever rule
 * here would be a claim about music that the measurements cannot support. What
 * they DO earn: the loudest recurring level is where a chorus lives, a quiet
 * first section is an opening, a quiet last one is an ending, and a section that
 * climbs into a loud one is a build. Everything else is a verse, and anything
 * with no words in it is instrumental whatever its energy.
 *
 * Exported and pure so the labelling can be tested directly, and so the
 * director can be handed the same function's output rather than a private one.
 */
export function labelSections(sections: Section[], lines: Line[] | null): SectionLabel[] {
  if (!sections.length) return [];
  const peak = Math.max(...sections.map((s) => s.energy));
  const loud = (s: Section) => (peak > 0 ? s.energy / peak : 0);
  const hasWords = (s: Section) =>
    !lines ? true : lines.some((l) => l.endSec > s.startSec && l.startSec < s.endSec);

  return sections.map((s, i): SectionLabel => {
    const share = loud(s);
    const first = i === 0;
    const last = i === sections.length - 1;
    const next = sections[i + 1];

    // Words decide this one outright: a loud stretch with nothing sung over it
    // is a break, however big it is.
    if (lines && !hasWords(s)) {
      return first && share < 0.7 ? "intro" : last && share < 0.7 ? "outro" : "instrumental";
    }
    if (first && share < 0.7) return "intro";
    if (last && share < 0.7) return "outro";
    if (share >= 0.87) return "chorus";
    // A quiet-ish section that hands over to a loud one is doing the handing —
    // but only if it is SHORT. Almost every song has a verse at two thirds of
    // its chorus's energy leading into that chorus, so length is the whole
    // difference between a pre-chorus and the verse before it: eight bars or
    // fewer is a run-up, sixteen is where the song has been living.
    if (next && share < 0.75 && loud(next) >= 0.87 && s.bars > 0 && s.bars <= 8) return "build";
    // A lone mid-energy section between two loud ones, late on, is where a song
    // usually goes somewhere else.
    const prev = sections[i - 1];
    if (prev && next && i >= sections.length / 2 && loud(prev) >= 0.8 && loud(next) >= 0.8 && share < 0.7) {
      return "bridge";
    }
    return "verse";
  });
}

// ----- the trust boundary ----------------------------------------------------

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** A day. Long enough for any track, short enough that a silly number is caught. */
const MAX_TRACK_SEC = 86_400;
const LABELS: SectionLabel[] = ["intro", "verse", "build", "chorus", "bridge", "outro", "instrumental"];
const LEVEL_NAMES = ["quiet", "low", "mid", "high", "peak"] as const;

/**
 * A timeline off the wire, made safe.
 *
 * The measurements are computed in the browser — the owner's audio file never
 * leaves their machine — so the server receives them as a claim rather than as
 * data it produced, and clamps them like any other client input. What that
 * protects is narrow but real: these numbers are written into a prompt, and an
 * unclamped one is a way to write whatever you like into it.
 *
 * Beats are dropped rather than clamped. A grid is either the track's own or it
 * is worthless, and truncating one to a cap would hand the director bar lines
 * that stop two thirds of the way through the song with no sign that they had.
 */
export function cleanTimeline(v: unknown): AudioTimeline | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const durationSec = num(o.durationSec, 0, MAX_TRACK_SEC, 0);
  if (durationSec <= 0) return null;

  const g = (o.grid ?? {}) as Record<string, unknown>;
  const beats = (Array.isArray(g.beats) ? g.beats : [])
    .map((b) => num(b, 0, durationSec, -1))
    .filter((b) => b >= 0)
    .slice(0, 4000);
  const grid = {
    bpm: Math.round(num(g.bpm, 0, 400, 0)),
    beats,
    downbeats: (Array.isArray(g.downbeats) ? g.downbeats : [])
      .map((i) => Math.round(num(i, 0, beats.length - 1, -1)))
      .filter((i) => i >= 0 && i < beats.length)
      .slice(0, 1200),
    beatsPerBar: Math.round(num(g.beatsPerBar, 1, 16, 4)),
    period: num(g.period, 0, 10, 0),
    confidence: num(g.confidence, 0, 1, 0),
  };

  const lines = cleanLines(o.lines, durationSec);

  const sections: TimelineSection[] = (Array.isArray(o.sections) ? o.sections : [])
    .slice(0, 40)
    .map((raw, i): TimelineSection => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const startSec = num(s.startSec, 0, durationSec, 0);
      const endSec = num(s.endSec, startSec, durationSec, durationSec);
      const level = str(s.level, 10) as TimelineSection["level"];
      const provisional = str(s.provisional, 20) as SectionLabel;
      return {
        id: str(s.id, 40).replace(/[^a-zA-Z0-9_-]/g, "") || `sec-${i + 1}`,
        startSec,
        endSec,
        energy: num(s.energy, 0, 1, 0),
        level: (LEVEL_NAMES as readonly string[]).includes(level) ? level : "mid",
        bars: Math.round(num(s.bars, 0, 2000, 0)),
        provisional: LABELS.includes(provisional) ? provisional : "verse",
        lines: (lines ?? []).filter((l) => l.endSec > startSec && l.startSec < endSec),
      };
    })
    .filter((s) => s.endSec > s.startSec);

  const source = str(o.lyricSource, 10);
  return {
    name: str(o.name, 160) || "Untitled track",
    durationSec,
    bpm: Math.round(num(o.bpm, 0, 400, 0)),
    bpmConfidence: num(o.bpmConfidence, 0, 1, 0),
    key: str(o.key, 30),
    keyConfidence: num(o.keyConfidence, 0, 1, 0),
    brightness: str(o.brightness, 60),
    percussion: str(o.percussion, 60),
    dynamics: str(o.dynamics, 60),
    density: str(o.density, 60),
    analyzer: o.analyzer === "essentia" ? "essentia" : "dsp",
    grid,
    sections,
    hits: (Array.isArray(o.hits) ? o.hits : [])
      .slice(0, 64)
      .map((raw) => {
        const h = (raw ?? {}) as Record<string, unknown>;
        return {
          atSec: num(h.atSec, 0, durationSec, -1),
          strength: num(h.strength, 0, 1000, 0),
          drop: Boolean(h.drop),
        };
      })
      .filter((h) => h.atSec >= 0),
    lines,
    lyricSource: source === "heard" || source === "pasted" ? source : "none",
    ...(str(o.lyricNote, 400) ? { lyricNote: str(o.lyricNote, 400) } : {}),
  };
}

function cleanLines(v: unknown, durationSec: number): Line[] | null {
  if (!Array.isArray(v)) return null;
  const out: Line[] = [];
  for (const raw of v.slice(0, 400)) {
    const l = (raw ?? {}) as Record<string, unknown>;
    const text = str(l.text, 400);
    if (!text) continue;
    const startSec = num(l.startSec, 0, durationSec, -1);
    if (startSec < 0) continue;
    const words = (Array.isArray(l.words) ? l.words : [])
      .slice(0, 60)
      .map((w) => {
        const x = (w ?? {}) as Record<string, unknown>;
        const t = str(x.text, 60);
        const atSec = num(x.atSec, 0, durationSec, -1);
        return t && atSec >= 0 ? { atSec, text: t } : null;
      })
      .filter((w): w is { atSec: number; text: string } => Boolean(w));
    out.push({
      startSec,
      endSec: num(l.endSec, startSec, durationSec, Math.min(durationSec, startSec + 3)),
      text,
      ...(words.length ? { words } : {}),
      ...(l.owned ? { owned: true } : {}),
    });
  }
  return out.length ? out.sort((a, b) => a.startSec - b.startSec) : null;
}

// ----- the brief -------------------------------------------------------------

/** Keeps a long song's bar list from swamping the prompt. */
const MAX_BAR_TIMES = 200;

/**
 * The timeline as the director reads it.
 *
 * Written as measured ground truth with the provenance attached, because the
 * failure this prevents is the model narrating a listen it never had: every
 * number here came from DSP on the file, the words came from a transcriber or
 * from the owner, and the difference is stated so the model can say which.
 *
 * The beat grid is given as arithmetic plus a bar list rather than as every
 * beat. A four-minute track has some five hundred beats and no prompt needs
 * them; what a cut needs is the bar lines, and a rule for the ones past the end
 * of the list.
 */
export function timelineBrief(t: AudioTimeline): string {
  const bars = barTimes(t.grid);
  const bar = barSec(t.grid);
  const out: string[] = [];

  out.push(
    "THE AUDIO — measured, not guessed. Every number below was computed from the owner's own file",
    "in their browser (Web Audio DSP). You have NOT heard this track and must never say you have;",
    "these measurements and the words are all you know about it, and they are enough to direct from.",
    "",
    `Track: ${t.name} · ${fmt(t.durationSec)} (${t.durationSec.toFixed(1)}s)`,
  );

  if (t.bpm) {
    out.push(
      `Tempo: ${t.bpm} BPM (confidence ${(t.bpmConfidence * 100).toFixed(0)}%), ` +
        `${t.grid.beatsPerBar}/4, one bar = ${bar.toFixed(3)}s`,
    );
  } else {
    out.push("Tempo: no steady pulse found — this is free time (speech, ambience or rubato).");
  }
  if (t.key) out.push(`Key: ${t.key} (confidence ${(t.keyConfidence * 100).toFixed(0)}%)`);
  out.push(
    `Tone: ${t.brightness} · Percussion: ${t.percussion} · Dynamics: ${t.dynamics} · Arrangement: ${t.density}`,
  );

  // ----- the grid -----
  if (bars.length) {
    const shown = bars.slice(0, MAX_BAR_TIMES);
    out.push(
      "",
      `BAR LINES (seconds). ${
        t.grid.confidence >= 0.4
          ? "The grid is solid — a cut that lands on one of these is on the beat."
          : `The grid is WEAK (confidence ${(t.grid.confidence * 100).toFixed(
              0,
            )}%): treat these as loose and cut on meaning instead.`
      }`,
      shown.map((s) => s.toFixed(2)).join(", ") +
        (bars.length > shown.length
          ? ` … and on every ${bar.toFixed(3)}s after that, to ${fmt(t.durationSec)}.`
          : ""),
    );
  }

  // ----- sections -----
  out.push(
    "",
    "SECTIONS. Boundaries are measured (the arrangement's energy changes on these bar lines).",
    'The "shape" name is a GUESS from energy and position only — nothing recognised a chorus. You',
    "have the words; you decide what each section actually is, and say so if you rename one.",
  );
  for (const [i, s] of t.sections.entries()) {
    const words = s.lines.map((l) => l.text.trim()).filter(Boolean);
    out.push(
      `${i + 1}. ${fmt(s.startSec)}–${fmt(s.endSec)} (${(s.endSec - s.startSec).toFixed(1)}s, ` +
        `${s.bars} bars) · energy ${s.level} · shape "${s.provisional}"` +
        (words.length ? `\n   words: ${words.join(" / ")}` : "\n   words: (none over this section)"),
    );
  }

  // ----- the moments -----
  if (t.hits.length) {
    out.push(
      "",
      "MOMENTS worth cutting on. A DROP is the point a whole arrangement arrives (the seconds after",
      "are measurably louder than the seconds before); an ACCENT is one hit louder than its",
      "neighbours. Cut on the drops. Use the accents sparingly — a cut on every accent is a",
      "slideshow, and the brief is a music video.",
    );
    out.push(
      t.hits
        .map((h) => `${h.atSec.toFixed(2)}s ${h.drop ? "DROP" : "accent"} (×${h.strength})`)
        .join(" · "),
    );
  }

  // ----- the words -----
  out.push("", ...lyricBlock(t));
  return out.join("\n");
}

function lyricBlock(t: AudioTimeline): string[] {
  if (!t.lines || !t.lines.length) {
    return [
      `WORDS: none. ${
        t.lyricNote ??
        "Nothing was transcribed and the owner pasted no lyrics, so treat this as instrumental: " +
          "drive the visuals from the sections, the energy and the moments above."
      }`,
      "Do NOT invent lyrics. Do not write shots that depend on words nobody has.",
    ];
  }
  const heard = t.lyricSource === "heard";
  const timed = t.lines.some((l) => l.words?.length);
  return [
    `WORDS (${
      heard
        ? "transcribed from the audio by a listening model — timings are close, not frame-accurate"
        : "supplied by the owner and aligned to the sections"
    }${timed ? ", with word-level timing" : ", line-level timing only"}):`,
    ...t.lines.map((l) => `[${l.startSec.toFixed(2)}–${l.endSec.toFixed(2)}] ${l.text}`),
    "",
    "These words are the film's spine. A shot covering a line must be ABOUT that line — what it",
    "means, not the nouns in it. Decide which lines earn a literal image and which are better",
    "carried by the scene they are already in.",
  ];
}
