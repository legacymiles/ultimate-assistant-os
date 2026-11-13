// ---------------------------------------------------------------------------
// The verify gate's rules, with no side effects.
//
// A harness build used to be finished when the agent said so. The bridge now
// checks the work itself, and everything that decides WHAT is checked and what
// a result MEANS is here, pure, so the runner, the loop and the tests all read
// the same rules. See docs/superpowers/specs/harness-verify-gate.md.
// ---------------------------------------------------------------------------

/** Repair messages sent before a build is shown as failing its checks. */
export const MAX_ROUNDS = 3;

/** Ceilings, not estimates: a step that passes them is killed as a tree. */
export const LIMITS = {
  install: 600_000, typecheck: 300_000, lint: 300_000, test: 600_000, build: 600_000, boot: 180_000, crawl: 180_000,
};
export const MAX_PAGES = 25;
export const MAX_DEPTH = 3;

const RUN = { npm: "npm run", pnpm: "pnpm run", yarn: "yarn run", bun: "bun run" };
const INSTALL = { npm: "npm install", pnpm: "pnpm install --frozen-lockfile", yarn: "yarn install --frozen-lockfile", bun: "bun install" };

/** A git ref that is safe to put on a command line. */
const SAFE_REF = /^[\w./-]{1,100}$/;

export function managerOf(names = []) {
  if (names.includes("pnpm-lock.yaml")) return "pnpm";
  if (names.includes("yarn.lock")) return "yarn";
  if (names.includes("bun.lockb") || names.includes("bun.lock")) return "bun";
  return "npm";
}

/**
 * The checks for one folder, in order.
 *
 * `project` is a folder the build owns outright (App Builder's new app). A
 * worktree of an existing repo is NOT one: its node_modules is a junction to
 * the owner's real packages, so it is never installed into, and a full build
 * of the hub is minutes of laptop for little that typecheck, the related
 * tests and a live preview do not already prove.
 *
 * A step is `{ shell }` (a fixed string, never built from file names) or
 * `{ node }` (arguments to this same node binary, no shell at all).
 */
export function planChecks({ pkg = null, names: listed = [], project = false, base = "", has: facts = {} } = {}) {
  // Tolerant of a caller that passes null for a folder it could not read.
  const names = Array.isArray(listed) ? listed : [];
  const has = facts ?? {};
  const scripts = pkg?.scripts ?? {};
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const pm = managerOf(names);
  const steps = [];

  if (project && pkg && !has.modules && Object.keys(deps).length) {
    steps.push({
      id: "install", label: "Install its packages", limit: LIMITS.install,
      run: { shell: pm === "npm" && names.includes("package-lock.json") ? "npm ci" : INSTALL[pm] },
    });
  }
  if (names.includes("tsconfig.json") && deps.typescript) {
    steps.push({ id: "typecheck", label: "Typecheck", limit: LIMITS.typecheck, run: { node: ["node_modules/typescript/bin/tsc", "--noEmit"] } });
  }
  if (scripts.lint) {
    steps.push({ id: "lint", label: "Lint", limit: LIMITS.lint, advisory: true, run: { shell: `${RUN[pm]} lint` } });
  }
  // `npm init` writes a test script that only prints "no test specified" and
  // exits 1. That is the absence of tests, not a failing one.
  if (scripts.test && !/no test specified/i.test(scripts.test)) {
    const changedOnly = !project && deps.vitest && typeof base === "string" && SAFE_REF.test(base) && !base.startsWith("-");
    steps.push({
      id: "test", label: "Its own tests", limit: LIMITS.test,
      run: changedOnly ? { node: ["node_modules/vitest/vitest.mjs", "run", "--changed", base] } : { shell: `${RUN[pm]} test` },
    });
  }
  if (project && scripts.build) {
    steps.push({ id: "build", label: "Build", limit: LIMITS.build, run: { shell: `${RUN[pm]} build` } });
  }

  let boot = null;
  if (has.devPreview) boot = { kind: "node", args: ["scripts/dev-preview.mjs", "{port}", "--no-auth"] };
  else if (scripts.start) boot = { kind: "shell", command: `${RUN[pm]} start` };
  else if (scripts.dev) boot = { kind: "shell", command: `${RUN[pm]} dev` };
  else if (has.staticDir) boot = { kind: "static", dir: has.staticDir };

  return { pm, steps, boot };
}

