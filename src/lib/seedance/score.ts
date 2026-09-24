// ---------------------------------------------------------------------------
// The score — a shot plan pinned to a song.
//
// A storyboard (src/lib/studio/storyboard.ts) is a run of shots whose lengths
// add up to whatever they add up to; the film is as long as the plan. A SCORE is
// the other way round: the song is the clock, every cut has a time on it, and a
// shot's length is the distance to the next cut. That single inversion is what
// "audio-driven" actually means in code — you cannot lengthen a shot here
// without moving a cut, exactly as you cannot in a cutting room.
//
// Two rules do the heavy lifting.
//
//   THE SONG IS THE MASTER. Cuts land on measured bar lines and drops, the film
//   is exactly as long as the stretch of song it covers, and a clip that comes
//   back longer than its slot is trimmed rather than allowed to push everything
//   after it out of sync. (H3 renders in whole 17-frame windows, so a clip is
//   ALWAYS a little longer than asked for — see `renderSec`. Ignoring that is
//   how a four-minute video ends up eight seconds behind its own song.)
//
//   LIP SYNC SUPERSEDES THE PROMPT. On a shot that sings, the words and their
//   timing are not one ingredient among several — they are the subject of the
//   frame, and the visual idea is demoted to the world the performance happens
//   in. `shotPrompt` writes that demotion explicitly, because a model handed a
//   sung line and a sweeping landscape in the same paragraph will render the
//   landscape and leave the singer out of it.
//
// Pure. No Web Audio, no fetch, no React — the arithmetic, the weave and the
// projection onto the existing render pipeline, all testable.
// ---------------------------------------------------------------------------

import {
  MAX_SHOT_SEC,
  MIN_SHOT_SEC,
  MAX_SHOTS,
  MAX_SUBJECT,
  type AspectRatio,
  type Beat,
  type CastMember,
  type Shot,
  type ShotLink,
  type Storyboard,
} from "@/lib/studio/storyboard";
import {
  VISUAL_MODES,
  barSec,
  fmt,
  barTimes,
  sectionAt,
  wordsIn,
  type AudioTimeline,
  type TimelineSection,
  type VisualMode,
} from "./audio/timeline";
import type { LipRange } from "./types";

/** A place the film goes, described once and reused — the location bible. */
export interface Place {
  id: string;
  /** Short and reusable, the way a shot names it: "the stairwell". */
  name: string;
  /** Everything a frame must keep about it: surfaces, light sources, weather, clutter. */
  look: string;
}

export interface ScoreShot {
  id: string;
  title: string;
  /** Where this cut starts in the song, in seconds. The one anchor. */
  atSec: number;
  /** What physically happens. On a singing shot this is the SETTING, not the subject. */
  action: string;
  /**
   * Which line or measured moment this cut answers.
   *
   * Not decoration: it is the field that makes the board reviewable. A shot
   * that cannot say what in the audio put it there is the "random clips over a
   * song" failure, caught on the sheet instead of an hour into a render.
   */
  because: string;
  framing: string;
  move: string;
  cameraNote: string;
  lensMm: number;
  aperture: string;
  /** Must match a `Place.name` to inherit its look. Free text is allowed. */
  location: string;
  beats: Beat[];
  link: ShotLink;
  carry: string;
  endsOn: string;
  /** Subject numbers from the conversation's uploads. */
  references: number[];
  /** `CastMember.name`s in this shot. */
  cast: string[];
  /**
   * Pinned by the owner. A re-plan may rewrite every other shot but must leave
   * this cut's time alone — otherwise editing a board and asking for a fix are
   * mutually exclusive, and the owner loses the one they had.
   */
  locked: boolean;
  /** Set when the owner hand-edits the woven prompt; then it wins outright. */
  prompt?: string;
  /** The drawn panel for this cut. Small: the board syncs across devices. */
  panel?: string;
}

