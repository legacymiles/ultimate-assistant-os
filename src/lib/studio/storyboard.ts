// ---------------------------------------------------------------------------
// The shot plan — one film, cut into clips H3 can actually render.
//
// H3 renders 4–15 seconds at a time. A minute of film is therefore a dozen
// separate generations, and the only thing standing between "a dozen clips"
// and "one film" is what each clip is told about the one before it. That is
// what this file is: the board the owner edits, and the prompt each shot is
// rendered from, woven so that shot N carries shot N-1 forward.
//
// Continuity happens twice, because one pass is never enough:
//
//   IN WORDS   every shot repeats the wardrobe, the light, the grade, the lens
//              and the world sentence VERBATIM — the same strings, not
//              paraphrases, because a paraphrase is a different film — and
//              names the frame the previous camera finished on.
//   IN PIXELS  a shot linked "continuous" is rendered first-frame-to-video from
//              the LAST FRAME of the shot before it (H3 FL2VA), so the join is
//              not a match, it is the same frame. A shot linked "cut" is a
//              deliberate new angle and gets the reference photos instead
//              (H3 Ref2VA), which is what holds the faces steady across it.
//
// Both prompts are written in H3's OWN sections — subject_definitions /
// retention_analysis / detailed_description for Ref2VA, and
// integrated_multimodal_description for FL2VA. That is not decoration: the
// retention section is the part of the format that exists to say what must not
// change, which is exactly the job here.
//
// Nothing in this file talks to a model or a GPU. It is the board, the weave
// and the arithmetic behind the progress bar, so all three can be tested.
// ---------------------------------------------------------------------------

export type AspectRatio = "16:9" | "9:16" | "1:1";

/** How a shot joins the one before it. The first shot is always "open". */
export type ShotLink = "open" | "continuous" | "cut";

/** Somebody or something that must look the same in every shot it appears in. */
export interface CastMember {
  id: string;
  /** Short and shouted, the way a call sheet writes it: "FATHER". */
  name: string;
  /** Everything a frame must keep: face, build, hair, skin, distinguishing marks. */
  look: string;
  /** The upload that shows them, as a conversation Subject number. */
  subject: number | null;
}

export interface Shot {
  id: string;
  /** "Cut 3 — the turn". */
  title: string;
  /** 4–15; H3's window. */
  durationSec: number;
  lensMm: number;
  aperture: string;
  /** "slow push-in", "handheld track", "static". Free text: the deck is wide. */
  move: string;
  /** "medium", "close-up", "wide". */
  framing: string;
  /** What physically happens across these seconds. */
  action: string;
  /** "NAME: line", or empty. */
  dialogue: string;
  link: ShotLink;
  /** What must survive from the shot before — props, blocking, damage, weather. */
  carry: string;
  /** The frame this shot finishes on, so the next one can start there. */
  endsOn: string;
  /** Subject numbers from the conversation's uploads. */
  references: number[];
  /** Set once the owner hand-edits the woven prompt; then it wins outright. */
  prompt?: string;
}

export interface Storyboard {
  title: string;
  logline: string;
  /** One sentence that fingerprints the whole film; read into every shot. */
  world: string;
  /** "live action, anamorphic, sunlit". */
  look: string;
  aspectRatio: AspectRatio;
  /** "ANAMORPHIC PRIME SET" — the same glass all the way through. */
  lens: string;
  lighting: string;
  grade: string;
  /** 4–6 hexes. */
  palette: string[];
  /** What everyone is wearing, unchanged unless a shot says otherwise. */
  wardrobe: string;
  soundscape: string;
  /** Score under the whole film, or "none" — H3 asks for it by name. */
  music: string;
  cast: CastMember[];
  shots: Shot[];
}

// ----- the trust boundary ----------------------------------------------------

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 10) / 10)) : fallback;
};

const ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1"];
const HEX = /^#[0-9a-f]{3,8}$/i;

/** H3's window. Asking for 30 seconds does not make a 30-second clip exist. */
export const MIN_SHOT_SEC = 4;
export const MAX_SHOT_SEC = 15;
/** Long enough for a real short, short enough that the owner can still read it. */
export const MAX_SHOTS = 24;
/** The conversation numbers uploads 1…24; a reference outside that is a typo. */
export const MAX_SUBJECT = 24;

