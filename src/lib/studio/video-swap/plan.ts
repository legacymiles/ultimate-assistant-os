// ---------------------------------------------------------------------------
// Custom Video Swap — the plan, pure (no browser, no network), so every rule
// here is tested.
//
// The owner's pipeline, in their words: "use Viggle to replace characters in
// the video, then send it to H3 to replace the background with the user's
// choice." Done honestly that is four stages on the PC:
//
//   1. Mark & mask   InsightFace finds the faces on the frame the owner chose;
//                    each tap on the screen picks the face nearest it.
//   2. Swap          Flux Klein edits that one frame (masked), Viggle Animate
//                    carries the edit through every frame — motion, camera,
//                    timing and wardrobe stay exactly as shot.
//   3. Background    H3 can't edit a video, so it does what it is best at:
//                    it renders a LIVING plate from the owner's background
//                    picture (Ref2VA, the camera move matched to the source).
//   4. Composite     Robust Video Matting cuts the swapped people out, lays
//                    them over the plate, light-wraps and grades them to it,
//                    and puts the original audio back.
//
// Either half can be switched off: swap only, or background only.
// ---------------------------------------------------------------------------

import { MAX_IMAGES } from "@/lib/new-jarvis/requests";

export const SWAP_FOLDER = "flow:custom-video-swap";
export const SWAP_SKILL = "custom-video-swap";

/** Viggle's swap is about an hour of GPU per 5 s on the owner's 6 GB card. */
export const MIN_PER_5S_SWAP = 60;
/** H3 locally (WanGP, int8 + turbo) — measured 5.7 min per 5 s clip. */
export const MIN_PER_5S_PLATE = 6;
/** Matting + composite + encode, per 5 s. */
export const MIN_PER_5S_FINISH = 1.5;
/** Past this the PC would be busy for most of a day; ask for a trim. */
export const MAX_SECONDS = 60;
/** One frame edit can hold this many faces cleanly (left-to-right masks). */
export const MAX_PEOPLE = 3;

export type SwapAspect = "source" | "9:16" | "16:9" | "1:1";
export type PlateMotion = "match" | "still" | "drift" | "push";
export type SwapQuality = "draft" | "hd";
export type SceneMode = "replace" | "keep";

export interface ClipMeta {
  name: string;
  /** Seconds. */
  duration: number;
  width: number;
  height: number;
  /** Bytes. */
  size: number;
}

export interface SwapPerson {
  id: string;
  /** Where the owner tapped on the marked frame, 0–1 across and down; -1 = not marked yet. */
  x: number;
  y: number;
  /** The original person, cut out of that frame (a small JPEG data URL), or "". */
  crop: string;
  /** Who they become: the replacement picture (data URL), or "". */
  image: string;
  /** Anything about the new look, in the owner's words ("in the red jacket"). */
  note: string;
}

export interface SwapScene {
  mode: SceneMode;
  /** The background picture (data URL), or "". */
  image: string;
  /** The world in words — what H3 is told to bring to life. */
  prompt: string;
  motion: PlateMotion;
  /** Grade the people to the new light (recommended). */
  relight: boolean;
}

export interface SwapDraft {
  title: string;
  /** What the owner typed in the Studio composer, kept in their words. */
  request: string;
  /** Seconds into the clip where the people were marked. */
  frameAt: number;
  /** The stretch of the clip to use, in seconds. */
  trim: { start: number; end: number } | null;
  people: SwapPerson[];
  scene: SwapScene;
  aspect: SwapAspect;
  quality: SwapQuality;
  keepAudio: boolean;
}

export function blankScene(): SwapScene {
  return { mode: "replace", image: "", prompt: "", motion: "match", relight: true };
}

export function blankDraft(): SwapDraft {
  return {
    title: "",
    request: "",
    frameAt: 0,
    trim: null,
    people: [],
    scene: blankScene(),
    aspect: "source",
    quality: "draft",
    keepAudio: true,
  };
}

let seq = 0;
export function personId(): string {
  seq += 1;
  return `p${Date.now().toString(36)}${seq}`;
}

export function blankPerson(image = "", id = personId()): SwapPerson {
  return { id, x: -1, y: -1, crop: "", image, note: "" };
}