export interface Score {
  id: string;
  name: string;
  mode: VisualMode;
  aspectRatio: AspectRatio;
  // ----- the bibles, repeated verbatim into every shot -----
  logline: string;
  /** The arc in a few sentences — the story bible. */
  story: string;
  world: string;
  look: string;
  mood: string;
  lens: string;
  lighting: string;
  grade: string;
  palette: string[];
  wardrobe: string;
  soundscape: string;
  cast: CastMember[];
  places: Place[];
  shots: ScoreShot[];
  /** Ranges of the song that are sung to camera. A shot overlapping one sings. */
  lipsync: LipRange[];
  /** The measurements this was planned against. */
  timeline: AudioTimeline | null;
}

// ----- placement -------------------------------------------------------------

export interface PlacedShot {
  shot: ScoreShot;
  index: number;
  startSec: number;
  endSec: number;
  /** The distance to the next cut — what the renderer is asked for. */
  durationSec: number;
  /** True when a lip-sync range covers enough of this shot to sing it. */
  sings: boolean;
  /** Seconds of this shot covered by a lip-sync range. */
  sungSec: number;
  /** The exact words over this stretch, when the transcript has them. */
  words: string;
  section: TimelineSection | null;
  /** Set when the slot is outside what the renderer can make in one clip. */
  fault: "short" | "long" | null;
}

/**
 * How much of a shot must be sung before the shot IS a singing shot.
 *
 * A range clipping the last half-second of a cut is a range that belongs to the
 * next cut; forcing the whole shot to be a performance because of an overhang
 * would put the singer on camera for four seconds of an instrumental.
 */
export const SINGS_SHARE = 0.34;

/** Overlap of two ranges, in seconds. */
function overlap(aFrom: number, aTo: number, bFrom: number, bTo: number): number {
  return Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom));
}

/**
 * The board as a timeline: every shot with the slot it actually occupies.
 *
 * Shots are sorted by time and each runs to the next one, so the run can never
 * overlap itself or leave a hole. The last runs to the end of the song — the
 * film is the length of the track, which is the premise.
 */
export function placeShots(score: Score): PlacedShot[] {
  const end = score.timeline?.durationSec ?? 0;
  const ordered = [...score.shots].sort((a, b) => a.atSec - b.atSec);
  return ordered.map((shot, index) => {
    const startSec = Math.max(0, shot.atSec);
    const next = ordered[index + 1];
    const endSec = next ? Math.max(startSec, next.atSec) : Math.max(startSec, end || startSec + 5);
    const durationSec = Math.round((endSec - startSec) * 1000) / 1000;
    const sungSec =
      Math.round(
        score.lipsync.reduce(
          (t, r) => t + overlap(startSec, endSec, r.startSec, r.startSec + r.durationSec),
          0,
        ) * 1000,
      ) / 1000;
    return {
      shot,
      index,
      startSec,
      endSec,
      durationSec,
      sungSec,
      sings: durationSec > 0 && sungSec / durationSec >= SINGS_SHARE,
      words: score.timeline ? wordsIn(score.timeline, startSec, endSec) : "",
      section: score.timeline ? sectionAt(score.timeline, startSec) : null,
      fault:
        durationSec < MIN_SHOT_SEC ? "short" : durationSec > MAX_SHOT_SEC ? "long" : null,
    };
  });
}

/** The shots that sing — the lip-sync board, on its own. */
export function sungShots(placed: PlacedShot[]): PlacedShot[] {
  return placed.filter((p) => p.sings);
}

/** Where the song has no shot over it at all, which renders as nothing. */
export function gaps(score: Score): { startSec: number; endSec: number }[] {
  const end = score.timeline?.durationSec ?? 0;
  const placed = placeShots(score);
  const out: { startSec: number; endSec: number }[] = [];
  let at = 0;
  for (const p of placed) {
    if (p.startSec - at > 0.25) out.push({ startSec: at, endSec: p.startSec });
    at = Math.max(at, p.endSec);
  }
  if (end - at > 0.25) out.push({ startSec: at, endSec: end });
  return out;
}

/** Share of the song a shot actually covers, 0–1. */
export function coverage(score: Score): number {
  const end = score.timeline?.durationSec ?? 0;
  if (!end) return 0;
  const covered = placeShots(score).reduce((t, p) => t + p.durationSec, 0);
  return Math.max(0, Math.min(1, covered / end));
}

