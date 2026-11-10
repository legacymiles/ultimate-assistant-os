#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The wake runner: 24/7 agents carry on the moment this machine can.
//
// The hub stores a goal; it never pushes. This is the other half — the thing
// on the owner's PC that notices it has power and asks "is there anything I
// can do?". It starts at sign-in from its own Startup shortcut, so it works
// with the browser shut and Jarvis never opened, and it notices a laptop lid
// opening because a timer that should have fired three minutes ago fired
// three hours late instead.
//
//   node agents-wake.mjs              run forever (what the shortcut runs)
//   node agents-wake.mjs --once       one cycle, then exit
//   node agents-wake.mjs --dry-run    say what it would do, start nothing
//   node agents-wake.mjs --install    put it in Startup and exit
//   node agents-wake.mjs --off        stop it starting at sign-in
//
// Its own process, not a verb on server.mjs, for the reason the picture
// drawer is its own service: a render that wedges must not be able to take
// the harness down with it, and the two have completely different lifetimes.
//
// WHAT KEEPS THIS SAFE: nobody is watching, so the session runs under
// agents-unattended.mjs, which allows or blocks and never asks. An agent that
// needs something off that list marks itself blocked and waits for a human.
//
// TWO WAYS A RUN HAPPENS, chosen from the brief (runSettingsFrom):
//
//   In this process — a render, a search, anything that only makes files.
//   The agent writes into out/agents/<id> and never near the owner's code.
//
//   Through the harness — an agent allowed to change the owner's apps, or one
//   powered by DeepSeek (which only exists as a harness). The bridge cuts a
//   git worktree, the run happens there in a thread the owner can read in the
//   Harness console, and this runner commits it afterwards: onto its branch
//   for review, or landed and pushed when the owner said SHIP: auto. Changing
//   the owner's apps from here directly would put an unwatched model in the
//   checkout they have open, which is the one thing a worktree exists to stop.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeFound, detect } from "./agents-capabilities.mjs";
import { decide, denial } from "./agents-unattended.mjs";
import { describePick, resolvePick } from "./harness-models.mjs";
import { loadIntoEnv, shareKeys } from "./keys.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const WORK = path.join(HERE, "out", "agents");
/** Where the bridge keeps its pairing token and the 24/7 agents secret. */
const BRIDGE_OUT = path.join(HERE, "out");
const BRIDGE = `http://127.0.0.1:${process.env.JARVIS_BRIDGE_PORT || 42020}`;

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const value = (f, fallback) => {
  const i = args.indexOf(`--${f}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** How often to ask the hub. Cheap: no model runs, it is one small request. */
const TICK_MS = Number(value("tick", process.env.AGENTS_TICK_MS || 3 * 60 * 1000));
/** The heartbeat that spots a laptop waking from sleep. */
const BEAT_MS = 20_000;
/** A gap this much bigger than a beat means the machine was asleep. */
const SLEPT_MS = 2 * 60 * 1000;
/** Stop a single agent run from going forever. */
const RUN_MS = Number(value("max-run", process.env.AGENTS_MAX_RUN_MS || 45 * 60 * 1000));
/** How often a harness run is looked at. A thread is read, not streamed. */
const POLL_MS = 5_000;
/** A ceiling so a confused agent cannot spin all night. */
const MAX_RUNS_PER_HOUR = Number(process.env.AGENTS_MAX_RUNS_PER_HOUR || 8);

const DRY = has("dry-run");

const log = (...parts) => console.log(`[agents] ${new Date().toISOString()} ${parts.join(" ")}`);

// --- who we are talking to -------------------------------------------------

/**
 * The hub and the token this machine already has.
 *
 * Exactly where scripts/skill-sync.mjs looks, and for the same reason: anyone
 * who set up "Same memory everywhere" already pasted this into Claude Code,
 * and a second place to keep the same secret is a second place to leak it.
 */
export function findConnector(files) {
  const candidates = files || [
    path.join(homedir(), ".claude.json"),
    process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : "",
    path.join(REPO, ".mcp.json"),
  ];
  let found = null;
  const walk = (node) => {
    if (!node || typeof node !== "object" || found) return;
    if (typeof node.url === "string" && /\/api\/jarvis\/memory\//.test(node.url)) {
      const auth = node.headers && (node.headers.Authorization || node.headers.authorization);
      let token = typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "").trim() : "";
      if (!token) {
        try {
          token = new URL(node.url).searchParams.get("k") || "";
        } catch {
          token = "";
        }
      }
      if (token) {
        try {
          found = { token, hub: new URL(node.url).origin };
          return;
        } catch {
          /* a url we cannot parse is not a connector */
        }
      }
    }
    for (const v of Object.values(node)) walk(v);
  };
  for (const file of candidates) {
    if (!file || !existsSync(file)) continue;
    try {
      walk(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      /* a config we cannot read is not a reason to stop */
    }
    if (found) break;
  }
  return found;
}

/** One connector tool call. Returns its text, or "" — never throws. */
async function callTool(conn, name, args_, timeout = 30_000) {
  try {
    const res = await fetch(`${conn.hub}/api/jarvis/memory/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${conn.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args_ } }),
      signal: AbortSignal.timeout(timeout),
    });
    const json = await res.json().catch(() => null);
    const text = json?.result?.content?.[0]?.text;
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

