// ---------------------------------------------------------------------------
// Rendering a whole shot plan as one film.
//
// The board lives in the browser and so do the reference photos, so the film
// starts here: every shot's prompt is woven (storyboard.ts), its references are
// resolved out of the conversation, and the lot is handed to the local bridge
// (tools/studio-bridge), which renders them in order on this PC's GPU, chains
// each continuous shot onto the last frame of the one before it, and cuts them
// together with ffmpeg.
//
// The bridge owns the truth about progress — it is the only thing that knows
// how long a shot has actually been going — so this file polls it rather than
// guessing, and only falls back to the local arithmetic when the bridge has
// not said anything yet.
// ---------------------------------------------------------------------------

import { BRIDGE, bridgeStatus, type CharacterRef } from "./render";
import { isChained, shotPrompt, type Storyboard } from "./storyboard";

export interface FilmShotView {
  n: number;
  title: string;
  status: "queued" | "rendering" | "done" | "error" | "cancelled";
  link: "cut" | "continuous";
  /** True when this clip really did open on the previous clip's last frame. */
  chained: boolean;
  durationSec: number;
  seconds: number;
  percent: number;
  error?: string;
  /**
   * The shot rendered, and there is still something wrong with it — above all
   * a shot that barely moves, which H3 produces when it is given a scene to
   * depict rather than an action to perform. Not an error: the clip is in the
   * film, and the owner is the one who decides whether to render it again.
   */
  warning?: string;
  /** Filled in here, not by the bridge: the clip, once it has been fetched. */
  url?: string;
}

export interface FilmView {
  status: "queued" | "rendering" | "stitching" | "done" | "error";
  error?: string;
  title: string;
  doneShots: number;
  etaSeconds: number;
  elapsedSeconds: number;
  /** What this PC currently measures, s per frame — the ETA's basis. */
  secondsPerFrame: number;
  shots: FilmShotView[];
}

export interface FilmResult {
  blob: Blob;
  url: string;
}

/** The reference photos one shot attaches, as data URLs the bridge can save. */
function refsFor(
  board: Storyboard,
  index: number,
  subjects: string[],
  characters: CharacterRef[],
): { label: string; dataUrl: string }[] {
  const shot = board.shots[index];
  // A chained shot opens on a real frame of the previous clip; adding reference
  // photos on top of that only gives H3 two answers to the same question.
  if (isChained(board, index)) return [];
  const out: { label: string; dataUrl: string }[] = [];
  for (const n of shot.references) {
    const member = board.cast.find((c) => c.subject === n);
    const url = subjects[n - 1];
    if (url) out.push({ label: member?.name ?? `Subject ${n}`, dataUrl: url });
  }
  // Nobody uploaded for this shot, but the conversation named people from the
  // photo library — their faces are the only thing holding the cut together.
  if (!out.length) {
    for (const c of characters.slice(0, 2)) {
      if (c.images[0]) out.push({ label: c.name, dataUrl: c.images[0] });
    }
  }
  return out.slice(0, 6);
}

export interface FilmRequest {
  board: Storyboard;
  subjects: string[];
  characters: CharacterRef[];
  /** An audio reference the owner attached, laid under the finished cut. */
  soundtrack?: string;
  /**
   * How the track relates to the picture.
   *
   * "under" (the default) is a bed: ducked, looped to fit, mixed beneath
   * whatever sound the clips generated. "master" is for a film that was cut TO
   * the track — Seedance Studio's scores — where the track plays at its own
   * level and unlooped, the clips' own audio is dropped, and every clip is
   * trimmed back to the slot it was planned for so the picture cannot drift
   * away from the music it was measured against.
   */
  audioMode?: "under" | "master";
  /** Which second of the track the film starts at. Master mode only. */
  soundtrackFromSec?: number;
}

/** The exact payload the bridge is sent — pulled out so it can be tested. */
export function filmPayload(req: FilmRequest): Record<string, unknown> {
  const { board, subjects, characters } = req;
  return {
    title: board.title,
    aspectRatio: board.aspectRatio,
    ...(req.soundtrack ? { soundtrack: req.soundtrack } : {}),
    ...(req.audioMode === "master" ? { audioMode: "master" } : {}),
    ...(req.soundtrackFromSec ? { soundtrackFromSec: req.soundtrackFromSec } : {}),
    shots: board.shots.map((shot, i) => {
      // The references are resolved first so the prompt can name the pictures
      // that are really going with it — H3's subject_definitions section is
      // wrong the moment it describes a photo that was never attached.
      const refs = refsFor(board, i, subjects, characters);
      return {
        title: shot.title,
        prompt: shotPrompt(board, i, { refLabels: refs.map((r) => r.label) }),
        durationSec: shot.durationSec,
        link: shot.link === "continuous" ? "continuous" : "cut",
        refs,
      };
    }),
  };
}

export class FilmError extends Error {}

const OFFLINE =
  "The free local renderer isn't running on this PC. Double-click "
  + "tools/studio-bridge/install-autostart.cmd once — it starts the renderer now and again every time you "
  + "sign in — then press Make the film again.";

/** Queue the film. Resolves with the bridge's id for it. */
export async function startFilm(req: FilmRequest): Promise<string> {
  if (!(await bridgeStatus()).ok) throw new FilmError(OFFLINE);
  const res = await fetch(`${BRIDGE}/film`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(filmPayload(req)),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!data.id) throw new FilmError(data.error ?? "The local renderer refused the film.");
  return data.id;
}

export async function filmView(id: string): Promise<FilmView> {
  const res = await fetch(`${BRIDGE}/film/${id}`);
  if (!res.ok) throw new FilmError(`The renderer lost the film (${res.status}).`);
  return (await res.json()) as FilmView;
}

export async function shotClip(id: string, n: number): Promise<Blob> {
  const res = await fetch(`${BRIDGE}/film/${id}/shot/${n}`);
  if (!res.ok) throw new FilmError("That clip isn't ready.");
  return res.blob();
}

export async function filmFile(id: string): Promise<Blob> {
  const res = await fetch(`${BRIDGE}/film/${id}/file`);
  if (!res.ok) throw new FilmError("The film finished but couldn't be fetched.");
  return res.blob();
}

export async function cancelFilm(id: string): Promise<void> {
  await fetch(`${BRIDGE}/film/${id}/cancel`, { method: "POST" }).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Watch a film to the end.
 *
 * `onView` fires on every poll, so the bar moves while a shot is still in the
 * machine; each clip is fetched the moment it lands, because a shot the owner
 * can already watch is worth more than a film they are still waiting for.
 */
export async function watchFilm(
  id: string,
  onView: (view: FilmView) => void,
  opts: { maxMinutes?: number } = {},
): Promise<FilmResult> {
  const fetched = new Map<number, string>();
  const deadline = Date.now() + (opts.maxMinutes ?? 240) * 60_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const view = await filmView(id);
    for (const shot of view.shots) {
      if (shot.status === "done" && !fetched.has(shot.n)) {
        // A failed fetch is not worth failing the film over; the next poll
        // tries again.
        const url = await shotClip(id, shot.n)
          .then((b) => URL.createObjectURL(b))
          .catch(() => null);
        if (url) fetched.set(shot.n, url);
      }
      const url = fetched.get(shot.n);
      if (url) shot.url = url;
    }
    onView(view);
    if (view.status === "error") throw new FilmError(view.error ?? "The film failed.");
    if (view.status === "done") {
      const blob = await filmFile(id);
      return { blob, url: URL.createObjectURL(blob) };
    }
  }
  throw new FilmError("The film has been rendering for four hours — check the bridge window.");
}