/**
 * The length the renderer will really produce for a slot.
 *
 * H3 renders whole latent windows — 107 frames, then 17 at a time, at 24 fps —
 * so a clip is always a little LONGER than the seconds it was asked for. On an
 * ordinary storyboard that is invisible. On a score it is cumulative drift
 * against the song, which is why the finished cut trims every clip back to its
 * slot instead of concatenating what came out of the GPU.
 */
export function renderSec(seconds: number): number {
  const want = Math.round(Math.min(MAX_SHOT_SEC, Math.max(MIN_SHOT_SEC, seconds || 5)) * 24);
  const frames = 107 + 17 * Math.max(0, Math.ceil((want - 107) / 17));
  return Math.round((frames / 24) * 1000) / 1000;
}

// ----- the weave -------------------------------------------------------------

const NO_ARTEFACTS =
  "No text, captions, watermarks, logos, split screens, letterboxing, montage or scene changes. "
  + "No morphing, warping, duplicated limbs or extra fingers.";

/** The film-wide fields, repeated word for word into every shot. */
function bible(score: Score): string {
  return [
    score.world && `World: ${score.world.replace(/\.\s*$/, "")}.`,
    score.mood && `Genre and treatment: ${score.mood.replace(/\.\s*$/, "")}.`,
    score.wardrobe && `Wardrobe, unchanged: ${score.wardrobe.replace(/\.\s*$/, "")}.`,
    score.lighting && `Light: ${score.lighting.replace(/\.\s*$/, "")}.`,
    score.grade && `Grade: ${score.grade.replace(/\.\s*$/, "")}.`,
    score.lens && `Glass: ${score.lens.replace(/\.\s*$/, "")}.`,
  ]
    .filter(Boolean)
    .join(" ") + " ";
}

/** The place this shot is in, from the location bible when it names one. */
function placeOf(score: Score, shot: ScoreShot): string {
  const place = score.places.find((p) => p.name.toLowerCase() === shot.location.trim().toLowerCase());
  if (!place) return shot.location ? `Location: ${shot.location}. ` : "";
  return `Location — ${place.name}: ${place.look.replace(/\.\s*$/, "")}. `;
}

/** Who is in it, described rather than named, so the model knows a stranger. */
function castLine(score: Score, shot: ScoreShot): string {
  const named = shot.cast
    .map((name) => score.cast.find((c) => c.name.toLowerCase() === name.toLowerCase()))
    .filter((c): c is CastMember => Boolean(c));
  if (!named.length) return "";
  return named.map((c) => `${c.name} — ${c.look.replace(/\.\s*$/, "")}.`).join(" ") + " ";
}

function continuity(score: Score, placed: PlacedShot[], index: number): string {
  const p = placed[index];
  const previous = placed[index - 1];
  if (!previous) return "";
  const parts: string[] = [];
  if (p.shot.link === "continuous") {
    parts.push(
      "This is the SAME TAKE as the shot before it, continuing without a cut: it opens on the exact "
      + `frame that one closed on — ${previous.shot.endsOn || "the frame the camera finished on"}.`,
    );
  } else if (previous.shot.endsOn) {
    parts.push(`The previous cut ended on ${previous.shot.endsOn.replace(/\.\s*$/, "")}; this is a new angle.`);
  }
  if (p.shot.carry) parts.push(`Carried over and unchanged: ${p.shot.carry.replace(/\.\s*$/, "")}.`);
  return parts.length ? `${parts.join(" ")} ` : "";
}

function beatLine(shot: ScoreShot): string {
  if (!shot.beats.length) return "";
  return (
    "The shot's clock, and it must be met: "
    + shot.beats.map((b) => `at ${b.at.toFixed(1)}s ${b.text.replace(/\.\s*$/, "")}`).join("; ")
    + ". "
  );
}

function cameraLine(shot: ScoreShot): string {
  const parts = [
    `${shot.framing || "medium"} on a ${shot.lensMm}mm at ${shot.aperture || "f/2.8"}`,
    shot.move ? `camera: ${shot.move}` : "",
  ].filter(Boolean);
  const note = shot.cameraNote ? ` ${shot.cameraNote.replace(/\.\s*$/, "")}.` : "";
  return `${parts.join(", ")}.${note} `;
}