function subjectNumbers(v: unknown, max: number): number[] {
  if (!Array.isArray(v)) return [];
  const seen = v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SUBJECT);
  return [...new Set(seen)].slice(0, max);
}

/**
 * The model's loose JSON, made safe to render and to edit. Returns null when
 * there is no film in it — a board with no shots is not a board.
 */
export function cleanStoryboard(raw: unknown): Storyboard | null {
  const o = (raw ?? {}) as Record<string, unknown>;

  const cast: CastMember[] = [];
  for (const c of Array.isArray(o.cast) ? o.cast.slice(0, 8) : []) {
    const r = (c ?? {}) as Record<string, unknown>;
    const name = str(r.name, 60);
    if (!name) continue;
    cast.push({
      id: str(r.id, 40).replace(/[^a-zA-Z0-9_-]/g, "") || `cast-${cast.length + 1}`,
      name,
      look: str(r.look ?? r.description, 1000),
      subject: subjectNumbers([r.subject], 1)[0] ?? null,
    });
  }

  const shots: Shot[] = [];
  for (const s of Array.isArray(o.shots) ? o.shots.slice(0, MAX_SHOTS) : []) {
    const r = (s ?? {}) as Record<string, unknown>;
    const action = str(r.action, 1200);
    const title = str(r.title, 90);
    // A shot with neither a beat nor a name is a blank row, not a shot.
    if (!action && !title) continue;
    shots.push({
      id: str(r.id, 40).replace(/[^a-zA-Z0-9_-]/g, "") || `shot-${shots.length + 1}`,
      title: title || `Cut ${shots.length + 1}`,
      durationSec: num(r.duration_sec ?? r.durationSec, MIN_SHOT_SEC, MAX_SHOT_SEC, 5),
      lensMm: num(r.lens_mm ?? r.lensMm, 8, 300, 35),
      aperture: str(r.aperture, 20) || "f/2.8",
      move: str(r.move, 80) || "static",
      framing: str(r.framing, 60) || "medium",
      action,
      dialogue: str(r.dialogue, 600),
      link: linkOf(r.link, shots.length),
      carry: str(r.carry, 600),
      endsOn: str(r.ends_on ?? r.endsOn, 400),
      references: subjectNumbers(r.references, 6),
      ...(str(r.prompt, 6000) ? { prompt: str(r.prompt, 6000) } : {}),
    });
  }
  if (!shots.length) return null;
  // Whatever the model said, the first shot has nothing to carry on from.
  shots[0].link = "open";

  return {
    title: str(o.title, 120) || "Untitled film",
    logline: str(o.logline, 400),
    world: str(o.world, 800),
    look: str(o.look, 300) || "live action, cinematic, photorealistic",
    aspectRatio: (ASPECTS as string[]).includes(str(o.aspect_ratio ?? o.aspectRatio, 10))
      ? (str(o.aspect_ratio ?? o.aspectRatio, 10) as AspectRatio)
      : "16:9",
    lens: str(o.lens, 160) || "spherical prime set",
    lighting: str(o.lighting, 300),
    grade: str(o.grade, 300),
    palette: (Array.isArray(o.palette) ? o.palette : [])
      .map((x) => str(x, 12))
      .filter((x) => HEX.test(x))
      .slice(0, 6),
    wardrobe: str(o.wardrobe, 600),
    soundscape: str(o.soundscape, 400),
    music: str(o.music, 300) || "none",
    cast,
    shots,
  };
}

function linkOf(v: unknown, index: number): ShotLink {
  if (index === 0) return "open";
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s.startsWith("cont") || s === "same-take" || s === "none") return "continuous";
  return "cut";
}

// ----- which H3 the shot is rendered by --------------------------------------

/**
 * Ref2VA holds a face across a cut; FL2VA continues a take from a frame.
 *
 * A "continuous" shot is chained off the previous clip's last frame, and that
 * frame already IS the person — so it goes to FL2VA and the reference photos
 * would only fight it. Everything else that has references goes to Ref2VA.
 */
export type H3Form = "ref2va" | "fl2va";

/**
 * What the render is actually going to attach.
 *
 * The board names uploads by number, but a shot can also be carried by someone
 * the conversation @-mentioned out of the photo library, who has no number at
 * all. The caller knows which pictures really went with the job, so it can say
 * so here; without that, the shot's own reference numbers are the best guess.
 */
export interface AttachedRefs {
  /** One label per attached picture, in the order H3 will see them. */
  refLabels?: string[];
}

