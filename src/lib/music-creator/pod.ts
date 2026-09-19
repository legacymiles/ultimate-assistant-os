// ---------------------------------------------------------------------------
// Music Creator — the RunPod pod behind the GPU server. Server-side only.
//
// The GPU is a Pod that bills per second while RUNNING, so it spends most of
// its life stopped: the owner wants to pay only while it is actually in use.
// The site therefore wakes it: RUNPOD_API_KEY lets this module read the pod's
// state and send `start`, the pod's boot command (autostart.sh) brings the
// server up, and the server stops its own pod after MUSIC_IDLE_STOP_MINUTES
// idle — so a wake can never bill forever.
//
// A stopped pod stays bound to the machine it last ran on, and RunPod refuses
// to start it if that machine's GPU has been rented out meanwhile. The models
// live on the network volume, not the machine, so the fix is to replace the
// pod: terminate it and create a new one on the same volume, on whatever card
// in that data centre is in stock. That is why the pod is found by NAME
// (MUSIC_POD_NAME, default "music-creator") and MUSIC_POD_ID is only a hint —
// a replacement has a new id.
//
// Same REST API v2 and pod shape as tools/music-creator/runpod/setup.mjs.
// ---------------------------------------------------------------------------

const API = "https://api.runpod.io/v2";
const PORT = 8770;
const MOUNT = "/workspace";

export type PodStatus = "PROVISIONING" | "STARTING" | "RUNNING" | "EXITED" | "ERROR" | "TERMINATED" | string;

export interface PodState {
  /** False when the site has no pod to manage (no key, or no pod and no volume). */
  managed: boolean;
  status?: PodStatus;
  gpu?: string;
  costPerHour?: number;
  /** Set when the pod was replaced on this call because the old one could not start. */
  replaced?: boolean;
  error?: string;
}

interface Pod {
  id: string;
  name: string;
  status: PodStatus;
  gpu?: { id?: string };
  cost?: number;
}

const env = (name: string, fallback = "") => (process.env[name] ?? "").trim() || fallback;
const key = () => env("RUNPOD_API_KEY");
const podName = () => env("MUSIC_POD_NAME", "music-creator");
const volumeName = () => env("MUSIC_VOLUME_NAME", "music-creator-weights");

async function api<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
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
  return data as T;
}

// The proxy asks for the pod on every request; a short cache keeps that to one
// RunPod call per burst rather than one per poll.
let cached: { at: number; pod: Pod | null } | null = null;

async function findPod(fresh = false): Promise<Pod | null> {
  if (!key()) return null;
  if (!fresh && cached && Date.now() - cached.at < 15_000) return cached.pod;
  const out = await api<{ pods?: Pod[] }>("/pods");
  const pods = (out.pods ?? []).filter((p) => p.status !== "TERMINATED");
  const hint = env("MUSIC_POD_ID");
  const pod = pods.find((p) => p.name === podName()) ?? pods.find((p) => p.id === hint) ?? null;
  cached = { at: Date.now(), pod };
  return pod;
}

export function podManaged(): boolean {
  return !!key() && (!!env("MUSIC_POD_ID") || !!env("MUSIC_TOKEN"));
}

/** The pod's HTTPS proxy address — used when MUSIC_SERVER_URL is not set. */
export async function podServerUrl(): Promise<string> {
  if (!podManaged()) return "";
  const pod = await findPod().catch(() => null);
  const id = (pod?.id ?? env("MUSIC_POD_ID")).replace(/^pod_/, "");
  return id ? `https://${id}-${PORT}.proxy.runpod.net` : "";
}

function describe(pod: Pod | null): PodState {
  if (!pod) return { managed: true, status: "EXITED" };
  return { managed: true, status: pod.status, gpu: pod.gpu?.id, costPerHour: typeof pod.cost === "number" ? pod.cost : undefined };
}

export async function podState(): Promise<PodState> {
  if (!podManaged()) return { managed: false };
  try {
    // No pod at all is "asleep" too: waking creates one on the volume.
    return describe(await findPod());
  } catch (err) {
    return { managed: true, error: (err as Error).message };
  }
}