/**
 * The performance block — the reason this file exists.
 *
 * Everything here is written as an override rather than as a description,
 * because the failure it prevents is specific and reliable: given a sung line
 * and an interesting visual idea in the same prompt, a video model renders the
 * idea and forgets the mouth. So the words are stated as the subject, the frame
 * is constrained to keep the mouth readable, and the shot's own action is
 * explicitly reduced to the setting around the performance.
 */
function performance(p: PlacedShot, score: Score): string {
  const words = p.words.trim();
  const share = p.durationSec > 0 ? p.sungSec / p.durationSec : 0;
  const lines: string[] = [
    "THIS SHOT IS A SUNG PERFORMANCE TO CAMERA, and that outranks everything else described here.",
  ];
  if (words) {
    lines.push(
      `The performer sings these exact words across the shot, and only these: "${words}". Their mouth `
      + "shapes these words — the consonants land, the vowels open, the jaw moves with the phrasing.",
    );
  } else {
    lines.push(
      "The performer sings the vocal line of the track to camera. No words were transcribed for this "
      + "stretch, so do not put specific lyrics in their mouth — render singing, with the mouth "
      + "moving continuously and musically rather than mouthing anything in particular.",
    );
  }
  lines.push(
    "The performer is ON CAMERA for the whole shot, facing close enough to camera that the sync reads: "
    + "the face is unobstructed, the mouth is clearly visible and large in frame, and nothing crosses "
    + "in front of it. Framing no wider than a medium shot.",
  );
  if (share < 0.98) {
    lines.push(
      `They sing for the first ${p.sungSec.toFixed(1)} of these ${p.durationSec.toFixed(1)} seconds and `
      + "hold the performance for the rest.",
    );
  }
  lines.push(
    "Anything below that would take them off camera, hide the face, cut away, or replace them with "
    + "scenery is subordinate to this and must not happen — it describes the WORLD THIS PERFORMANCE "
    + `IS IN, not a shot of its own.${score.mode === "lyric-video" ? "" : ""}`,
  );
  return lines.join(" ") + " ";
}

/** What a non-singing shot is told about the sound, so it does not invent a singer. */
function silent(score: Score): string {
  return (
    "Nobody in this shot speaks or sings, and no mouth mimes along: this cut plays UNDER the music. "
    + `${score.soundscape ? `Its own sound is ${score.soundscape.replace(/\.\s*$/, "")}. ` : ""}`
  );
}

/**
 * One shot, woven into the prompt it is rendered from.
 *
 * `index` is into the PLACED order, not `score.shots` — the board is sorted by
 * time and the prompt has to agree with the film.
 */
export function shotPrompt(score: Score, index: number): string {
  const placed = placeShots(score);
  const p = placed[index];
  if (!p) return "";
  if (p.shot.prompt) return p.shot.prompt;

  const n = index + 1;
  const of = placed.length;
  const secs = p.durationSec.toFixed(1);
  const head =
    `A ${secs}-second ${score.look} shot — cut ${n} of ${of} of one continuous music film, `
    + `covering ${fmt(p.startSec)}–${fmt(p.endSec)} of the track`
    + `${p.section ? ` (the ${p.section.provisional}, energy ${p.section.level})` : ""}. `;

  const body =
    `${bible(score)}${placeOf(score, p.shot)}${castLine(score, p.shot)}`
    + `${continuity(score, placed, index)}`
    + `${p.sings ? performance(p, score) : silent(score)}`
    + `${p.shot.action.replace(/\.\s*$/, "")}. `
    + `${beatLine(p.shot)}${cameraLine(p.shot)}`
    + `${p.shot.endsOn ? `The shot finishes on ${p.shot.endsOn.replace(/\.\s*$/, "")}. ` : ""}`
    + "Motion is natural and physically coherent, with real weight and momentum; identity, "
    + "proportions and wardrobe stay stable throughout. "
    + NO_ARTEFACTS;

  return [
    `integrated_multimodal_description: ${head}${body}`,
    `overall_soundscape: ${
      p.sings
        ? "The performer's sung vocal, present and forward in the mix."
        : score.soundscape || "The natural sound of the scene, in stereo."
    }`,
    // The real track is laid under the finished cut by the renderer, so asking
    // H3 for music here would put a second, different song inside the clip.
    "non_diegetic_music: none",
  ].join("\n");
}