function attachedCount(board: Storyboard, index: number, opts: AttachedRefs): number {
  return opts.refLabels ? opts.refLabels.length : (board.shots[index]?.references.length ?? 0);
}

/** Is this shot chained onto the last frame of the one before it? */
export function isChained(board: Storyboard, index: number): boolean {
  return index > 0 && board.shots[index]?.link === "continuous";
}

export function h3Form(board: Storyboard, index: number, opts: AttachedRefs = {}): H3Form {
  const shot = board.shots[index];
  if (!shot) return "fl2va";
  if (isChained(board, index)) return "fl2va";
  return attachedCount(board, index, opts) > 0 ? "ref2va" : "fl2va";
}

// ----- the weave -------------------------------------------------------------

const clause = (label: string, text: string): string => (text ? `${label} ${text.replace(/\.\s*$/, "")}. ` : "");

/** The film's fixed facts, written the same way into every single shot. */
function bible(board: Storyboard): string {
  return (
    clause("The world of the film:", board.world) +
    clause("Wardrobe, unchanged for the whole film:", board.wardrobe) +
    clause("Lighting, unchanged:", board.lighting) +
    clause("Colour grade, unchanged:", board.grade) +
    (board.palette.length ? `The palette is ${board.palette.join(", ")}. ` : "") +
    clause("Shot on:", board.lens)
  );
}

/** Camera, in the one sentence H3 reads best. */
function cameraLine(shot: Shot): string {
  return `The camera is a ${shot.lensMm}mm ${shot.aperture} ${shot.framing}, ${shot.move}, with no cuts.`;
}

/** What binds this shot to the one before it — the whole point of the file. */
function continuity(board: Storyboard, index: number): string {
  const shot = board.shots[index];
  const prev = index > 0 ? board.shots[index - 1] : null;
  if (!prev) {
    return (
      "This is the opening shot of the film and it sets the light, the grade and the wardrobe that every later "
      + "shot must match. "
    );
  }
  const from = prev.endsOn
    ? `The previous shot ended on: ${prev.endsOn.replace(/\.\s*$/, "")}. `
    : `The previous shot was: ${prev.action.replace(/\.\s*$/, "")}. `;
  const carried = shot.carry ? `These carry over exactly: ${shot.carry.replace(/\.\s*$/, "")}. ` : "";
  return shot.link === "continuous"
    ? `${from}This shot CONTINUES that take with no cut: it opens on exactly that frame and carries the motion `
      + `straight on — same position, same light, same weather, same moment in time. Do not restart the action, do not `
      + `change location, do not cut away. ${carried}`
    : `${from}This shot is a MATCHED CUT: a new camera angle on the same scene moments later. The same people in the `
      + `same wardrobe, the same location, the same light and the same grade — only the camera has moved. ${carried}`;
}

/** The sentence a shot ends on, so the next one has somewhere to start. */
function ending(shot: Shot): string {
  return shot.endsOn ? `The shot finishes on: ${shot.endsOn.replace(/\.\s*$/, "")}. ` : "";
}

function spoken(shot: Shot): string {
  if (!shot.dialogue) return "";
  return (
    `They speak clearly, in sync: (S1) <d>[English] ${shot.dialogue.replace(/^[^:]{1,30}:\s*/, "").trim()}</d>. `
    + "The line completes naturally inside the shot with precise lip synchronisation. "
  );
}

const NO_ARTEFACTS =
  "No on-screen text, no captions, no subtitles, no watermark, no split screen, no montage and no second angle: "
  + "this is one single continuous camera take.";

/** The cast this shot actually attaches, in Subject order. */
export function castOf(board: Storyboard, index: number): CastMember[] {
  const shot = board.shots[index];
  if (!shot) return [];
  return shot.references
    .map((n) => board.cast.find((c) => c.subject === n))
    .filter((c): c is CastMember => Boolean(c));
}

/**
 * The prompt one shot is rendered from, in H3's own sections.
 *
 * An owner-edited prompt wins whole: once they have rewritten it, re-weaving
 * would quietly throw their words away.
 */