export const isMarked = (p: SwapPerson): boolean => p.x >= 0 && p.y >= 0;

/** People ordered the way the PC numbers faces: left to right across the frame. */
export function leftToRight(people: SwapPerson[]): SwapPerson[] {
  return [...people].sort((a, b) => (isMarked(a) ? a.x : 2) - (isMarked(b) ? b.x : 2));
}

/** "on the left" / "in the middle" / "on the right", for the tap position. */
export function sideOf(x: number): string {
  if (x < 0) return "not marked";
  if (x < 0.38) return "on the left";
  if (x > 0.62) return "on the right";
  return "in the middle";
}

// ----- Reading the composer prompt ---------------------------------------------

export interface PromptRead {
  scenePrompt: string;
  keepBackground: boolean;
  backgroundOnly: boolean;
  aspect: SwapAspect | null;
  quality: SwapQuality | null;
  motion: PlateMotion | null;
}

const BG_LEAD =
  /\b(?:background|backdrop|scene|setting|location|set it|put (?:them|him|her|it|me|us|everyone) (?:in|on|at|into)|place (?:them|him|her|it|me|us) (?:in|on|at)|in front of)\b\s*(?:to|of|is|as|with|into|:|=|-)?\s*(?:a|an|the)?\s*([^.\n;]+)/i;

/** What the owner's line says about the scene, the shape and the quality. */
export function readPrompt(text: string): PromptRead {
  const t = text.trim();
  const lower = t.toLowerCase();
  const keepBackground = /\bkeep (?:the |my |our )?(?:original )?(?:background|scene|backdrop|location)\b/.test(lower);
  const mentionsSwap = /\b(?:swap|replace|switch|change|turn)\b[^.]*\b(?:character|person|people|guy|girl|man|woman|face|actor|dancer|me|him|her|them|kid|influencer|avatar)\b|\b(?:character|face) swap\b|\bput (?:me|my|him|her) in\b/.test(lower);
  const mentionsBg = /\b(?:background|backdrop|scene|setting|location)\b/.test(lower);
  const backgroundOnly =
    mentionsBg &&
    !mentionsSwap &&
    /\b(?:only|just)\b[^.]*\b(?:background|backdrop|scene)\b|\b(?:change|replace|swap|new)\b[^.]*\b(?:background|backdrop|scene)\b/.test(lower);

  let scenePrompt = "";
  if (!keepBackground) {
    const m = BG_LEAD.exec(t);
    if (m) scenePrompt = cleanScene(m[1]);
  }

  const aspect: SwapAspect | null = /\b(?:9:16|vertical|tiktok|reels?|shorts|portrait)\b/.test(lower)
    ? "9:16"
    : /\b(?:16:9|landscape|horizontal|youtube|widescreen)\b/.test(lower)
      ? "16:9"
      : /\b(?:1:1|square)\b/.test(lower)
        ? "1:1"
        : null;
  const quality: SwapQuality | null = /\b(?:hd|1080p?|high quality|best quality|full quality)\b/.test(lower)
    ? "hd"
    : /\b(?:draft|quick|fast|preview)\b/.test(lower)
      ? "draft"
      : null;
  const motion: PlateMotion | null = /\b(?:still|static|locked|tripod)\b/.test(lower)
    ? "still"
    : /\b(?:push in|push-in|dolly in|zoom in)\b/.test(lower)
      ? "push"
      : /\b(?:drift|floating|handheld|slow pan)\b/.test(lower)
        ? "drift"
        : null;

  return { scenePrompt, keepBackground, backgroundOnly, aspect, quality, motion };
}

function cleanScene(s: string): string {
  return s
    .replace(/\b(?:please|thanks|thank you)\b.*$/i, "")
    .replace(/\b(?:in|at)\s+(?:9:16|16:9|1:1|hd|1080p?)\b.*$/i, "")
    .replace(/,\s*(?:vertical|landscape|square|hd|draft)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,\s]+$/, "")
    .slice(0, 240);
}

// ----- Placing the composer's uploads into the right slots ----------------------

export interface Placement {
  clip: number | null;
  /** Indexes into the image list, one per new character, in order. */
  characters: number[];
  background: number | null;
}