// ----- projection onto the render pipeline -----------------------------------

/**
 * The score as an ordinary storyboard, ready for the existing film pipeline.
 *
 * Each shot's prompt is woven HERE and baked into `Shot.prompt`, which
 * storyboard.ts treats as final. That is deliberate: the audio-aware weave
 * (the performance override, the song timecodes, the section) has no place in a
 * general storyboard, and this way the score gets the whole rendering,
 * chaining, progress and ETA machinery without either file learning about the
 * other's job.
 */
export function toStoryboard(score: Score): Storyboard {
  const placed = placeShots(score);
  return {
    title: score.name,
    logline: score.logline,
    world: score.world,
    look: score.look,
    mood: score.mood,
    aspectRatio: score.aspectRatio,
    lens: score.lens,
    lighting: score.lighting,
    grade: score.grade,
    palette: score.palette,
    wardrobe: score.wardrobe,
    soundscape: score.soundscape,
    music: "none",
    cast: score.cast,
    shots: placed.map((p, i): Shot => ({
      id: p.shot.id,
      title: p.shot.title,
      // Clamped, because the renderer cannot make a clip outside its window and
      // a board with a fault must still be renderable up to that fault.
      durationSec: Math.min(MAX_SHOT_SEC, Math.max(MIN_SHOT_SEC, p.durationSec)),
      lensMm: p.shot.lensMm,
      aperture: p.shot.aperture,
      move: p.shot.move,
      cameraNote: p.shot.cameraNote,
      framing: p.shot.framing,
      location: p.shot.location,
      action: p.shot.action,
      beats: p.shot.beats,
      dialogue: "",
      link: i === 0 ? "open" : p.shot.link === "continuous" ? "continuous" : "cut",
      carry: p.shot.carry,
      endsOn: p.shot.endsOn,
      references: p.shot.references,
      prompt: shotPrompt(score, i),
      ...(p.shot.panel ? { panel: p.shot.panel } : {}),
    })),
  };
}

// ----- the trust boundary ----------------------------------------------------

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000)) : fallback;
};

const HEX = /^#[0-9a-f]{3,8}$/i;
const ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1"];
const MODES: VisualMode[] = ["music-video", "lyric-video", "story", "voiceover", "reaction", "cinematic"];

/** An array off the wire, capped. A non-array is nothing, not a crash. */
function list(v: unknown, limit: number): unknown[] {
  return Array.isArray(v) ? v.slice(0, limit) : [];
}

function idOf(v: unknown, fallback: string): string {
  return str(v, 40).replace(/[^a-zA-Z0-9_-]/g, "") || fallback;
}

function beatList(v: unknown): Beat[] {
  if (!Array.isArray(v)) return [];
  const out: Beat[] = [];
  for (const b of v.slice(0, 20)) {
    const r = (b ?? {}) as Record<string, unknown>;
    const text = str(r.text ?? r.action, 300);
    if (text) out.push({ at: num(r.at ?? r.t, 0, MAX_SHOT_SEC, 0), text });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 10);
}

function subjects(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const ok = v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SUBJECT);
  return [...new Set(ok)].slice(0, 6);
}

/**
 * The director's JSON, made safe to render and to edit.
 *
 * Returns null when there is no film in it. A score with no shots is not a
 * score, and a board of zero rows would be reported to the owner as a plan.
 */
