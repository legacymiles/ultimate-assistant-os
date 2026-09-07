// ---------------------------------------------------------------------------
// Which backend renders a shot.
//
// Order is deliberate: your own hardware first, then the hosted API, then the
// gateway, then nothing. A key that is present is treated as a key you meant
// to use. AUTEUR_VIDEO_BACKEND overrides the order when you want to pin one.
//
// Async task ids are prefixed with the backend that owns them
// ("runpod:abc123"), so a later poll or download is routed back to the same
// place even if configuration changed underneath it.
// ---------------------------------------------------------------------------

import "server-only";

import { gatewayBackend } from "./gateway";
import { minimaxBackend } from "./minimax";
import { placeholderBackend } from "./placeholder";
import { runpodBackend } from "./runpod";
import type { BackendId, VideoBackend } from "./types";

export * from "./types";
export { runpodHealth } from "./runpod";

function available(): VideoBackend[] {
  const out: VideoBackend[] = [];
  const runpodKey = process.env.RUNPOD_API_KEY || "";
  const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID || "";
  const minimaxKey = process.env.MINIMAX_API_KEY || "";
  const gatewayKey = process.env.AI_GATEWAY_API_KEY || "";

  if (runpodKey && runpodEndpoint) out.push(runpodBackend(runpodKey, runpodEndpoint));
  if (minimaxKey) out.push(minimaxBackend(minimaxKey));
  if (gatewayKey) out.push(gatewayBackend());
  out.push(placeholderBackend());
  return out;
}

/** The backend a new render should use. */
export function activeBackend(): VideoBackend {
  const list = available();
  const pinned = (process.env.AUTEUR_VIDEO_BACKEND || "").trim().toLowerCase() as BackendId;
  if (pinned) {
    const hit = list.find((b) => b.id === pinned);
    if (hit) return hit;
    // A pin naming an unconfigured backend is a misconfiguration worth seeing
    // in the logs rather than silently ignoring.
    console.warn(`AUTEUR_VIDEO_BACKEND="${pinned}" is not configured; falling back.`);
  }
  return list[0];
}

/** The backend that owns an existing task id. */
export function backendForTask(taskId: string): { backend: VideoBackend; id: string } | null {
  const [prefix, ...rest] = taskId.split(":");
  const bare = rest.join(":");
  const hit = available().find((b) => b.id === prefix);
  if (!hit || !bare) return null;
  return { backend: hit, id: bare };
}

export function tagTask(backend: VideoBackend, id: string): string {
  return `${backend.id}:${id}`;
}

/** What the studio shows in its status line. */
export function backendSummary(): { id: BackendId; label: string; async: boolean } {
  const b = activeBackend();
  return { id: b.id, label: b.label, async: Boolean(b.poll) };
}