/**
 * The agent id out of a brief, or "".
 *
 * briefFor() opens with "You have picked up 24/7 agent a-xxxxx." and the
 * "nothing waiting" answer has no id in it at all, so one regex tells the two
 * apart without parsing a list.
 */
export function agentIdFrom(text) {
  const m = /picked up 24\/7 agent\s+(a-[a-z0-9]+)/i.exec(String(text || ""));
  return m ? m[1] : "";
}

/**
 * The top of a brief: the GOAL line down to the first blank line.
 *
 * The machine-readable lines live here and nowhere else. Below the first blank
 * line come the last machine's handoff note and the steps — text a MODEL
 * wrote — and a note that happened to say "SHIP: auto" must not be able to
 * turn a review-only agent into one that pushes to the live site.
 */
function headerOf(text) {
  const all = String(text || "").replace(/\r\n?/g, "\n");
  const goal = all.search(/^GOAL:/m);
  const from = goal >= 0 ? all.slice(goal) : all;
  const gap = from.search(/\n[ \t]*\n/);
  return gap >= 0 ? from.slice(0, gap) : from;
}

/** One `KEY: value` line from the header, or "". */
function headerLine(header, key) {
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(header);
  return m ? m[1].trim() : "";
}

/**
 * How the owner asked this agent to run, read off its brief.
 *
 *   POWERED BY: <pick>          which Claude, or DeepSeek ("default" = "")
 *   EDITS APPS: slug, slug      the apps it may change (absent = none)
 *   SHIP: review | auto         only means anything with EDITS APPS
 *
 * The words are written by briefFor() in src/lib/new-jarvis/agents/describe.ts;
 * change them there and here together. Anything unreadable falls to the
 * careful side: no apps, and review rather than auto.
 */
export function runSettingsFrom(briefText) {
  const header = headerOf(briefText);
  const powered = headerLine(header, "POWERED BY");
  const pick = !powered || powered.toLowerCase() === "default" ? "" : powered;
  const edits = headerLine(header, "EDITS APPS")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(s));
  // Auto only when the line says exactly that AND there are apps to ship.
  const ship = edits.length && headerLine(header, "SHIP").toLowerCase() === "auto" ? "auto" : "review";
  return { pick, edits, ship };
}

/**
 * This agent's status in an `agent_list` answer ("running", "blocked", …), or "".
 *
 * The list names every agent that is not done — waiting, blocked and paused
 * ones too — so "is its id in there" is not the question. Only "running"
 * means this machine still holds it. Reading the id alone handed a blocked
 * agent straight back to waiting, which undid the very block that was meant
 * to stop it until the owner looked.
 */