export function shotPrompt(board: Storyboard, index: number, opts: AttachedRefs = {}): string {
  const shot = board.shots[index];
  if (!shot) return "";
  if (shot.prompt) return shot.prompt;

  const n = index + 1;
  const of = board.shots.length;
  const secs = Math.round(shot.durationSec);
  const body =
    `[Shot 1] ${bible(board)}${continuity(board, index)}`
    + `${shot.action.replace(/\.\s*$/, "")}. `
    + `${cameraLine(shot)} ${spoken(shot)}${ending(shot)}`
    + `Motion is slow, natural and physically coherent; identity, proportions and wardrobe stay stable throughout. `
    + NO_ARTEFACTS;

  const tail = [
    `overall_soundscape: ${board.soundscape || "The natural sound of the scene, in stereo."}`,
    `non_diegetic_music: ${board.music || "none"}`,
  ];

  if (h3Form(board, index, opts) === "fl2va") {
    return [
      `integrated_multimodal_description: A ${secs}-second ${board.look} single take — shot ${n} of ${of} of one `
      + `continuous film. ${body}`,
      ...tail,
    ].join("\n");
  }

  // Whoever is really being attached, in the order H3 will see the pictures:
  // the caller's labels when it knows, otherwise the cast this shot named.
  const cast = castOf(board, index);
  const labels =
    opts.refLabels ?? shot.references.map((sub, i) => cast[i]?.name ?? board.cast.find((c) => c.subject === sub)?.name ?? "");
  const definitions = labels.map((name, i) => {
    const who = board.cast.find((c) => c.name === name) ?? cast[i];
    const label = `<Subject ${i + 1}>`;
    const picture = `<Picture ${i + 1}>`;
    return who
      ? `${label} is ${who.name}, the person in ${picture}${who.look ? ` — ${who.look.replace(/\.\s*$/, "")}` : ""}, `
        + "preserving their exact identity: face, skin tone, hair, build, distinguishing marks and accessories."
      : `${label} is ${name ? `${name}, ` : ""}the subject in ${picture}, preserving their exact identity, features, `
        + "proportions and details.";
  });
  const retention = labels.map((name, i) => {
    const who = board.cast.find((c) => c.name === name) ?? cast[i];
    return (
      `<Subject ${i + 1}>${who ? ` (${who.name})` : ""} (appears in [Shot 1]): fully_preserved - identity, face, hair `
      + `and proportions are unchanged, and the wardrobe stays exactly as described; only the camera angle, the light `
      + "on them and the action are new."
    );
  });

  return [
    "subject_definitions:",
    ...definitions,
    "summary:",
    `[reference generation] ${shot.title}: ${shot.action || board.logline} — shot ${n} of ${of} of one continuous `
    + `${board.look} film, cut to match the shot before it.`,
    "retention_analysis:",
    ...retention,
    "detailed_description:",
    `The target video is a ${secs}-second ${board.look} single take. ${body}`,
    ...tail,
  ].join("\n");
}

/** Every shot's prompt, in order — what the sheet shows before a render runs. */
export function filmPrompts(board: Storyboard): string[] {
  return board.shots.map((_, i) => shotPrompt(board, i));
}

/** Total running time of the finished film. */
export function runtimeSec(board: Storyboard): number {
  return board.shots.reduce((t, s) => t + s.durationSec, 0);
}

// ----- how long this will take ----------------------------------------------

/**
 * H3 is rendered in whole latent windows: 107 frames, then 17 at a time, at
 * 24 fps. The bridge rounds the same way, so a 5-second shot is really 124
 * frames and the ETA must count frames, not the seconds the owner asked for.
 */
export function framesFor(seconds: number): number {
  const want = Math.round(Math.min(MAX_SHOT_SEC, Math.max(MIN_SHOT_SEC, seconds || 5)) * 24);
  return 107 + 17 * Math.max(0, Math.ceil((want - 107) / 17));
}

export interface RenderRate {
  /** Measured on this PC: 5.7 min for 124 frames on the owner's RTX 3050. */
  secondsPerFrame: number;
  /** Loading ~20 GB of weights, paid once per session and not per shot. */
  startupSec: number;
}

export const DEFAULT_RATE: RenderRate = { secondsPerFrame: 2.76, startupSec: 0 };

export interface FilmProgressInput {
  /** Shots whose file has actually landed. */
  doneShots?: number;
  /** How long the shot in the machine has been going. */
  elapsedOnCurrentSec?: number;
}

/**
 * Seconds left in the whole film. Subtracting the time already spent on the
 * running shot is what stops the estimate sitting still and then jumping.
 */