/**
 * The composer hands over pictures and clips in the order they were added.
 * The first clip is the driving video. Pictures are the new characters —
 * except when the line talks about a background: then the LAST picture is the
 * background (people attach "who" first and "where" last), and when the line
 * is only about the background, the one picture is the background.
 */
export function placeUploads(kinds: ("image" | "video" | "audio")[], text: string): Placement {
  const clip = kinds.findIndex((k) => k === "video");
  const images = kinds.map((k, i) => (k === "image" ? i : -1)).filter((i) => i >= 0);
  const read = readPrompt(text);
  const talksBackground = /\b(?:background|backdrop|scene|setting|location|in front of)\b/i.test(text) && !read.keepBackground;
  let background: number | null = null;
  let characters = images;
  if (images.length && talksBackground && (read.backgroundOnly || images.length >= 2)) {
    background = images[images.length - 1];
    characters = images.slice(0, -1);
  }
  return { clip: clip >= 0 ? clip : null, characters, background };
}

// ----- What the PC will do ------------------------------------------------------

export type StageId = "mask" | "swap" | "plate" | "composite" | "finish";

export interface PipelineStage {
  id: StageId;
  label: string;
  engine: string;
  detail: string;
  on: boolean;
  minutes: number;
}

export const doesSwap = (d: SwapDraft): boolean => d.people.some((p) => p.image);
export const doesScene = (d: SwapDraft): boolean => d.scene.mode === "replace" && Boolean(d.scene.image || d.scene.prompt.trim());

/** Seconds of footage the PC will process. */
export function workSeconds(d: SwapDraft, clip: ClipMeta | null): number {
  if (!clip) return 0;
  const start = Math.max(0, d.trim?.start ?? 0);
  const end = Math.min(clip.duration, d.trim?.end ?? clip.duration);
  return Math.max(0, Math.round((end - start) * 10) / 10);
}

export function pipeline(d: SwapDraft, clip: ClipMeta | null): PipelineStage[] {
  const blocks = Math.max(1, Math.ceil(workSeconds(d, clip) / 5));
  const swap = doesSwap(d);
  const scene = doesScene(d);
  const hd = d.quality === "hd" ? 1.6 : 1;
  const motion: Record<PlateMotion, string> = {
    match: "camera move matched to your clip",
    still: "locked-off camera",
    drift: "a slow handheld drift",
    push: "a slow push in",
  };
  return [
    {
      id: "mask",
      label: "Find the people",
      engine: "InsightFace",
      detail: d.people.some(isMarked) ? "Faces on your marked frame, matched to your taps" : "The main face in frame",
      on: swap,
      minutes: swap ? 1 : 0,
    },
    {
      id: "swap",
      label: "Swap the characters",
      engine: "Viggle Animate",
      detail: "One frame edited, then carried through every frame — motion and camera stay as shot",
      on: swap,
      minutes: swap ? Math.round(blocks * MIN_PER_5S_SWAP * hd) : 0,
    },
    {
      id: "plate",
      label: "Build the new world",
      engine: "MiniMax H3",
      detail: scene ? `A living background from your picture, ${motion[d.scene.motion]}` : "Keeping the original background",
      on: scene,
      minutes: scene ? Math.round(blocks * MIN_PER_5S_PLATE * hd) : 0,
    },
    {
      id: "composite",
      label: "Cut out & composite",
      engine: "Robust Video Matting",
      detail: scene ? `People matted onto the new world${d.scene.relight ? ", graded to its light" : ""}` : "Not needed",
      on: scene,
      minutes: scene ? Math.max(1, Math.round(blocks * MIN_PER_5S_FINISH)) : 0,
    },
    {
      id: "finish",
      label: "Finish",
      engine: "ffmpeg",
      detail: `${d.keepAudio ? "Original audio back in, " : ""}${d.aspect === "source" ? "your clip's shape" : d.aspect}, before/after sheet`,
      on: swap || scene,
      minutes: swap || scene ? 1 : 0,
    },
  ];
}

export function totalMinutes(d: SwapDraft, clip: ClipMeta | null): number {
  return pipeline(d, clip).reduce((n, s) => n + (s.on ? s.minutes : 0), 0);
}

export function humanMinutes(min: number): string {
  if (min <= 0) return "—";
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m >= 10 ? `~${h} h ${m} min` : `~${h} h`;
}