export function agentStatusIn(listText, id) {
  // Agent ids are `a-` and letters/digits; anything else is not one, and
  // refusing it here means nothing needs escaping in the pattern below.
  if (!/^[\w-]+$/.test(String(id || ""))) return "";
  const m = new RegExp(`^-\\s+${id}\\s+·\\s+(\\w+)`, "m").exec(String(listText || ""));
  return m ? m[1].toLowerCase() : "";
}

/** The goal, for a thread title and a commit message. */
export function goalFrom(briefText) {
  return headerLine(headerOf(briefText), "GOAL");
}

// --- running one -----------------------------------------------------------

function promptFor(brief, workDir) {
  return [
    brief,
    "",
    "--- how this run works ---",
    `You are running UNATTENDED on the owner's PC. Nobody is awake to approve anything.`,
    `Write any files you produce into: ${workDir}`,
    `You may read anywhere and run render tools (node, python, ffmpeg, Blender, Unreal, curl to this machine).`,
    `You may NOT commit, push, install software, delete anything, or edit the owner's checkout.`,
    `If the goal needs one of those, call agent_note with blocked: true saying exactly what you need, then stop.`,
    `On a long job, call agent_note every ten minutes or so — silence for twenty minutes looks like a dead machine and another machine may take over.`,
    `Before you finish, for ANY reason, call agent_handoff with where you got to. If the goal is genuinely met, call agent_done instead.`,
  ].join("\n");
}

