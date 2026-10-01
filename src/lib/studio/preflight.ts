// ---------------------------------------------------------------------------
// Pre-flight: read a shot plan and say what cannot become the film it claims.
//
// A film costs the better part of an hour on this PC's GPU and cannot be
// skimmed until it is finished, which makes every fault an hour late. Every
// check here is cheap, needs no GPU, and exists because it shipped in a real
// finished film.
//
// The gate runs on the board the owner is ABOUT TO RENDER, not on the first
// draft — they edit the sheet, and an edit can break a good plan: a shortened
// shot that no longer fits its line, a new cut that extends a chain past two.
//
// Two severities, and the distinction is the whole design. An "error" is a plan
// that cannot produce the film it describes; a "warn" is one that probably
// disappoints. Only errors block, because a gate that cries wolf gets bypassed
// and then protects nothing.
//
// The doctrine behind each check is the film-plan skill (skills/film-plan).
// ---------------------------------------------------------------------------

import { MAX_SHOT_SEC, MIN_SHOT_SEC, unanchored, type BoardNote, type Storyboard } from "./storyboard";

/**
 * How long a chain of continued shots may run before it must cut back to a
 * shot carrying references.
 *
 * A continued shot cannot take reference photos — the handed-over frames and
 * the photos are two answers to the same question, and the model visibly
 * splits the difference — so identity is held only by what the chain
 * inherited. It drifts gradually, which is why the fix is frequency rather
 * than strength. Measured on a real film: a three-shot chain turned a Black
 * toddler into a fair-haired one and back.
 */
export const MAX_CHAIN = 2;

/** Ordinary speech, words per second. A line longer than its shot is cut off at the source. */
const WORDS_PER_SEC = 2.5;

/** Past this many seconds a shot without a beat list fills the time with a pose. */
const NEEDS_CLOCK_SEC = 6;

/**
 * Verbs that change a state. A shot's action needs at least one, or it is
 * describing a situation that already exists — and a situation renders as a
 * photograph, because that is literally what it asked for.
 *
 * Deliberately generous: a false pass costs nothing (the shot is probably
 * fine) while a false flag costs the owner a re-read of a good shot. It is a
 * smoke detector, not a critic.
 */
const CHANGES = new RegExp(
  "\\b(turn|stop|drop|fall|run|reach|open|close|slam|pull|push|step|lunge|grab|raise|lower|break|"
  + "shatter|rise|enter|exit|leave|arrive|cross|begin|start|snap|jerk|collapse|spin|twist|throw|"
  + "catch|hit|strike|burst|tear|rip|swing|slide|crawl|climb|jump|leap|duck|freeze|flinch|recoil|"
  + "take|place|lift|drag|shove|kick|knock|spill|flood|ignite|die|wake|emerge|vanish|appear|"
  + "disappear|change|become|widen|narrow|tighten|accelerate|slow|halt|stumble|trip|slip|land|"
  + "launch|fire|drive|brake|swerve|swallow|scream|shout|whisper|crack|split|bend|crumble|spread|"
  + "pour|sink|surface|lurch|stagger|bolt|flee|chase|catch up|give way|let go|pick up|set down)"
  + "(s|es|ed|ing)?\\b",
  "i",
);

/** Named moves that render as something ordinary unless the mechanics travel with them. */
const TRICK_MOVES =
  /\b(dolly zoom|vertigo|whip pan|crash|snorricam|parallax|rack focus|crane|jib|orbit|arc|push-?in|pull-?out|zolly)\b/i;

export type Severity = "error" | "warn";

