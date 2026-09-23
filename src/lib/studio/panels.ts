// ---------------------------------------------------------------------------
// Drawing the shot plan.
//
// A film from this sheet costs the better part of an hour on this PC's GPU and
// cannot be skimmed until it is finished, so every fault in the plan is an
// hour late. A drawn panel costs a few seconds and shows the same fault now:
// the room is wrong, the light is wrong, cut 4 plainly does not follow cut 3.
//
// One request per panel, because /api/studio/image returns one image and a
// generated PNG is a megabyte or two of base64 — several in one response would
// pass Vercel's limit. They go out together and land as they land.
//
// What is kept is a THUMBNAIL. The board is saved into the synced conversation,
// so full-size frames here would push megabytes per film between the owner's
// devices; the chat's own attachments already sync as thumbnails for exactly
// this reason. A panel is looked at in a 200-pixel column, so 480 across is
// already generous.
// ---------------------------------------------------------------------------

import { panelPrompt, type Storyboard } from "./storyboard";

/** Long edge of the panel that is kept. Twice the column it is read in. */
const PANEL_EDGE = 480;
const PANEL_QUALITY = 0.72;

/** A face the panel should draw, resolved by the caller from the conversation. */
export interface PanelFace {
  /** "Subject 2", or a name from the photo library. */
  label: string;
  dataUrl: string;
}

export class PanelError extends Error {}

/**
 * Shrink a generated frame to something a synced store can carry.
 *
 * Returns the original when the browser cannot decode it: a panel that is too
 * big is still better than no panel, and the alternative is throwing away a
 * generation the owner already paid for.
 */
async function thumbnail(dataUrl: string): Promise<string> {
  if (typeof document === "undefined") return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = dataUrl;
    });
    const scale = Math.min(1, PANEL_EDGE / Math.max(img.width, img.height));
    if (scale === 1 && dataUrl.length < 120_000) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", PANEL_QUALITY);
  } catch {
    return dataUrl;
  }
}

/** The faces this cut needs, in the order the prompt will name them. */
export function facesFor(board: Storyboard, index: number, faces: PanelFace[]): PanelFace[] {
  const shot = board.shots[index];
  if (!shot) return [];
  const named = shot.references
    .map((n) => board.cast.find((c) => c.subject === n))
    .map((c) => faces.find((f) => f.label === c?.name || f.label === `Subject ${c?.subject}`))
    .filter((f): f is PanelFace => Boolean(f));
  // A cut that named nobody still has people in it more often than not, and a
  // panel drawn without the faces is a panel of strangers — which is precisely
  // the continuity the sheet exists to check.
  return (named.length ? named : faces).slice(0, 4);
}

/** Draw one cut. Resolves with the thumbnail to store on that shot. */
export async function drawPanel(
  board: Storyboard,
  index: number,
  faces: PanelFace[],
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/studio/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: panelPrompt(board, index),
      aspectRatio: board.aspectRatio,
      refs: facesFor(board, index, faces),
    }),
    ...(signal ? { signal } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as { image?: string; refusal?: string; error?: string };
  if (!data.image) {
    throw new PanelError(data.refusal ?? data.error ?? `The image service failed (${res.status}).`);
  }
  return thumbnail(data.image);
}
