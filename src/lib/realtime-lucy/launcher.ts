// Realtime Lucy's start button.
//
// The model runs on the owner's PC; this page is usually served from Vercel,
// which cannot reach it. The browser can: the studio bridge
// (tools/studio-bridge) already runs on that PC for Jarvis Studio, so it is
// what starts and stops the GPU server — the page only asks. An https page
// calling 127.0.0.1 is a private-network request; the bridge answers
// Access-Control-Allow-Private-Network, so this works from the deployed hub as
// well as from a dev server.
//
// Server side: the /lucy/* routes in tools/studio-bridge/server.mjs.

export const LUCY_BRIDGE = "http://127.0.0.1:42010";
/** Where the page remembers a different launcher (a second PC with a big GPU). */
export const LS_BRIDGE = "lucy.bridgeUrl";

export function bridgeBase() {
  try {
    const saved = localStorage.getItem(LS_BRIDGE)?.trim().replace(/\/+$/, "");
    if (saved) return saved;
  } catch {
    /* private mode */
  }
  return LUCY_BRIDGE;
}

/** Thrown when the bridge itself is not running — a different fix to show. */
export const BRIDGE_DOWN = "bridge-down";
/** Thrown when it IS running, but from a build that predates the Lucy routes.
 *  Worth telling apart: starting a second copy won't help, because the port is
 *  taken by the old one — it has to be stopped first. */
export const BRIDGE_STALE = "bridge-stale";

export interface LauncherStatus {
  /** Is the Python env + weights install present on that PC at all? */
  installed: boolean;
  python?: string;
  port?: number;
  /** Is the Lucy server answering /health? */
  running: boolean;
  /** Has it finished loading the model onto the card? */
  ready: boolean;
  starting: boolean;
  exited: { code: number | null; message?: string } | null;
  startedAt: number | null;
  error: string | null;
  log: string;
}

async function ask(path: string, method: "GET" | "POST", timeoutMs = 10_000) {
  let res: Response;
  try {
    res = await fetch(`${bridgeBase()}${path}`, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(BRIDGE_DOWN);
  }
  if (res.status === 404) {
    // An older bridge answers /health and 404s everything Lucy needs.
    const alive = await fetch(`${bridgeBase()}/health`, { cache: "no-store", signal: AbortSignal.timeout(15_000) })
      .then((r) => r.ok)
      .catch(() => false);
    throw new Error(alive ? BRIDGE_STALE : BRIDGE_DOWN);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `${path} ${res.status}`);
  return body;
}

export async function launcherStatus(): Promise<LauncherStatus> {
  return (await ask("/lucy/status", "GET")) as unknown as LauncherStatus;
}

/** Spawns the server and returns as soon as it is spawned — the model then
 *  takes 20–30 s to land on the card, which the caller watches via /health. */
export async function startEngine(): Promise<void> {
  await ask("/lucy/start", "POST");
}

/** Hands the ~5.2 GB of VRAM back. */
export async function stopEngine(): Promise<void> {
  await ask("/lucy/stop", "POST", 20_000);
}

/** The line of the server log worth showing when a start dies. */
export function lastLogLine(log: string): string {
  const lines = log
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}
