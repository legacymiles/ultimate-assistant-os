# Harness Verify Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A harness build is "Built" only after the bridge itself has installed, typechecked, tested, built, started and browsed it; failures go back to the agent for a bounded number of repair rounds.

**Architecture:** Three new files in `tools/jarvis-bridge`: pure rules (`harness-verify.mjs`), the side-effecting runner (`harness-verify-run.mjs`) and the repair loop (`harness-verify-loop.mjs`). `harness.mjs` calls the loop from the `turn_end` it already watches, so Claude and DeepSeek get the same gate. The page reads one new field, `summary.verify`, and `phaseOf` stops calling an unchecked build "Built".

**Tech Stack:** Node ESM (`.mjs`), Playwright (already a bridge dependency), vitest (`tools/jarvis-bridge/*.test.mjs` and `src/**/*.test.ts` are both collected by the root `vitest.config.ts`), Next.js 15 / React / TypeScript for the page.

**Spec:** `docs/superpowers/specs/harness-verify-gate.md`

**Before you start**

- Run every command from the repo root, `C:\dev\jarvis-plugins-studios`. Tests: `npx vitest run <path>`.
- The spec is uncommitted on `main`. Ask the owner which branch to work on before the first commit (they chose `main` for the spec).
- Commit subjects follow the repo rule `"<App>: <what changed, in plain words>"`. Use the app name **Jarvis harness** for bridge work and **App Builder** / **Client Review** for page work. After the last task, run `npm run timeline:log` and commit `src/lib/timeline/feature-log.json`.
- Never run `npm install` at the repo root or in a hub worktree as part of this work. No new dependency is needed.
- The bridge on this PC is a running process. Nothing here takes effect until it is restarted (`tools\jarvis-bridge\start.cmd`); do that only in Task 10.

## File structure

| File | Responsibility |
|---|---|
| `tools/jarvis-bridge/harness-verify.mjs` (new) | Pure rules: which checks to run, the scrubbed environment, failure fingerprints, the pass/repair/stop decision, the repair message, how a crawled response is judged |
| `tools/jarvis-bridge/harness-verify.test.mjs` (new) | Tests for all of the above |
| `tools/jarvis-bridge/harness-verify-run.mjs` (new) | Side effects: read the folder, run a step, start the app, crawl it, check the live address, write the report |
| `tools/jarvis-bridge/harness-verify-run.test.mjs` (new) | Runs the gate against the fixtures |
| `tools/jarvis-bridge/fixtures/verify/` (new) | `serve.mjs` + five tiny apps: `clean`, `build-fails`, `page-throws`, `dead-link`, `prints-env` |
| `tools/jarvis-bridge/harness-verify-loop.mjs` (new) | The loop: queue, permission card, run, decide, repair or stop, accept, report |
| `tools/jarvis-bridge/harness-verify-loop.test.mjs` (new) | The loop against a stub gate and a temp job store |
| `tools/jarvis-bridge/harness-preview.mjs` | Export `killTree` |
| `tools/jarvis-bridge/build-jobs.mjs` (+ test) | `verify` on a job; a finish line becomes `claimed`, not `done`, when verify is on |
| `tools/jarvis-bridge/harness.mjs` | Call the loop on `turn_end`, on resume, on stop; `verify` in `summary()`; three handlers |
| `tools/jarvis-bridge/server.mjs` | Three routes |
| `tools/jarvis-bridge/agents-wake.mjs` (+ test) | One check before an unattended `SHIP: auto` lands |
| `src/lib/new-jarvis/harness/types.ts` | `VerifySummary`, `ThreadSummary.verify` |
| `src/lib/app-builder/build.ts` (+ test) | Three phases, the changed `done` rule, `phaseLabel`, one sentence in `<finish>` |
| `src/lib/client-review/autoBuild.ts`, `liveBuild.ts` | The same sentence; `finishOf` knows the new phases |
| `src/lib/app-builder/useBuild.ts` | `checkAgain`, `useAnyway`, `loadReport` |
| `src/components/app-builder/BuildStatus.tsx`, `MoveIntoHub.tsx`, `Blueprint.tsx`, `AppBuilder.tsx`, `app-builder.css` | The checks panel and the new phases |

---

### Task 1: The pure rules

**Files:**
- Create: `tools/jarvis-bridge/harness-verify.mjs`
- Test: `tools/jarvis-bridge/harness-verify.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tools/jarvis-bridge/harness-verify.test.mjs`:

```js
import { describe, expect, it } from "vitest";

import {
  MAX_ROUNDS, afterRun, crawlLinks, fingerprint, finishLinks, judgeResponse,
  managerOf, planChecks, repairPrompt, resumeAction, sameFailures, scrubEnv,
} from "./harness-verify.mjs";

const NEXT_APP = {
  scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint", test: "vitest run" },
  dependencies: { next: "15.0.0" },
  devDependencies: { typescript: "5.6.0", vitest: "2.1.9" },
};
const ids = (plan) => plan.steps.map((s) => s.id);

describe("which checks a folder gets", () => {
  it("a new project installs, typechecks, lints, tests, builds and starts", () => {
    const plan = planChecks({ pkg: NEXT_APP, names: ["package.json", "package-lock.json", "tsconfig.json"], project: true, has: {} });
    expect(ids(plan)).toEqual(["install", "typecheck", "lint", "test", "build"]);
    expect(plan.steps[0].run.shell).toBe("npm ci");
    expect(plan.boot).toEqual({ kind: "shell", command: "npm run start" });
  });

  it("never installs or builds in a hub worktree, and tests only what changed", () => {
    const plan = planChecks({ pkg: NEXT_APP, names: ["package.json", "tsconfig.json"], project: false, base: "main", has: { modules: true, devPreview: true } });
    expect(ids(plan)).toEqual(["typecheck", "lint", "test"]);
    expect(plan.steps[2].run.node).toEqual(["node_modules/vitest/vitest.mjs", "run", "--changed", "main"]);
    expect(plan.boot).toEqual({ kind: "node", args: ["scripts/dev-preview.mjs", "{port}", "--no-auth"] });
  });

  it("skips install when the packages are already there, or there are none to install", () => {
    expect(ids(planChecks({ pkg: NEXT_APP, names: ["package.json"], project: true, has: { modules: true } }))).not.toContain("install");
    expect(ids(planChecks({ pkg: { scripts: { build: "node build.mjs" } }, names: ["package.json"], project: true, has: {} }))).toEqual(["build"]);
  });

  it("lint is advice, never a failure", () => {
    const lint = planChecks({ pkg: NEXT_APP, names: ["package.json"], project: true, has: { modules: true } }).steps.find((s) => s.id === "lint");
    expect(lint.advisory).toBe(true);
  });

  it("will not put a strange base name on a command line", () => {
    const test = planChecks({ pkg: NEXT_APP, names: ["package.json"], project: false, base: "main; rm -rf .", has: { modules: true } }).steps.find((s) => s.id === "test");
    expect(test.run.shell).toBe("npm run test");
  });

  it("uses the lockfile's package manager", () => {
    expect(managerOf(["pnpm-lock.yaml"])).toBe("pnpm");
    expect(managerOf(["yarn.lock"])).toBe("yarn");
    expect(managerOf(["bun.lockb"])).toBe("bun");
    expect(managerOf(["package-lock.json"])).toBe("npm");
  });

  it("falls back to dev, then to a plain folder with an index.html, then to nothing", () => {
    expect(planChecks({ pkg: { scripts: { dev: "vite" } }, names: [], project: true, has: {} }).boot).toEqual({ kind: "shell", command: "npm run dev" });
    expect(planChecks({ pkg: null, names: ["index.html"], project: true, has: { staticDir: "." } }).boot).toEqual({ kind: "static", dir: "." });
    expect(planChecks({ pkg: null, names: [], project: true, has: {} }).boot).toBeNull();
  });
});

describe("the environment the app under test gets", () => {
  it("keeps what a process needs and drops every key", () => {
    const env = scrubEnv({ Path: "C:\\bin", SystemRoot: "C:\\Windows", OPENROUTER_API_KEY: "sk-1", SUPABASE_SERVICE_ROLE_KEY: "x", ANTHROPIC_AUTH_TOKEN: "y" }, { PORT: "4100" });
    expect(env).toEqual({ Path: "C:\\bin", SystemRoot: "C:\\Windows", CI: "1", NO_COLOR: "1", PORT: "4100" });
  });
});

describe("telling two failures apart", () => {
  it("is the same id when only paths, line numbers and timings differ", () => {
    const a = fingerprint({ step: "typecheck", evidence: "C:\\Users\\a\\proj\\src\\app.ts(3,7): error TS2322 in 1.2s" });
    const b = fingerprint({ step: "typecheck", evidence: "C:\\other\\src\\app.ts(9,1): error TS2322 in 4.8s" });
    expect(a).toBe(b);
  });
  it("is a different id for a different error or a different page", () => {
    expect(fingerprint({ step: "crawl", page: "/a", evidence: "x is not defined" })).not.toBe(fingerprint({ step: "crawl", page: "/b", evidence: "x is not defined" }));
    expect(fingerprint({ step: "build", evidence: "Module not found" })).not.toBe(fingerprint({ step: "build", evidence: "Type error" }));
  });
  it("only calls two runs the same when both failed the same things", () => {
    expect(sameFailures(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameFailures(["a"], ["a", "b"])).toBe(false);
    expect(sameFailures([], [])).toBe(false);
  });
});

describe("what happens after a check", () => {
  it("passes", () => {
    expect(afterRun({ passed: true, ids: [] }).state).toBe("passed");
  });
  it("sends a first failure back to be fixed", () => {
    expect(afterRun({ passed: false, ids: ["a"], lastIds: [], rounds: 0 }).state).toBe("repairing");
  });
  it("stops when the same failures come back", () => {
    const r = afterRun({ passed: false, ids: ["a"], lastIds: ["a"], rounds: 1 });
    expect(r.state).toBe("failed");
    expect(r.why).toMatch(/twice in a row/);
  });
  it("stops after the last round", () => {
    const r = afterRun({ passed: false, ids: ["c"], lastIds: ["b"], rounds: MAX_ROUNDS });
    expect(r.state).toBe("failed");
    expect(r.why).toContain(String(MAX_ROUNDS));
  });
  it("never repairs when asked only to look", () => {
    expect(afterRun({ passed: false, ids: ["a"], repair: false }).state).toBe("failed");
  });
});

describe("the message the agent gets", () => {
  const report = {
    failures: [
      { step: "typecheck", title: "Typecheck failed", ran: "node node_modules/typescript/bin/tsc --noEmit", page: "", evidence: "src/app.ts(3,7): error TS2322" },
      { step: "crawl", title: "A page threw an error: /settings", ran: "", page: "/settings", evidence: "settings is not defined" },
    ],
  };
  it("names every failure with what ran and what it said", () => {
    const text = repairPrompt(report, { round: 2, max: 3 });
    expect(text).toContain("round 2 of 3");
    expect(text).toContain("Typecheck failed");
    expect(text).toContain("error TS2322");
    expect(text).toContain("Page: /settings");
    expect(text).toMatch(/Do not delete, skip or weaken/);
  });
  it("counts what it leaves out", () => {
    const many = { failures: Array.from({ length: 11 }, (_, i) => ({ step: "crawl", title: `t${i}`, evidence: "e" })) };
    expect(repairPrompt(many, { round: 1, max: 3 })).toContain("and 3 more");
  });
});

describe("judging what the crawl saw", () => {
  const origin = "http://127.0.0.1:4100";
  it("fails a server error and a missing page or file", () => {
    expect(judgeResponse({ url: `${origin}/x`, origin, status: 500 })).toBe("fail");
    expect(judgeResponse({ url: `${origin}/missing`, origin, status: 404 })).toBe("fail");
    expect(judgeResponse({ url: `${origin}/login`, origin, status: 403, document: true })).toBe("fail");
  });
  it("only notes a 4xx from the app's own API", () => {
    expect(judgeResponse({ url: `${origin}/api/me`, origin, status: 401 })).toBe("note");
    expect(judgeResponse({ url: `${origin}/api/me`, origin, status: 500 })).toBe("fail");
  });
  it("ignores other sites and good answers", () => {
    expect(judgeResponse({ url: "https://fonts.googleapis.com/css", origin, status: 404 })).toBe("");
    expect(judgeResponse({ url: `${origin}/`, origin, status: 200 })).toBe("");
  });
  it("follows only this app's own pages", () => {
    expect(crawlLinks([`${origin}/about#team`, `${origin}/about`, `${origin}/api/x`, "https://x.com/a", "mailto:a@b.c", `${origin}/file.pdf`, `${origin}/shop?p=2`], origin))
      .toEqual(["/about", "/shop?p=2"]);
  });
});

describe("reading the finish lines", () => {
  it("takes the last live address, and nothing for `none`", () => {
    expect(finishLinks("Repo: https://github.com/a/b\nLive: https://a.vercel.app.").live).toBe("https://a.vercel.app");
    expect(finishLinks("PR: https://github.com/a/b/pull/1\nPreview: https://b.vercel.app/apps/x").live).toBe("https://b.vercel.app/apps/x");
    expect(finishLinks("Preview: none\nThe deploy failed.").live).toBe("");
  });
});