// ----- What has to be true before it goes ---------------------------------------

export function checkSwap(d: SwapDraft, clip: ClipMeta | null): string[] {
  const out: string[] = [];
  if (!clip) out.push("Add the driving video.");
  if (clip && workSeconds(d, clip) > MAX_SECONDS) {
    out.push(`Trim the clip to ${MAX_SECONDS} seconds or less — longer would tie your PC up all day.`);
  }
  if (clip && workSeconds(d, clip) < 1) out.push("The trimmed stretch is shorter than a second.");
  if (!doesSwap(d) && !doesScene(d)) out.push("Add a new character or a new background — there's nothing to change yet.");
  if (d.people.length > MAX_PEOPLE) out.push(`Up to ${MAX_PEOPLE} people per swap.`);
  const swapping = d.people.filter((p) => p.image);
  if (d.people.some((p) => isMarked(p) && !p.image)) out.push("Every marked person needs a new character picture (or remove them).");
  if (swapping.length > 1 && swapping.some((p) => !isMarked(p))) {
    out.push("With more than one person, tap each one in the video so I know who becomes who.");
  }
  if (d.scene.mode === "replace" && !d.scene.image && !d.scene.prompt.trim() && swapping.length === 0) {
    out.push("Add a background picture or describe the new world.");
  }
  if (pictures(d).length > MAX_IMAGES) out.push(`Up to ${MAX_IMAGES} pictures in all (new characters + background).`);
  return out;
}

/** The pictures that travel with the job, in order, and what each one is. */
export function pictures(d: SwapDraft): { src: string; role: string }[] {
  const out: { src: string; role: string }[] = [];
  leftToRight(d.people).forEach((p, i) => {
    if (p.image) out.push({ src: p.image, role: `person ${i + 1} becomes this` });
  });
  if (d.scene.mode === "replace" && d.scene.image) out.push({ src: d.scene.image, role: "the new background" });
  return out;
}

// ----- The brief the PC reads ---------------------------------------------------

export interface SwapJob {
  v: 1;
  clip: { name: string; duration: number; width: number; height: number; trim: [number, number] };
  frameAt: number;
  people: { n: number; x: number | null; y: number | null; side: string; picture: number; note: string }[];
  scene: { mode: SceneMode; picture: number | null; prompt: string; motion: PlateMotion; relight: boolean };
  output: { aspect: SwapAspect; quality: SwapQuality; keepAudio: boolean };
  stages: StageId[];
}