export function cleanScore(raw: unknown, timeline: AudioTimeline | null): Score | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const end = timeline?.durationSec ?? 0;

  const cast: CastMember[] = [];
  for (const c of Array.isArray(o.cast) ? o.cast.slice(0, 8) : []) {
    const r = (c ?? {}) as Record<string, unknown>;
    const name = str(r.name, 60);
    if (!name) continue;
    const turnsInto = str(r.turns_into ?? r.turnsInto, 1000);
    const turnsAt = num(r.turns_at ?? r.turnsAt, 1, MAX_SHOTS, 0);
    cast.push({
      id: idOf(r.id, `cast-${cast.length + 1}`),
      name,
      look: str(r.look ?? r.description, 1000),
      subject: subjects([r.subject])[0] ?? null,
      turnsAt: turnsInto && turnsAt >= 1 ? Math.round(turnsAt) : null,
      turnsInto: turnsAt >= 1 ? turnsInto : "",
    });
  }

  const places: Place[] = [];
  for (const p of list(o.places ?? o.locations, 12)) {
    const r = (p ?? {}) as Record<string, unknown>;
    const name = str(r.name, 80);
    if (!name) continue;
    places.push({ id: idOf(r.id, `place-${places.length + 1}`), name, look: str(r.look ?? r.description, 800) });
  }

  const shots: ScoreShot[] = [];
  for (const s of Array.isArray(o.shots) ? o.shots.slice(0, MAX_SHOTS) : []) {
    const r = (s ?? {}) as Record<string, unknown>;
    const action = str(r.action, 1200);
    const title = str(r.title, 90);
    if (!action && !title) continue;
    const at = num(r.at_sec ?? r.atSec ?? r.start_sec ?? r.startSec, 0, end || 86_400, 0);
    shots.push({
      id: idOf(r.id, `shot-${shots.length + 1}`),
      title: title || `Cut ${shots.length + 1}`,
      atSec: at,
      action,
      because: str(r.because ?? r.why, 400),
      framing: str(r.framing, 60) || "medium",
      move: str(r.move, 80) || "static",
      cameraNote: str(r.camera_note ?? r.cameraNote, 900),
      lensMm: num(r.lens_mm ?? r.lensMm, 8, 300, 35),
      aperture: str(r.aperture, 20) || "f/2.8",
      location: str(r.location, 160),
      beats: beatList(r.beats),
      link: str(r.link, 20).toLowerCase().startsWith("cont") ? "continuous" : "cut",
      carry: str(r.carry, 600),
      endsOn: str(r.ends_on ?? r.endsOn, 400),
      references: subjects(r.references),
      cast: (Array.isArray(r.cast) ? r.cast : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 8),
      locked: false,
      ...(str(r.prompt, 6000) ? { prompt: str(r.prompt, 6000) } : {}),
      ...(typeof r.panel === "string" && r.panel.startsWith("data:image/") ? { panel: r.panel } : {}),
    });
  }
  if (!shots.length) return null;
  shots.sort((a, b) => a.atSec - b.atSec);
  // Whatever the director said, the opening cut has nothing to continue from.
  shots[0].link = "cut";

  const lipsync: LipRange[] = [];
  for (const r of list(o.lipsync ?? o.lip_sync, 48)) {
    const x = (r ?? {}) as Record<string, unknown>;
    const startSec = num(x.start_sec ?? x.startSec, 0, end || 86_400, -1);
    const durationSec = num(x.duration_sec ?? x.durationSec, 0.2, 600, 0);
    if (startSec < 0 || durationSec <= 0) continue;
    lipsync.push({ id: idOf(x.id, `lip-${lipsync.length + 1}`), startSec, durationSec });
  }

  const mode = str(o.mode, 40).toLowerCase().replace(/[\s_]+/g, "-") as VisualMode;
  return {
    id: idOf(o.id, "score"),
    name: str(o.title ?? o.name, 120) || timeline?.name || "Untitled",
    mode: MODES.includes(mode) ? mode : "music-video",
    aspectRatio: (ASPECTS as string[]).includes(str(o.aspect_ratio ?? o.aspectRatio, 10))
      ? (str(o.aspect_ratio ?? o.aspectRatio, 10) as AspectRatio)
      : "16:9",
    logline: str(o.logline, 400),
    story: str(o.story ?? o.arc, 1200),
    world: str(o.world, 800),
    look: str(o.look, 300) || "live action, cinematic, photorealistic",
    mood: str(o.mood ?? o.genre, 900),
    lens: str(o.lens, 160) || "spherical prime set",
    lighting: str(o.lighting, 300),
    grade: str(o.grade, 300),
    palette: (Array.isArray(o.palette) ? o.palette : []).map((x) => str(x, 12)).filter((x) => HEX.test(x)).slice(0, 6),
    wardrobe: str(o.wardrobe, 600),
    soundscape: str(o.soundscape, 400),
    cast,
    places,
    shots,
    lipsync,
    timeline,
  };
}