export function etaSeconds(
  board: Storyboard,
  rate: RenderRate = DEFAULT_RATE,
  progress: FilmProgressInput = {},
): number {
  const done = Math.max(0, Math.min(board.shots.length, progress.doneShots ?? 0));
  const remaining = board.shots.slice(done).reduce((t, s) => t + framesFor(s.durationSec) * rate.secondsPerFrame, 0);
  // The stitch is ffmpeg on finished files: seconds, not minutes.
  const stitch = board.shots.length > 1 ? 8 : 0;
  return Math.max(0, Math.round(remaining + stitch + rate.startupSec - (progress.elapsedOnCurrentSec ?? 0)));
}

/** 0–1 across the whole film, weighted by frames so a 15 s shot counts more. */
export function filmProgress(
  board: Storyboard,
  progress: FilmProgressInput = {},
  rate: RenderRate = DEFAULT_RATE,
): number {
  const total = board.shots.reduce((t, s) => t + framesFor(s.durationSec), 0);
  if (!total) return 0;
  const done = Math.max(0, Math.min(board.shots.length, progress.doneShots ?? 0));
  const finished = board.shots.slice(0, done).reduce((t, s) => t + framesFor(s.durationSec), 0);
  const current = board.shots[done];
  // Inside the running shot, guess from the clock — but never let a slow render
  // claim the shot is finished. The bar stops just short until the file lands.
  const inside = current
    ? Math.min(0.97, (progress.elapsedOnCurrentSec ?? 0) / (framesFor(current.durationSec) * rate.secondsPerFrame)) *
      framesFor(current.durationSec)
    : 0;
  return Math.min(1, (finished + inside) / total);
}

/** "6 min 20 s left", and never "0 s left" while something is still running. */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "any moment now";
  if (seconds < 60) return `${Math.max(5, Math.round(seconds / 5) * 5)} s left`;
  const mins = Math.floor(seconds / 60);
  const rest = Math.round((seconds % 60) / 10) * 10;
  if (mins >= 60) return `${Math.floor(mins / 60)} h ${mins % 60} min left`;
  return rest && mins < 10 ? `${mins} min ${rest} s left` : `${mins} min left`;
}

/** "1:04" for a runtime, the way an edit bay writes it. */
export function timecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ----- editing the board -----------------------------------------------------