describe("a restart", () => {
  it("re-runs the check when it died mid-check, and re-sends the brief otherwise", () => {
    expect(resumeAction({ verify: { state: "checking" } })).toBe("verify");
    expect(resumeAction({ verify: { state: "repairing" } })).toBe("prompt");
    expect(resumeAction({})).toBe("prompt");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tools/jarvis-bridge/harness-verify.test.mjs`
Expected: FAIL — `Failed to resolve import "./harness-verify.mjs"`.

- [ ] **Step 3: Write the module**

Create `tools/jarvis-bridge/harness-verify.mjs`:

```js
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
export function planChecks({ pkg = null, names = [], project = false, base = "", has = {} } = {}) {
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
  if (scripts.test) {
    const changedOnly = !project && deps.vitest && SAFE_REF.test(base) && !base.startsWith("-");
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
    // Standalone numbers only (line and column, counts, timings, ports). A
    // number inside a word is an error code — ts2322 — and that IS the error.
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)?\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return `${step}:${page}:${hash(flat)}`;
}

export function sameFailures(a = [], b = []) {
  if (!a.length || a.length !== b.length) return false;
  const seen = new Set(b);
  return a.every((id) => seen.has(id));
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
export function repairPrompt(report, { round, max = MAX_ROUNDS }) {
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

const NOT_A_PAGE = /\.(pdf|zip|png|jpe?g|gif|webp|svg|ico|mp4|mov|mp3|wav|csv|xlsx?|docx?|json|xml|txt)$/i;

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
    if (u.pathname.startsWith("/api/") || NOT_A_PAGE.test(u.pathname)) continue;
    const at = `${u.pathname}${u.search}`;
    if (!out.includes(at)) out.push(at);
  }
  return out;
}

/** The deployed address the agent printed, if it printed one. */
export function finishLinks(text) {
  const all = [...String(text ?? "").matchAll(/^\s*(?:Live|Preview):\s*(\S+)/gim)];
  const last = (all.at(-1)?.[1] ?? "").replace(/[)\].,;]+$/, "");
  return { live: /^https?:\/\/\S+$/i.test(last) ? last : "" };
}

/** A job that died mid-check is checked again; the agent had already finished its turn. */
export function resumeAction(job) {
  return job?.verify?.state === "checking" ? "verify" : "prompt";
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tools/jarvis-bridge/harness-verify.test.mjs`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/jarvis-bridge/harness-verify.mjs tools/jarvis-bridge/harness-verify.test.mjs
git commit -m "Jarvis harness: the rules for checking a build before calling it built"
```

---

### Task 2: Run a step and start the app

**Files:**
- Modify: `tools/jarvis-bridge/harness-preview.mjs:63` (export `killTree`)
- Create: `tools/jarvis-bridge/fixtures/verify/serve.mjs`, `fixtures/verify/clean/{package.json,build.mjs,server.mjs}`, `fixtures/verify/build-fails/{package.json,build.mjs,server.mjs}`
- Create: `tools/jarvis-bridge/harness-verify-run.mjs`
- Test: `tools/jarvis-bridge/harness-verify-run.test.mjs`

- [ ] **Step 1: Export `killTree`**

In `tools/jarvis-bridge/harness-preview.mjs`, change line 63 from `function killTree(pid) {` to:

```js
export function killTree(pid) {
```

- [ ] **Step 2: Write the fixtures**

`tools/jarvis-bridge/fixtures/verify/serve.mjs`:

```js
// A tiny app for the verify gate's tests: no packages, no framework.
import { createServer } from "node:http";

/** `routes` maps a path to an HTML string, or to a function returning { status, body }. */
export function serve(routes) {
  const port = Number(process.env.PORT) || 0;
  createServer((req, res) => {
    const at = new URL(req.url, "http://x").pathname;
    const hit = routes[at];
    const out = typeof hit === "function" ? hit() : hit != null ? { status: 200, body: hit } : { status: 404, body: "<h1>Not found</h1>" };
    res.writeHead(out.status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(out.body);
  }).listen(port, "127.0.0.1", () => console.log(`listening on http://127.0.0.1:${port}`));
}

export const page = (body) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body>${body}</body></html>`;
```

`tools/jarvis-bridge/fixtures/verify/clean/package.json`:

```json
{ "name": "verify-clean", "private": true, "type": "module", "scripts": { "build": "node build.mjs", "start": "node server.mjs" } }
```

`tools/jarvis-bridge/fixtures/verify/clean/build.mjs`:

```js
console.log("built");
```

`tools/jarvis-bridge/fixtures/verify/clean/server.mjs`:

```js
import { page, serve } from "../serve.mjs";

serve({
  "/": page('<h1>Home</h1><a href="/about">About</a>'),
  "/about": page('<h1>About</h1><a href="/">Home</a>'),
});
```

`tools/jarvis-bridge/fixtures/verify/build-fails/package.json`:

```json
{ "name": "verify-build-fails", "private": true, "type": "module", "scripts": { "build": "node build.mjs", "start": "node server.mjs" } }
```

`tools/jarvis-bridge/fixtures/verify/build-fails/build.mjs`:

```js
console.error("src/app.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.");
process.exit(1);
```

`tools/jarvis-bridge/fixtures/verify/build-fails/server.mjs`:

```js
import { page, serve } from "../serve.mjs";

serve({ "/": page("<h1>Home</h1>") });
```

- [ ] **Step 3: Write the failing tests**

Create `tools/jarvis-bridge/harness-verify-run.test.mjs`:

```js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { planChecks, scrubEnv } from "./harness-verify.mjs";
import { freePort, readFacts, runStep, startApp } from "./harness-verify-run.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "verify");
const fx = (name) => path.join(FIX, name);

describe("reading a folder", () => {
  it("finds the scripts and plans a build and a start", () => {
    const facts = readFacts(fx("clean"));
    expect(facts.pkg.scripts.build).toBe("node build.mjs");
    const plan = planChecks({ ...facts, project: true });
    expect(plan.steps.map((s) => s.id)).toEqual(["build"]);
    expect(plan.boot.kind).toBe("shell");
  });
});

describe("running one step", () => {
  it("passes a build that exits 0", async () => {
    const [build] = planChecks({ ...readFacts(fx("clean")), project: true }).steps;
    const row = await runStep(build, { cwd: fx("clean"), env: scrubEnv(process.env) });
    expect(row).toMatchObject({ id: "build", ok: true, skipped: false });
    expect(row.tail).toContain("built");
  }, 30_000);

  it("fails a build that exits 1, and keeps what it said", async () => {
    const [build] = planChecks({ ...readFacts(fx("build-fails")), project: true }).steps;
    const row = await runStep(build, { cwd: fx("build-fails"), env: scrubEnv(process.env) });
    expect(row.ok).toBe(false);
    expect(row.tail).toContain("TS2322");
  }, 30_000);

  it("kills a step that runs past its ceiling", async () => {
    const row = await runStep(
      { id: "test", label: "Its own tests", limit: 500, run: { node: ["-e", "setInterval(() => {}, 1000)"] } },
      { cwd: fx("clean"), env: scrubEnv(process.env) },
    );
    expect(row.ok).toBe(false);
    expect(row.tail).toMatch(/was stopped/);
  }, 15_000);

  it("never hands the owner's keys to what it runs", async () => {
    const row = await runStep(
      { id: "test", label: "Its own tests", limit: 10_000, run: { node: ["-e", "console.log(Object.keys(process.env).join(','))"] } },
      { cwd: fx("clean"), env: scrubEnv({ ...process.env, OPENROUTER_API_KEY: "sk-test", SUPABASE_SERVICE_ROLE_KEY: "x" }) },
    );
    expect(row.tail).not.toMatch(/OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
    expect(row.tail).toMatch(/CI/);
  }, 15_000);
});

describe("starting the app", () => {
  it("starts it on a free port and stops it again", async () => {
    const { boot } = planChecks({ ...readFacts(fx("clean")), project: true });
    const app = await startApp({ cwd: fx("clean"), boot, env: scrubEnv(process.env) });
    try {
      const res = await fetch(`${app.url}/about`);
      expect(res.status).toBe(200);
    } finally {
      await app.stop();
    }
  }, 60_000);

  it("serves a plain folder that has only an index.html", async () => {
    const app = await startApp({ cwd: FIX, boot: { kind: "static", dir: "static" }, env: {} });
    try {
      expect((await fetch(`${app.url}/`)).status).toBe(200);
      expect((await fetch(`${app.url}/nope.html`)).status).toBe(404);
      expect((await fetch(`${app.url}/..%2Fserve.mjs`)).status).not.toBe(200);
    } finally {
      await app.stop();
    }
  }, 30_000);

  it("hands out a port nothing is using", async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(1023);
  });
});
```

Also create `tools/jarvis-bridge/fixtures/verify/static/index.html` for the plain-folder test:

```html
<!doctype html><html><head><link rel="icon" href="data:,"></head><body><h1>Plain</h1></body></html>
```

- [ ] **Step 4: Run them to see them fail**

Run: `npx vitest run tools/jarvis-bridge/harness-verify-run.test.mjs`
Expected: FAIL — `Failed to resolve import "./harness-verify-run.mjs"`.

- [ ] **Step 5: Write the runner's first half**

Create `tools/jarvis-bridge/harness-verify-run.mjs`:

```js
// ---------------------------------------------------------------------------
// The verify gate's hands: run a step, start the app, look at it, write down
// what happened. The rules for what any of it means are in harness-verify.mjs.
//
// Two things here are deliberate:
//
//   Every child is started with scrubEnv()'s environment, never the bridge's
//   own. The bridge holds every key on this PC.
//
//   A `{ shell }` step is a FIXED string from planChecks. Nothing read from
//   the folder — a file name, a branch, a script's contents — is ever spliced
//   into a shell line here.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer as createNet } from "node:net";
import path from "node:path";

import { killTree } from "./harness-preview.mjs";
import {
  LIMITS, MAX_DEPTH, MAX_PAGES, crawlLinks, fingerprint, finishLinks, judgeResponse, planChecks, scrubEnv,
} from "./harness-verify.mjs";

const SPAWN = { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What is in the folder, in the shape planChecks reads. */
export function readFacts(cwd) {
  const names = existsSync(cwd) ? readdirSync(cwd) : [];
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8").replace(/^\uFEFF/, ""));
  } catch {
    /* no package.json, or not JSON: a plain folder */
  }
  const staticDir = [".", "dist", "out", "build", "public"].find((d) => existsSync(path.join(cwd, d, "index.html"))) ?? "";
  return {
    pkg,
    names,
    has: {
      modules: existsSync(path.join(cwd, "node_modules")),
      devPreview: existsSync(path.join(cwd, "scripts", "dev-preview.mjs")),
      staticDir,
    },
  };
}

/** Run one planned step to its end, its ceiling, or an abort. Never throws. */
export function runStep(step, { cwd, env, signal }) {
  const started = Date.now();
  const ran = step.run.shell ?? `node ${step.run.node.join(" ")}`;
  return new Promise((resolve) => {
    const child = step.run.node
      ? spawn(process.execPath, step.run.node, { ...SPAWN, cwd, env })
      : spawn(step.run.shell, { ...SPAWN, cwd, env, shell: true });
    let tail = "";
    const keep = (chunk) => {
      tail = `${tail}${chunk}`.slice(-4_000);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);

    let why = "";
    let settled = false;
    const stop = (reason) => {
      why = reason;
      void killTree(child.pid);
    };
    const timer = setTimeout(() => stop(`It ran past ${Math.max(1, Math.round(step.limit / 60_000))} minute(s) and was stopped.`), step.limit);
    const onAbort = () => stop("Stopped.");
    signal?.addEventListener("abort", onAbort, { once: true });

    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        id: step.id,
        label: step.label,
        ok: code === 0 && !why,
        advisory: Boolean(step.advisory),
        skipped: false,
        ms: Date.now() - started,
        ran,
        tail: why ? `${tail}\n${why}`.trim() : tail.trim(),
      });
    };
    child.once("error", (e) => {
      keep(String(e?.message ?? e));
      done(1);
    });
    child.once("exit", (code) => done(code ?? 1));
  });
}

/** A port nothing is listening on, chosen by the OS. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNet();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4_000), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

/** Serve a plain folder: the single-file app that has no start script at all. */
function serveStatic(root, port) {
  const base = path.resolve(root);
  const server = createHttp((req, res) => {
    let rel = "/";
    try {
      rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = path.resolve(base, `.${rel}`);
    if (file !== base && !file.startsWith(base + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/**
 * Start the app and wait until it answers.
 *
 * The port is handed over as PORT, which Next and most servers honour. Some
 * (Vite's dev server) pick their own and print it, so the log is also read for
 * an address, and whichever one actually answers is used.
 */
export async function startApp({ cwd, boot, env, signal, limit = LIMITS.boot }) {
  const port = await freePort();
  if (boot.kind === "static") {
    const server = await serveStatic(path.join(cwd, boot.dir), port);
    return {
      url: `http://127.0.0.1:${port}`,
      log: () => "",
      stop: () => new Promise((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
    };
  }

  const childEnv = { ...env, PORT: String(port) };
  const child = boot.kind === "node"
    ? spawn(process.execPath, boot.args.map((a) => (a === "{port}" ? String(port) : a)), { ...SPAWN, cwd, env: childEnv })
    : spawn(boot.command, { ...SPAWN, cwd, env: childEnv, shell: true });
  let log = "";
  const keep = (chunk) => {
    log = `${log}${chunk}`.slice(-8_000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let exited = null;
  child.once("exit", (code) => {
    exited = code ?? 0;
  });
  child.once("error", (e) => {
    keep(String(e?.message ?? e));
    exited = 1;
  });
  const stop = () => killTree(child.pid);

  const deadline = Date.now() + limit;
  const mine = `http://127.0.0.1:${port}`;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      await stop();
      throw new Error("Stopped.");
    }
    if (exited !== null) throw new Error(`It exited (code ${exited}) before it answered.\n${log.slice(-1_200)}`);
    if (await answers(mine)) return { url: mine, log: () => log, stop };
    const said = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i.exec(log);
    if (said && Number(said[1]) !== port && (await answers(`http://127.0.0.1:${said[1]}`))) {
      return { url: `http://127.0.0.1:${said[1]}`, log: () => log, stop };
    }
    await sleep(500);
  }
  await stop();
  throw new Error(`It did not answer within ${Math.round(limit / 60_000)} minutes.\n${log.slice(-1_200)}`);
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run tools/jarvis-bridge/harness-verify-run.test.mjs`
Expected: PASS, 8 tests. The imports of `crawlLinks`, `fingerprint`, `finishLinks`, `judgeResponse`, `MAX_DEPTH`, `MAX_PAGES`, `mkdirSync` and `writeFileSync` are unused until Task 3; that is expected.

- [ ] **Step 7: Commit**

```bash
git add tools/jarvis-bridge/harness-preview.mjs tools/jarvis-bridge/harness-verify-run.mjs tools/jarvis-bridge/harness-verify-run.test.mjs tools/jarvis-bridge/fixtures
git commit -m "Jarvis harness: run a build's checks and start it with none of the owner's keys"
```

---

### Task 3: Crawl it, check the live address, write the report

**Files:**
- Create: `tools/jarvis-bridge/fixtures/verify/{page-throws,dead-link,prints-env}/{package.json,server.mjs}`
- Modify: `tools/jarvis-bridge/harness-verify-run.mjs` (append)
- Test: `tools/jarvis-bridge/harness-verify-run.test.mjs` (append)

- [ ] **Step 1: Write the three fixtures**

Each `package.json` (change the name per folder: `verify-page-throws`, `verify-dead-link`, `verify-prints-env`):

```json
{ "name": "verify-page-throws", "private": true, "type": "module", "scripts": { "start": "node server.mjs" } }
```

`fixtures/verify/page-throws/server.mjs`:

```js
import { page, serve } from "../serve.mjs";

serve({
  "/": page('<h1>Home</h1><a href="/settings">Settings</a>'),
  "/settings": page('<h1>Settings</h1><script>throw new Error("settings is not defined")</script>'),
});
```

`fixtures/verify/dead-link/server.mjs`:

```js
import { page, serve } from "../serve.mjs";

serve({ "/": page('<h1>Home</h1><a href="/missing">A page that is not there</a>') });
```

`fixtures/verify/prints-env/server.mjs`:

```js
import { page, serve } from "../serve.mjs";

// Answers 500 the moment it can see anything that looks like a key, so the
// gate passes this app only if it started it with a scrubbed environment.
// Named providers only: npm adds variables of its own to a script's environment.
const leaked = () => Object.keys(process.env).filter((k) => /^(OPENROUTER|ANTHROPIC|OPENAI|SUPABASE|STRIPE)_/i.test(k));

serve({
  "/": () => (leaked().length ? { status: 500, body: `saw ${leaked().join(",")}` } : { status: 200, body: page("<h1>No keys in sight</h1>") }),
});
```

- [ ] **Step 2: Write the failing tests**

Append to `tools/jarvis-bridge/harness-verify-run.test.mjs` (add `existsSync, mkdtempSync, readFileSync` from `node:fs`, `tmpdir` from `node:os`, and `canBrowse, checkLive, runGate` from `./harness-verify-run.mjs` to the imports at the top):

```js
const browser = await canBrowse();
const out = () => mkdtempSync(path.join(tmpdir(), "jarvis-verify-"));
const gate = (name, extra = {}) => runGate({ cwd: fx(name), project: true, dir: out(), ...extra });

describe.skipIf(!browser)("the whole gate, on a real little app", () => {
  it("passes a clean app and leaves a report and two pictures", async () => {
    const dir = out();
    const report = await runGate({ cwd: fx("clean"), project: true, dir });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.pages.map((p) => p.url).sort()).toEqual(["/", "/about"]);
    expect(JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")).passed).toBe(true);
    expect(existsSync(path.join(dir, "home-1280.jpg"))).toBe(true);
    expect(existsSync(path.join(dir, "home-390.jpg"))).toBe(true);
  }, 120_000);

  it("fails a build that does not build, and does not try to start it", async () => {
    const report = await gate("build-fails");
    expect(report.passed).toBe(false);
    expect(report.failures.map((f) => f.step)).toEqual(["build"]);
    expect(report.failures[0].evidence).toContain("TS2322");
    expect(report.steps.find((s) => s.id === "boot").skipped).toBe(true);
  }, 120_000);

  it("fails a page that throws, and names the page", async () => {
    const report = await gate("page-throws");
    const hit = report.failures.find((f) => f.page === "/settings");
    expect(hit?.evidence).toContain("settings is not defined");
    expect(report.passed).toBe(false);
  }, 120_000);

  it("fails a link to a page that is not there", async () => {
    const report = await gate("dead-link");
    expect(report.failures.some((f) => f.page === "/missing" && /404/.test(f.evidence))).toBe(true);
  }, 120_000);

  it("starts the app with none of the keys the bridge holds", async () => {
    const report = await gate("prints-env", { env: { ...process.env, OPENROUTER_API_KEY: "sk-test", STRIPE_SECRET_KEY: "x" } });
    expect(report.failures).toEqual([]);
  }, 120_000);

  it("in a worktree it opens only the pages it was told to, and follows no links", async () => {
    const report = await runGate({ cwd: fx("clean"), project: false, dir: out() });
    expect(report.pages.map((p) => p.url)).toEqual(["/"]);
  }, 120_000);

  it("says so when there was nothing it could check", async () => {
    const report = await runGate({ cwd: out(), project: true, dir: out() });
    expect(report.passed).toBe(false);
    expect(report.failures[0].title).toMatch(/nothing to check/i);
  }, 60_000);
});

describe("the live address", () => {
  const fake = (status, location = "") => async () => ({ status, headers: { get: () => location } });
  it("passes one that answers", async () => {
    expect((await checkLive("https://a.vercel.app", fake(200))).ok).toBe(true);
  });
  it("fails one behind Vercel's login, with the fix", async () => {
    const r = await checkLive("https://a.vercel.app", fake(307, "https://vercel.com/sso/access"));
    expect(r.ok).toBe(false);
    expect(r.evidence).toMatch(/Deployment Protection/);
  });
  it("fails one that is down", async () => {
    expect((await checkLive("https://a.vercel.app", fake(404))).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tools/jarvis-bridge/harness-verify-run.test.mjs`
Expected: FAIL — `canBrowse` is not exported.

- [ ] **Step 4: Append the crawl, the live check and `runGate`**

Append to `tools/jarvis-bridge/harness-verify-run.mjs`:

```js
// --- looking at it -----------------------------------------------------------

let chromium = null;

/** A fresh, hidden browser. Never the signed-in profile in out/browser-profile. */
async function launch() {
  if (!chromium) ({ chromium } = await import("playwright"));
  return chromium.launch({ headless: true });
}

/** Can this PC open a browser at all? Tests skip the crawl when it cannot. */
export async function canBrowse() {
  try {
    const b = await launch();
    await b.close();
    return true;
  } catch {
    return false;
  }
}

const TITLE = {
  pageerror: "A page threw an error",
  console: "A page logged an error",
  request: "A request from a page failed",
  status: "A page or file answered with an error",
  navigation: "A page did not load",
  overflow: "A page scrolls sideways on a phone",
};

/** Load one page and collect everything that went wrong on it. */
async function visit(cx, origin, at) {
  const page = await cx.newPage();
  const errors = [];
  const notes = [];
  const add = (kind, evidence, where = at) => {
    if (!errors.some((e) => e.kind === kind && e.evidence === evidence)) errors.push({ kind, evidence, where });
  };
  page.on("pageerror", (e) => add("pageerror", String(e?.message ?? e)));
  page.on("console", (m) => {
    // "Failed to load resource" is the browser repeating a response that
    // judgeResponse has already seen, including the 401s it only notes.
    if (m.type() === "error" && !/^Failed to load resource/i.test(m.text())) add("console", m.text().slice(0, 600));
  });
  page.on("requestfailed", (req) => {
    const why = req.failure()?.errorText ?? "";
    if (req.url().startsWith(origin) && !/ERR_ABORTED/i.test(why)) add("request", `${req.method()} ${req.url()} failed: ${why}`);
  });
  page.on("response", (res) => {
    let document = false;
    try {
      document = res.request().isNavigationRequest() && res.request().frame() === page.mainFrame();
    } catch {
      /* a request with no frame (a worker) is not the document */
    }
    const verdict = judgeResponse({ url: res.url(), origin, status: res.status(), document });
    const line = `${res.status()} ${res.request().method()} ${res.url()}`;
    if (verdict === "fail") add("status", line, document ? at : new URL(res.url()).pathname);
    else if (verdict === "note") notes.push(line);
  });

  let status = 0;
  try {
    const res = await page.goto(`${origin}${at}`, { waitUntil: "load", timeout: 30_000 });
    status = res?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  } catch (e) {
    add("navigation", String(e?.message ?? e).split("\n")[0]);
  }
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.href)).catch(() => []);
  return { page, status, errors, notes, hrefs };
}

const asFailure = (e) => ({
  id: fingerprint({ step: "crawl", page: `${e.where}:${e.kind}`, evidence: e.evidence }),
  step: "crawl",
  page: e.where,
  title: `${TITLE[e.kind]}: ${e.where}`,
  ran: "",
  evidence: e.evidence,
});

/**
 * Open the app's own pages and write down what broke.
 *
 * It navigates and nothing else: no clicks, no typing, no submits. Without a
 * contract the gate does not know what a click should do.
 */
export async function crawl({ origin, paths = [], dir = "", signal, limit = LIMITS.crawl, depth: maxDepth = MAX_DEPTH }) {
  const b = await launch();
  const pages = [];
  const failures = [];
  const notes = [];
  const deadline = Date.now() + limit;
  try {
    const cx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const queue = [...new Set(["/", ...paths])].map((at) => ({ at, depth: 0 }));
    const seen = new Set(queue.map((q) => q.at));
    while (queue.length && pages.length < MAX_PAGES && Date.now() < deadline && !signal?.aborted) {
      const { at, depth } = queue.shift();
      const r = await visit(cx, origin, at);
      pages.push({ url: at, status: r.status, errors: r.errors.map((e) => e.evidence) });
      failures.push(...r.errors.map(asFailure));
      notes.push(...r.notes);
      if (depth < maxDepth) {
        for (const next of crawlLinks(r.hrefs, origin)) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push({ at: next, depth: depth + 1 });
        }
      }
      if (at === "/" && dir) await r.page.screenshot({ path: path.join(dir, "home-1280.jpg"), type: "jpeg", quality: 60 }).catch(() => {});
      await r.page.close().catch(() => {});
    }

    // The home page again, the size of a phone. Only what is phone-specific is
    // recorded here; its errors were already seen at desktop width.
    if (!signal?.aborted) {
      const phone = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
      const r = await visit(phone, origin, "/");
      const wide = await r.page.evaluate(() => document.documentElement.scrollWidth).catch(() => 0);
      if (wide > 391) failures.push(asFailure({ kind: "overflow", where: "/", evidence: `The page is ${wide}px wide on a 390px screen.` }));
      if (dir) await r.page.screenshot({ path: path.join(dir, "home-390.jpg"), type: "jpeg", quality: 60 }).catch(() => {});
      await r.page.close().catch(() => {});
    }
  } finally {
    await b.close().catch(() => {});
  }
  return { pages, failures, notes: [...new Set(notes)] };
}

/** Does the address the agent printed actually open, without a login? */
export async function checkLive(url, fetcher = fetch) {
  try {
    const res = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const to = res.headers.get("location") ?? "";
    if (res.status === 401 || /vercel\.com\/sso/i.test(to)) {
      return {
        ok: false,
        evidence: `${url} asks for a login (${res.status}). Turn off Vercel Authentication for previews in Vercel › the project › Settings › Deployment Protection.`,
      };
    }
    if (res.status >= 400) return { ok: false, evidence: `${url} answered ${res.status}.` };
    return { ok: true, evidence: "" };
  } catch (e) {
    return { ok: false, evidence: `${url} did not answer: ${String(e?.message ?? e)}` };
  }
}

// --- the gate ----------------------------------------------------------------

const lastLine = (text) => String(text ?? "").trim().split(/\r?\n/).filter(Boolean).pop() ?? "";

/**
 * Run every check on one folder and write the report beside the bridge.
 *
 * `text` is the agent's last message (for the live address); `paths` are extra
 * pages to open besides "/". Returns the report; never throws for a failing
 * build — a failing build is a result, not an error.
 */
export async function runGate({ cwd, project = false, base = "", text = "", paths = [], dir, onStep = () => {}, signal, env = process.env }) {
  const startedAt = Date.now();
  mkdirSync(dir, { recursive: true });
  const plan = planChecks({ ...readFacts(cwd), project, base });
  const clean = scrubEnv(env);
  const steps = [];
  const failures = [];
  const advice = [];
  const record = (row) => {
    steps.push(row);
    onStep(row);
  };
  const skip = (id, label, why) => record({ id, label, ok: true, advisory: false, skipped: true, ms: 0, ran: "", tail: why });
  const failed = (step, title, ran, evidence, page = "") =>
    failures.push({ id: fingerprint({ step, page, evidence }), step, page, title, ran, evidence });

  let blocked = "";
  for (const step of plan.steps) {
    if (signal?.aborted) break;
    if (blocked) {
      skip(step.id, step.label, blocked);
      continue;
    }
    const row = await runStep(step, { cwd, env: clean, signal });
    record(row);
    if (row.ok) continue;
    if (step.advisory) {
      advice.push(`${step.label}: ${lastLine(row.tail)}`);
      continue;
    }
    failed(step.id, `${step.label} failed`, row.ran, row.tail);
    if (step.id === "install") blocked = "Skipped because its packages did not install.";
  }

  let pages = [];
  const built = !failures.some((f) => f.step === "install" || f.step === "build");
  if (!plan.boot) {
    skip("boot", "Start it", "Nothing here says how to start it: no start or dev script, and no index.html.");
  } else if (!built) {
    skip("boot", "Start it", "Skipped because it did not build.");
    skip("crawl", "Open every page", "Skipped because it did not build.");
  } else if (!signal?.aborted) {
    const ran = plan.boot.command ?? (plan.boot.args ? `node ${plan.boot.args.join(" ")}` : `serve ${plan.boot.dir}`);
    const t0 = Date.now();
    let app = null;
    try {
      app = await startApp({ cwd, boot: plan.boot, env: clean, signal });
      record({ id: "boot", label: "Start it", ok: true, advisory: false, skipped: false, ms: Date.now() - t0, ran, tail: "" });
    } catch (e) {
      const evidence = String(e?.message ?? e);
      record({ id: "boot", label: "Start it", ok: false, advisory: false, skipped: false, ms: Date.now() - t0, ran, tail: evidence });
      if (!signal?.aborted) failed("boot", "It did not start", ran, evidence);
    }
    if (app) {
      const t1 = Date.now();
      try {
        // A new project is crawled link by link. A worktree of a big existing
        // site is not: following the hub's home page would open forty unrelated
        // apps and fail an edit for an error that was already there. It opens
        // the home page and the pages it was told to, and nothing else.
        const seen = await crawl({ origin: app.url, paths, dir, signal, depth: project ? MAX_DEPTH : 0 });
        pages = seen.pages;
        failures.push(...seen.failures);
        advice.push(...seen.notes.slice(0, 20));
        record({ id: "crawl", label: "Open every page", ok: seen.failures.length === 0, advisory: false, skipped: false, ms: Date.now() - t1, ran: `${pages.length} page(s)`, tail: "" });
      } catch (e) {
        // No browser on this PC is the PC's problem, not the build's.
        const why = `The hidden browser could not start, so no page was opened: ${String(e?.message ?? e).split("\n")[0]}`;
        skip("crawl", "Open every page", why);
        advice.push(why);
      } finally {
        await app.stop().catch(() => {});
      }
    }
  }

  const { live } = finishLinks(text);
  if (live && !signal?.aborted) {
    const t2 = Date.now();
    const r = await checkLive(live);
    record({ id: "live", label: "Open the live address", ok: r.ok, advisory: false, skipped: false, ms: Date.now() - t2, ran: `GET ${live}`, tail: r.evidence });
    if (!r.ok) failed("live", "The live address does not open", `GET ${live}`, r.evidence, live);
  }

  if (!signal?.aborted && !steps.some((s) => !s.skipped)) {
    failed("none", "There was nothing to check", "", "No package.json scripts and no index.html were found in the project folder.");
  }

  const report = {
    startedAt,
    ms: Date.now() - startedAt,
    passed: failures.length === 0 && !signal?.aborted,
    aborted: Boolean(signal?.aborted),
    steps,
    pages,
    advice,
    failures,
  };
  writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tools/jarvis-bridge/harness-verify-run.test.mjs`
Expected: PASS, 18 tests. If the seven "whole gate" tests show as skipped, Chromium is missing on this machine: run `npx playwright install chromium` inside `tools/jarvis-bridge` (this is the bridge's own existing dependency, not a new one) and run again. They must run and pass here before this task is done.

- [ ] **Step 6: Commit**

```bash
git add tools/jarvis-bridge/harness-verify-run.mjs tools/jarvis-bridge/harness-verify-run.test.mjs tools/jarvis-bridge/fixtures
git commit -m "Jarvis harness: open every page of a build and write down what broke"
```

---

### Task 4: A job that says "finished" is claimed, not done

**Files:**
- Modify: `tools/jarvis-bridge/build-jobs.mjs:48` (export), `:210-239` (`begin`), `:268-289` (`appendEvent`)
- Test: `tools/jarvis-bridge/build-jobs.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tools/jarvis-bridge/build-jobs.test.mjs`:

```js
describe("a build that is checked before it is called built", () => {
  const FINISH = "All done.\nRepo: https://github.com/a/b\nLive: https://a.vercel.app";

  it("is only CLAIMED when it prints its finish lines", () => {
    const { s } = store();
    s.begin({ ...job(), verify: true });
    s.arm("t_1");
    turn(s, "t_1", FINISH);
    const one = s.get("t_1");
    expect(one.status).toBe("running");
    expect(one.claimed).toBe(true);
    expect(one.claimedText).toContain("Live: https://a.vercel.app");
    expect(one.verify.state).toBe("idle");
  });

  it("is still done on its own word when verify is off", () => {
    const { s } = store();
    s.begin(job());
    s.arm("t_1");
    turn(s, "t_1", FINISH);
    expect(s.get("t_1").status).toBe("done");
  });

  it("forgets the claim when the next turn starts", () => {
    const { s } = store();
    s.begin({ ...job(), verify: true });
    s.arm("t_1");
    turn(s, "t_1", FINISH);
    s.appendEvent("t_1", { seq: 9, kind: "user", text: "fix it" });
    expect(s.get("t_1").claimed).toBe(false);
  });

  it("does not claim a turn that ended on an error", () => {
    const { s } = store();
    s.begin({ ...job(), verify: true });
    s.arm("t_1");
    turn(s, "t_1", FINISH, { error: "boom" });
    expect(s.get("t_1").claimed).toBe(false);
    expect(s.get("t_1").status).toBe("failed");
  });

  it("is never resumed once it is unverified, and keeps a check that was running", () => {
    const { file, s } = store();
    s.begin({ ...job(), verify: true });
    s.arm("t_1");
    s.update("t_1", { verify: { ...s.get("t_1").verify, state: "checking", run: 2 } });
    expect(createJobStore({ file }).resumable()[0].verify).toMatchObject({ state: "checking", run: 2 });
    s.mark("t_1", "unverified", "Still failing after 3 repair rounds.");
    expect(createJobStore({ file }).resumable()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tools/jarvis-bridge/build-jobs.test.mjs`
Expected: FAIL — the first new test gets `status: "done"`.

- [ ] **Step 3: Change `build-jobs.mjs`**

Line 48 — export the pattern so nothing else has to copy it:

```js
export const FINISH_LINE = /^\s*(?:Preview|Live|Repo|PR):\s*(?:https?:\/\/\S+|none)\s*$/im;
```

In `begin(job)`, add three fields to `next`, directly after `lastError: "",` and before `...(existing || {}),`:

```js
        // The bridge checks this build itself before it is called built. Null
        // means the old rule: finished when it prints its finish lines.
        verify: job.verify ? { state: "idle", run: 0, rounds: 0, failures: [], lastIds: [], report: "", why: "" } : null,
        claimed: false,
        claimedText: "",
```

In `appendEvent`, replace the `if (row.kind === "user") { … }` block's body and the finish-line branch. The `user` branch becomes:

```js
      if (row.kind === "user") {
        j.turnText = "";
        j.lastError = "";
        j.lastTurnEnded = false;
        j.claimed = false;
```

and the `else if (FINISH_LINE.test(j.turnText || "")) { … }` branch inside `turn_end` becomes:

```js
        } else if (FINISH_LINE.test(j.turnText || "")) {
          if (j.verify) {
            // It SAYS it is finished. harness.mjs sees this and runs the gate;
            // only a pass (or the owner) makes it done.
            j.claimed = true;
            j.claimedText = String(j.turnText || "").slice(-4_000);
          } else {
            j.status = "done";
            j.why = "It printed what it finished with.";
          }
        }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tools/jarvis-bridge/build-jobs.test.mjs`
Expected: PASS — the five new tests and every existing one.

- [ ] **Step 5: Commit**

```bash
git add tools/jarvis-bridge/build-jobs.mjs tools/jarvis-bridge/build-jobs.test.mjs
git commit -m "Jarvis harness: a build that says it is finished is a claim until it is checked"
```

---

### Task 5: The repair loop

**Files:**
- Create: `tools/jarvis-bridge/harness-verify-loop.mjs`
- Test: `tools/jarvis-bridge/harness-verify-loop.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tools/jarvis-bridge/harness-verify-loop.test.mjs`:

```js
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createJobStore } from "./build-jobs.mjs";
import { createVerifier, verifyView } from "./harness-verify-loop.mjs";

const fail = (id) => ({ id, step: "build", page: "", title: `Build failed (${id})`, ran: "npm run build", evidence: `error ${id}` });
const PASS = { passed: true, aborted: false, failures: [] };
const FAIL = (...ids) => ({ passed: false, aborted: false, failures: ids.map(fail) });

/** A thread, a job store, and a gate that answers from a script. */
function rig(script, thread = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "jarvis-loop-"));
  const jobs = createJobStore({ file: path.join(dir, "jobs.json") });
  jobs.begin({ id: "t_1", title: "WalkBook", brief: "Build it.", worktree: { path: dir }, verify: true });
  jobs.arm("t_1");
  const runs = [];
  /** `during(n)` runs while check n is in progress — for "the agent finished again mid-check". */
  const hooks = { during: null };
  const verifier = createVerifier({
    runGate: async (args) => {
      runs.push(args);
      await hooks.during?.(runs.length);
      return script.shift() ?? PASS;
    },
    jobs,
    dirFor: (id, run) => path.join(dir, "verify", id, String(run)),
  });
  const s = { id: "t_1", jobId: "t_1", trust: "trusted", strict: false, worktree: { path: dir, project: true, base: "main" }, verify: jobs.get("t_1").verify, ...thread };
  const said = [];
  const events = [];
  const opts = { emit: (e) => events.push(e), say: (t) => said.push(t), ask: async () => ({ allow: true, how: "owner" }), repair: true, text: "Live: none" };
  return { s, jobs, verifier, runs, said, events, opts, hooks };
}

describe("the loop around the gate", () => {
  it("a pass makes the job done and says nothing to the agent", async () => {
    const r = rig([PASS]);
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify.state).toBe("passed");
    expect(r.jobs.get("t_1").status).toBe("done");
    expect(r.said).toEqual([]);
    expect(r.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["verify_start", "verify_end", "note"]));
  });

  it("a failure goes back to the agent, and the next pass finishes it", async () => {
    const r = rig([FAIL("a"), PASS]);
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify).toMatchObject({ state: "repairing", rounds: 1 });
    expect(r.said).toHaveLength(1);
    expect(r.said[0]).toContain("round 1 of 3");
    expect(r.jobs.get("t_1").status).toBe("running");
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify.state).toBe("passed");
    expect(r.jobs.get("t_1").status).toBe("done");
  });

  it("stops at the second check when nothing changed", async () => {
    const r = rig([FAIL("a"), FAIL("a"), FAIL("a")]);
    await r.verifier.check(r.s, r.opts);
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify.state).toBe("failed");
    expect(r.s.verify.why).toMatch(/twice in a row/);
    expect(r.said).toHaveLength(1);
    expect(r.jobs.get("t_1").status).toBe("unverified");
    expect(r.runs).toHaveLength(2);
  });

  it("gives up after three rounds of new failures", async () => {
    const r = rig([FAIL("a"), FAIL("b"), FAIL("c"), FAIL("d")]);
    for (let i = 0; i < 4; i++) await r.verifier.check(r.s, r.opts);
    expect(r.said).toHaveLength(3);
    expect(r.s.verify.state).toBe("failed");
    expect(r.s.verify.why).toContain("3 repair rounds");
  });

  it("only looks when asked only to look", async () => {
    const r = rig([FAIL("a")]);
    await r.verifier.check(r.s, { ...r.opts, repair: false });
    expect(r.said).toEqual([]);
    expect(r.s.verify.state).toBe("failed");
  });

  it("asks first on a thread that may not run things unasked, and stays unverified on a no", async () => {
    const r = rig([PASS], { trust: "ask", worktree: { path: "x", project: false, base: "main" } });
    await r.verifier.check(r.s, { ...r.opts, ask: async () => ({ allow: false, how: "owner" }) });
    expect(r.runs).toHaveLength(0);
    expect(r.s.verify.state).toBe("failed");
    expect(r.jobs.get("t_1").status).toBe("unverified");
  });

  it("checks again when the agent finished a second time during a check", async () => {
    const r = rig([FAIL("stale"), PASS]);
    r.hooks.during = (n) => {
      if (n === 1) void r.verifier.check(r.s, r.opts);
    };
    await r.verifier.check(r.s, r.opts);
    expect(r.runs).toHaveLength(2);
    expect(r.s.verify.state).toBe("passed");
    expect(r.said).toEqual([]);
  });

  it("an aborted check decides nothing", async () => {
    const r = rig([{ passed: false, aborted: true, failures: [] }]);
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify.state).toBe("idle");
    expect(r.jobs.get("t_1").status).toBe("running");
  });

  it("the owner can use it anyway", async () => {
    const r = rig([FAIL("a"), FAIL("a")]);
    await r.verifier.check(r.s, r.opts);
    await r.verifier.check(r.s, r.opts);
    r.verifier.accept(r.s, r.opts.emit);
    expect(r.s.verify.state).toBe("accepted");
    expect(r.jobs.get("t_1").status).toBe("done");
  });

  it("a repair turn that ends without finishing leaves it unverified", async () => {
    const r = rig([FAIL("a")]);
    await r.verifier.check(r.s, r.opts);
    r.verifier.stalledRepair(r.s, r.opts.emit);
    expect(r.s.verify.state).toBe("failed");
    expect(r.jobs.get("t_1").status).toBe("unverified");
  });

  it("tells the page only what it needs", async () => {
    const r = rig([FAIL("a")]);
    await r.verifier.check(r.s, r.opts);
    expect(verifyView(r.s.verify)).toMatchObject({ state: "repairing", run: 1, rounds: 1, max: 3, failures: [{ step: "build", title: "Build failed (a)", page: "" }] });
    expect(verifyView(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tools/jarvis-bridge/harness-verify-loop.test.mjs`
Expected: FAIL — `Failed to resolve import "./harness-verify-loop.mjs"`.

- [ ] **Step 3: Write the loop**

Create `tools/jarvis-bridge/harness-verify-loop.mjs`:

```js
// ---------------------------------------------------------------------------
// The loop around the gate: check, then pass it, send it back, or stop.
//
// Kept apart from harness.mjs so it can be tested with a gate that answers
// from a script. harness.mjs hands it a thread and four functions — emit, say,
// ask, and the gate itself — and this file owns everything that happens to
// `s.verify` and to the job's status.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { MAX_ROUNDS, afterRun, repairPrompt } from "./harness-verify.mjs";

const EMPTY = { state: "idle", run: 0, rounds: 0, failures: [], lastIds: [], report: "", why: "" };

/**
 * May this thread's checks run without a card?
 *
 * The gate runs scripts the agent wrote. Where the thread could already run
 * commands unasked that is nothing new; where it could not, the gate must not
 * become a way around the permission card.
 */
const runsUnasked = (s) =>
  !s.strict && (Boolean(s.worktree?.project) || Boolean(s.unattended) || ["trusted", "auto", "full"].includes(s.trust));

/** What the page is told. Never the evidence: that is in the report. */
export function verifyView(v) {
  if (!v) return null;
  return {
    state: v.state,
    run: v.run,
    rounds: v.rounds,
    max: MAX_ROUNDS,
    why: v.why || "",
    failures: (v.failures || []).slice(0, 8).map((f) => ({ step: f.step, title: f.title, page: f.page || "" })),
    report: v.report || "",
  };
}

export function createVerifier({ runGate, jobs, dirFor }) {
  /** One gate at a time on this PC: a build and a browser are heavy. */
  let queue = Promise.resolve();

  const set = (s, patch) => {
    s.verify = { ...EMPTY, ...(s.verify || {}), ...patch };
    if (s.jobId) jobs.update(s.jobId, { verify: s.verify });
    return s.verify;
  };
  const note = (emit, text) => emit({ kind: "note", text });
  const unverified = (s, emit, why, patch = {}) => {
    set(s, { state: "failed", why, ...patch });
    if (s.jobId) jobs.mark(s.jobId, "unverified", why);
    note(emit, `Built, but the checks are failing. ${why}`);
  };

  async function once(s, { emit, say, ask, repair = true, text = "", paths = [] }) {
    if (!runsUnasked(s)) {
      const answer = await ask({
        name: "VerifyGate",
        title: "Run the checks on this build",
        why: "Typecheck, its own tests, a build, then every page opened in a hidden browser. These run scripts the agent wrote.",
        risk: "act",
        command: "typecheck · test · build · start · open every page",
      }).catch(() => ({ allow: false, how: "error" }));
      if (!answer.allow) {
        unverified(s, emit, "The checks were not allowed to run, so nothing was verified.", { failures: [] });
        return s.verify;
      }
    }

    for (;;) {
      const run = (s.verify?.run || 0) + 1;
      const dir = dirFor(s.id, run);
      s.verifyAgain = false;
      s.verifyAbort = new AbortController();
      set(s, { state: "checking", run, why: "" });
      emit({ kind: "verify_start", run });
      note(emit, `Checking it works (check ${run}).`);

      let report;
      try {
        report = await runGate({
          cwd: s.worktree.path,
          project: Boolean(s.worktree.project),
          base: s.worktree.base || "",
          text,
          paths,
          dir,
          signal: s.verifyAbort.signal,
          onStep: (row) => emit({ kind: "verify_step", id: row.id, ok: row.ok, skipped: row.skipped, ms: row.ms }),
        });
      } catch (e) {
        report = {
          passed: false,
          aborted: false,
          failures: [{ id: "gate", step: "gate", page: "", title: "The checks could not run", ran: "", evidence: String(e?.message ?? e) }],
        };
      }

      // Stopped by the owner: nothing was decided, and nothing is marked.
      if (report.aborted) {
        set(s, { state: "idle" });
        return s.verify;
      }
      // The agent finished again while this was running. That result is about
      // files that have since changed, so it is thrown away and run again.
      if (s.verifyAgain) continue;

      const ids = report.failures.map((f) => f.id);
      const next = afterRun({ passed: report.passed, ids, lastIds: s.verify.lastIds, rounds: s.verify.rounds, repair });
      const file = path.join(dir, "report.json");
      emit({ kind: "verify_end", run, passed: report.passed, failures: report.failures.length });

      if (next.state === "passed") {
        set(s, { state: "passed", failures: [], lastIds: [], report: file, why: "" });
        if (s.jobId) jobs.mark(s.jobId, "done", "The checks passed.");
        note(emit, "The checks passed.");
      } else if (next.state === "repairing") {
        const rounds = s.verify.rounds + 1;
        set(s, { state: "repairing", rounds, failures: report.failures, lastIds: ids, report: file });
        const n = report.failures.length;
        note(emit, `${n} check${n === 1 ? "" : "s"} failed. Sent back to be fixed (round ${rounds} of ${MAX_ROUNDS}).`);
        say(repairPrompt(report, { round: rounds, max: MAX_ROUNDS }));
      } else {
        unverified(s, emit, next.why, { failures: report.failures, lastIds: ids, report: file });
      }
      return s.verify;
    }
  }

  return {
    /** Check this thread. A second call while one is running re-checks when it ends. */
    check(s, opts) {
      if (s.verifying) {
        s.verifyAgain = true;
        return s.verifyDone;
      }
      s.verifying = true;
      set(s, { state: "checking" });
      s.verifyDone = queue.then(() => once(s, opts)).catch(() => s.verify).finally(() => {
        s.verifying = false;
      });
      queue = s.verifyDone;
      return s.verifyDone;
    },

    /** The owner's "Use it anyway". */
    accept(s, emit) {
      set(s, { state: "accepted", why: "Accepted by the owner without a passing check." });
      if (s.jobId) jobs.mark(s.jobId, "done", s.verify.why);
      note(emit, "You chose to use it anyway. The failing checks are still in the report.");
      return s.verify;
    },

    /** A repair turn ended without the agent saying it had finished. */
    stalledRepair(s, emit) {
      if (s.verify?.state !== "repairing") return;
      unverified(s, emit, "It stopped without finishing the repair.");
    },

    abort(s) {
      s.verifyAbort?.abort();
    },

    /** The latest report, with its two pictures as data URLs, for the page. */
    report(s) {
      const file = s.verify?.report || "";
      if (!file || !existsSync(file)) return { report: null, shots: {} };
      const dir = path.dirname(file);
      const shot = (name) => {
        const at = path.join(dir, name);
        return existsSync(at) ? `data:image/jpeg;base64,${readFileSync(at).toString("base64")}` : "";
      };
      return {
        report: JSON.parse(readFileSync(file, "utf8")),
        shots: { desktop: shot("home-1280.jpg"), phone: shot("home-390.jpg") },
      };
    },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tools/jarvis-bridge/harness-verify-loop.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/jarvis-bridge/harness-verify-loop.mjs tools/jarvis-bridge/harness-verify-loop.test.mjs
git commit -m "Jarvis harness: send a failing build back to be fixed, three rounds at most"
```

---

### Task 6: Wire the loop into the bridge

**Files:**
- Modify: `tools/jarvis-bridge/harness.mjs` (imports, `summary`, `startThread`, `stopThread`, `discardThread`, three new exports)
- Modify: `tools/jarvis-bridge/server.mjs:226` (three routes)

`harness.mjs` has no test file of its own because it starts real agents; the loop it calls is covered by Task 5. This task is checked by syntax, by the whole suite still passing, and by the real run in Task 10.

- [ ] **Step 1: Imports and the verifier**

In `tools/jarvis-bridge/harness.mjs`, replace the two `node:` imports at the top (lines 29–30) with:

```js
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
```

After the `import { startPreview, stopPreview, publicView } from "./harness-preview.mjs";` line, add:

```js
import { resumeAction } from "./harness-verify.mjs";
import { runGate } from "./harness-verify-run.mjs";
import { createVerifier, verifyView } from "./harness-verify-loop.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The gate every durable build passes before it is called built.
 *
 * Reports live beside the bridge under out/verify, never in a repository: they
 * hold output from code the agent wrote.
 */
const verifier = createVerifier({
  runGate,
  jobs: buildJobs,
  dirFor: (id, run) => path.join(HERE, "out", "verify", id, String(run)),
});

/**
 * The off switch: a file named `verify-off` in out/, like `agents-off`.
 *
 * While it exists a durable build is finished on its own word, exactly as
 * before the gate existed, and the 24/7 runner ships without asking for a
 * check. It is there for the rollout — this helper runs from the folder it is
 * edited in, so a restart must not switch the gate on half-built — and it
 * stays as the way to turn the gate off without touching code. A check the
 * owner asks for by hand (`POST /harness/verify`) still runs.
 */
const gateOff = () => existsSync(path.join(HERE, "out", "verify-off"));
```

**The live helper runs from this folder.** `out/verify-off` already exists (the controller created it before this task). Do not delete it; Task 10 does, with the owner watching. And because a restart can happen at any moment, **every save of `harness.mjs` and `server.mjs` must leave the file parseable and working**: add the imports first (the files they name already exist), make each edit complete in itself, and add the handlers to `harness.mjs` before the routes that call them in `server.mjs`. Run `node --check` after each edit.

- [ ] **Step 2: `summary()`**

In `summary(s)`, add one line after `landed: s.landed,`:

```js
    // What the bridge's own check of this build found. Null: never checked.
    verify: verifyView(s.verify),
```

- [ ] **Step 3: `startThread` — the argument, the job, the session**

Add a parameter after `mcpServers = null,`:

```js
  // "off" switches the gate off for a durable build. Anything else leaves the
  // default: a durable build is checked before it is called built.
  verify = "",
  // Pages to open besides "/". A client edit to one hub app names that app's
  // route, because a worktree's check follows no links (see runGate).
  verifyPaths = [],
```

Directly below the `const durableJob = durable || Boolean(resume);` line, add:

```js
  // Only site-relative paths, and only a handful: these become URLs the
  // hidden browser opens on the app under test.
  const checkPaths = (Array.isArray(verifyPaths) ? verifyPaths : [])
    .filter((p) => typeof p === "string" && /^\/[^\s]*$/.test(p) && !p.startsWith("//"))
    .slice(0, 5);
```

In the `buildJobs.begin({ … })` call, add after `createdAt: resume?.createdAt ?? Date.now(),`:

```js
      verify: verify !== "off" && !gateOff(),
```

and add `verifyPaths: checkPaths,` to the `args: { … }` object in that same call, after `pick,` — a resumed build is started from `job.args`, so this is what carries the paths across a restart.

In the `const s = { … }` literal, add after `retryTimer: null,`:

```js
    // Mirrors the job's `verify`; a thread with no job gets one the first time
    // somebody asks for a check (an unattended run before it ships).
    verify: stored?.verify ?? null,
    verifyPaths: checkPaths,
    unattended: Boolean(unattended),
    emit: null,
    ask: null,
```

- [ ] **Step 4: `startThread` — run the gate when the agent says it is finished**

Inside `emit`, directly after the closing brace of the existing `if (s.jobId && event.kind === "turn_end") { … }` retry block and before `if (event.kind === "status") {`, add:

```js
    // The agent's turn is over. If it said it was finished, the bridge now
    // checks that itself; if it was mid-repair and stopped without saying so,
    // the build stays what the last check found. Read AFTER the retry block:
    // a turn that ended on a limit is paused, and a paused build is not done.
    if (s.jobId && event.kind === "turn_end") {
      const job = buildJobs.get(s.jobId);
      if (job?.verify && job.status === "running" && !job.retry && !job.retryAt) {
        if (job.claimed) {
          void verifier.check(s, { emit, say: s.tell, ask: gate, repair: true, text: job.claimedText || "", paths: s.verifyPaths });
        } else if (!event.error) {
          verifier.stalledRepair(s, emit);
        }
      }
    }
```

Directly after the `const gate = (ask) => new Promise(…);` definition ends (before `const common = {`), add:

```js
  // The three handlers at the bottom of this file run outside this closure.
  s.emit = emit;
  s.ask = gate;
  // How the gate sends a repair back. `adapter.say` queues silently on a
  // thread that has ended, and a repair nobody will ever read must be an
  // error the loop can see, not a build left on "fixing" for ever.
  s.tell = (text) => {
    if (s.status === "ended") throw new Error("That thread has ended.");
    s.adapter.say(text);
  };
```

Also add `tell: null,` beside `emit: null,` in the `const s = { … }` literal.

In `sayToThread`, inside the existing `if (s.jobId) { … }` block, after `buildJobs.update(s.jobId, { retryAt: "" });`, add:

```js
    // The owner has sent the agent back to work, so whatever was checked is
    // about to be out of date. A check in flight is called off and the rounds
    // start over; a build that was done or unverified is running again, which
    // is what gets its next finish line checked.
    const job = buildJobs.get(s.jobId);
    if (job?.verify) {
      verifier.reopen(s);
      if (job.status === "done" || job.status === "unverified") {
        buildJobs.update(s.jobId, { status: "running", why: "" });
      }
    }
```

(`sayToThread` is the owner's route. The gate's own repair message and the rate-limit resume go through `s.tell` / `s.adapter.say` directly, so they do not reopen anything.)

- [ ] **Step 5: `startThread` — a restart mid-check checks again**

Replace the tail of the `if (resume) { … }` block — the `emit({ kind: "note", text: "Jarvis restarted and picked this build back up. …" });` call and the `s.adapter.say(resumePrompt(resume));` line after it — with:

```js
    if (resumeAction(resume) === "verify") {
      // It had finished its turn and was being checked when the helper went
      // down. Sending the brief again would start work that is already done.
      emit({ kind: "note", text: "Jarvis restarted while this build was being checked. Checking it again." });
      void verifier.check(s, { emit, say: s.tell, ask: gate, repair: true, text: resume.claimedText || "", paths: s.verifyPaths });
    } else {
      emit({
        kind: "note",
        text: "Jarvis restarted and picked this build back up. The work already in this folder was kept; the agent is checking it before it continues.",
      });
      s.adapter.say(resumePrompt(resume));
    }
```

- [ ] **Step 6: Stop and discard abort a running check**

In `stopThread`, add as the first line after `if (s.retryTimer) clearTimeout(s.retryTimer);`:

```js
  // A check still running would start the app again in a folder being let go.
  verifier.abort(s);
```

Add the same two lines at the same place in `discardThread`.

- [ ] **Step 7: The three handlers**

Add after `markJobDone`:

```js
/**
 * Check this thread's work now, once, without sending anything back.
 *
 * The owner's "Check again", and what the 24/7 runner asks before it lets an
 * unattended run ship. Returns at once; the verdict arrives in `summary.verify`.
 */
export function verifyThread({ id }) {
  const s = mustGet(id);
  const text = s.jobId ? buildJobs.get(s.jobId)?.claimedText || "" : "";
  void verifier.check(s, { emit: s.emit, say: s.tell, ask: s.ask, repair: false, text, paths: s.verifyPaths });
  return { ok: true, session: summary(s) };
}

/** The latest report and its two pictures. */
export function verifyReport({ id }) {
  return verifier.report(mustGet(id));
}

/** The owner's "Use it anyway". Recorded, never silent. */
export function verifyAccept({ id }) {
  const s = mustGet(id);
  verifier.accept(s, s.emit);
  return { ok: true, session: summary(s) };
}
```

- [ ] **Step 8: The routes**

In `tools/jarvis-bridge/server.mjs`, add after the `"POST /harness/job/done"` line (226):

```js
  "POST /harness/verify": (b) => harness.verifyThread(b),
  "POST /harness/verify/report": (b) => harness.verifyReport(b),
  "POST /harness/verify/accept": (b) => harness.verifyAccept(b),
```

and extend the comment near line 34 with one more line:

```js
//   POST /harness/verify|verify/report|verify/accept   the bridge's own check of a build
```

- [ ] **Step 9: Check it parses and nothing else broke**

Run: `node --check tools/jarvis-bridge/harness.mjs && node --check tools/jarvis-bridge/server.mjs && npx vitest run tools/jarvis-bridge`
Expected: no output from `node --check`; vitest PASS for every file in the folder.

- [ ] **Step 10: Commit**

```bash
git add tools/jarvis-bridge/harness.mjs tools/jarvis-bridge/server.mjs
git commit -m "Jarvis harness: the bridge checks a build when the agent says it is finished"
```

---

### Task 7: The page stops calling an unchecked build "Built"

**Files:**
- Modify: `src/lib/new-jarvis/harness/types.ts`
- Modify: `src/lib/app-builder/build.ts`
- Modify: `src/lib/client-review/liveBuild.ts:161-174`, `src/lib/client-review/autoBuild.ts:137`
- Test: `src/lib/app-builder/build.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/app-builder/build.test.ts` (add `phaseLabel` to the import from `./build`):

```ts
describe("a build the PC has checked", () => {
  const verify = (state: string, extra: Record<string, unknown> = {}) =>
    ({ status: "idle", verify: { state, run: 1, rounds: 0, max: 3, why: "", failures: [], report: "", ...extra } }) as unknown as ThreadSummary;
  const built = view([turn("Repo: https://github.com/a/b\nLive: https://a.vercel.app")]);

  it("says it is checking while the check runs", () => {
    expect(phaseOf(verify("checking"), built)).toBe("checking");
  });
  it("is Built only after a pass, or when the owner says use it anyway", () => {
    expect(phaseOf(verify("passed"), built)).toBe("done");
    expect(phaseOf(verify("accepted"), built)).toBe("done");
  });
  it("is unverified when the checks failed", () => {
    expect(phaseOf(verify("failed"), built)).toBe("unverified");
  });
  it("is working while a repair is on its way to the agent", () => {
    expect(phaseOf(verify("repairing", { rounds: 1 }), built)).toBe("working");
  });
  it("is unfinished when it stopped without claiming anything", () => {
    expect(phaseOf(verify("idle"), view([turn("Should the booking page need a login?")]))).toBe("unfinished");
  });
  it("keeps the old rule for a thread that was never checked", () => {
    expect(phaseOf(summary("idle"), built)).toBe("done");
  });
  it("names the repair round", () => {
    expect(phaseLabel("working", verify("repairing", { rounds: 2 }))).toBe("Fixing what the checks found (round 2 of 3)");
    expect(phaseLabel("working", summary("thinking"))).toBe(PHASE_LABEL.working);
    expect(phaseLabel("unverified", null)).toBe("Built, but the checks are failing");
  });
  it("tells the agent the check is coming", () => {
    expect(buildBrief(project())).toMatch(/the PC checks the build itself/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/app-builder/build.test.ts`
Expected: FAIL — `phaseLabel` is not exported.

- [ ] **Step 3: The types**

In `src/lib/new-jarvis/harness/types.ts`, add above `/** The thread summary the bridge returns beside every poll. */`:

```ts
/**
 * The bridge's own check of a build: `checking` while it runs, `repairing`
 * while a failure is on its way back to the agent, `failed` when the rounds
 * ran out, `accepted` when the owner chose to use it anyway.
 */
export type VerifyState = "idle" | "checking" | "repairing" | "passed" | "failed" | "accepted";

export interface VerifySummary {
  state: VerifyState;
  /** How many checks have run. */
  run: number;
  /** How many repair messages have been sent, out of `max`. */
  rounds: number;
  max: number;
  why: string;
  failures: { step: string; title: string; page: string }[];
  report: string;
}
```

and inside `ThreadSummary`, after the `retryAt?: string;` field:

```ts
  /** Null or missing: this thread is not checked (an ordinary chat thread). */
  verify?: VerifySummary | null;
```

- [ ] **Step 4: The phases**

In `src/lib/app-builder/build.ts`:

Replace the `BuildPhase` type:

```ts
export type BuildPhase =
  | "starting" | "reconnecting" | "resuming" | "paused" | "working" | "asking"
  | "checking" | "unverified" | "unfinished"
  | "done" | "failed" | "stopped" | "lost";
```

Add three entries to `PHASE_LABEL`, after `asking`:

```ts
  // The PC is checking the build itself: typecheck, tests, build, every page.
  checking: "Checking it works",
  // It was built and the checks say it does not work. Never "Built".
  unverified: "Built, but the checks are failing",
  // It stopped without saying it had finished: a question, or it gave up.
  unfinished: "Stopped before it finished",
```

Add below `PHASE_LABEL`:

```ts
/** The label for a phase, naming the repair round when there is one. */
export function phaseLabel(phase: BuildPhase, summary: ThreadSummary | null): string {
  const v = summary?.verify;
  if (phase === "working" && v && v.rounds > 0 && v.state === "repairing") {
    return `Fixing what the checks found (round ${v.rounds} of ${v.max})`;
  }
  return PHASE_LABEL[phase];
}

/**
 * What a thread that has stopped working amounts to.
 *
 * With no `verify` the old rule stands: stopped means built. With it, only a
 * pass (or the owner's say-so) is built.
 */
function settled(summary: ThreadSummary): BuildPhase {
  const v = summary.verify;
  if (!v) return "done";
  if (v.state === "passed" || v.state === "accepted") return "done";
  if (v.state === "failed") return "unverified";
  return "unfinished";
}
```

In `phaseOf`, add directly after `if (summary.retryAt) return "paused";`:

```ts
  // The bridge is checking the work, or has just sent a failure back. Neither
  // is a finished build, whatever the thread's own status says. Not once the
  // thread has ended, though: a repair nobody is left to make is not "working".
  if (summary.status !== "ended") {
    if (summary.verify?.state === "checking") return "checking";
    if (summary.verify?.state === "repairing") return "working";
  }
```

In the `if (summary.status === "ended") { … }` block, replace `return "done";` with `return settled(summary);`.

In the `case "ready": case "idle":` branch, replace `return stalled(view) ? "failed" : "done";` with:

```ts
      return stalled(view) ? "failed" : settled(summary);
```

In `buildBrief`, add one line to **both** `<finish>` blocks, directly before the `"</finish>"` entry:

```ts
      "After your last message the PC checks the build itself — its packages, typecheck, tests, the build, and every page opened in a browser — and sends back anything that fails. A message that starts <checks_failed> is that, not a new request.",
```

- [ ] **Step 5: Client Review's two files**

In `src/lib/client-review/liveBuild.ts`, in `finishOf`, replace `if (phase !== "done") return { kind: "running" };` with:

```ts
  if (phase === "unverified") {
    return { kind: "failed", why: "It was built, but the checks are failing. Open the build to see which." };
  }
  // `unfinished` falls through: its last words are read below, exactly as a
  // build that stopped without a preview always was.
  if (phase !== "done" && phase !== "unfinished") return { kind: "running" };
```

In `src/lib/client-review/autoBuild.ts`, in the `<how_to_finish_here>` array, add after the `"If a link does not exist, write `Preview: none` …"` line:

```ts
      "After your last message the PC checks the work itself — typecheck, the related tests, and the app opened in a browser — and sends back anything that fails. A message that starts <checks_failed> is that, not a new request.",
```

In the same file's `harness/start` call (the object that ends `durable: true, brief: harnessBrief(bucket),`), add after the `brief` line, so the check opens the edited app's own page and not only the hub's home:

```ts
      verifyPaths: bucket.edit?.appPath ? [bucket.edit.appPath] : [],
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run src/lib/app-builder src/lib/client-review`
Expected: PASS. If a snapshot or string test of the client-edit prompt fails only because of the added sentence, update that expectation to include it.

- [ ] **Step 7: Find every other place the phases are listed**

Run: `npx tsc --noEmit`
Expected: errors in exactly `src/components/app-builder/BuildStatus.tsx` (`TONE`) and `src/components/app-builder/MoveIntoHub.tsx` (`MOVE_LABEL`) — both are `Record<BuildPhase, …>` missing the three new keys. Task 8 fixes them; do not commit a red typecheck, so go straight on.

---

### Task 8: The checks panel

**Files:**
- Modify: `src/lib/app-builder/useBuild.ts`
- Modify: `src/components/app-builder/BuildStatus.tsx`, `MoveIntoHub.tsx`, `Blueprint.tsx:165`, `AppBuilder.tsx:203,373`
- Modify: `src/components/app-builder/app-builder.css`

**Before writing UI:** the repo rule is that a design skill drives any UI change. Invoke `interactive-web-studio` and close with `impeccable` (mode: Operate), and say which is driving. The code below is the structure and the behaviour, in the panel's existing vocabulary (`ab-bgate`, `ab-brow`, `ab-ghost`, `ab-primary-sm`); the skills may refine spacing and type, not remove a state or a button.

- [ ] **Step 1: The hook**

In `src/lib/app-builder/useBuild.ts`, add to the `UseBuild` interface after `stop: () => Promise<void>;`:

```ts
  /** Run the PC's checks again, once, without sending anything to the agent. */
  checkAgain: () => Promise<void>;
  /** The owner's call: call it built although the checks are failing. */
  useAnyway: () => Promise<void>;
  /** The latest report and its two pictures; null until one exists. */
  loadReport: () => Promise<VerifyReport | null>;
```

Add above the interface:

```ts
export interface VerifyReport {
  report: {
    ms: number;
    passed: boolean;
    steps: { id: string; label: string; ok: boolean; skipped: boolean; advisory: boolean; ms: number; ran: string; tail: string }[];
    advice: string[];
    failures: { step: string; page: string; title: string; ran: string; evidence: string }[];
  } | null;
  shots: { desktop?: string; phone?: string };
}
```

Add three callbacks beside `stop` (same shape as `say`):

```ts
  const checkAgain = useCallback(async () => {
    if (!threadId) return;
    try {
      await call("harness/verify", { id: threadId });
      await pull();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [threadId, pull]);

  const useAnyway = useCallback(async () => {
    if (!threadId) return;
    try {
      await call("harness/verify/accept", { id: threadId });
      await pull();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [threadId, pull]);

  const loadReport = useCallback(async () => {
    if (!threadId) return null;
    try {
      return await call<VerifyReport>("harness/verify/report", { id: threadId });
    } catch {
      // The PC is off or the thread is gone: the panel shows the summary it already has.
      return null;
    }
  }, [threadId]);
```

and return them: add `checkAgain, useAnyway, loadReport,` after `stop,` in the returned object.

- [ ] **Step 2: `BuildStatus.tsx` — tones and sentences**

Change the import on line 23 to also bring in `phaseLabel`:

```ts
import { latestWord, PHASE_LABEL, phaseLabel, projectSlug, stalled, stalledWhy, tally as toolTally, type BuildPhase } from "@/lib/app-builder/build";
import type { VerifyReport } from "@/lib/app-builder/useBuild";
```

Add three entries to `TONE` after `asking: "ask",`:

```ts
  checking: "work",
  unverified: "ask",
  unfinished: "ask",
```

Add three cases to `sub()` before `case "done":`:

```ts
    case "checking":
      return "Your PC is checking it itself: typecheck, its tests, the build, then every page in a hidden browser.";
    case "unverified":
      return build.summary?.verify?.why || "The checks below are failing.";
    case "unfinished":
      return "Claude stopped without saying it had finished. Its last words are below.";
```

Replace the header's `<h3>{PHASE_LABEL[phase]}</h3>` with:

```tsx
          <h3>{phaseLabel(phase, build.summary)}</h3>
```

(If `PHASE_LABEL` is now unused in this file, drop it from the import.)

- [ ] **Step 3: `BuildStatus.tsx` — the panel**

Inside the component, after `const logEnd = useRef<HTMLDivElement>(null);`, add:

```tsx
  const [report, setReport] = useState<VerifyReport | null>(null);
  const verify = build.summary?.verify ?? null;
  const loadReport = build.loadReport;
  // One fetch per finished check: the pictures are too big to ride every poll.
  useEffect(() => {
    if (!verify || verify.state === "checking" || !verify.report) return;
    let live = true;
    void loadReport().then((r) => {
      if (live) setReport(r);
    });
    return () => {
      live = false;
    };
  }, [verify?.state, verify?.run, verify?.report, loadReport]);
```

Directly after the gate block (`{gate && ( … )}`), add:

```tsx
      {/* What the PC's own check found. */}
      {verify && (verify.state === "failed" || verify.state === "passed" || verify.state === "accepted") && (
        <div className={`ab-bchecks is-${verify.state}`}>
          <p className="ab-bchecks-head">
            {verify.state === "passed"
              ? `Checked on your PC — ${report?.report?.steps.filter((s) => !s.skipped).length ?? "all"} checks passed`
              : verify.state === "accepted"
                ? "You chose to use it with these checks failing"
                : `${verify.failures.length} check${verify.failures.length === 1 ? "" : "s"} failing`}
          </p>
          {verify.failures.length > 0 && (
            <ol className="ab-bchecks-rows">
              {(report?.report?.failures ?? verify.failures).map((f, i) => (
                <li key={`${f.step}-${i}`}>
                  <span className="ab-blog-kind">{f.step}</span>
                  <div className="ab-bchecks-what">
                    {f.title}
                    {"evidence" in f && f.evidence ? <pre className="ab-bgate-what">{f.evidence.slice(-600)}</pre> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {(report?.shots.desktop || report?.shots.phone) && (
            <div className="ab-bchecks-shots">
              {report?.shots.desktop && <img src={report.shots.desktop} alt="The home page as the check saw it on a laptop" />}
              {report?.shots.phone && <img src={report.shots.phone} alt="The home page as the check saw it on a phone" />}
            </div>
          )}
          {verify.state === "failed" && (
            <div className="ab-brow">
              <button className="ab-primary-sm" disabled={!bridge.paired} onClick={() => void build.checkAgain()}>
                Check again
              </button>
              <button className="ab-ghost" disabled={!bridge.paired} onClick={() => void build.useAnyway()}>
                Use it anyway
              </button>
            </div>
          )}
        </div>
      )}
```

Change the "is built" block so it never claims that over a failing check — replace its opening condition

```tsx
      {(links.repo || links.url || built?.repo || built?.url) && (
```

with:

```tsx
      {phase !== "unverified" && phase !== "checking" && (links.repo || links.url || built?.repo || built?.url) && (
```

Change the "Build it again" condition (line 277) to include the two new stopped states:

```tsx
        {(phase === "done" || phase === "failed" || phase === "stopped" || phase === "lost" || phase === "unverified" || phase === "unfinished") && (
```

and the Stop condition two lines below it to include `checking`:

```tsx
        {(phase === "working" || phase === "asking" || phase === "starting" || phase === "checking") &&
```

- [ ] **Step 4: The other three files**

`src/components/app-builder/MoveIntoHub.tsx` — add to `MOVE_LABEL` after `asking`:

```ts
  checking: "Checking it works",
  unverified: "Moved, but the checks are failing",
  unfinished: "Stopped before it finished",
```

`src/components/app-builder/Blueprint.tsx:165` — a check is still in flight:

```ts
  const inFlight = started && (build.phase === "starting" || build.phase === "working" || build.phase === "asking" || build.phase === "checking");
```

`src/components/app-builder/AppBuilder.tsx` — at lines 203 and 373 replace `PHASE_LABEL[build.phase]` with `phaseLabel(build.phase, build.summary)` (keeping `.toLowerCase()` on line 373), and change the import on line 32 to:

```ts
import { isNewBuild, phaseLabel } from "@/lib/app-builder/build";
```

- [ ] **Step 5: The styles**

In `src/components/app-builder/app-builder.css`, add after the `.ab-bgate-what { … }` rule (line 418):

```css
.ab-bchecks { border: 1px solid var(--ab-line-soft); border-radius: 11px; padding: 11px 12px; display: grid; gap: 9px; }
.ab-bchecks.is-failed { border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.07); }
.ab-bchecks.is-passed { border-color: rgba(34, 197, 94, 0.4); background: rgba(34, 197, 94, 0.06); }
.ab-bchecks-head { margin: 0; font-size: 13px; font-weight: 600; }
.ab-bchecks-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
.ab-bchecks-rows li { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px; align-items: start; font-size: 12px; }
.ab-bchecks-what { display: grid; gap: 5px; min-width: 0; overflow-wrap: anywhere; }
.ab-bchecks-shots { display: flex; gap: 8px; align-items: flex-start; overflow-x: auto; }
.ab-bchecks-shots img { height: 150px; width: auto; border-radius: 8px; border: 1px solid var(--ab-line-soft); flex: none; }
@media (max-width: 480px) {
  .ab-bchecks-rows li { grid-template-columns: minmax(0, 1fr); }
  .ab-bchecks-shots img { height: 110px; }
}
```

- [ ] **Step 6: Typecheck, tests, and look at it**

Run: `npx tsc --noEmit && npx vitest run src/lib/app-builder src/lib/client-review`
Expected: no type errors; PASS.

Then look at it: start the preview with `node scripts/dev-preview.mjs 3345 --no-auth`, open `/apps/app-builder` at 390 px and at desktop width, and confirm the build panel still renders for a project with no build (the new block is absent) and that nothing scrolls sideways. The failing-checks state is seen for real in Task 10.

- [ ] **Step 7: Commit (Tasks 7 and 8 together, so the typecheck is never red on a commit)**

```bash
git add src/lib/new-jarvis/harness/types.ts src/lib/app-builder src/lib/client-review/liveBuild.ts src/lib/client-review/autoBuild.ts src/components/app-builder
git commit -m "App Builder: Built only after your PC has checked it, with the failing checks on screen"
```

---

### Task 9: An unattended run is checked before it ships

**Files:**
- Modify: `tools/jarvis-bridge/agents-wake.mjs` (new `verifyBeforeShip`, one call before landing, one parameter on `outcomeFor`)
- Test: `tools/jarvis-bridge/agents-wake.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tools/jarvis-bridge/agents-wake.test.mjs` (add `verifyBeforeShip` to the import from `./agents-wake.mjs`):

```js
describe("an unattended run is checked before it may ship itself", () => {
  const steps = (states) => {
    const calls = [];
    const call = async (route) => {
      calls.push(route);
      if (route === "/harness/verify") return { ok: true };
      return { session: { verify: states.shift() ?? { state: "passed", failures: [] } } };
    };
    return { call, calls };
  };
  const quick = { sleep: async () => {}, pollMs: 1 };

  it("waits for the check and reports a pass", async () => {
    const { call, calls } = steps([{ state: "checking" }, { state: "checking" }, { state: "passed", failures: [] }]);
    expect(await verifyBeforeShip({ call, thread: "t", ...quick })).toEqual({ passed: true, why: "" });
    expect(calls[0]).toBe("/harness/verify");
  });

  it("reports what failed", async () => {
    const { call } = steps([{ state: "failed", failures: [{ title: "Typecheck failed" }, { title: "A page threw an error: /x" }] }]);
    const r = await verifyBeforeShip({ call, thread: "t", ...quick });
    expect(r.passed).toBe(false);
    expect(r.why).toBe("Typecheck failed; A page threw an error: /x");
  });

  it("does not ship when the helper will not answer", async () => {
    const r = await verifyBeforeShip({ call: async () => { throw new Error("offline"); }, thread: "t", ...quick });
    expect(r.passed).toBe(false);
  });

  it("gives up waiting rather than waiting forever", async () => {
    const call = async (route) => (route === "/harness/verify" ? { ok: true } : { session: { verify: { state: "checking" } } });
    let t = 0;
    const r = await verifyBeforeShip({ call, thread: "t", ...quick, now: () => (t += 10 * 60_000), maxMs: 30 * 60_000 });
    expect(r).toEqual({ passed: false, why: "the checks did not finish in time" });
  });

  it("says why work that would have shipped is waiting for review instead", () => {
    const land = { committed: true, merged: false, why: "Committed 2 files on its branch." };
    const out = outcomeFor({ files: [{ file: "a" }, { file: "b" }], ship: "review", land, checks: "Typecheck failed" });
    expect(out.outcome).toBe("ready");
    expect(out.why).toBe("The checks failed (Typecheck failed), so it was not shipped. Committed 2 files on its branch.");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tools/jarvis-bridge/agents-wake.test.mjs`
Expected: FAIL — `verifyBeforeShip` is not exported.

- [ ] **Step 3: `verifyBeforeShip` and the `checks` reason**

In `tools/jarvis-bridge/agents-wake.mjs`, add directly above the `/** What a finished harness run amounts to, for `agent_ran`. */` comment:

```js
/**
 * Ask the bridge to check a thread's work, and wait for the verdict.
 *
 * Only before `SHIP: auto`: that is the one path where work lands and is
 * pushed with nobody looking. It asks once and reads the answer from the
 * thread's summary, the way everything else here polls rather than holds a
 * request open across a sleeping laptop. Anything but a clear pass is "no".
 */
export async function verifyBeforeShip({
  call,
  thread,
  pollMs = POLL_MS,
  maxMs = 30 * 60_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
}) {
  try {
    await call("/harness/verify", { id: thread });
  } catch (e) {
    return { passed: false, why: `the checks could not be started (${String(e?.message || e)})` };
  }
  const started = now();
  while (now() - started <= maxMs) {
    let v = null;
    try {
      v = (await call("/harness/status", { id: thread })).session?.verify ?? null;
    } catch {
      /* one missed poll is not a verdict */
    }
    if (v && v.state !== "checking") {
      if (v.state === "passed") return { passed: true, why: "" };
      const titles = (v.failures || []).map((f) => f.title).filter(Boolean);
      return { passed: false, why: titles.join("; ") || v.why || "the checks failed" };
    }
    await sleep(pollMs);
  }
  return { passed: false, why: "the checks did not finish in time" };
}
```

Change `outcomeFor`'s signature to take `checks = ""`:

```js
export function outcomeFor({ files = [], ship = "review", land = null, pushed = false, pushWhy = "", landError = "", timedOut = false, runError = "", checks = "" } = {}) {
```

and replace its `const partial = …;` statement with:

```js
  const partial = timedOut
    ? "It ran out of time, so this is partial work. "
    : runError
      ? `It stopped on an error (${runError}), so this may be partial. `
      : checks
        ? `The checks failed (${checks}), so it was not shipped. `
        : "";
```

- [ ] **Step 4: Call it before landing**

In the function that runs a harness agent, add `let checks = "";` beside `let ship = settings.ship;`. Then, inside `if (files.length && !landError) {`, directly after the line `if (ship === "auto" && agentStatusIn(await hub("agent_list", {}), id) === "blocked") ship = "review";`, add:

```js
    // The last reason auto becomes review: the bridge's own check of the work.
    // Only asked when everything else would have let it ship, and not at all
    // while the gate is switched off (out/verify-off, beside this file).
    if (ship === "auto" && !existsSync(VERIFY_OFF)) {
      const verdict = await verifyBeforeShip({ call, thread, pollMs, sleep, now });
      if (!verdict.passed) {
        ship = "review";
        checks = verdict.why;
        say(`${id} will wait for review: ${checks}`);
      }
    }
```

`VERIFY_OFF` is a new constant near the top of the file, beside its other path constants — use the file's existing "this folder" constant if it has one, otherwise `path.dirname(fileURLToPath(import.meta.url))`, and import `existsSync` from `node:fs` if it is not already imported:

```js
/** The verify gate's off switch, shared with the bridge (harness.mjs `gateOff`). */
const VERIFY_OFF = path.join(HERE, "out", "verify-off");
```

and pass it on: change the `outcomeFor({ … })` call at the end of that function to include `checks`:

```js
  const result = outcomeFor({ files, ship, land, pushed, pushWhy, landError, timedOut: waited.timedOut, runError, checks });
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tools/jarvis-bridge/agents-wake.test.mjs && node --check tools/jarvis-bridge/agents-wake.mjs`
Expected: PASS — the five new tests and every existing one; no output from `node --check`.

- [ ] **Step 6: Commit**

```bash
git add tools/jarvis-bridge/agents-wake.mjs tools/jarvis-bridge/agents-wake.test.mjs
git commit -m "Jarvis harness: a 24/7 agent's work is checked before it ships itself"
```

---

### Task 10: Document it, restart the bridge, watch one real build

**Files:**
- Modify: `tools/jarvis-bridge/README.md` (new section after "Landing refuses rather than guesses")
- Modify: `docs/superpowers/specs/harness-verify-gate.md` (status line; fill in "What is not known yet" with what was measured)
- Modify: the `jarvis-harness` skill, saved with the `jarvis-memory` connector's `save_skill`

- [ ] **Step 1: The README section**

In `tools/jarvis-bridge/README.md`, add after the "Landing refuses rather than guesses" section:

```markdown
#### A build is checked before it is called built

A durable build (App Builder, a Client Review edit) used to be finished when
the agent printed its `Repo:`/`Live:` lines. Now that line is a claim. When a
turn ends on it, the bridge checks the folder itself — `harness-verify.mjs`
decides what, `harness-verify-run.mjs` does it:

install (a project folder only, never a worktree: its `node_modules` is the
junction above) → typecheck → lint (advice, never a failure) → its own tests →
build → start it on a free port → open up to 25 of its own pages in a hidden
browser, plus the home page at 390 px → open the `Live:` address.

Everything the gate starts gets `scrubEnv()`'s environment, not the bridge's:
the bridge holds every key on this PC and a generated app must not. A worktree
of the hub still reads the `.env.local` that was copied into it, as every
preview always has.

A failure goes back to the agent as one `<checks_failed>` message
(`harness-verify-loop.mjs`), at most three times, and it stops early when the
same checks fail twice running. Then the job is `unverified`, the page says
"Built, but the checks are failing", and the owner has **Check again** and
**Use it anyway**. A thread that may not run commands unasked gets one card,
"Run the checks on this build", instead of the checks running behind its back.

The crawl only navigates. It never clicks, types or submits, and it never uses
the signed-in profile in `out/browser-profile`.

Reports and two screenshots are in `out/verify/<thread>/<run>/`. The 24/7
runner asks for one check (`POST /harness/verify`) before a `SHIP: auto` run
lands; anything but a pass turns auto into review.

| What you see | What it means |
|---|---|
| "Open every page" skipped, "the hidden browser could not start" | Chromium is not installed here: `npx playwright install chromium` in this folder. The build is not failed for it. |
| "There was nothing to check" | The folder has no `package.json` scripts and no `index.html`. |
| A build sits on "Checking it works" | Another build is being checked; one runs at a time. |
| Builds are "Built" without being checked | The gate is off: a file named `verify-off` is in `out/`. Delete it; the next build is checked. |

**Switching it off.** Put a file named `verify-off` in `out/` (any contents).
New durable builds are then finished on their own word, as before, and the
24/7 runner ships without asking for a check. **Check again** still works.
```

- [ ] **Step 2: Switch the gate on and restart the bridge**

Both steps need the owner's go-ahead: this is the moment real builds start being checked. Delete the off switch, `tools/jarvis-bridge/out/verify-off`, then stop the running helper by the port it holds and start it visibly so the log can be read:

```powershell
Get-NetTCPConnection -LocalPort 42020 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

```cmd
tools\jarvis-bridge\start.cmd
```

Expected: the window prints that it is listening on 42020 and, if any build was running, that it resumed it. **Ask the owner before doing this if a build is in flight** — `POST /harness/threads` lists them.

- [ ] **Step 3: One real build on each harness (spec acceptance 8)**

In `/apps/app-builder`, build a small throwaway app (a one-page tip calculator at plain depth) with Claude, then again with DeepSeek selected. For each, confirm and write down:

- the panel shows "Checking it works" after the agent's finish lines
- `tools/jarvis-bridge/out/verify/<thread id>/1/report.json` exists, with `home-1280.jpg` and `home-390.jpg`
- the `ms` of every step in that report

Then break one on purpose: in the Claude build's folder, add `<script>throw new Error("on purpose")</script>` to the home page, press **Check again**, and confirm the panel shows "Built, but the checks are failing" naming that page, with **Use it anyway** working.

- [ ] **Step 4: Check the one assumption the plan could not**

In any hub worktree under `~/.jarvis-harness/worktrees`, edit one `*.test.ts` file without committing, then run:

```bash
node node_modules/vitest/vitest.mjs run --changed main
```

Expected: that test file runs. If it does not (vitest compares commits only when given a ref), change `planChecks` so the hub's test step is `["node_modules/vitest/vitest.mjs", "run", "--changed"]` with no ref, update the matching expectation in `harness-verify.test.mjs`, and re-run that test file.

- [ ] **Step 5: Write down what was measured**

In `docs/superpowers/specs/harness-verify-gate.md`: set the status line to `**Status:** built 2026-11-<day>`, and replace the three bullets under "What is not known yet" with the real per-step timings from Step 3, whether `tsc --noEmit` on a hub worktree was quick enough to keep, and whether `console.error` produced any false failure on the two real builds.

- [ ] **Step 6: Update the skill, log it, commit**

Add a section "The verify gate" to the `jarvis-harness` skill (the README section above, shortened to the rules a session must respect: a finish line is a claim; never run `npm install` in a worktree; the crawl only navigates; `POST /harness/verify` for a one-off check) and save the complete SKILL.md with `save_skill`. Then:

```bash
npm run timeline:log
git add tools/jarvis-bridge/README.md docs/superpowers/specs/harness-verify-gate.md docs/superpowers/plans/harness-verify-gate.md src/lib/timeline/feature-log.json
git commit -m "Jarvis harness: how the verify gate works, and what the first real builds measured"
```

Finally `add_finding` on `jarvis-harness` with the measured timings, and `log_activity` one line.

---

## Self-review (done while writing this plan)

**Spec coverage**

| Spec section | Task |
|---|---|
| What the gate runs (steps table, hub vs project) | 1 (`planChecks`), 2 (`runStep`, `startApp`) |
| The crawl rules, two screenshots | 1 (`judgeResponse`, `crawlLinks`), 3 (`crawl`) |
| `live` step | 1 (`finishLinks`), 3 (`checkLive`) |
| Scrubbed environment | 1 (`scrubEnv`), 2 and 3 (tests) |
| Never installs in a hub worktree | 1 (test "never installs or builds in a hub worktree") |
| Permission card on strict/ask threads | 5 (`runsUnasked`, test) |
| The loop, three rounds, early stop | 1 (`afterRun`), 5 |
| Restart mid-check | 1 (`resumeAction`), 4 (test), 6 (Step 5) |
| Report file and event kinds | 3 (`runGate`), 5 (`verify_start`/`verify_step`/`verify_end`) |
| `summary.verify`, phases, labels | 5 (`verifyView`), 6, 7 |
| Check again / Use it anyway / report route | 5, 6, 8 |
| Agent told the check is coming | 7 (Steps 4–5) |
| Unattended agents | 9 |
| Acceptance 1–9 | 1: Task 3 `build-fails` (see note); 2–5: Task 3; 6: Task 5; 7: Tasks 4 and 6; 8: Task 10; 9: Task 1 |

**Where the plan departs from the spec, on purpose** — the spec has been edited to match each:

1. The page folds no new event kinds. `summary.verify` rides every poll already, so `model.ts` is untouched; the three `verify_*` events exist for the transcript and the job record only.
2. Unattended threads are not checked automatically on every turn. The runner asks for exactly one check, with no repair rounds, and only before `SHIP: auto`.
3. The failing fixture is `build-fails`, not `type-error`: a real `tsc` run needs TypeScript installed in the fixture, and the fixtures are deliberately package-free. The typecheck step itself is covered by `planChecks` tests and by the real build in Task 10.
4. `install` runs when `node_modules` is missing, not also when it is older than the lockfile.
5. Typecheck and the hub's tests call `node_modules/typescript/bin/tsc` and `node_modules/vitest/vitest.mjs` directly rather than through `npx`, so nothing can be downloaded and no shell is involved.
6. A worktree's crawl follows no links: it opens the home page and the `verifyPaths` it was started with. Following the hub's home page would open forty unrelated apps and fail an edit for an error that was already there.

**Known limits carried into the build**

- A Client Review edit's prompt (`autoBuild.ts`) tells the agent to merge its own pull request before it prints `PR:`/`Preview:`. So for client edits the gate runs after the merge: it stops the preview being published to the client, not the merge. Changing that order is a decision for the owner, not part of this plan.
- A hub worktree's preview still reads the `.env.local` copied into the worktree. The scrubbed environment protects new projects completely and worktrees only from the bridge's own process environment.

**Type consistency** — `verify` is `{ state, run, rounds, failures, lastIds, report, why }` on the job (Task 4), on the session (Tasks 5–6) and, trimmed by `verifyView`, `{ state, run, rounds, max, why, failures: [{step,title,page}], report }` on the page (Task 7's `VerifySummary`). A failure is `{ id, step, page, title, ran, evidence }` everywhere it is produced (Task 3) and read (Tasks 1, 5, 8). A step row is `{ id, label, ok, advisory, skipped, ms, ran, tail }` (Tasks 2–3, read by Task 8's `VerifyReport`).
