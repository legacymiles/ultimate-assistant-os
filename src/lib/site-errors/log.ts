// ---------------------------------------------------------------------------
// Site errors — every crash on the hub, and on client sites, in one log.
//
// The first rung of Felix's "keep it crash-free" ladder is knowing a crash
// happened before anyone reports it. Browsers send a report (the hub through
// ErrorReporter, client sites through /jarvis-errors.js); the server folds it
// into one entry per FINGERPRINT, so a crash that fires a thousand times is
// one row with a count of a thousand, not a thousand rows.
//
// The log feeds three things: the Site errors widget on the Deck, the Improve
// self-audit, and super-board's super-collect (as the `jarvis-errors` custom
// source), which files verified Backlog cards from it.
//
// Pure: no I/O here, so the folding and the noise filter are tested.
// ---------------------------------------------------------------------------

export type ErrorKind = "error" | "rejection" | "render" | "server" | "console";

export interface ErrorReport {
  /** Which site: "hub" for this one, or the client site's name from the script tag. */
  site: string;
  kind: ErrorKind;
  message: string;
  stack?: string;
  /** Page it happened on (path + query stripped of anything that looks like a secret). */
  url?: string;
  /** Short browser label, e.g. "iPhone Safari". */
  agent?: string;
  /** Next.js error digest, when the boundary has one. */
  digest?: string;
}

export interface ErrorEntry {
  id: string;
  site: string;
  kind: ErrorKind;
  message: string;
  stack: string;
  /** Up to five distinct pages it has happened on. */
  urls: string[];
  agents: string[];
  count: number;
  firstSeen: string;
  lastSeen: string;
  /** Owner marked it fixed. A new occurrence after that re-opens it. */
  resolvedAt?: string;
}

export interface ErrorLog {
  entries: ErrorEntry[];
}

export const MAX_ENTRIES = 300;
const MAX_MESSAGE = 500;
const MAX_STACK = 4_000;

/** Errors no one can act on: browser noise, extensions, cross-origin "Script error.". */
const NOISE = [
  /^script error\.?$/i,
  /resizeobserver loop/i,
  /^(uncaught )?(abort|cancel)ed?/i,
  /the user aborted a request/i,
  /^loading chunk \d+ failed/i, // a deploy landed mid-session; the reload fixes it
  /^network ?error$/i,
];

/** A crash whose stack starts inside a browser extension is the extension's, not ours. */
const EXTENSION = /(chrome|moz|safari-web)-extension:\/\//;

export function isNoise(r: Pick<ErrorReport, "message" | "stack">): boolean {
  if (NOISE.some((re) => re.test(r.message.trim()))) return true;
  const firstFrame = (r.stack ?? "").split("\n").slice(1).find((l) => l.trim());
  return Boolean(firstFrame && EXTENSION.test(firstFrame));
}

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

/** Drop query strings and anything token-shaped, so a log never holds a secret link. */
export function cleanUrl(u: unknown): string {
  const s = clip(u, 600);
  if (!s) return "";
  try {
    const url = new URL(s, "https://x.invalid");
    const path = url.pathname.replace(/[A-Za-z0-9_-]{24,}/g, ":id");
    return url.host === "x.invalid" ? path : `${url.host}${path}`;
  } catch {
    return s.split("?")[0].slice(0, 200);
  }
}

const KINDS: ErrorKind[] = ["error", "rejection", "render", "server", "console"];

/** Whatever arrived over the wire, made safe and bounded — or null if unusable. */
export function coerceReport(raw: unknown): ErrorReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const message = clip(r.message, MAX_MESSAGE).trim();
  if (!message) return null;
  const site = (clip(r.site, 60).trim() || "hub").replace(/[^\w .-]/g, "").slice(0, 60) || "hub";
  return {
    site,
    kind: KINDS.includes(r.kind as ErrorKind) ? (r.kind as ErrorKind) : "error",
    message,
    stack: clip(r.stack, MAX_STACK) || undefined,
    url: cleanUrl(r.url) || undefined,
    agent: clip(r.agent, 40) || undefined,
    digest: clip(r.digest, 40) || undefined,
  };
}

