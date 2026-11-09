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
  /** Claude (the owner's own subscription) can be Jarvis's brain on this PC. */
  brain?: boolean;
  /** At least one coding harness (Claude Code or DeepSeek Harness) can run here. */
  harness?: boolean;
  /** Which ones, and why not when one cannot. */
  harnesses?: { id: string; label: string; available: boolean; why: string }[];
  /** MCP servers can be run from this PC. */
  mcp?: boolean;
  /** The CLI inventory can be read from this PC. */
  cli?: boolean;
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
  /**
   * The browser is refusing to let this site reach 127.0.0.1 at all.
   *
   * Chrome gates a public page talking to the local network behind a
   * permission, and it only ever asks on a CLICK. A probe on page load is not
   * a click, so it fails with the same "Failed to fetch" as a bridge that is
   * genuinely off — and the page then tells the owner to go and start
   * something that is already running. Distinguishing the two is the whole
   * reason this flag exists.
   */
  needsLocalNetwork?: boolean;
  /** The agent installing its own packages (first run, or after a move). */
  settingUp?: boolean;
}

export const BRIDGE_OFFLINE: BridgeHealth = {
  up: false,
  paired: false,
  problem: "Jarvis's PC helper isn't running on this computer.",
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

/**
 * Pair with the agent on this PC by itself — no token to copy, no pair.cmd.
 *
 * The agent hands its token only to this site's origin, on a preflighted
 * request (the custom header forces one), so other websites can't read it.
 */
export async function autoPair(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_URL}/pair`, { signal, cache: "no-store", headers: { "X-Jarvis-Pair": "1" } });
    if (!res.ok) return false;
    const data = (await res.json()) as { token?: string };
    if (!data.token || data.token.length < 20) return false;
    saveToken(data.token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is it there? Never throws: "not there" is the normal answer.
 *
 * Tried TWICE before believing the answer is no. A page served over https
 * reaching 127.0.0.1 is a cross-origin request into the local network, and
 * the browser does a dance before the first one of those lands — a preflight,
 * and on current Chrome a local-network permission check. The first call from
 * a page can fail where the second succeeds milliseconds later.
 *
 * That blip used to cost a whole Approve & build: one failed fetch meant
 * "Jarvis's PC helper isn't running" on a machine where it was running, was
 * answering, and was already paired. Everything else here is written on the
 * assumption that the bridge is off, so the one thing that must be right is
 * deciding that it IS off.
 *
 * An aborted probe is not retried: the caller walked away.
 */
export async function probe(signal?: AbortSignal): Promise<BridgeHealth> {
  const first = await probeOnce(signal);
  if (first.up || signal?.aborted) return first;
  await new Promise((r) => setTimeout(r, 250));
  if (signal?.aborted) return first;
  return probeOnce(signal);
}

async function probeOnce(signal?: AbortSignal): Promise<BridgeHealth> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { signal, cache: "no-store" });
    if (!res.ok) return { ...BRIDGE_OFFLINE, up: true, problem: `The agent answered ${res.status}.` };
    const data = (await res.json()) as {
      version?: string;
      capabilities?: BridgeCapabilities;
      browserRunning?: boolean;
      pairable?: boolean;
      setup?: { state?: string; why?: string };
      folder?: string;
    };
    if (data.folder) rememberFolder(data.folder);
    let paired = readToken().length > 0;
    if (!paired && data.pairable) paired = await autoPair(signal);
    const settingUp = data.setup?.state === "installing";
    return {
      up: true,
      paired,
      version: data.version,
      capabilities: data.capabilities,
      browserRunning: data.browserRunning,
      settingUp,
      problem: !paired
        ? "Running, but New Jarvis is not paired with it yet."
        : data.setup?.state === "failed" || settingUp
          ? data.setup?.why
          : undefined,
    };
  } catch {
    // Can't tell "not running" from "the browser threw the answer away" by the
    // failure alone — both are a thrown fetch — so ask the browser which.
    const perm = await localNetworkState();
    if (perm === "prompt" || perm === "denied") {
      return {
        up: false,
        paired: false,
        needsLocalNetwork: true,
        problem:
          perm === "denied"
            ? "This browser is set to block this site from reaching your PC. Allow local network access for this site in its permissions, then try again."
            : "This browser hasn't been allowed to reach your PC from this site yet. Press Connect to this PC and say yes to the prompt.",
      };
    }
    return BRIDGE_OFFLINE;
  }
}

/**
 * Has this site been allowed to reach the local network?
 *
 * "granted" on a site that has been allowed, "prompt" on one that has not yet
 * been asked, "denied" when the owner said no. Older browsers, and ones with
 * no such permission, know nothing about it and say so — and that is treated
 * as "not the problem", because on those the request is not being blocked
 * here.
 */
async function localNetworkState(): Promise<"granted" | "prompt" | "denied" | "unknown"> {
  try {
    const perms = (navigator as unknown as { permissions?: { query(d: { name: string }): Promise<{ state: string }> } }).permissions;
    if (!perms?.query) return "unknown";
    const { state } = await perms.query({ name: "local-network-access" });
    return state === "granted" || state === "prompt" || state === "denied" ? state : "unknown";
  } catch {
    // An unrecognised permission name throws. That is the common case on any
    // browser that does not have this gate, and it is not an error.
    return "unknown";
  }
}

const FOLDER_KEY = "new-jarvis:bridge-folder";

function rememberFolder(folder: string): void {
  try {
    window.localStorage.setItem(FOLDER_KEY, folder);
  } catch { /* only used for a hint */ }
}

/** The agent's folder on this PC, as last reported — shown if it needs installing again. */
export function knownFolder(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(FOLDER_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The jarvis-agent:// link the agent registers on Windows, so a tap can start it. */
export const START_LINK = "jarvis-agent://start";

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
  opts: { signal?: AbortSignal; method?: "GET" | "POST"; retried?: boolean } = {},
): Promise<T> {
  let token = readToken();
  if (!token && (await autoPair(opts.signal))) token = readToken();
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

  // A stale token (the agent was reinstalled or moved) re-pairs itself once.
  if (res.status === 401 && !opts.retried && (await autoPair(opts.signal)) && readToken() !== token) {
    return call<T>(route, args, { ...opts, retried: true });
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
