// ---------------------------------------------------------------------------
// Drawing a picture without paying for it.
//
// This sits IN FRONT of the paid image model rather than replacing it. It
// tries the owner's own PC first (WanGP + Flux 2 Klein, tools/wangp-image),
// then a keyless public drawer when the picture is only a placeholder, and
// returns null when neither can help — at which point the caller falls through
// to whatever it did before. Nothing that used to work stops working; it just
// stops costing money when the PC is on.
//
// Deliberately NOT handling reference images. Flux Klein can edit, but the
// settings for carrying references through WanGP are a different shape from
// the paid model's, and a half-wired reference path would quietly produce
// pictures that ignore the reference. A request with refs goes straight to the
// lane that genuinely supports them (see `canDrawFree`).
// ---------------------------------------------------------------------------

import "server-only";

import { laneNote, planLanes, type LaneId, type Purpose } from "../lanes";

/** Where the PC's drawer listens. Local by definition — never a public host. */
const LOCAL_URL = process.env.WANGP_IMAGE_URL || "http://127.0.0.1:3391";

/** The keyless public drawer. Off unless the deploy opts in. */
const FREE_ENABLED = process.env.FREE_IMAGE_LANE !== "off";
const FREE_BASE = "https://image.pollinations.ai/prompt/";

/**
 * A health probe must not make the page wait — but it must not be so tight
 * that it fails on a server that is plainly up. Measured: a raw Node fetch to
 * the local drawer answers in ~5 ms, while the first call through Next's
 * patched fetch took over a second and a 1.2 s budget timed out, which looked
 * exactly like "PC off" and silently sent the picture to the paid model.
 * Four seconds is slow enough to be honest and still bounded.
 */
const HEALTH_MS = 4000;

/** How long a health answer is trusted, so one picture costs one probe. */
const HEALTH_TTL_MS = 15_000;
let healthCache: { at: number; up: boolean } | null = null;
/** A local render: model load plus steps. */
const LOCAL_MS = 10 * 60 * 1000;
/** The public drawer is usually seconds; give it room but not forever. */
const FREE_MS = 90_000;

export interface DrawRequest {
  prompt: string;
  purpose: Purpose;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  /** Reference images, if the caller has any. Their presence sends this to the paid lane. */
  refs?: unknown[];
}

export interface DrawResult {
  /** A data URL. The caller decides where to keep it. */
  image: string;
  lane: LaneId;
  ms: number;
  /** One line for the owner: which lane drew it and what it cost. */
  note: string;
  /** True when the lane stamps its own logo on the picture. */
  watermarked: boolean;
}

/**
 * Can the free lanes even be tried for this request?
 *
 * References are the one hard no: only the paid model carries them properly
 * today, and silently dropping them would be worse than paying.
 */
export function canDrawFree(req: DrawRequest): boolean {
  return !req.refs?.length;
}

/**
 * Is the PC's drawer up?
 *
 * Cached for a few seconds: a page drawing four variations should probe once,
 * not four times, and the answer cannot meaningfully change in between.
 */
export async function localUp(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && healthCache && now - healthCache.at < HEALTH_TTL_MS) return healthCache.up;
  let up = false;
  try {
    const res = await fetch(`${LOCAL_URL}/health`, {
      signal: AbortSignal.timeout(HEALTH_MS),
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; hasWanGP?: boolean };
      up = Boolean(data.ok && data.hasWanGP);
    }
  } catch {
    // Not running, not installed, not this machine. All the same answer.
    up = false;
  }
  healthCache = { at: now, up };
  return up;
}

async function drawLocal(req: DrawRequest): Promise<DrawResult | null> {
  try {
    const res = await fetch(`${LOCAL_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: req.prompt,
        width: req.width ?? 1024,
        height: req.height ?? 1024,
        steps: req.steps ?? 4,
        seed: req.seed ?? -1,
      }),
      signal: AbortSignal.timeout(LOCAL_MS),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      image?: string;
      ms?: number;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.image) return null;
    const ms = data.ms ?? 0;
    return { image: data.image, lane: "local", ms, note: laneNote("local", ms), watermarked: false };
  } catch {
    return null;
  }
}

async function drawFree(req: DrawRequest): Promise<DrawResult | null> {
  const started = Date.now();
  try {
    const url = new URL(FREE_BASE + encodeURIComponent(req.prompt.slice(0, 1200)));
    url.searchParams.set("width", String(req.width ?? 1024));
    url.searchParams.set("height", String(req.height ?? 1024));
    if (typeof req.seed === "number" && req.seed >= 0) url.searchParams.set("seed", String(req.seed));

    const res = await fetch(url, { signal: AbortSignal.timeout(FREE_MS), cache: "no-store" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;

    const ms = Date.now() - started;
    return {
      image: `data:${type.split(";")[0]};base64,${buf.toString("base64")}`,
      lane: "free",
      ms,
      note: laneNote("free", ms),
      // This lane stamps its logo on everything, which is why `lanes.ts`
      // refuses to offer it for anything carrying a name.
      watermarked: true,
    };
  } catch {
    return null;
  }
}

/**
 * Try the free lanes, in order, and give up quietly.
 *
 * Returns null when nothing free could draw it — the caller then does whatever
 * it did before this existed, so adding this can only remove cost, never
 * remove capability.
 */
export async function drawFreeFirst(req: DrawRequest): Promise<DrawResult | null> {
  if (!req.prompt.trim()) return null;
  if (!canDrawFree(req)) return null;

  const plan = planLanes(req.purpose, {
    localUp: await localUp(),
    freeAllowed: FREE_ENABLED,
    // The caller owns the paid lane; this module never runs it.
    paidKeyed: false,
  });

  for (const lane of plan.order) {
    const drawn = lane === "local" ? await drawLocal(req) : lane === "free" ? await drawFree(req) : null;
    if (drawn) return drawn;
  }
  return null;
}

/**
 * Turn an aspect like "3:4" into pixel sides the card can hold.
 *
 * Long side 1024, rounded to a multiple of 16 (diffusion models want that),
 * and clamped so an extreme ratio can't ask for a 4000px edge.
 */
export function sizeForAspect(ratio: string | undefined): { width: number; height: number } {
  const [a, b] = String(ratio || "1:1").split(":").map((n) => Number(n));
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    return { width: 1024, height: 1024 };
  }
  const round16 = (n: number) => Math.max(256, Math.min(1536, Math.round(n / 16) * 16));
  return a >= b
    ? { width: 1024, height: round16((1024 * b) / a) }
    : { width: round16((1024 * a) / b), height: 1024 };
}

/** What the UI can say about the free lanes right now, without drawing anything. */
export async function freeLaneStatus(purpose: Purpose = "placeholder") {
  const up = await localUp();
  const plan = planLanes(purpose, { localUp: up, freeAllowed: FREE_ENABLED, paidKeyed: true });
  return { localUp: up, freeAllowed: FREE_ENABLED, order: plan.order, why: plan.why };
}
