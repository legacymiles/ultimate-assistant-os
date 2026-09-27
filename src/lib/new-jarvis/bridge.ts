// ---------------------------------------------------------------------------
// Talking to the local agent from the page.
//
// The bridge listens on 127.0.0.1:42020. That is reachable from a tab served
// by Vercel — the browser does not care that the page came from the internet
// and the server is on this desk — which is the whole trick that lets a
// deployed site drive this machine.
//
// Everything here is written on the assumption that the bridge is OFF, because
// most of the time it is. `probe` never throws, `call` fails with a sentence
// the owner can act on, and the surface greys out what is missing rather than
// offering a button that cannot work.
// ---------------------------------------------------------------------------

import { classify, type BridgeOp, type Verdict } from "./actions";

export const BRIDGE_URL = "http://127.0.0.1:42020";
const TOKEN_KEY = "new-jarvis:bridge-token";

export interface BridgeCapabilities {
  shell: boolean;
  files: boolean;
  system: boolean;
  browser: boolean;
  /** Why browser control is off, when it is. Shown verbatim. */
  browserWhy?: string;
}

export interface BridgeHealth {
  /** Answering at all. */
  up: boolean;
  /** Answering AND holding a token we have. */
  paired: boolean;
  version?: string;
  capabilities?: BridgeCapabilities;
  browserRunning?: boolean;
  /** Set when it is not usable, in the owner's language. */
  problem?: string;
}

export const BRIDGE_OFFLINE: BridgeHealth = {
  up: false,
  paired: false,
  problem: "The local agent is not running on this PC.",
};

// --- the token ------------------------------------------------------------

export function readToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    // A browser with storage switched off can still use everything that does
    // not need this PC, so this is a missing token, not an error.
    return "";
  }
}

export function saveToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token.trim());
  } catch { /* nothing to do; the next call will simply say it is not paired. */ }
}

export function forgetToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* already gone as far as anyone can tell. */ }
}

/**
 * Take the token out of `#pair=…` if pair.cmd put one there.
 *
 * A fragment never reaches a server — not Vercel, not a proxy, not an access
 * log — so this is the one way the key to the machine can travel from a script
 * on the PC into a page served from the internet without being written down
 * anywhere in between. It is stripped from the address bar immediately so it
 * does not end up in a screenshot or a bookmark.
 */
export function claimPairedToken(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash ?? "";
  const m = /[#&]pair=([A-Za-z0-9_-]{20,})/.exec(hash);
  if (!m) return false;
  saveToken(m[1]);
  const cleaned = hash.replace(/[#&]pair=[A-Za-z0-9_-]+/, "").replace(/^#&/, "#");
  window.history.replaceState(null, "", window.location.pathname + window.location.search + (cleaned === "#" ? "" : cleaned));
  return true;
}

// --- talking to it --------------------------------------------------------

/** Is it there? Never throws: "not there" is the normal answer. */
export async function probe(signal?: AbortSignal): Promise<BridgeHealth> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { signal, cache: "no-store" });
    if (!res.ok) return { ...BRIDGE_OFFLINE, up: true, problem: `The agent answered ${res.status}.` };
    const data = (await res.json()) as {
      version?: string;
      capabilities?: BridgeCapabilities;
      browserRunning?: boolean;
    };
    const paired = readToken().length > 0;
    return {
      up: true,
      paired,
      version: data.version,
      capabilities: data.capabilities,
      browserRunning: data.browserRunning,
      problem: paired ? undefined : "Running, but New Jarvis is not paired with it yet.",
    };
  } catch {
    return BRIDGE_OFFLINE;
  }
}

export class BridgeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "BridgeError";
  }
}

/**
 * One call to the bridge.
 *
 * The failure messages are the point. "Failed to fetch" tells the owner
 * nothing and sends them to the browser console; "the agent is not running"
 * tells them exactly which of the three things went wrong.
 */
export async function call<T = Record<string, unknown>>(
  route: string,
  args: Record<string, unknown> = {},
  opts: { signal?: AbortSignal; method?: "GET" | "POST" } = {},
): Promise<T> {
  const token = readToken();
  if (!token) throw new BridgeError("Not paired with the local agent yet.", 401);

  let res: Response;
  try {
    res = await fetch(`${BRIDGE_URL}/${route.replace(/^\//, "")}`, {
      method: opts.method ?? "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: opts.method === "GET" ? undefined : JSON.stringify(args),
      signal: opts.signal,
      cache: "no-store",
    });
  } catch {
    throw new BridgeError("The local agent is not running on this PC.", 0);
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) {
    throw new BridgeError(
      data.error ?? (res.status === 401 ? "This bridge does not know that token — re-pair it." : `The agent answered ${res.status}.`),
      res.status,
    );
  }
  return data as T;
}

/**
 * A call the owner has already agreed to, with its verdict attached.
 *
 * The verdict is computed HERE rather than being passed in, so a caller cannot
 * skip the gate by forgetting to ask for one — and so the sentence shown on
 * the gate and the sentence written into the run log are the same sentence.
 */
export function verdictFor(op: BridgeOp): Verdict {
  return classify(op);
}