/** The same message with its changing parts (ids, numbers, quotes, urls) flattened. */
export function normalizeMessage(m: string): string {
  return m
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/(["'`]).*?\1/g, "<s>")
    .replace(/\b[0-9a-f]{8,}\b/g, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first stack frame that is the app's own code, without line numbers. */
function topFrame(stack?: string): string {
  if (!stack) return "";
  for (const line of stack.split("\n").slice(1, 12)) {
    const m = line.match(/(?:\(|@|at )([^()\s]+?\.(?:js|ts|tsx|jsx|mjs))(?::\d+)*\)?\s*$/);
    if (m && !/node_modules|chunks\/framework|react-dom/.test(m[1])) return m[1].replace(/\?.*$/, "").replace(/-[0-9a-f]{8,}/, "");
  }
  return "";
}

/** Small, stable, non-crypto hash (FNV-1a) — ids only need to be stable, not secret. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function fingerprint(r: ErrorReport): string {
  return `${r.site.toLowerCase()}-${fnv(`${r.site.toLowerCase()}|${r.kind}|${normalizeMessage(r.message)}|${topFrame(r.stack)}`)}`;
}

const addUnique = (list: string[], v: string | undefined, max: number) =>
  !v || list.includes(v) ? list : [...list, v].slice(-max);

/** Fold one report into the log. Returns the new log and the entry it landed on. */
export function record(log: ErrorLog, report: ErrorReport, now: Date): { log: ErrorLog; entry: ErrorEntry } {
  const at = now.toISOString();
  const id = fingerprint(report);
  const existing = log.entries.find((e) => e.id === id);
  let entry: ErrorEntry;
  if (existing) {
    entry = {
      ...existing,
      count: existing.count + 1,
      lastSeen: at,
      urls: addUnique(existing.urls, report.url, 5),
      agents: addUnique(existing.agents, report.agent, 5),
      stack: existing.stack || report.stack || "",
      // Happening again after "fixed" means it isn't.
      resolvedAt: undefined,
    };
  } else {
    entry = {
      id,
      site: report.site,
      kind: report.kind,
      message: report.message,
      stack: report.stack ?? "",
      urls: report.url ? [report.url] : [],
      agents: report.agent ? [report.agent] : [],
      count: 1,
      firstSeen: at,
      lastSeen: at,
    };
  }
  const rest = log.entries.filter((e) => e.id !== id);
  // Newest first; past the cap, the oldest resolved entries go first, then the oldest.
  let entries = [entry, ...rest];
  if (entries.length > MAX_ENTRIES) {
    const byAge = [...entries].sort((a, b) => Number(!a.resolvedAt) - Number(!b.resolvedAt) || a.lastSeen.localeCompare(b.lastSeen));
    const drop = new Set(byAge.slice(0, entries.length - MAX_ENTRIES).map((e) => e.id));
    entries = entries.filter((e) => !drop.has(e.id));
  }
  return { log: { entries }, entry };
}

export function resolve(log: ErrorLog, id: string, now: Date, reopen = false): ErrorLog {
  return {
    entries: log.entries.map((e) => (e.id === id ? { ...e, resolvedAt: reopen ? undefined : now.toISOString() } : e)),
  };
}

export function openEntries(log: ErrorLog): ErrorEntry[] {
  return log.entries.filter((e) => !e.resolvedAt).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

/** Open errors seen in the last `days` days. */
export function recentOpen(log: ErrorLog, now: Date, days = 7): ErrorEntry[] {
  const since = now.getTime() - days * 86_400_000;
  return openEntries(log).filter((e) => Date.parse(e.lastSeen) >= since);
}

/**
 * The shape super-collect's custom http source reads
 * (map: items/id/title/body/url/count — see the board config).
 */
export function toCollect(log: ErrorLog, origin: string): { items: { id: string; title: string; body: string; url: string; count: number }[] } {
  return {
    items: openEntries(log).map((e) => ({
      id: e.id,
      title: `[${e.site}] ${e.message}`.slice(0, 200),
      body: [
        `Site: ${e.site} · kind: ${e.kind} · ${e.count}× · first ${e.firstSeen} · last ${e.lastSeen}`,
        e.urls.length ? `Pages: ${e.urls.join(", ")}` : "",
        e.agents.length ? `Browsers: ${e.agents.join(", ")}` : "",
        e.stack ? `Stack:\n${e.stack.slice(0, 1_500)}` : "",
        "Checklist: R2 (logged). Fix the cause, add a test that fails for this reason first, and keep R1/R3 (friendly screen, plain words).",
      ]
        .filter(Boolean)
        .join("\n"),
      url: `${origin}/apps/jarvis#site-errors`,
      count: e.count,
    })),
  };
}

/** A short browser label from a user-agent string, for the row — never the full UA. */
export function agentLabel(ua: string): string {
  const os = /iphone|ipad/i.test(ua) ? "iPhone" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : /linux/i.test(ua) ? "Linux" : "";
  const br = /edg\//i.test(ua) ? "Edge" : /crios|chrome/i.test(ua) ? "Chrome" : /fxios|firefox/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" ") || "Browser";
}
