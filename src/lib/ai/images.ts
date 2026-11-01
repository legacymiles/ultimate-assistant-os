import "server-only";

// ---------------------------------------------------------------------------
// Where a generated picture comes from, and what it is allowed to cost.
//
// Measured on 2026-09-26, from OpenRouter's own activity ledger: of $20.11 of
// credit, google/gemini-3.1-flash-image — Nano Banana — took $6.95 across 98
// requests, and it was ACCELERATING ($0.68 on the 24th, $1.17 on the 25th,
// $1.98 on the 26th) while every other model went quiet. A storyboard sheet is
// a cast sheet per invented character plus a set plate plus one frame per cut,
// redrawn whenever a frame comes back wrong, so a single afternoon of planning
// is dozens of paid pictures.
//
// The hub's front-page model picker cannot prevent any of that: `modelChain` in
// ./provider.ts deliberately exempts specialist models, so an image model is
// never swapped for the owner's pick. The decision has to live here.
//
// So: a picture is drawn on the owner's own PC, free, by Flux 2 Klein inside
// WanGP (tools/studio-bridge). The paid model is OFF and stays off until
// ALLOW_PAID_IMAGES=1 says otherwise. A picture that cannot be drawn locally
// degrades visibly — a placeholder, or a message naming the one thing to do —
// which is the house rule for a missing key and is the right shape here too.
// ---------------------------------------------------------------------------

/** The paid painter. Named once so there is one place to find it. */
export const CLOUD_IMAGE_MODEL = process.env.CLOUD_IMAGE_MODEL || "google/gemini-3.1-flash-image";

/** The owner's free local renderer, same address the browser uses. */
const BRIDGE = process.env.STUDIO_BRIDGE_URL || "http://127.0.0.1:42010";

/**
 * Has the owner explicitly allowed a picture to cost money?
 *
 * Default no. This is the whole point of the module: nothing in the hub can
 * spend on a picture by accident, only because this was turned on.
 */
export function paidImagesAllowed(): boolean {
  return process.env.ALLOW_PAID_IMAGES === "1";
}

/** What to tell the owner when a picture could not be drawn for free. */
export const NO_FREE_PAINTER =
  "Images render free on this PC with Flux 2 Klein, and the local renderer isn't answering. "
  + "Double-click tools/studio-bridge/install-autostart.cmd once — it starts it now and at every "
  + "sign-in — then try again. (To pay a cloud model instead, set ALLOW_PAID_IMAGES=1 in .env.local.)";

export interface LocalRef {
  label?: string;
  dataUrl: string;
}

/** Is the local renderer up AND new enough to paint a still? */
async function bridgeCanPaint(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const { ok, image } = (await res.json()) as { ok?: boolean; image?: boolean };
    // `image` is absent on a bridge from before the local painter existed.
    return Boolean(ok && image);
  } catch {
    return false;
  }
}

/**
 * Draw one picture on the owner's PC. Returns a data URL, or null when this
 * machine cannot reach the renderer at all — which is the normal case on Vercel,
 * where 127.0.0.1 is the serverless box and not the owner's desk.
 *
 * Null rather than throwing: "the free painter isn't here" is a routing fact the
 * caller decides about, not an error to surface.
 */
export async function paintLocally(
  body: { prompt: string; aspectRatio?: string; refs?: LocalRef[] },
  timeoutMs = 300_000,
): Promise<string | null> {
  if (!(await bridgeCanPaint())) return null;
  const started = Date.now();
  const res = await fetch(`${BRIDGE}/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const { id, error } = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!id) throw new Error(error ?? "The local renderer refused the picture.");
  // ~40 s on the RTX 3050, and it queues behind any clip already rendering:
  // one GPU, so the bridge runs stills and clips through the same queue.
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const view = (await (await fetch(`${BRIDGE}/job/${id}`)).json().catch(() => ({}))) as {
      status?: string;
      error?: string;
    };
    if (view.status === "error") throw new Error(view.error ?? "The local picture failed.");
    if (view.status === "done") {
      const file = await fetch(`${BRIDGE}/file/${id}`);
      if (!file.ok) throw new Error("The picture finished but couldn't be read from the local renderer.");
      // The type comes from the response, never assumed: WanGP returns a JPEG
      // for a Flux still, and a data URL that claims PNG over JPEG bytes is a
      // reference image some decoders will refuse later.
      const type = (file.headers.get("Content-Type") || "image/jpeg").split(";")[0].trim();
      const buf = Buffer.from(await file.arrayBuffer());
      return `data:${type};base64,${buf.toString("base64")}`;
    }
  }
  throw new Error("The local picture never finished.");
}
