// ---------------------------------------------------------------------------
// Music Creator — the RunPod pod behind the GPU server. Server-side only.
//
// The GPU is a Pod that bills per second while RUNNING, so it spends most of
// its life stopped. That used to mean "rendering is broken until someone runs
// setup.mjs --start and SSHes in". Now the site wakes it: RUNPOD_API_KEY +
// MUSIC_POD_ID let this module read the pod's state and send `start`, the pod's
// boot command (autostart.sh) brings the server up, and the server stops its
// own pod after MUSIC_IDLE_STOP_MINUTES idle — so a wake can never bill forever.
//
// Same REST API v2 as tools/music-creator/runpod/setup.mjs.
// ---------------------------------------------------------------------------

const API = "https://api.runpod.io/v2";
const PORT = 8770;

export type PodStatus = "PROVISIONING" | "STARTING" | "RUNNING" | "EXITED" | "ERROR" | "TERMINATED" | string;

export interface PodState {
  /** False when the site has no pod to manage (no key or no pod id). */
  managed: boolean;
  status?: PodStatus;
  gpu?: string;
  costPerHour?: number;
  error?: string;
}

function podId(): string {
  return (process.env.MUSIC_POD_ID ?? "").trim();
}

function key(): string {
  return (process.env.RUNPOD_API_KEY ?? "").trim();
}

export function podManaged(): boolean {
  return !!podId() && !!key();
}

/** The pod's HTTPS proxy address — used when MUSIC_SERVER_URL is not set. */
export function podServerUrl(): string {
  const id = podId().replace(/^pod_/, "");
  return id ? `https://${id}-${PORT}.proxy.runpod.net` : "";
}

async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key()}`,
      // RunPod's edge rejects the default client UA (Cloudflare 1010).
      "User-Agent": "music-creator-site/1.0",
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(String(data.detail ?? data.title ?? data.error ?? `RunPod answered ${res.status}`));
  return data;
}

export async function podState(): Promise<PodState> {
  if (!podManaged()) return { managed: false };
  try {
    const pod = await api(`/pods/${encodeURIComponent(podId())}`);
    const gpu = pod.gpu as { id?: string } | undefined;
    return {
      managed: true,
      status: String(pod.status ?? "UNKNOWN"),
      gpu: gpu?.id,
      costPerHour: typeof pod.cost === "number" ? pod.cost : undefined,
    };
  } catch (err) {
    return { managed: true, error: (err as Error).message };
  }
}

export async function startPod(): Promise<PodState> {
  if (!podManaged()) return { managed: false, error: "No pod is configured (MUSIC_POD_ID / RUNPOD_API_KEY)." };
  const before = await podState();
  if (before.error) return before;
  if (before.status === "TERMINATED") {
    return { ...before, error: "The pod was terminated. Recreate it with tools/music-creator/runpod/setup.mjs --yes." };
  }
  if (before.status === "RUNNING" || before.status === "STARTING" || before.status === "PROVISIONING") return before;
  try {
    await api(`/pods/${encodeURIComponent(podId())}/action`, { method: "POST", body: { action: "start" } });
    return { ...before, status: "STARTING" };
  } catch (err) {
    return { ...before, error: `RunPod would not start the pod: ${(err as Error).message}` };
  }
}
