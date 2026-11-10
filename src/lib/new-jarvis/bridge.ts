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
  /** The relay window can carry the same calls when the direct route is blocked. */
  needsRelay?: boolean;
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
    if (res.ok) {
      const data = (await res.json()) as { token?: string };
      if (data.token && data.token.length >= 20) {
        saveToken(data.token);
        return true;
      }
    }
  } catch {
    /* direct fetch is blocked; the relay below is the other door. */
  }

  if (relayAlive()) {
    try {
      const res = await relayCall("pair", {}, { method: "GET", timeoutMs: 8_000 });
      if (res.status === 200) {
        const data = JSON.parse(res.body) as { token?: string };
        if (data.token && data.token.length >= 20) {
          saveToken(data.token);
          return true;
        }
      }
    } catch {
      /* both doors are shut; the caller reports the bridge as off. */
    }
  }
  return false;
}

// --- the relay window -----------------------------------------------------
//
// Chrome 156 can refuse a public page's fetch to 127.0.0.1 and, once the owner
// has dismissed that prompt, stop asking at all. A TOP-LEVEL navigation to
// localhost is not gated the same way, so a click can open a small page served
// by the bridge; that page fetches its own origin and posts the answer back.
// This is the same door for every app on the owner's domains.

const RELAY_WINDOW = "jarvis-pc-relay";

let relayWin: Window | null = null;
let relayReady = false;
let relaySeq = 0;
let relayListening = false;
const relayWaiting = new Map<
  number,
  { resolve: (v: { status: number; body: string }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

function relayAlive(): boolean {
  return typeof window !== "undefined" && Boolean(relayWin && !relayWin.closed);
}

function relayListen(): void {
  if (relayListening || typeof window === "undefined") return;
  relayListening = true;
  window.addEventListener("message", (event) => {
    if (event.origin !== BRIDGE_URL || !relayWin || event.source !== relayWin) return;
    const data = event.data as { type?: string; id?: number; status?: number; body?: string; error?: string } | null;
    if (data?.type === "jarvis:ready") {
      relayReady = true;
      return;
    }
    if (data?.type !== "jarvis:result" || typeof data.id !== "number") return;
    const waiting = relayWaiting.get(data.id);
    if (!waiting) return;
    relayWaiting.delete(data.id);
    clearTimeout(waiting.timer);
    if (data.error) waiting.reject(new BridgeError(String(data.error), 0));
    else waiting.resolve({ status: Number(data.status ?? 0), body: String(data.body ?? "") });
  });
}

/**
 * Open (or focus) the local relay window. Call it from a click: browsers only
 * allow a popup in response to a real gesture.
 */
export function openRelay(): boolean {
  if (typeof window === "undefined") return false;
  relayListen();
  if (relayAlive()) {
    try {
      relayWin!.focus();
    } catch {
      /* a background tab may be unfocusable; it is still usable. */
    }
    return true;
  }
  relayReady = false;
  relayWin = window.open(`${BRIDGE_URL}/relay`, RELAY_WINDOW, "popup=yes,width=460,height=320");
  return Boolean(relayWin);
}

async function waitForRelay(ms = 5_000): Promise<boolean> {
  if (!relayAlive()) return false;
  if (relayReady) return true;
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (!relayAlive()) return false;
    if (relayReady) return true;
    try {
      relayWin!.postMessage({ type: "jarvis:ping" }, BRIDGE_URL);
    } catch {
      return false;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return relayReady;
}

async function relayCall(
  route: string,
  args: Record<string, unknown> = {},
  opts: { method?: "GET" | "POST"; timeoutMs?: number } = {},
): Promise<{ status: number; body: string }> {
  if (!(await waitForRelay())) throw new BridgeError("The PC relay window did not answer.", 0);
  const id = ++relaySeq;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      relayWaiting.delete(id);
      reject(new BridgeError("The PC relay did not answer in time.", 0));
    }, timeoutMs);
    relayWaiting.set(id, { resolve, reject, timer });
    try {
      relayWin!.postMessage(
        { type: "jarvis:call", id, route, method: opts.method ?? "POST", args, token: readToken() },
        BRIDGE_URL,
      );
    } catch {
      clearTimeout(timer);
      relayWaiting.delete(id);
      reject(new BridgeError("The PC relay window is gone.", 0));
    }
  });
}

/**
 * The one press: open the relay, pair if needed, and say whether the PC is up.
 *
 * This is what every "Connect to my PC" button calls, so the same one window
 * serves Client Review, App Builder and the Chat.
 */
export async function connectPc(): Promise<boolean> {
  if (!openRelay()) return false;
  if (!(await waitForRelay())) return false;
  const health = await probe();
  return Boolean(health.up && health.paired);
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
    return await healthFrom(await res.json());
  } catch {
    // Direct fetch is blocked or the bridge is off. If the relay window is
    // open it can answer the same question from its own origin.
    if (relayAlive()) {
      try {
        const res = await relayCall("health", {}, { method: "GET", timeoutMs: 8_000 });
        if (res.status !== 200) return { ...BRIDGE_OFFLINE, up: true, problem: `The agent answered ${res.status}.` };
        return await healthFrom(JSON.parse(res.body));
      } catch {
        /* fall through to the permission explanation below */
      }
    }
    // Can't tell "not running" from "the browser threw the answer away" by the
    // failure alone — both are a thrown fetch — so ask the browser which.
    const perm = await localNetworkState();
    if (perm === "prompt" || perm === "denied") {
      return {
        up: false,
        paired: false,
        needsLocalNetwork: true,
        needsRelay: true,
        problem:
          perm === "denied"
            ? "Chrome is blocking this site from reaching your PC. Press Connect to my PC: a small Jarvis window will open and carry the connection instead."
            : "Press Connect to my PC once. A small Jarvis window will open and keep the connection — no browser permission needed.",
      };
    }
    return BRIDGE_OFFLINE;
  }
}

async function healthFrom(data: {
  version?: string;
  capabilities?: BridgeCapabilities;
  browserRunning?: boolean;
  pairable?: boolean;
  setup?: { state?: string; why?: string };
  folder?: string;
}): Promise<BridgeHealth> {
  if (data.folder) rememberFolder(data.folder);
  let paired = readToken().length > 0;
  if (!paired && data.pairable) paired = await autoPair();
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
    // The direct route was blocked. If the owner has the relay open, the same
    // call can go through it without any browser permission.
    if (relayAlive()) return callViaRelay<T>(route, args, opts);
    throw new BridgeError("The local agent is not running on this PC. Press Connect to my PC.", 0);
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

/** The same call, carried by the local relay window instead of a direct fetch. */
async function callViaRelay<T = Record<string, unknown>>(
  route: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal; method?: "GET" | "POST"; retried?: boolean },
): Promise<T> {
  let token = readToken();
  if (!token && (await autoPair(opts.signal))) token = readToken();
  if (!token) throw new BridgeError("Not paired with the local agent yet.", 401);

  const timeoutMs = route.startsWith("harness/") ? 120_000 : 45_000;
  let res = await relayCall(route, args, { method: opts.method, timeoutMs });
  if (res.status === 401 && !opts.retried && (await autoPair(opts.signal)) && readToken() !== token) {
    res = await relayCall(route, args, { method: opts.method, timeoutMs });
  }

  const data = JSON.parse(res.body || "{}") as { error?: string } & Record<string, unknown>;
  if (res.status >= 400) {
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