export function jobOf(d: SwapDraft, clip: ClipMeta): SwapJob {
  const pics = pictures(d);
  const ordered = leftToRight(d.people).filter((p) => p.image);
  const start = Math.max(0, d.trim?.start ?? 0);
  const end = Math.min(clip.duration, d.trim?.end ?? clip.duration);
  return {
    v: 1,
    clip: { name: clip.name, duration: clip.duration, width: clip.width, height: clip.height, trim: [round(start), round(end)] },
    frameAt: round(d.frameAt),
    people: ordered.map((p, i) => ({
      n: i + 1,
      x: isMarked(p) ? round(p.x, 3) : null,
      y: isMarked(p) ? round(p.y, 3) : null,
      side: sideOf(p.x),
      picture: pics.findIndex((x) => x.src === p.image) + 1,
      note: p.note.trim(),
    })),
    scene: {
      mode: doesScene(d) ? "replace" : "keep",
      picture: d.scene.mode === "replace" && d.scene.image ? pics.findIndex((x) => x.src === d.scene.image) + 1 : null,
      prompt: d.scene.prompt.trim(),
      motion: d.scene.motion,
      relight: d.scene.relight,
    },
    output: { aspect: d.aspect, quality: d.quality, keepAudio: d.keepAudio },
    stages: pipeline(d, clip).filter((s) => s.on).map((s) => s.id),
  };
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function titleFor(d: SwapDraft): string {
  if (d.title.trim()) return d.title.trim().slice(0, 80);
  const n = d.people.filter((p) => p.image).length;
  const where = doesScene(d) ? (d.scene.prompt.trim() ? ` · ${d.scene.prompt.trim().split(/[,.]/)[0].slice(0, 40)}` : " · new background") : "";
  return `${n ? `${n} character swap${n === 1 ? "" : "s"}` : "Background swap"}${where}`;
}

/**
 * What the PC agent reads: plain steps first (so a person can read it too),
 * then the exact job as JSON (so nothing is re-guessed from prose).
 */
export function briefText(d: SwapDraft, clip: ClipMeta): string {
  const job = jobOf(d, clip);
  const lines: string[] = [];
  lines.push(`CUSTOM VIDEO SWAP — ${titleFor(d)}`);
  if (d.request.trim()) lines.push(`Owner's words: "${d.request.trim().slice(0, 300)}"`);
  lines.push(
    `Driving clip: "${clip.name}", ${clip.width}x${clip.height}, ${clip.duration.toFixed(1)} s — use ${job.clip.trim[0]}–${job.clip.trim[1]} s. Download it from the "driving clip" link on this request.`,
  );
  if (job.people.length) {
    lines.push(`Swap (viggle-motion-swap): on the frame at ${job.frameAt} s —`);
    for (const p of job.people) {
      const where = p.x === null ? "the main person in frame" : `the face nearest ${Math.round(p.x * 100)}% across, ${Math.round((p.y ?? 0) * 100)}% down (${p.side})`;
      lines.push(`  person ${p.n}: ${where} → picture ${p.picture}${p.note ? ` (${p.note})` : ""}`);
    }
  } else {
    lines.push("Swap: none — keep the people as they are.");
  }
  if (job.scene.mode === "replace") {
    const from = job.scene.picture ? `picture ${job.scene.picture}` : "no picture — generate the still first from the words";
    lines.push(
      `Background (H3 plate): from ${from}${job.scene.prompt ? `, "${job.scene.prompt}"` : ""}; camera ${job.scene.motion}; then matte the people with Robust Video Matting and composite${job.scene.relight ? ", light-wrapped and graded to the plate" : ""}.`,
    );
  } else {
    lines.push("Background: keep the original.");
  }
  lines.push(
    `Output: ${job.output.aspect === "source" ? "the clip's own shape" : job.output.aspect}, ${job.output.quality === "hd" ? "HD" : "draft"}${job.output.keepAudio ? ", original audio kept" : ", no audio"}. Send the MP4 back with queue_video_link and finish with queue_complete video: true.`,
  );
  lines.push("");
  lines.push(`SWAP JSON: ${JSON.stringify(job)}`);
  return lines.join("\n");
}

/** The PC time for a filed job, from the job alone (the Watch view has no draft). */
export function jobMinutes(job: SwapJob): number {
  const blocks = Math.max(1, Math.ceil((job.clip.trim[1] - job.clip.trim[0]) / 5));
  const hd = job.output.quality === "hd" ? 1.6 : 1;
  const swap = job.stages.includes("swap") ? 1 + Math.round(blocks * MIN_PER_5S_SWAP * hd) : 0;
  const plate = job.stages.includes("plate")
    ? Math.round(blocks * MIN_PER_5S_PLATE * hd) + Math.max(1, Math.round(blocks * MIN_PER_5S_FINISH))
    : 0;
  return swap + plate + 1;
}

/** Pull the job back out of a request's text (the Watch view and the PC both read it). */
export function parseJob(text: string): SwapJob | null {
  const m = /SWAP JSON: (\{.*\})\s*$/m.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]) as SwapJob;
    return j && j.v === 1 && j.clip && Array.isArray(j.people) ? j : null;
  } catch {
    return null;
  }
}

// ----- Seeding from the composer ------------------------------------------------

/** A fresh draft from the composer line plus the placed uploads. */
export function draftFromPrompt(text: string, characterImages: string[], backgroundImage: string | null): SwapDraft {
  const read = readPrompt(text);
  const d = blankDraft();
  d.request = text.trim();
  d.people = characterImages.slice(0, MAX_PEOPLE).map((img) => blankPerson(img));
  d.scene = {
    ...blankScene(),
    mode: read.keepBackground ? "keep" : "replace",
    image: backgroundImage ?? "",
    prompt: read.scenePrompt,
    motion: read.motion ?? "match",
  };
  if (read.aspect) d.aspect = read.aspect;
  if (read.quality) d.quality = read.quality;
  return d;
}