/** What a process needs to run at all. Compared in lower case: Windows env names are not case-sensitive. */
const KEEP = new Set([
  "path", "pathext", "systemroot", "windir", "comspec", "temp", "tmp", "home", "userprofile", "homedrive", "homepath",
  "appdata", "localappdata", "programfiles", "programfiles(x86)", "programdata", "number_of_processors",
  "processor_architecture", "os", "lang", "term", "shell", "user", "username",
]);

/**
 * The environment for anything the gate starts.
 *
 * keys.mjs loads every key on this PC into the bridge's own environment, and a
 * child inherits it. A freshly generated app must not be started with the
 * owner's keys in reach, so this is an allowlist, not a blocklist. `CI=1`
 * stops test runners from sitting in watch mode until the ceiling kills them.
 */
export function scrubEnv(env = {}, extra = {}) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (v != null && KEEP.has(k.toLowerCase())) out[k] = String(v);
  }
  return { ...out, CI: "1", NO_COLOR: "1", ...extra };
}

function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * A failure's identity across runs.
 *
 * Paths, line numbers and timings change between two runs of the same broken
 * build, so they are flattened before hashing. Two runs with the same set of
 * ids mean the repair changed nothing.
 */
export function fingerprint({ step, page = "", evidence = "" }) {
  const flat = String(evidence)
    .toLowerCase()
    .replace(/[a-z]:[\\/][^\s:'"()]*/g, "<path>")
    .replace(/(^|\s)\/[^\s:'"()]+/g, "$1<path>")
    // A timestamp is new on every run.
    .replace(/\d{4}-\d\d-\d\dt[\d:.]+z?/g, "#")
    // Standalone numbers only (line and column, counts, timings, sizes, ports).
    // A number inside a word is an error code — ts2322 — and that IS the error.
    .replace(/\b\d+(?:\.\d+)?(?:ms|s|kb|mb|gb|b)?\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return `${step}:${page}:${hash(flat)}`;
}

export function sameFailures(a = [], b = []) {
  // As sets: two failures on one page can share an id, and ["x","x"] is not
  // the same run as ["x","y"].
  const now = new Set(a);
  const before = new Set(b);
  if (!now.size || now.size !== before.size) return false;
  return [...now].every((id) => before.has(id));
}

/**
 * What a finished check means.
 *
 * `rounds` is how many repair messages have already been sent. `repair: false`
 * is "look, do not send anything back" — the owner's Check again, and an
 * unattended run deciding whether it may ship.
 */
export function afterRun({ passed, ids = [], lastIds = [], rounds = 0, max = MAX_ROUNDS, repair = true } = {}) {
  if (passed) return { state: "passed", why: "" };
  if (!repair) return { state: "failed", why: "The checks failed." };
  if (sameFailures(ids, lastIds)) {
    return { state: "failed", why: "The same checks failed twice in a row, so another round would not help." };
  }
  if (rounds >= max) return { state: "failed", why: `Still failing after ${max} repair rounds.` };
  return { state: "repairing", why: "" };
}

const FENCE = "`".repeat(3);

/** What the agent is told when its build fails the checks. */
export function repairPrompt(report, { round = 1, max = MAX_ROUNDS } = {}) {
  const all = report?.failures ?? [];
  const shown = all.slice(0, 8);
  const lines = [
    "<checks_failed>",
    `The PC checked this build after your last message and ${all.length} check${all.length === 1 ? "" : "s"} failed. This is repair round ${round} of ${max}.`,
    "",
  ];
  for (const f of shown) {
    lines.push(`## ${f.title}`);
    if (f.ran) lines.push(`Ran: ${f.ran}`);
    if (f.page) lines.push(`Page: ${f.page}`);
    lines.push(FENCE, String(f.evidence ?? "").slice(-1_200).trim(), FENCE, "");
  }
  if (all.length > shown.length) lines.push(`…and ${all.length - shown.length} more.`, "");
  lines.push(
    "Fix the cause of each one. Do not delete, skip or weaken a test or a check to get past it, and do not change anything that already works.",
    "When they are fixed, redeploy if you had deployed, and end your message with the same final lines as before.",
    "</checks_failed>",
  );
  return lines.join("\n");
}

/**
 * Is this response a failure, a note, or nothing?
 *
 * A 4xx from the app's own API is only noted: a signed-out 401 is correct
 * behaviour, and without a contract the gate cannot tell which ones are.
 */
export function judgeResponse({ url, origin, status, document = false }) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  if (u.origin !== origin || status < 400) return "";
  if (status >= 500) return "fail";
  if (u.pathname.startsWith("/api/")) return "note";
  if (document || status === 404) return "fail";
  return "note";
}

// Files, not pages. Navigating to a download makes the browser throw, which
// would read as a page that did not load.
const NOT_A_PAGE = /\.(pdf|zip|gz|tar|exe|msi|dmg|apk|png|jpe?g|gif|webp|avif|svg|ico|mp4|mov|webm|mp3|wav|ogg|csv|xlsx?|docx?|pptx?|ics|json|xml|rss|txt)$/i;

// Links that DO something. The crawl only navigates, but a plain GET to
// /logout signs the crawl out, so every page after it fails for a reason the
// build does not have, and a GET to /delete/3 on a carelessly written app
// deletes row 3. A whole path segment only: /deleted-items is a page.
const AN_ACTION = /(?:^|\/)(?:logout|log-out|signout|sign-out|delete|remove|destroy)(?:\/|$)/i;

/** The same-origin pages worth visiting next, as paths, in first-seen order. */
export function crawlLinks(hrefs = [], origin) {
  const out = [];
  for (const href of hrefs) {
    let u;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    if (u.origin !== origin || !/^https?:$/.test(u.protocol)) continue;
    if (u.pathname.startsWith("/api/") || NOT_A_PAGE.test(u.pathname) || AN_ACTION.test(u.pathname)) continue;
    const at = `${u.pathname}${u.search}`;
    if (!out.includes(at)) out.push(at);
  }
  return out;
}

/** The deployed address the agent printed, if it printed one. */
export function finishLinks(text) {
  // Only lines that carry an address count, so `Live: <url>` followed by
  // `Preview: none` still has a live address. `<url>` and `url in backticks`
  // are how an agent often writes one.
  const all = [...String(text ?? "").matchAll(/^\s*(?:Live|Preview):\s*[<`]?(https?:\/\/[^\s<>`"']+)/gim)];
  let last = (all.at(-1)?.[1] ?? "").replace(/[\].,;]+$/, "");
  // A closing bracket belongs to the sentence unless the address opened one.
  if (last.endsWith(")") && !last.includes("(")) last = last.replace(/\)+$/, "");
  return { live: last };
}

const PRIVATE_V4 = [
  [0, 0, 0, 0, 32], // 0.0.0.0, "this machine" to most servers
  [127, 0, 0, 0, 8], // loopback
  [10, 0, 0, 0, 8], [172, 16, 0, 0, 12], [192, 168, 0, 0, 16], // private networks
  [169, 254, 0, 0, 16], // link-local, where cloud machines serve their own credentials
];

function privateV4(a, b, c, d) {
  const n = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  return PRIVATE_V4.some(([w, x, y, z, bits]) => {
    const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((((w << 24) | (x << 16) | (y << 8) | z) & mask) >>> 0);
  });
}

/**
 * May the bridge fetch this address?
 *
 * The live address is whatever the agent printed, and the bridge runs on the
 * owner's PC, inside their network. Without this a build could have the
 * bridge call the router, another app on this PC, or the bridge itself.
 *
 * This reads the address as written. It does NOT look the name up, so a public
 * name that resolves to a private address still gets through; closing that
 * needs the lookup and the fetch to be the same step.
 */
export function isPublicAddress(url) {
  let u;
  try {
    u = new URL(String(url ?? ""));
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  // URL has already lower-cased the name and rewritten every spelling of an
  // IPv4 address (127.1, 2130706433, 0x7f.0.0.1) as four plain numbers.
  const host = u.hostname.replace(/\.$/, "");
  if (!host) return false;

  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    if (v6 === "::1" || v6 === "::") return false;
    // An IPv4 address carried inside an IPv6 one, which URL writes in hex.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      return !privateV4(hi >> 8, hi & 255, lo >> 8, lo & 255);
    }
    const first = parseInt(v6.split(":")[0] || "0", 16);
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10, link-local
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7, unique-local
    return true;
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return !privateV4(Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4]));

  if (host === "localhost") return false;
  return !/\.(?:localhost|local|internal)$/.test(host);
}

/**
 * What a restarted bridge does with a job.
 *
 * One that died mid-check is checked again: the agent had already finished its
 * turn. One that died mid-repair is checked too, to see where the repair got
 * to — the new model session has never been shown the failures, so it cannot
 * be asked to carry on fixing them. Anything else is sent the brief again.
 */
export function resumeAction(job) {
  const state = job?.verify?.state;
  return state === "checking" || state === "repairing" ? "verify" : "prompt";
}