// ----- the director's operating instructions ---------------------------------

/**
 * What the director is told, on top of the measured brief.
 *
 * The tool's own description carries the craft; this carries the facts about
 * THIS track that decide whether the plan is even renderable — how many cuts
 * fit, where they may land, how long the render will take. A director that has
 * to infer the shot budget from a duration writes a forty-cut plan for a song
 * that has room for twenty.
 */
export function scoreRules(timeline: AudioTimeline, mode: unknown): string {
  const requested = typeof mode === "string" ? (mode as VisualMode) : "music-video";
  const known = ["music-video", "lyric-video", "story", "voiceover", "reaction", "cinematic"];
  const chosen: VisualMode = known.includes(requested) ? requested : "music-video";
  const bars = barTimes(timeline.grid);
  const min = Math.ceil(timeline.durationSec / MAX_SHOT_SEC);
  const max = Math.floor(timeline.durationSec / MIN_SHOT_SEC);

  const out: string[] = [
    "AUDIO-DRIVEN MODE. The owner attached a track, so this job is a SCORE, not a storyboard:",
    "call studio_score and never studio_storyboard. The audio above is the clock.",
    "",
    `The owner is making a ${chosen.replace(/-/g, " ")}.`,
    `${VISUAL_MODES.find((m) => m.id === chosen)?.note ?? ""}`,
    "",
    "THE SHOT BUDGET, from this track's own length:",
    `- The film is ${timeline.durationSec.toFixed(1)}s, exactly as long as the song.`,
    `- A clip can be ${MIN_SHOT_SEC}-${MAX_SHOT_SEC}s, so this track takes between ${min} and ${max} cuts.`,
    `- ${
      max > MAX_SHOTS
        ? `The board holds at most ${MAX_SHOTS} cuts, so use ${MAX_SHOTS} or fewer and let the quieter `
          + "stretches run long."
        : "Aim for the middle of that range unless the music argues otherwise."
    }`,
    "- Every cut renders separately on the owner's own GPU at roughly 6 minutes per 5 seconds of "
      + "footage, one at a time, for free. Twenty cuts is a couple of hours. Say the estimate out loud "
      + "so the owner can decide before they start it.",
  ];

  if (bars.length && timeline.grid.confidence >= 0.4) {
    out.push(
      "",
      "WHERE CUTS MAY LAND. Use the bar lines above, verbatim, as your at_sec values. Do not compute "
        + "your own — the grid was measured and yours will drift.",
      `A bar is ${barSec(timeline.grid).toFixed(3)}s, so a comfortable cut is every 2, 4 or 8 bars `
        + `(${(barSec(timeline.grid) * 2).toFixed(2)}s, ${(barSec(timeline.grid) * 4).toFixed(2)}s or `
        + `${(barSec(timeline.grid) * 8).toFixed(2)}s). Four bars is the default; two through a chorus; `
        + "eight through something slow.",
    );
  } else {
    out.push(
      "",
      "WHERE CUTS MAY LAND. There is no reliable grid on this track, so ignore bar lines and cut on "
        + "MEANING instead: the section boundaries, the moments listed above, and where the words turn.",
    );
  }

  if (timeline.lines?.length) {
    out.push(
      "",
      "LIP SYNC. The vocal lines above are where someone is singing. Choose the stretches you want to "
        + "SEE sung and put a lipsync range on each — their exact times, so the words and the mouth "
        + "agree. Leave the rest for everything else the film is about; a music video that never cuts "
        + "away from the singer is a performance video, and one that never cuts to them has no anchor. "
        + "A third to a half of the runtime as performance is a normal music video.",
    );
  } else {
    out.push(
      "",
      "LIP SYNC. No words were transcribed, so there is nothing to sync to. Leave `lipsync` empty "
        + "unless the owner tells you where a performance belongs — a lip-sync shot with no words "
        + "renders a mouth moving to nothing in particular.",
    );
  }

  return out.filter((l) => l !== "").length ? out.join("\n") : "";
}

// ----- what is wrong with the board -----------------------------------------

export interface ScoreNote {
  kind: "error" | "warn" | "info";
  /** The placed index this is about, or null for the whole board. */
  shot: number | null;
  text: string;
}