export async function startPod(): Promise<PodState> {
  if (!podManaged()) return { managed: false, error: "No GPU pod is configured (RUNPOD_API_KEY + MUSIC_TOKEN)." };
  try {
    const pod = await findPod(true);
    if (pod && ["RUNNING", "STARTING", "PROVISIONING"].includes(pod.status)) return describe(pod);
    if (pod) {
      try {
        await api(`/pods/${encodeURIComponent(pod.id)}/action`, { method: "POST", body: { action: "start" } });
        cached = null;
        return { ...describe(pod), status: "STARTING" };
      } catch {
        // Most often: its machine's GPU is rented out. Replace it (below).
        await api(`/pods/${encodeURIComponent(pod.id)}/action`, { method: "POST", body: { action: "terminate" } }).catch(() => undefined);
      }
    }
    const created = await createPod();
    cached = null;
    return { ...describe(created), status: "STARTING", replaced: !!pod };
  } catch (err) {
    return { managed: true, error: `Could not wake the GPU: ${(err as Error).message}` };
  }
}

/**
 * A new pod on the existing volume — the same shape setup.mjs --yes creates.
 * The card is whichever NVIDIA card with enough memory is best stocked in the
 * volume's data centre right now (then cheapest).
 */
async function createPod(): Promise<Pod> {
  const token = env("MUSIC_TOKEN");
  if (!token) throw new Error("MUSIC_TOKEN is not set, so a replacement pod could not authenticate the site.");
  const vols = await api<{ networkVolumes?: { id: string; name: string; dataCenter: string }[] }>("/network-volumes");
  const volume = (vols.networkVolumes ?? []).find((v) => v.name === volumeName());
  if (!volume) throw new Error(`No network volume named "${volumeName()}" — run tools/music-creator/runpod/setup.mjs --yes.`);

  const minVram = Number(env("MUSIC_MIN_VRAM", "32"));
  const catalog = await api<{ gpus?: { id: string; manufacturer: string; memory: number; secure: boolean; price?: { secure?: number }; dataCenters?: { id: string; availability: string }[] }[] }>(
    "/catalog/gpus?include=AVAILABILITY&product=POD",
  );
  const rank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const preferred = env("MUSIC_GPU");
  const options = (catalog.gpus ?? [])
    .filter((g) => g.manufacturer === "NVIDIA" && g.memory >= minVram && g.secure && g.price?.secure)
    .map((g) => ({ g, stock: rank[g.dataCenters?.find((d) => d.id === volume.dataCenter)?.availability ?? ""] ?? 0 }))
    .filter((o) => o.stock > 0)
    .sort((a, b) => Number(b.g.id === preferred) - Number(a.g.id === preferred) || b.stock - a.stock || a.g.price!.secure! - b.g.price!.secure!);
  if (!options.length) throw new Error(`No GPU with ${minVram} GB is free in ${volume.dataCenter} right now. Try again in a few minutes.`);

  return api<Pod>("/pods", {
    method: "POST",
    body: {
      name: podName(),
      image: env("MUSIC_POD_IMAGE", "runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404"),
      gpu: { id: options[0].g.id, count: 1 },
      cloud: "SECURE",
      disk: Number(env("MUSIC_DISK_GB", "60")),
      ports: [`${PORT}/http`, "22/tcp"],
      dataCenterIds: [volume.dataCenter],
      mounts: { network: [{ volumeId: volume.id, path: MOUNT }] },
      env: {
        MUSIC_TOKEN: token,
        VOLUME: MOUNT,
        MUSIC_PORT: String(PORT),
        MUSIC_IDLE_STOP_MINUTES: env("MUSIC_IDLE_STOP_MINUTES", "20"),
      },
      cmd: ["bash", "-c", `[ -f ${MOUNT}/autostart.sh ] && (bash ${MOUNT}/autostart.sh &); exec /start.sh`],
      startSsh: true,
    },
  });
}