/** A blank shot that already matches the film it is being added to. */
export function blankShot(board: Storyboard, index: number): Shot {
  const prev = board.shots[index - 1];
  return {
    id: `shot-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    title: `Cut ${index + 1}`,
    durationSec: prev?.durationSec ?? 5,
    lensMm: prev?.lensMm ?? 35,
    aperture: prev?.aperture ?? "f/2.8",
    move: "static",
    framing: "medium",
    action: "",
    dialogue: "",
    link: index === 0 ? "open" : "cut",
    carry: "",
    endsOn: "",
    references: prev ? [...prev.references] : [],
  };
}

/**
 * Put the shots back in order after an edit: renumber the untouched titles,
 * and make sure the first shot never claims to continue anything.
 */
export function normalise(board: Storyboard): Storyboard {
  const shots = board.shots.map((s, i) => ({
    ...s,
    link: i === 0 ? ("open" as const) : s.link === "open" ? ("cut" as const) : s.link,
    title: /^Cut \d+$/.test(s.title) ? `Cut ${i + 1}` : s.title,
  }));
  return { ...board, shots };
}

// ----- the runtime, as a thing the owner sets --------------------------------
//
// Running time is the first question anyone asks of a film and the last thing a
// shot plan makes editable: it is the SUM of a dozen little numbers, so wanting
// forty-five seconds means arithmetic across twelve rows. These four give the
// sheet a total that can be typed into.
//
// Two ways to honour a new total, because they are genuinely different edits:
// spreading it over the cuts that exist (arithmetic, instant, free), and asking
// the model to re-plan (different cuts, rewritten beats). Only the second can
// change how many cuts there are, so only the second can reach a runtime the
// current row count cannot hold.

/** "45", "0:45", "1:30", "90s", "1m30" → seconds. Null when it isn't a time. */
export function parseRuntime(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  const clock = /^(\d{1,3}):([0-5]?\d)$/.exec(s);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const spoken = /^(?:(\d{1,3})\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d{1,3})\s*s(?:ec(?:ond)?s?)?)?$/.exec(s);
  if (spoken && (spoken[1] || spoken[2])) return Number(spoken[1] ?? 0) * 60 + Number(spoken[2] ?? 0);
  const bare = /^\d{1,4}(?:\.\d+)?$/.exec(s);
  if (bare) return Math.round(Number(s));
  return null;
}

/** The runtimes a film of this many cuts can actually be. */
export function runtimeRange(shotCount: number): { min: number; max: number } {
  const n = Math.max(0, Math.min(MAX_SHOTS, Math.round(shotCount)));
  return { min: n * MIN_SHOT_SEC, max: n * MAX_SHOT_SEC };
}

/**
 * Re-time the cuts that exist so they add up to `targetSec`.
 *
 * Proportional, so a shot the owner deliberately made the long one stays the
 * long one; the seconds that rounding drops are handed back biggest-remainder
 * first, and each shot stays inside H3's 4–15 s window, which is why the result
 * is clamped to `runtimeRange` rather than hitting any number asked for.
 */
export function fitRuntime(board: Storyboard, targetSec: number): Storyboard {
  const n = board.shots.length;
  if (!n) return board;
  const { min, max } = runtimeRange(n);
  const target = Math.round(Math.min(max, Math.max(min, targetSec)));
  const current = runtimeSec(board);
  const share = board.shots.map((s) => (current > 0 ? s.durationSec / current : 1 / n) * target);
  const secs = share.map((v) => Math.min(MAX_SHOT_SEC, Math.max(MIN_SHOT_SEC, Math.floor(v))));
  const order = share.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);

  let left = target - secs.reduce((t, v) => t + v, 0);
  // Round-robin rather than dumping the remainder on one shot: a second here is
  // 24 frames of render time, and piling them all on the first cut would quietly
  // rewrite the rhythm the owner planned.
  for (let pass = 0; left !== 0 && pass <= MAX_SHOT_SEC; pass += 1) {
    let moved = false;
    for (const { i } of order) {
      if (left === 0) break;
      const step = left > 0 ? 1 : -1;
      const next = secs[i] + step;
      if (next < MIN_SHOT_SEC || next > MAX_SHOT_SEC) continue;
      secs[i] = next;
      left -= step;
      moved = true;
    }
    if (!moved) break;
  }
  return { ...board, shots: board.shots.map((s, i) => ({ ...s, durationSec: secs[i] })) };
}

/**
 * The sheet as plain text, for a model that has to re-plan it.
 *
 * The board lives in this browser and never travelled to the route, so a
 * re-plan that isn't handed the current sheet invents a second, different film.
 */
export function boardBrief(board: Storyboard): string {
  const fact = (label: string, value: string) => (value.trim() ? `${label}: ${value.trim()}` : "");
  return [
    `TITLE: ${board.title}`,
    fact("LOGLINE", board.logline),
    fact("WORLD", board.world),
    fact("LOOK", board.look),
    `ASPECT: ${board.aspectRatio}`,
    fact("LENS", board.lens),
    fact("LIGHTING", board.lighting),
    fact("GRADE", board.grade),
    board.palette.length ? `PALETTE: ${board.palette.join(" ")}` : "",
    fact("WARDROBE", board.wardrobe),
    fact("SOUNDSCAPE", board.soundscape),
    fact("MUSIC", board.music),
    board.cast.length
      ? `CAST:\n${board.cast
          .map((c) => `  ${c.name}${c.subject ? ` (Subject ${c.subject})` : ""} — ${c.look}`)
          .join("\n")}`
      : "",
    `SHOTS (${board.shots.length}, ${runtimeSec(board)} s total):`,
    ...board.shots.map((s, i) =>
      [
        `  ${i + 1}. ${s.title} — ${s.durationSec}s, ${s.framing}, ${s.lensMm}mm, ${s.move}`,
        i > 0 ? `, link ${s.link}` : "",
        `\n     ACTION: ${s.action}`,
        s.dialogue ? `\n     DIALOGUE: ${s.dialogue}` : "",
        s.carry ? `\n     CARRY: ${s.carry}` : "",
        s.endsOn ? `\n     ENDS ON: ${s.endsOn}` : "",
        s.references.length ? `\n     REFS: ${s.references.map((n) => `Subject ${n}`).join(", ")}` : "",
      ].join(""),
    ),
  ]
    .filter(Boolean)
    .join("\n");
}
