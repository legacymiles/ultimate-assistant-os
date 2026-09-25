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
// this reason. A frame is now read on the full-page sheet, in a card around
// 360 pixels wide, so 640 across is the honest size: half that was visibly
// soft at the size the sheet actually shows it.
// ---------------------------------------------------------------------------

import { castSheetPrompt, inventedIn, panelPrompt, platePrompt, type Storyboard } from "./storyboard";

/** Long edge of the panel that is kept. Nearly twice the card it is read in. */
const PANEL_EDGE = 640;
const PANEL_QUALITY = 0.72;

/**
 * Long edge of a cast sheet. Bigger than a panel on purpose: a panel is looked
 * at once, this is ATTACHED to every shot its character appears in, and a face
 * that arrives too small to read cannot anchor one in a wider frame.
 */
const SHEET_EDGE = 1024;

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
async function thumbnail(dataUrl: string, edge: number = PANEL_EDGE): Promise<string> {
  if (typeof document === "undefined") return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = dataUrl;
    });
    const scale = Math.min(1, edge / Math.max(img.width, img.height));
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
  // The drawn sheets of anyone this shot INVENTED, on exactly the same terms
  // the render gets them (film.ts `refsFor`).
  //
  // Without this the panel is drawn from the uploads alone while the film is
  // rendered from the uploads AND the sheets — so the two describe different
  // people, which is the one thing this sheet exists to prevent. Measured the
  // hard way: panels drawn beside a Black baby's photo inferred Black parents,
  // while their sheets, drawn from text that never said, came back white.
  const drawn = inventedIn(board, index)
    .filter((c) => c.sheet)
    .map((c) => ({ label: c.name, dataUrl: c.sheet! }));
  // A CONTINUED shot is withheld its references at render time, because FL2VA
  // is handed the previous clip's real frames instead and two answers to one
  // question make the model split the difference. A PANEL has no frames — it
  // is a drawing, made from nothing but what is attached to it — so applying
  // the same withholding leaves it with no picture of anybody. Measured: cut 2
  // was chained, so its panel got no photo of the baby and drew a four-year-old
  // where the film has a one-year-old.
  //
  // So the panel always sees everyone in the shot, whatever the link.
  const everyone = board.cast
    .filter((c) => c.subject !== null)
    .map((c) => faces.find((f) => f.label === c.name || f.label === `Subject ${c.subject}`))
    .filter((f): f is PanelFace => Boolean(f));
  const all = [...new Map([...named, ...everyone, ...drawn].map((f) => [f.label, f])).values()];
  // A cut that named nobody still has people in it more often than not, and a
  // panel drawn without the faces is a panel of strangers.
  const who = all.length ? all : faces;
  // ...and a panel drawn without the SET is a panel of a different house. The
  // render gets the plate (film.ts `refsFor`), so a panel drawn without it is
  // predicting a film that will not happen — which is the one job the sheet
  // has. Measured: panels drawn with faces but no plate gave a near-empty
  // living room in one shot and invented a hall dresser in the next, while the
  // plate showed a room full of sofas, toys and a coat rack.
  //
  // Last, so the faces keep the first reference slots. Again ignoring `link`:
  // the sheet is checked for whether the cuts describe ONE house, which is
  // exactly the question a panel drawn without the set cannot answer.
  const plate = board.plate ? [{ label: "THE SET", dataUrl: board.plate }] : [];
  return [...who.slice(0, 3), ...plate].slice(0, 4);
}

/**
 * Draw one invented character's reference sheet.
 *
 * Square, and kept a little larger than a storyboard panel: this one picture is
 * attached to every shot that person appears in, so detail here is spent once
 * and recovered a dozen times. Nothing is attached as a reference — the whole
 * point is that this IS the reference.
 */
export async function drawCastSheet(
  board: Storyboard,
  member: Storyboard["cast"][number],
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/studio/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: castSheetPrompt(board, member), aspectRatio: "1:1", refs: [] }),
    ...(signal ? { signal } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as { image?: string; refusal?: string; error?: string };
  if (!data.image) {
    throw new PanelError(data.refusal ?? data.error ?? `The image service failed (${res.status}).`);
  }
  return thumbnail(data.image, SHEET_EDGE);
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

/**
 * Draw the set plate — the room, empty and wide.
 *
 * Kept at the sheet size rather than the panel size: like a cast sheet it is
 * attached to shots rather than merely looked at, and a room that arrives too
 * small to read cannot hold the geography of one.
 */
export async function drawPlate(board: Storyboard, signal?: AbortSignal): Promise<string> {
  const res = await fetch("/api/studio/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: platePrompt(board), aspectRatio: board.aspectRatio, refs: [] }),
    ...(signal ? { signal } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as { image?: string; refusal?: string; error?: string };
  if (!data.image) {
    throw new PanelError(data.refusal ?? data.error ?? `The image service failed (${res.status}).`);
  }
  return thumbnail(data.image, SHEET_EDGE);
}