export interface Finding {
  severity: Severity;
  /** "shot 3", or "the plan". */
  where: string;
  /**
   * The row it is about, 0-based; -1 for the film as a whole. Same convention
   * as BoardNote, so a finding can be shown in the sheet's own notes column
   * with a working jump link instead of a second panel.
   */
  shot: number;
  /** The fault, in one line. */
  what: string;
  /** What it costs, and what to do instead. */
  why: string;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** "shot 3" → 2; anything else is the film as a whole. */
const shotIndex = (where: string) => {
  const m = /^shot (\d+)$/.exec(where);
  return m ? Number(m[1]) - 1 : -1;
};

/** Strips a "NAME:" prefix so a speaker's name is not counted as spoken words. */
const spoken = (line: string) => line.replace(/^[A-Z][A-Z \-']*:/, "").trim();

/**
 * Read a plan and return every finding, worst first.
 *
 * Pure: no I/O, no model, no GPU. Tested in preflight.test.ts.
 */
export function preflight(board: Storyboard): Finding[] {
  const out: Finding[] = [];
  const add = (severity: Severity, where: string, what: string, why: string) =>
    out.push({ severity, where, shot: shotIndex(where), what, why });

  const shots = board.shots ?? [];
  const cast = board.cast ?? [];

  if (!shots.length) {
    add("error", "the plan", "No shots.", "There is nothing to render.");
    return out;
  }

  // --- the film-wide fields ------------------------------------------------
  // Repeated verbatim into every shot, they are the only reason a dozen
  // separate generations read as one film. Empty, each one is a decision
  // handed to the model.
  // Named the way the sheet labels them, not the way the type spells them:
  // these lines are read on the sheet, so `mood` there is "genre".
  const FILM_WIDE: [keyof Storyboard, string, string][] = [
    ["mood", "genre", "it decides what happens as well as how it is shot"],
    ["world", "world", "it is the one sentence that fingerprints the location"],
    ["look", "look", "it is what the film is made of"],
    ["lighting", "lighting", "it is where the light is"],
    ["grade", "grade", "it is what colour the film is"],
    ["wardrobe", "wardrobe", "it is the most common continuity break there is"],
  ];
  for (const [field, label, why] of FILM_WIDE) {
    if (!String(board[field] ?? "").trim()) {
      // Genre is the one that ruins the film rather than merely loosening it.
      add(
        field === "mood" ? "error" : "warn",
        "the plan",
        `No ${label} set.`,
        `It is repeated word for word into every shot, and ${why}. Empty, the model decides.`,
      );
    }
  }

  // --- sound ---------------------------------------------------------------
  // The model renders audio with the picture. A film that comes back silent or
  // scored by accident was never told what to make, so these are plan faults,
  // not model limitations.
  if (!board.soundscape.trim()) {
    add(
      "error",
      "the plan",
      "No soundscape.",
      "The render makes its own audio, so an empty soundscape means the model picks what the scene "
      + "sounds like. Write what the microphone in the scene hears.",
    );
  }
  if (!board.music.trim()) {
    add(
      "error",
      "the plan",
      "No music decided.",
      'Write the score, or "none" for a film scored by its own silence. "none" is a decision; '
      + "blank is the model's.",
    );
  }

  // --- per shot ------------------------------------------------------------
  // Whether identity is held by photographs at all. A fully invented cast is a
  // first-class film — it just cannot be told to keep a face it was never
  // given, so the reference checks below do not apply to it.
  const hasUploads = cast.some((c) => typeof c.subject === "number");

  // ...but it does need SOMETHING. Every shot is generated separately, and a
  // face described only in words is re-imagined by each one. Over a couple of
  // shots that passes; over a film it is how a character becomes someone else
  // halfway through. One drawn sheet, attached to every shot they are in, is
  // what turns a description into an anchor.
  // Two is already enough. The threshold was 3, and it is why the check sat
  // silent through a two-generation film whose second half lost the cast: drift
  // happens BETWEEN separately generated clips, so the moment there is more
  // than one generation there is somewhere to drift. A single generation cannot
  // drift from itself, which is the only case this skips.
  if (shots.length > 1) {
    for (const c of unanchored(board)) {
      add(
        "error",
        "the plan",
        `Nothing is holding ${c.name}'s face.`,
        `${c.name} was invented rather than uploaded, and across ${shots.length} separately generated `
        + "clips a face described only in words drifts into someone else. Draw their reference sheet on "
        + "the sheet's cast row — it is one picture, and every shot they appear in is anchored to it.",
      );
    }
  }

  let chain = 0;
  let carried = 0;

  shots.forEach((shot, i) => {
    const n = i + 1;
    const where = `shot ${n}`;
    const action = shot.action.trim();
    const secs = shot.durationSec;
    const link = shot.link || (i === 0 ? "open" : "cut");

    // A shot that describes a standing arrangement renders as a still. This is
    // the single largest defect measured on real films — a quarter of one
    // film's running time was living photographs.
    if (!action) {
      add("error", where, "No action.", "Nothing was said to happen, so nothing will.");
    } else if (!CHANGES.test(action)) {
      add(
        "error",
        where,
        "Held pose — the action names no change of state.",
        `"${action.slice(0, 90)}${action.length > 90 ? "…" : ""}" describes a situation that already `
        + "exists. Write the event: what is true at the end that was not true at the start?",
      );
    }

    if (secs < MIN_SHOT_SEC || secs > MAX_SHOT_SEC) {
      add(
        "error",
        where,
        `${secs || "no"} seconds is outside the ${MIN_SHOT_SEC}–${MAX_SHOT_SEC}s window.`,
        "Asking for it does not make a clip that long exist.",
      );
    }

    // A shot given seconds and no clock fills them with a held pose.
    if (secs > NEEDS_CLOCK_SEC && shot.beats.length < 2) {
      add(
        "warn",
        where,
        `${secs}s with ${shot.beats.length} beat(s).`,
        "Give a long shot a beat roughly every 2s or it drifts into a pose.",
      );
    }

    if (link === "continuous") {
      chain += 1;
      if (chain > MAX_CHAIN) {
        add(
          "error",
          where,
          `Chain of ${chain} continued shots with no reference shot between.`,
          "A continued shot takes no reference photos, so nothing is holding identity. Cut back to "
          + "a referenced shot, or anchor the chain on a known-good end frame.",
        );
      }
      // The two are answers to the same question and the model splits the
      // difference, which looks like a face that is nearly right.
      if (shot.references.length) {
        add(
          "warn",
          where,
          "A continued shot carrying references.",
          "It already inherits identity from the previous shot's frames. Attaching photos on top "
          + "makes the model visibly split the difference — drop them, or make this a cut.",
        );
      }
    } else {
      chain = 0;
      // A cut re-invents the room from cold. Only a fault when there were
      // photographs to give it: an invented cast is held by `look`, not refs.
      if (hasUploads && !shot.references.length) {
        add(
          "error",
          where,
          "A cut with no references, in a film whose cast has uploads.",
          "This shot starts cold while a real face exists for it. Name whose face it needs, or a "
          + "silent fallback picks for you.",
        );
      }
    }

    // Speech that cannot finish is cut off at the source and is unrecoverable.
    if (shot.dialogue.trim()) {
      const w = words(spoken(shot.dialogue));
      const needed = w / WORDS_PER_SEC;
      if (needed > secs - 0.5) {
        add(
          "error",
          where,
          `${w} words in ${secs}s.`,
          `Needs about ${needed.toFixed(1)}s to speak. Lengthen the shot or shorten the line — a `
          + "word cut off at the source stays cut off.",
        );
      }
    }

    if (shot.move && TRICK_MOVES.test(shot.move) && !shot.cameraNote.trim()) {
      add(
        "warn",
        where,
        `"${shot.move}" named with no mechanics.`,
        "A named move alone renders as the ordinary move its words describe. Put the geometry in "
        + "the camera note.",
      );
    }

    if (i < shots.length - 1 && !shot.endsOn.trim()) {
      add("warn", where, "No end frame.", "It is literally what the next shot is told to open on.");
    }

    if (i > 0 && shot.carry.trim()) carried += 1;
  });

  // --- the shape of the film ----------------------------------------------
  // Nothing here can read meaning, but a plan where nothing is ever carried
  // forward has no pressure curve to read.
  if (shots.length > 2 && carried < Math.floor((shots.length - 1) / 2)) {
    add(
      "warn",
      "the plan",
      `Only ${carried} of ${shots.length - 1} cuts carry anything forward.`,
      "If you cannot say what a shot took away, it is a held pose with a camera move on it.",
    );
  }

  const order: Record<Severity, number> = { error: 0, warn: 1 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** True when the plan cannot become the film it describes. Only errors block. */
export const blocked = (findings: Finding[]): boolean => findings.some((f) => f.severity === "error");

/**
 * The gate's blocking findings, as notes the sheet already knows how to draw.
 *
 * Only the errors cross over. `boardNotes` in storyboard.ts already gives the
 * sheet its advisory warnings — beats, camera geometry, end frames — and the
 * gate re-checks several of the same things for callers that have no sheet
 * (the CLI, a skill reading a plan by hand). Showing both would print each
 * warning twice, so the division is: the gate owns what stops a render, the
 * notes own what merely costs quality.
 */
export function blockers(board: Storyboard): BoardNote[] {
  return preflight(board)
    .filter((f) => f.severity === "error")
    .map((f) => ({ shot: f.shot, severity: "block" as const, text: `${f.what} ${f.why}` }));
}

/** One line for the button: what the owner is about to walk into. */
export function summary(findings: Finding[]): string {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.length - errors;
  if (!findings.length) return "Pre-flight clear.";
  const parts = [];
  if (errors) parts.push(`${errors} ${errors === 1 ? "problem" : "problems"}`);
  if (warns) parts.push(`${warns} ${warns === 1 ? "warning" : "warnings"}`);
  return parts.join(" and ");
}