async function runAgent(conn, id, brief, caps, settings = { pick: "" }) {
  const workDir = path.join(WORK, id);
  mkdirSync(workDir, { recursive: true });

  // The owner's "Powered by" pick, turned into a model and a login by the one
  // file that does that for every surface, so this run and the harness cannot
  // disagree about what "Opus 5.5 · API" means. A pick that cannot run here
  // (no OpenRouter key, say) is a sentence for the handoff, not a crash.
  let resolved;
  try {
    resolved = resolvePick(settings.pick);
  } catch (e) {
    return { ok: false, why: String(e?.message || e) };
  }
  log(`${id} runs on ${describePick(settings.pick)}`);

  let query;
  try {
    ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch {
    return { ok: false, why: "the Claude Agent SDK isn't installed on this PC" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUN_MS);
  let blocked = 0;
  let finished = false;

  try {
    const run = query({
      prompt: promptFor(brief, workDir),
      options: {
        cwd: REPO,
        permissionMode: "default",
        abortController: controller,
        ...(resolved.model ? { model: resolved.model } : {}),
        // Spread over process.env, because `env` REPLACES the child's
        // environment rather than adding to it: without PATH it cannot find
        // node. Only set at all for the OpenRouter route.
        ...(Object.keys(resolved.env).length ? { env: { ...process.env, ...resolved.env } } : {}),
        // Handed over explicitly rather than hoped for: without the connector
        // the agent cannot note progress or hand off, and would look to the
        // owner like a machine that took the work and vanished.
        mcpServers: {
          "jarvis-memory": {
            type: "http",
            url: `${conn.hub}/api/jarvis/memory/mcp`,
            headers: { Authorization: `Bearer ${conn.token}` },
          },
        },
        canUseTool: async (name, toolArgs) => {
          const d = decide(name, toolArgs, { roots: [workDir, path.join(HERE, "out")] });
          if (d.allow) return { behavior: "allow", updatedInput: toolArgs };
          blocked += 1;
          log(`blocked ${name}: ${d.why}`);
          return { behavior: "deny", message: denial(d.why) };
        },
      },
    });

    for await (const msg of run) {
      if (msg?.type === "result") finished = true;
    }
    return { ok: true, blocked, finished };
  } catch (e) {
    return { ok: false, why: e?.name === "AbortError" ? `it ran past ${Math.round(RUN_MS / 60000)} minutes` : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// --- running one through the harness ---------------------------------------
//
// Everything below talks to the bridge over HTTP rather than importing
// harness.mjs, because the thread has to live in the BRIDGE: that is the
// process the Harness console reads, so a thread started here in-process
// would be invisible to the owner and gone the moment this runner exits.

const BRIDGE_DOWN =
  "the PC helper (Jarvis bridge) isn't running, so app edits can't start — start it and this agent resumes";

/** A small file in the bridge's out folder, trimmed, or "". */
function readLocal(name) {
  try {
    return readFileSync(path.join(BRIDGE_OUT, name), "utf8").trim();
  } catch {
    return "";
  }
}

/** Does the bridge answer at all? /health needs no token. */
async function bridgeAnswers(base, fetchImpl) {
  try {
    const res = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(10_000) });
    const json = await res.json().catch(() => null);
    return Boolean(res.ok && json?.ok);
  } catch {
    return false;
  }
}

/**
 * One bridge route. Resolves the bridge's JSON, throws its own sentence.
 *
 * The bridge's error text is the whole value of a failure ("No OpenRouter key
 * on this PC…"), so it is what the thrown error carries, never a status code.
 */
export function bridgeClient({ base = BRIDGE, token, fetchImpl = fetch }) {
  return async (route, body = {}, timeout = 60_000) => {
    const res = await fetchImpl(`${base}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.ok === false) {
      throw new Error(String(json?.error || `the PC helper answered ${res.status} on ${route}`));
    }
    return json;
  };
}

/**
 * The run rules for a worktree, after the brief.
 *
 * Different from promptFor() on purpose: here writing the owner's code IS the
 * job, but only inside the worktree, and the commit belongs to this runner —
 * an agent that commits on its own leaves nothing for the review step to show.
 */
export function harnessPromptFor(brief, { edits = [], ship = "review", deepseek = false } = {}) {
  const apps = edits.join(", ");
  return [
    brief,
    "",
    "--- how this run works ---",
    "You are running UNATTENDED in the Jarvis harness on the owner's PC. Nobody is awake to approve anything; the owner reads this thread later in the Harness console.",
    "Your current folder is a git worktree of the owner's hub repo, on a branch made for this run. Write ONLY inside it — never in any other checkout or folder.",
    apps
      ? `You may change these apps: ${apps}. An app's page is src/app/apps/<slug>/, its UI is under src/components/, its logic and tests under src/lib/, and its record is docs/apps/<slug>.md — read that record first. Leave every other app alone.`
      : "This run has no apps to change. Keep anything you make inside this worktree.",
    "Do NOT commit, push, merge, switch branches or install packages (node_modules is shared with the owner's checkout). " +
      (ship === "auto"
        ? "When you finish, the runner commits your work, lands it and pushes it live — so only finish with work that builds and passes its tests."
        : "When you finish, the runner commits your work on this branch for the owner to review and land."),
    "Before you finish, run the typecheck and the tests that cover what you changed (for example `npx tsc --noEmit` and `npx vitest run <the folders you touched>`).",
    deepseek
      ? "You have no hub tools in this run, so you cannot call agent_note, agent_handoff, agent_done or agent_send. If the checks fail and you cannot fix them, say so plainly. End with a short summary of what you changed, which checks you ran, and what is left; the runner records the outcome."
      : [
          "If the checks fail and you cannot fix them, call agent_note with blocked: true saying what is failing, then stop — a blocked agent's work is kept for review and never pushed.",
          "Call agent_note when you finish a step, agent_send to hand results on if the brief says where, and before you stop for ANY other reason agent_handoff with where you got to — or agent_done if the goal is genuinely met.",
          "End with a short summary of what you changed and which checks you ran.",
        ].join("\n"),
  ].join("\n");
}

/**
 * The unattended policy, applied to a gate card the bridge parked.
 *
 * Only the DeepSeek harness ever parks one here — the Claude adapter asks
 * agents-unattended.mjs itself — and a parked gate on an unattended thread
 * would sit for twenty minutes and then refuse. So the runner answers it, by
 * the same rules, the moment it sees it. A card carries the tool's name (in
 * Claude's vocabulary) and its command or its path relative to the worktree,
 * which is everything decide() reads. Anything else it has never heard of is
 * blocked by decide() itself.
 */
export function gateVerdict(card, worktree) {
  const file = card?.path ? path.resolve(worktree, String(card.path)) : "";
  return decide(String(card?.name || ""), { command: String(card?.command || ""), file_path: file }, { roots: [worktree] });
}

/**
 * Fold a page of thread events into "has the one turn finished?".
 *
 * `turn_end` is the real signal. A status "idle" after the prompt went in
 * counts too, because DeepSeek's adapter reports a turn that threw as an error
 * and then idle with no turn_end. "ended" is the child being gone. "ready" is
 * NOT finished: Claude's init can arrive after the prompt has been taken.
 */
export function foldRun(state, events) {
  const next = { started: false, done: false, ended: false, error: "", ...state };
  for (const e of events || []) {
    if (e?.kind === "user") next.started = true;
    else if (e?.kind === "turn_end") {
      next.done = true;
      if (e.error) next.error = String(e.error);
    } else if (e?.kind === "error") {
      next.error = String(e.message ?? e.text ?? "") || next.error;
    } else if (e?.kind === "status") {
      if (e.status === "ended") {
        next.ended = true;
        next.done = true;
      } else if (e.status === "idle" && next.started) {
        next.done = true;
      }
    }
  }
  return next;
}

/**
 * Wait for a thread's turn to finish, answering any gate it parks.
 *
 * Polls /harness/events from a cursor, as the Harness console does, rather
 * than holding a stream open: this machine sleeps, and a poll survives that.
 * On the time limit the turn is interrupted, not the thread — the worktree and
 * whatever it wrote stay for the owner to look at.
 */
export async function waitForThread({
  call,
  thread,
  worktree,
  runMs = RUN_MS,
  pollMs = POLL_MS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  say = log,
}) {
  const started = now();
  let cursor = 0;
  let state = foldRun({}, []);
  let misses = 0;
  for (;;) {
    let page;
    try {
      page = await call("/harness/events", { id: thread, since: cursor });
      misses = 0;
    } catch (e) {
      const why = String(e?.message || e);
      // Gone for good (the bridge restarted and forgot it), or silent for half
      // a minute: either way nobody is coming back to this turn.
      if (/No such harness thread/i.test(why) || ++misses >= 6) return { ...state, finished: false, timedOut: false, lost: why };
      await sleep(pollMs);
      continue;
    }
    cursor = Number(page.cursor) || cursor;
    state = foldRun(state, page.events);

    const card = page.session?.gate;
    if (card?.gateId && !state.ended) {
      const v = gateVerdict(card, worktree);
      say(`${v.allow ? "allowed" : "blocked"} ${card.title || card.name}${v.allow ? "" : `: ${v.why}`}`);
      await call("/harness/decide", { id: thread, gateId: card.gateId, allow: v.allow }).catch(() => {});
      await sleep(Math.min(pollMs, 1_000));
      continue;
    }

    if (state.done && !page.session?.busy) return { ...state, finished: true, timedOut: false };

    if (now() - started > runMs) {
      await call("/harness/interrupt", { id: thread }).catch(() => {});
      // A moment for the last write in flight to land before anything is
      // committed on top of it.
      await sleep(Math.min(pollMs, 3_000));
      return { ...state, finished: false, timedOut: true };
    }
    await sleep(pollMs);
  }
}

/**
 * What a finished harness run amounts to, for `agent_ran`.
 *
 *   nothing  no files changed
 *   ready    committed on its branch, waiting for the owner to land it
 *   landed   merged into the base, but the push did not go
 *   pushed   merged and pushed
 *   failed   it could not run, or its work could not be committed
 *
 * `ship` here is what was actually attempted: the runner has already turned
 * auto into review for a run that timed out or that the agent itself flagged.
 * `land` is /harness/land's answer; `pushed` is whether `git push` worked.
 */
export function outcomeFor({ files = [], ship = "review", land = null, pushed = false, pushWhy = "", landError = "", timedOut = false, runError = "" } = {}) {
  const n = Array.isArray(files) ? files.length : 0;
  if (!n) {
    if (runError) return { outcome: "failed", why: runError };
    if (timedOut) return { outcome: "failed", why: `It ran past ${Math.round(RUN_MS / 60000)} minutes without changing anything.` };
    return { outcome: "nothing", why: "The run finished without changing any files." };
  }
  const changed = `${n} file${n === 1 ? "" : "s"}`;
  if (landError || !land) {
    return {
      outcome: "failed",
      why: `It changed ${changed}, but they couldn't be committed: ${landError || "the PC helper did not answer"}. The work is still in the thread's worktree.`,
    };
  }
  const partial = timedOut
    ? "It ran out of time, so this is partial work. "
    : runError
      ? `It stopped on an error (${runError}), so this may be partial. `
      : "";
  if (ship !== "auto" || !land.merged) {
    return { outcome: "ready", why: `${partial}${land.why || `Committed ${changed} on its branch.`}`.trim() };
  }
  if (pushed) return { outcome: "pushed", why: `Changed ${changed}, merged and pushed.` };
  return {
    outcome: "landed",
    why: `Changed ${changed} and merged, but the push failed${pushWhy ? `: ${pushWhy}` : ""}. Push it by hand.`,
  };
}

/** `git push origin <branch>` in the owner's repo. No shell, no prompt. */
function gitPush(repo, branch) {
  return new Promise((resolve) => {
    // A branch name that could read as a flag is not one this runner pushes.
    if (!repo || !/^[\w./-]+$/.test(String(branch || "")) || String(branch).startsWith("-")) {
      resolve({ ok: false, why: `"${branch}" isn't a branch this runner will push` });
      return;
    }
    execFile(
      "git",
      ["push", "origin", branch],
      { cwd: repo, timeout: 180_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (e, _out, err) => {
        if (!e) return resolve({ ok: true, why: "" });
        const tail = String(err || e.message).trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ");
        resolve({ ok: false, why: tail || "git push failed" });
      },
    );
  });
}

/**
 * Run one agent as a harness thread in the bridge, then commit what it did.
 *
 * Returns the same shape as runAgent so cycle()'s handoff logic is shared.
 * Every dependency is injectable, so the decisions can be tested without a
 * bridge, a model, or a git remote.
 */
export async function runInHarness(id, brief, settings, deps = {}) {
  const {
    conn,
    fetchImpl = fetch,
    hub = (name, a) => callTool(conn, name, a),
    push = gitPush,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now,
    runMs = RUN_MS,
    pollMs = POLL_MS,
    base = BRIDGE,
    token = readLocal("token.txt"),
    secret = readLocal("agents-secret.txt"),
    say = log,
  } = deps;

  if (!token || !secret || !(await bridgeAnswers(base, fetchImpl))) return { ok: false, why: BRIDGE_DOWN };
  const call = bridgeClient({ base, token, fetchImpl });

  const goal = goalFrom(brief) || "a 24/7 agent";
  const deepseek = settings.pick === "deepseek";
  let session;
  try {
    ({ session } = await call(
      "/harness/start-unattended",
      {
        secret,
        pick: settings.pick,
        title: `24/7 ${id}: ${goal.slice(0, 50)}`,
        // Everything non-read gates, so every DeepSeek action reaches the
        // runner's gateVerdict(). Claude's unattended adapter ignores this and
        // asks agents-unattended.mjs directly.
        trust: "ask",
        prompt: harnessPromptFor(brief, { edits: settings.edits, ship: settings.ship, deepseek }),
        // Handed over explicitly: without the connector the agent cannot note
        // progress, send results or hand off. DeepSeek's adapter takes none.
        mcpServers: conn
          ? {
              "jarvis-memory": {
                type: "http",
                url: `${conn.hub}/api/jarvis/memory/mcp`,
                headers: { Authorization: `Bearer ${conn.token}` },
              },
            }
          : null,
      },
      120_000,
    ));
  } catch (e) {
    return { ok: false, why: String(e?.message || e) };
  }

  if (!session?.id || !session.worktree?.path) return { ok: false, why: "the PC helper said it started the thread but sent nothing back" };
  const thread = session.id;
  const wt = session.worktree;
  say(`${id} is harness thread ${thread} on ${wt.branch} (${describePick(settings.pick)})`);

  const waited = await waitForThread({ call, thread, worktree: wt.path, runMs, pollMs, sleep, now, say });

  let files = [];
  let landError = "";
  const runError = waited.lost ? `the PC helper lost the thread mid-run (${waited.lost})` : waited.error;
  let land = null;
  let pushed = false;
  let pushWhy = "";
  let ship = settings.ship;

  if (!waited.lost) {
    try {
      files = (await call("/harness/status", { id: thread })).work?.files ?? [];
    } catch (e) {
      landError = String(e?.message || e);
    }
  }

  if (files.length && !landError) {
    // Half-done work is never pushed, and neither is work the agent itself
    // said was broken: an agent that marked itself blocked has asked for a
    // human, and pushing over that would make the flag decoration.
    if (ship === "auto" && waited.timedOut) ship = "review";
    if (ship === "auto" && agentStatusIn(await hub("agent_list", {}), id) === "blocked") ship = "review";
    try {
      land = await call(
        "/harness/land",
        { id: thread, message: `24/7 agent ${id}: ${goal.slice(0, 72)}`, merge: ship === "auto" },
        300_000,
      );
    } catch (e) {
      landError = String(e?.message || e);
    }
    if (ship === "auto" && land?.merged) {
      const r = await push(wt.repo, wt.base);
      pushed = r.ok;
      pushWhy = r.why;
    }
  }

  const result = outcomeFor({ files, ship, land, pushed, pushWhy, landError, timedOut: waited.timedOut, runError });
  // The thread is NOT discarded: it is the record the owner reviews, and for
  // "ready" it is the only place the work exists outside a branch name.
  await hub("agent_ran", { id, thread, branch: wt.branch || "", outcome: result.outcome, why: result.why });
  say(`${id} ${result.outcome}: ${result.why}`);

  return result.outcome === "failed"
    ? { ok: false, why: result.why, outcome: result.outcome }
    : { ok: true, finished: waited.finished, blocked: 0, outcome: result.outcome };
}

// --- the cycle -------------------------------------------------------------

let busy = false;
const runTimes = [];

function underCeiling(now) {
  while (runTimes.length && now - runTimes[0] > 60 * 60 * 1000) runTimes.shift();
  return runTimes.length < MAX_RUNS_PER_HOUR;
}

async function cycle() {
  // Each run gets the keys as they are now, without restarting the runner.
  try {
    loadIntoEnv(REPO);
  } catch {
    /* no key file is the same as no keys */
  }

  if (busy) return;
  if (existsSync(path.join(HERE, "agents-off"))) return;

  const now = Date.now();
  if (!underCeiling(now)) {
    log(`holding off — ${MAX_RUNS_PER_HOUR} runs already this hour`);
    return;
  }

  const conn = findConnector();
  if (!conn) {
    log("no jarvis-memory connector on this machine yet — set up 'Same memory everywhere' in Jarvis › Memory");
    return;
  }

  busy = true;
  try {
    const caps = await detect();
    const answer = await callTool(conn, "agent_next", { have: caps.have });
    const id = agentIdFrom(answer);

    if (!id) {
      log(`nothing to do (${caps.have.join(", ")})`);
      return;
    }

    const settings = runSettingsFrom(answer);
    const viaHarness = settings.edits.length > 0 || settings.pick === "deepseek";
    const how =
      `on ${describePick(settings.pick)}` +
      (viaHarness
        ? `, through the harness${settings.edits.length ? ` editing ${settings.edits.join(", ")} (ship: ${settings.ship})` : ""}`
        : "");

    if (DRY) {
      log(`would work ${id} ${how} — but this is a dry run, handing it straight back`);
      await callTool(conn, "agent_handoff", { id, note: "A dry run picked this up and put it straight back. Nothing was done." });
      return;
    }

    log(`picked up ${id} ${how} — this machine has ${describeFound(caps.found)}`);
    runTimes.push(Date.now());
    const result = viaHarness
      ? await runInHarness(id, answer, settings, { conn })
      : await runAgent(conn, id, answer, caps, settings);

    // Whatever happened, the agent must not be left leased to a machine that
    // has stopped: twenty minutes of looking busy is worse than a plain note.
    // Only while it is still "running" — see agentStatusIn. A run that ended
    // blocked (by the agent, or by agent_ran's "changes are ready") stays
    // blocked until the owner looks.
    const still = agentStatusIn(await callTool(conn, "agent_list", {}), id);
    if (still === "running") {
      const why = result.ok
        ? result.finished
          ? "The run on this machine ended. If this still says waiting, the session stopped without handing off."
          : "The run on this machine was cut short."
        : `The run on this machine couldn't start or finish: ${result.why}.`;
      await callTool(conn, "agent_handoff", { id, note: `${why} Pick it up from the log above.` });
      log(`handed ${id} back: ${why}`);
    } else {
      log(`${id} is ${still || "no longer listed"} — it was finished, handed off or blocked from inside the run`);
    }
  } finally {
    busy = false;
  }
}

// --- staying alive ---------------------------------------------------------

function ps(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true }, (e) =>
      resolve(!e),
    );
  });
}

const LNK = "Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Jarvis 24-7 agents.lnk'";

/** Its own shortcut, so it never has to edit the bridge's files to survive. */
async function install() {
  const vbs = path.join(HERE, "start-agents-hidden.vbs").replace(/'/g, "''");
  const dir = HERE.replace(/'/g, "''");
  const ok = await ps(
    [
      `$lnk = ${LNK}`,
      "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)",
      "$s.TargetPath = 'wscript.exe'",
      `$s.Arguments = '"${vbs}"'`,
      `$s.WorkingDirectory = '${dir}'`,
      "$s.Description = 'Jarvis 24/7 agents — carry on when this PC is awake'",
      "$s.Save()",
    ].join("; "),
  );
  log(ok ? "it will now start when you sign in" : "could not write the Startup shortcut");
  return ok;
}

async function uninstall() {
  const ok = await ps([`$lnk = ${LNK}`, "if (Test-Path $lnk) { Remove-Item $lnk -Force }"].join("; "));
  log(ok ? "it will no longer start when you sign in" : "could not remove the Startup shortcut");
  return ok;
}

async function main() {
  shareKeys(REPO, { log });
  if (has("install")) return void (await install());
  if (has("off")) return void (await uninstall());

  mkdirSync(WORK, { recursive: true });

  if (has("once") || DRY) {
    await cycle();
    return;
  }

  // Rewritten on every start, the same habit as selfheal.mjs: it is what
  // follows this folder if it ever moves.
  await install();

  const caps = await detect();
  log(`watching for work. this machine has ${describeFound(caps.found)}`);
  await cycle();

  let lastBeat = Date.now();
  let lastCycle = Date.now();

  setInterval(() => {
    const now = Date.now();
    const gap = now - lastBeat;
    lastBeat = now;

    // A timer that should have fired twenty seconds ago firing three hours
    // late is the lid having been shut. That IS the wake signal -- Windows
    // gives a plain Node process no better one -- and it is the moment the
    // owner means by "as soon as the laptop opens".
    if (gap > SLEPT_MS) {
      log(`awake again after ${Math.round(gap / 60000)} minutes asleep — checking for work`);
      lastCycle = now;
      cycle();
      return;
    }
    if (now - lastCycle >= TICK_MS) {
      lastCycle = now;
      cycle();
    }
  }, BEAT_MS);
}

// Importing this file for its helpers must not start a runner.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    log("stopped:", e?.message || String(e));
    process.exit(1);
  });
}
