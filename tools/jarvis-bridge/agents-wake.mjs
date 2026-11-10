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
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeFound, detect } from "./agents-capabilities.mjs";
import { decide, denial } from "./agents-unattended.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const WORK = path.join(HERE, "out", "agents");

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

async function runAgent(conn, id, brief, caps) {
  const workDir = path.join(WORK, id);
  mkdirSync(workDir, { recursive: true });

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

// --- the cycle -------------------------------------------------------------

let busy = false;
const runTimes = [];

function underCeiling(now) {
  while (runTimes.length && now - runTimes[0] > 60 * 60 * 1000) runTimes.shift();
  return runTimes.length < MAX_RUNS_PER_HOUR;
}

async function cycle() {
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

    if (DRY) {
      log(`would work ${id} — but this is a dry run, handing it straight back`);
      await callTool(conn, "agent_handoff", { id, note: "A dry run picked this up and put it straight back. Nothing was done." });
      return;
    }

    log(`picked up ${id} — this machine has ${describeFound(caps.found)}`);
    runTimes.push(Date.now());
    const result = await runAgent(conn, id, answer, caps);

    // Whatever happened, the agent must not be left leased to a machine that
    // has stopped: twenty minutes of looking busy is worse than a plain note.
    const still = await callTool(conn, "agent_list", {});
    if (still.includes(id)) {
      const why = result.ok
        ? result.finished
          ? "The run on this machine ended. If this still says waiting, the session stopped without handing off."
          : "The run on this machine was cut short."
        : `The run on this machine couldn't start or finish: ${result.why}.`;
      await callTool(conn, "agent_handoff", { id, note: `${why} Pick it up from the log above.` });
      log(`handed ${id} back: ${why}`);
    } else {
      log(`${id} is no longer waiting — it was finished or handed off from inside the run`);
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