/**
 * Everything wrong with the plan, before an hour of GPU finds it.
 *
 * Ordered by what actually ruins a film: a slot the renderer cannot make at
 * all, then sync, then continuity, then the things that merely make it worse.
 */
export function scoreNotes(score: Score): ScoreNote[] {
  const out: ScoreNote[] = [];
  const placed = placeShots(score);
  const t = score.timeline;

  for (const p of placed) {
    if (p.fault === "short") {
      out.push({
        kind: "error",
        shot: p.index,
        text: `${p.durationSec.toFixed(1)}s is shorter than the ${MIN_SHOT_SEC}s the renderer can make. `
          + "Move the next cut later, or delete this one.",
      });
    }
    if (p.fault === "long") {
      out.push({
        kind: "error",
        shot: p.index,
        text: `${p.durationSec.toFixed(1)}s is longer than the ${MAX_SHOT_SEC}s a single clip can be. `
          + "Split it — add a cut in the middle.",
      });
    }
  }

  // Sync: a cut that misses the bar it was aiming for.
  if (t && t.grid.confidence >= 0.4) {
    const bars = barTimes(t.grid);
    for (const p of placed) {
      if (!bars.length) break;
      const nearest = bars.reduce((a, b) => (Math.abs(b - p.startSec) < Math.abs(a - p.startSec) ? b : a));
      const off = Math.abs(nearest - p.startSec);
      // An eighth of a beat is about where a miss stops being felt as a miss.
      if (off > t.grid.period / 8 && off < t.grid.period) {
        out.push({
          kind: "warn",
          shot: p.index,
          text: `Cuts ${(off * 1000).toFixed(0)} ms off the bar line at ${nearest.toFixed(2)}s. Snap it.`,
        });
      }
    }
  }

  // The performance rule: a singing shot with nobody in it.
  for (const p of sungShots(placed)) {
    if (!p.shot.cast.length) {
      out.push({
        kind: "warn",
        shot: p.index,
        text: "Sings, but names nobody from the cast — the render has no face to put the words in.",
      });
    }
    if (/\b(empty|landscape|aerial|drone|cityscape|no one|nobody|abstract)\b/i.test(p.shot.action)) {
      out.push({
        kind: "warn",
        shot: p.index,
        text: "Sings, but the action describes a shot with no performer in it. The performance wins, so "
          + "this will render as a singer in that place — make that the intention or move the lip-sync range.",
      });
    }
  }

  for (const g of gaps(score)) {
    out.push({
      kind: "error",
      shot: null,
      text: `Nothing covers ${fmt(g.startSec)}–${fmt(g.endSec)} — that stretch of the song renders as black.`,
    });
  }

  if (t && !t.lines?.length) {
    out.push({
      kind: "info",
      shot: null,
      text: "No words for this track, so lip-sync shots render singing without specific lyrics. Paste "
        + "the lyrics, or transcribe it, to tighten the sync.",
    });
  }

  for (const p of placed) {
    if (!p.shot.because) {
      out.push({ kind: "info", shot: p.index, text: "Does not say what in the audio put it here." });
    }
    if (p.durationSec > 6 && !p.shot.beats.length) {
      out.push({
        kind: "warn",
        shot: p.index,
        text: `${p.durationSec.toFixed(1)}s with no clock inside it will render as a held pose. Give it beats.`,
      });
    }
    if (!p.shot.endsOn) {
      out.push({ kind: "info", shot: p.index, text: "No ending frame, so the next cut has nothing to open on." });
    }
  }

  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

/** A blank score, for the app before a director has run. */
export function blankScore(timeline: AudioTimeline | null): Score {
  return {
    id: "score",
    name: timeline?.name ?? "Untitled",
    mode: "music-video",
    aspectRatio: "16:9",
    logline: "",
    story: "",
    world: "",
    look: "live action, cinematic, photorealistic",
    mood: "",
    lens: "spherical prime set",
    lighting: "",
    grade: "",
    palette: [],
    wardrobe: "",
    soundscape: "",
    cast: [],
    places: [],
    shots: [],
    lipsync: [],
    timeline,
  };
}
