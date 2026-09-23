// ---------------------------------------------------------------------------
// Laying a cut-out over a video.
//
// The reaction format (skills/reaction-video.md): the source video plays full
// frame and the rendered plate is matted over it — a cut-out standing in the
// picture, never one half of a split screen.
//
// The renderer makes video and cannot composite, so this hands both files to
// the local bridge, which does it with ffmpeg. The bridge owns the arithmetic
// on purpose: the reactor's size is a share of the SOURCE's height and the key
// is whatever green the renderer actually produced, and both are easy to get
// wrong in a way that still succeeds — a plate scaled against its own height
// comes out a third of the size asked for, and a key that is not in the
// picture removes nothing. Neither reports an error. See server.mjs.
// ---------------------------------------------------------------------------

import { BRIDGE, bridgeStatus } from "./render";

/** Which corner of the frame the cut-out stands in. */
export type Corner = "bottom-left" | "bottom-right" | "top-left" | "top-right";

export const CORNERS: Corner[] = ["bottom-left", "bottom-right", "top-left", "top-right"];

export interface CompositePlacement {
  corner?: Corner;
  /** The REACTOR's share of the frame's height, 0.1–0.5. */
  share?: number;
  /** Inset from the side edge, as a share of the frame's width. */
  inset?: number;
  /** "auto" samples the green off the plate; "none" means it already has alpha. */
  key?: string;
  similarity?: number;
  blend?: number;
  audio?: "base" | "plate" | "both";
}

export interface CompositeRequest extends CompositePlacement {
  /** The source video, as a data URL. */
  base: string;
  /** The plate, as a data URL — or the id of a finished bridge render. */
  plate?: string;
  plateJob?: string;
}

export class CompositeError extends Error {}

const OFFLINE =
  "The free local renderer isn't running on this PC, so the cut-out can't be laid over the video. "
  + "Double-click tools/studio-bridge/install-autostart.cmd once, then try again.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Where the bridge says it put the cut-out, once it knows. */
export interface CompositeView {
  status: "queued" | "rendering" | "done" | "error";
  error?: string;
  key?: string;
  /** False when the reactor's bounds could not be found and the whole plate was used. */
  cropped?: boolean;
  placed?: { width: number; height: number; of: { w: number; h: number } };
}

/**
 * Composite, and resolve with the finished file.
 *
 * ffmpeg on two finished files takes seconds, and the bridge runs it straight
 * away rather than queueing it behind a render — there is one GPU and this
 * never touches it — so the poll is tight and the ceiling is short.
 */
export async function composite(
  req: CompositeRequest,
  onProgress?: (view: CompositeView) => void,
): Promise<{ blob: Blob; view: CompositeView }> {
  if (!(await bridgeStatus()).ok) throw new CompositeError(OFFLINE);

  const res = await fetch(`${BRIDGE}/composite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const { id, error } = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!id) throw new CompositeError(error ?? "The local renderer refused the composite.");

  for (let i = 0; i < 240; i += 1) {
    await sleep(1000);
    const view = (await (await fetch(`${BRIDGE}/job/${id}`)).json().catch(() => ({}))) as CompositeView;
    onProgress?.(view);
    if (view.status === "error") throw new CompositeError(view.error ?? "The composite failed.");
    if (view.status === "done") {
      const file = await fetch(`${BRIDGE}/file/${id}`);
      if (!file.ok) throw new CompositeError("The composite finished but couldn't be fetched.");
      return { blob: await file.blob(), view };
    }
  }
  throw new CompositeError("The composite has been going for four minutes — check the bridge window.");
}

/** A File the browser is holding, as the data URL the bridge takes. */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new CompositeError("That clip couldn't be read."));
    reader.readAsDataURL(file);
  });
}
