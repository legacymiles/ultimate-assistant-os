// ---------------------------------------------------------------------------
// RunPod GPU Pod control: status, start, stop. Nothing else.
//
// Field names and paths are from RunPod's REST API v2
// (https://api.runpod.io/v2/openapi.json and docs.runpod.io/pods/manage-pods),
// not guessed. v1 at rest.runpod.io/v1 is deprecated.
//
// THERE IS NO TERMINATE FUNCTION HERE, ON PURPOSE.
// Stop  = POST /v2/pods/{id}/action {"action":"stop"}  — frees the GPU, stops
//         compute billing, KEEPS the pod and its /workspace volume.
// Terminate = DELETE /v2/pods/{id} — destroys the pod and every byte not on a
//         network volume. That is the MuseTalk weights and the avatar gone.
// The two are one word apart in the API and worlds apart in consequence, so
// the destructive one is simply not reachable from this app.
// ---------------------------------------------------------------------------

import "server-only";

export const RUNPOD_API = "https://api.runpod.io/v2";

/** The run states RunPod reports. */
export type PodStatus =
  | "PROVISIONING"
  | "STARTING"
  | "RUNNING"
  | "EXITED"
  | "ERROR"
  | "TERMINATED";

export interface PodPort {
  private: number;
  public: number | null;
  type: string;
  ip: string | null;
}

export interface Pod {
  id: string;
  name: string;
  status: PodStatus;
  /** The pod's hourly compute rate in USD. Reported in every state. */
  cost: number;
  /** Declared ports, e.g. "8010/http". */
  ports: string[];
  /** Live mapping — null unless the pod is RUNNING, and absent from list calls. */
  runtime: { ports?: PodPort[] } | null;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class PodError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Compute is only billed in these states. */
export function isBilling(status: PodStatus): boolean {
  return status === "RUNNING" || status === "STARTING" || status === "PROVISIONING";
}

/** Still coming up — poll again rather than reporting a failure. */
export function isPending(status: PodStatus): boolean {
  return status === "STARTING" || status === "PROVISIONING";
}

/**
 * The pod's reachable address for a container port, from the live mapping.
 *
 * RunPod does not document a format for its HTTP proxy hostname, so this does
 * not invent one — it uses the ip:port RunPod actually reports, and answers
 * null when there is none yet. A guessed proxy URL would fail at the worst
 * moment, mid-conversation, with the pod already costing money.
 */
export function podEndpoint(pod: Pod, containerPort: number): string | null {
  const mapped = pod.runtime?.ports?.find((p) => p.private === containerPort);
  if (!mapped || !mapped.public || !mapped.ip) return null;
  const scheme = mapped.type === "https" ? "https" : "http";
  return `${scheme}://${mapped.ip}:${mapped.public}`;
}

function apiKey(): string | null {
  const key = process.env.RUNPOD_API_KEY?.trim();
  return key ? key : null;
}

export function podId(): string | null {
  const id = process.env.RUNPOD_POD_ID?.trim();
  return id ? id : null;
}

/** True when this hub has everything it needs to talk to RunPod. */
export function isConfigured(): boolean {
  return apiKey() !== null && podId() !== null;
}

/** What is missing, in words the owner can act on (R4). */
export function missingSetup(): string | null {
  if (!apiKey() && !podId()) return "Set RUNPOD_API_KEY and RUNPOD_POD_ID in .env.local.";
  if (!apiKey()) return "Set RUNPOD_API_KEY in .env.local.";
  if (!podId()) return "Set RUNPOD_POD_ID in .env.local — the pod you built from deploy/runpod.";
  return null;
}

async function call(path: string, init: RequestInit, fetchFn: Fetch): Promise<unknown> {
  const key = apiKey();
  if (!key) throw new PodError(503, "RUNPOD_API_KEY is not set.");
  let res: Response;
  try {
    res = await fetchFn(`${RUNPOD_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new PodError(502, "Could not reach RunPod. Check the connection and try again.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new PodError(502, "RunPod rejected the API key.");
  }
  if (res.status === 404) {
    throw new PodError(404, "RunPod has no pod with that id. Check RUNPOD_POD_ID.");
  }
  if (!res.ok) {
    // 400 on start usually means the host's GPUs went to someone else.
    throw new PodError(
      502,
      res.status === 400
        ? "RunPod would not start the pod — usually no free GPU left on that host. Try again shortly."
        : `RunPod answered ${res.status}.`,
    );
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function toPod(raw: unknown): Pod | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.status !== "string") return null;
  return {
    id: r.id,
    name: typeof r.name === "string" ? r.name : r.id,
    status: r.status as PodStatus,
    cost: typeof r.cost === "number" ? r.cost : 0,
    ports: Array.isArray(r.ports) ? r.ports.filter((p): p is string => typeof p === "string") : [],
    runtime: (r.runtime as Pod["runtime"]) ?? null,
  };
}

export async function getPod(fetchFn: Fetch = fetch): Promise<Pod | null> {
  const id = podId();
  if (!id) throw new PodError(503, "RUNPOD_POD_ID is not set.");
  return toPod(await call(`/pods/${encodeURIComponent(id)}`, { method: "GET" }, fetchFn));
}

/** Resume a stopped pod. Billing starts here. */
export async function startPod(fetchFn: Fetch = fetch): Promise<void> {
  const id = podId();
  if (!id) throw new PodError(503, "RUNPOD_POD_ID is not set.");
  await call(
    `/pods/${encodeURIComponent(id)}/action`,
    { method: "POST", body: JSON.stringify({ action: "start" }) },
    fetchFn,
  );
}

/** Free the GPU and keep the volume. Billing for compute stops here. */
export async function stopPod(fetchFn: Fetch = fetch): Promise<void> {
  const id = podId();
  if (!id) throw new PodError(503, "RUNPOD_POD_ID is not set.");
  await call(
    `/pods/${encodeURIComponent(id)}/action`,
    { method: "POST", body: JSON.stringify({ action: "stop" }) },
    fetchFn,
  );
}
