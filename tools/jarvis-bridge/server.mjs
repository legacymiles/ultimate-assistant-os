#!/usr/bin/env node
// ---------------------------------------------------------------------------
// jarvis-bridge — the half of New Jarvis that can touch this PC.
//
//   node tools/jarvis-bridge/server.mjs        (or double-click start.cmd)
//
// New Jarvis runs on Vercel, which cannot reach this machine. The owner's
// browser can, so the page posts here, to 127.0.0.1:42020, and this process
// does the things a web page is not allowed to do: drive a real browser with
// real logins, run a shell command, read and write files, list and focus
// windows, take the screen.
//
// The site is built to work with this DOWN. Every capability below reports
// itself through /health, and the page greys out what is missing rather than
// failing a request nobody could have known would fail. That is not politeness:
// the bridge is off far more often than it is on, and a surface that breaks
// when it is off is a surface the owner stops trusting.
//
//   GET  /health                      no auth; { ok, paired, capabilities }
//   GET  /status                      everything the page's panels draw
//   POST /shell                       { command, cwd?, shell?, timeoutMs? }
//   POST /browser/open                { url?, tabId? }
//   POST /browser/read                { tabId? }          → redacted text + refs
//   POST /browser/fields              { tabId? }          → field names + values
//   POST /browser/click               { tabId?, ref|selector|text }
//   POST /browser/type                { tabId?, ref, value, submit? }
//   POST /browser/press               { tabId?, key }
//   POST /browser/scroll              { tabId?, direction?, amount? }
//   POST /browser/navigate            { tabId?, url? , action? }
//   POST /browser/screenshot          { tabId?, fullPage? }
//   POST /browser/close               { tabId }
//   POST /browser/quit                close the whole browser
//   POST /harness/list|start|say|events|decide|interrupt|stop|threads
//   POST /harness/status|diff|land|discard|preview|preview/stop
//   POST /harness/start-unattended    token AND out/agents-secret.txt; the 24/7 runner only
//   POST /files/list|read|write
//   POST /system/windows|focus|launch|screenshot|info
//   POST /system/clipboard/read|write
//
// Every route but /health needs `Authorization: Bearer <token>`. The token is
// printed by start.cmd and lives in out/token.txt. See guard.mjs for why the
// token, not the origin check, is the thing actually holding the door.
// ---------------------------------------------------------------------------

import * as brain from "./brain.mjs";
import http from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ALLOWED_ORIGINS, bearer, originAllowed, refuseReason, tokenMatches } from "./guard.mjs";
import { selfHeal, setup } from "./selfheal.mjs";
import { spawn, execFileSync } from "node:child_process";
import * as browser from "./browser.mjs";
import * as computer from "./computer.mjs";
import * as vault from "./vault.mjs";
import * as harness from "./harness.mjs";
import { keyNames, shareKeys } from "./keys.mjs";
import { DEFAULT_REPO } from "./worktree.mjs";
import * as github from "./github.mjs";
import * as mcp from "./mcp.mjs";
import * as cli from "./cli.mjs";

/**
 * Forget the Claude Code session this agent may have been started from.
 *
 * Whatever launches the bridge hands it that process's environment, and if
 * that process was a Claude Code session the child inherits its credentials:
 * ANTHROPIC_AUTH_TOKEN overrides the owner's own subscription login, and when
 * that borrowed token expires EVERY harness thread fails with "401 Invalid
 * bearer token" — which the SDK reports as a successful turn that merely said
 * nothing. A whole afternoon went into finding that once.
 *
 * The agent's children should authenticate as the owner on this machine, never
 * as whoever started the agent, so the inheritance is cut here at the door.
 */
for (const key of Object.keys(process.env)) {
  if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDECODE$|CLAUDE_AGENT_SDK_|CLAUDE_PID$)/.test(key)) delete process.env[key];
}

// The owner's keys, entered once anywhere on this PC, for every harness run.
// After the scrub above on purpose: keys.mjs never loads Claude's login
// variables, so this cannot undo it. See keys.mjs.
shareKeys(DEFAULT_REPO, { log: (line) => console.log(`  ${line}`) });

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const PROFILE = join(OUT, "browser-profile");
const TOKEN_FILE = join(OUT, "token.txt");
const PORT = Number(process.env.JARVIS_BRIDGE_PORT || 42020);
const VERSION = "1.0.0";

mkdirSync(OUT, { recursive: true });

/** One token per machine, made once and kept. Losing it only costs a re-pair. */
function loadToken() {
  if (existsSync(TOKEN_FILE)) {
    const saved = readFileSync(TOKEN_FILE, "utf8").trim();
    if (saved.length >= 32) return saved;
  }
  const fresh = randomBytes(24).toString("base64url");
  writeFileSync(TOKEN_FILE, fresh, "utf8");
  return fresh;
}
const TOKEN = loadToken();

/**
 * The second key, for the one route a web page must never reach.
 *
 * `/harness/start-unattended` starts a thread that writes without asking. The
 * pairing token cannot guard that on its own, because the token is exactly
 * what /pair hands to the hub's web page. So this secret is never handed to
 * anyone: it is made fresh on every start, kept in memory, and written to
 * out/agents-secret.txt only once this copy owns the port — a second copy
 * that loses the race for the port must not overwrite the file with a secret
 * the running bridge has never heard of. The only reader is agents-wake.mjs,
 * a process on this PC that can read this folder anyway.
 */
const AGENTS_SECRET_FILE = join(OUT, "agents-secret.txt");
const AGENTS_SECRET = randomBytes(32).toString("base64url");

/**
 * Constant-time, and length-blind: both sides are hashed first, so
 * timingSafeEqual always compares 32 bytes and a wrong guess learns nothing,
 * not even how long the secret is.
 */
function agentsSecretMatches(given) {
  if (typeof given !== "string" || !given) return false;
  const digest = (v) => createHash("sha256").update(v, "utf8").digest();
  return timingSafeEqual(digest(given), digest(AGENTS_SECRET));
}

/**
 * Give the coding agents a GitHub token without asking the owner to paste one.
 *
 * `gh` does not read git's credential helper, so a harness could push a branch
 * (git had the credential) and then be unable to open or merge the pull
 * request. The same credential git already uses is enough for `gh` when it is
 * handed over as GH_TOKEN. Read once, at startup; never written to disk.
 */
function inheritGitHubToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return;
  try {
    const out = execFileSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      timeout: 8_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const match = /^password=(.+)$/m.exec(out);
    if (match) process.env.GH_TOKEN = match[1].trim();
  } catch {
    // No credential on this PC: git and gh will say so in their own words.
  }
}
inheritGitHubToken();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ROUTES = {
  // One click: bring main in, push the branch, merge the PR. The agent gets
  // the conflict sentence if git needs a human-sized fix.
  "POST /github/ship": (b) => github.ship(b),
  "POST /github/status": (b) => github.status(b),

  // Jarvis thinking with the owner's own Claude subscription, through the
  // unmodified Claude Code on this PC. See brain.mjs.
  "POST /brain/claude": (b) => brain.think(b),
  "POST /brain/claude/check": () => brain.check(),

  "POST /shell": async (body) => {
    const why = refuseReason(body.command);
    if (why) throw Object.assign(new Error(`Refused: that command ${why}.`), { status: 403 });
    return computer.runCommand(body);
  },

  "POST /browser/open": (b) => browser.openTab({ ...b, profileDir: PROFILE }),
  "POST /browser/tabs": async () => ({ tabs: await browser.listTabs() }),
  "POST /browser/read": (b) => browser.readTab(b),
  // Field NAMES to the model, field VALUES to the owner's own tab only. The
  // runner strips `values` before anything is sent upstream.
  "POST /browser/fields": (b) => browser.fieldsTab(b),
  "POST /browser/click": (b) => browser.clickTab(b),
  "POST /browser/type": (b) => browser.typeTab(b),
  "POST /browser/press": (b) => browser.pressTab(b),
  "POST /browser/scroll": (b) => browser.scrollTab(b),
  "POST /browser/navigate": (b) => browser.navigateTab(b),
  "POST /browser/screenshot": (b) => browser.shotTab(b),
  "POST /browser/close": (b) => browser.closeTab(b),
  "POST /browser/quit": () => browser.shutdownBrowser(),

  // The vault. These exist to collapse round trips, not because files/* is
  // missing: files/read reads ONE file per preflighted POST, so a 2000-note
  // vault would be 4000 requests to sweep once.
  "POST /vault/scan": () => vault.scanVault(),
  "POST /vault/read": (b) => vault.readNotes(b),
  "POST /vault/peek": (b) => vault.peekNote(b),
  "POST /vault/write": (b) => vault.writeNote(b),
  "POST /vault/append": (b) => vault.appendNote(b),

  // Coding harnesses. Unlike every other route here, these do not do a thing
  // and answer — they start something that keeps running, and the rest of the
  // group is how the page reads and steers it. See harness.mjs.
  "POST /harness/list": () => harness.listHarnesses(),
  // `unattended` and `mcpServers` are for the wake runner on this PC only:
  // an unattended thread writes without asking, so no HTTP caller may set it.
  "POST /harness/start": ({ unattended: _u, mcpServers: _m, ...b } = {}) => harness.startThread(b),
  // The same start, unattended, for the 24/7 wake runner. It needs the normal
  // token (checked below like every route) AND the local agents secret, which
  // is stripped here so it can never reach a thread, a log or an event.
  "POST /harness/start-unattended": ({ secret, unattended: _u, ...b } = {}) => {
    if (!agentsSecretMatches(secret)) {
      throw Object.assign(new Error("Refused: unattended threads can only be started by the 24/7 runner on this PC."), { status: 403 });
    }
    return harness.startThread({ ...b, unattended: true });
  },
  "POST /harness/say": (b) => harness.sayToThread(b),
  "POST /harness/events": (b) => harness.threadEvents(b),
  "POST /harness/decide": (b) => harness.decideGate(b),
  "POST /harness/interrupt": (b) => harness.interruptThread(b),
  "POST /harness/stop": (b) => harness.stopThread(b),
  "POST /harness/threads": () => harness.listThreads(),
  "POST /harness/status": (b) => harness.threadStatus(b),
  "POST /harness/diff": (b) => harness.threadDiff(b),
  "POST /harness/land": (b) => harness.landThread(b),
  "POST /harness/discard": (b) => harness.discardThread(b),
  "POST /harness/preview": (b) => harness.previewThread(b),
  "POST /harness/preview/stop": (b) => harness.previewStopThread(b),

  // MCP servers this PC can drive. A server is a child process speaking
  // JSON-RPC over stdio; `list` reads them, `tools` says what one offers, and
  // `call` runs one tool. See mcp.mjs.
  "POST /mcp/list": () => mcp.listServers(),
  "POST /mcp/tools": (b) => mcp.listTools(b),
  "POST /mcp/call": (b) => mcp.callTool(b),
  "POST /mcp/save": (b) => mcp.saveServer(b),
  "POST /mcp/remove": (b) => mcp.removeServer(b),
  "POST /mcp/enable": (b) => mcp.setEnabled(b),
  "POST /mcp/restart": (b) => mcp.restartServer(b),

  // The CLIs this PC has, and installing one it does not. See cli.mjs.
  "POST /cli/list": () => cli.listTools(),
  "POST /cli/install": (b) => cli.installTool(b),

  "POST /files/list": (b) => computer.listDir(b),
  "POST /files/read": (b) => computer.readTextFile(b),
  "POST /files/write": (b) => computer.writeTextFile(b),

  "POST /system/windows": () => computer.listWindows(),
  "POST /system/focus": (b) => computer.focusWindow(b),
  "POST /system/launch": (b) => computer.launchApp(b),
  "POST /system/screenshot": () => computer.screenShot(),
  "POST /system/info": () => computer.systemInfo(),
  "POST /system/clipboard/read": () => computer.readClipboard(),
  "POST /system/clipboard/write": (b) => computer.writeClipboard(b),

  "GET /status": async () => ({
    ok: true,
    version: VERSION,
    browser: await browser.browserStatus(),
    system: await computer.systemInfo().catch(() => ({})),
  }),
};

/**
 * What this bridge can do, as the page's capability row reads it.
 *
 * Browser control needs TWO things, and reporting only the first is how a
 * panel comes to offer a button that cannot work: the `playwright` module has
 * to resolve, and the Chromium it drives has to actually be on disk. The
 * module installs from npm in seconds; the browser is a separate 150 MB
 * download that people forget, so "resolved" on its own is a lie about half
 * the time. The executable is stat'd, not trusted.
 */
async function capabilities() {
  let browser = false;
  let why = "";
  try {
    const pw = await import("playwright");
    const exe = pw.chromium.executablePath();
    if (exe && existsSync(exe)) browser = true;
    else why = "Chromium is not downloaded — run `npx playwright install chromium`.";
  } catch {
    why = "Playwright is not installed — run `npm install` in tools/jarvis-bridge.";
  }
  // The vault is reported separately from `files`, because "this machine can
  // read files" and "this machine has the owner's vault on it" are different
  // facts and the page needs to say which one is missing.
  const where = await vault.vaultStatus();
  // Which coding harnesses are installed is a capability like any other, and
  // the page greys the picker per harness from it rather than offering a
  // choice that fails on the first turn.
  const { harnesses } = await harness.listHarnesses();
  return {
    harness: harnesses.some((h) => h.available),
    // The Agent SDK is here, so Jarvis can think with Claude on this PC. Whether
    // Claude Code is signed in is only known by trying — /brain/claude/check.
    brain: harnesses.some((h) => h.id === "claude" && h.available),
    harnesses: harnesses.map(({ id, label, available, why }) => ({ id, label, available, why })),
    // Names only, never values: which keys every harness run on this PC gets,
    // so a page can say "your harness already has it" instead of asking again.
    keys: keyNames(),
    shell: true,
    files: true,
    system: true,
    browser,
    browserWhy: why,
    // Both are always available on a running bridge: MCP needs only a child
    // process, and the CLI list is read from this PC. What varies is what they
    // FIND, which is the tool's answer rather than a capability.
    mcp: true,
    cli: true,
    vault: where.exists,
    vaultRoot: where.root,
    vaultWhy: where.exists ? "" : `No vault at ${where.root}. Create it, or set JARVIS_VAULT.`,
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function cors(res, origin) {
  if (origin && originAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Jarvis-Pair");
    // Chrome asks before a website may talk to this PC ("Private Network
    // Access"); without this the preflight fails and it looks like we're off.
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

/**
 * The one local page a public site is allowed to open in a window.
 *
 * Chrome 156 will not let a page on https://bighomieai.com fetch
 * http://127.0.0.1 unless the owner grants a per-site "loopback network"
 * permission — and if that prompt was dismissed before, Chrome can stop
 * showing it entirely. A TOP-LEVEL navigation to localhost is not gated the
 * same way, so this page is opened once from a click and becomes the channel:
 * the app posts a request to it, it fetches its own origin (the bridge), and
 * posts the answer back. No permission, and it works for every app on the
 * owner's domains because the relay checks the sender's origin.
 */
function relayPage() {
  const allow = JSON.stringify(ALLOWED_ORIGINS.map((re) => ({ source: re.source, flags: re.flags })));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis is connected</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:20px; background:#0a0b0f; color:#e5e7eb; font:14px/1.5 system-ui,Segoe UI,sans-serif; }
  h1 { margin:0 0 6px; font-size:16px; }
  p { margin:0 0 14px; color:#9ca3af; font-size:12.5px; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#34d399; margin-right:7px; box-shadow:0 0 10px #34d399; }
  button { border:1px solid #2a2f3a; background:#12151c; color:#cbd5e1; border-radius:7px; padding:6px 10px; font:inherit; cursor:pointer; }
  button:hover { background:#191d26; color:#fff; }
</style></head>
<body>
  <h1><span class="dot"></span>Jarvis is connected</h1>
  <p>Keep this window open while you use Jarvis on this PC. You can minimize it.</p>
  <button type="button" onclick="window.close()">Close</button>
<script>
  const ALLOWED = (${allow}).map((r) => new RegExp(r.source, r.flags));
  const allowed = (origin) => ALLOWED.some((re) => re.test(origin));
  const reply = (data, origin) => { try { window.opener && window.opener.postMessage(data, origin); } catch (e) {} };

  window.addEventListener("message", async (event) => {
    if (!allowed(event.origin)) return;
    const msg = event.data || {};
    if (msg.type === "jarvis:ping") {
      try { event.source.postMessage({ type: "jarvis:ready" }, event.origin); } catch (e) {}
      return;
    }
    if (msg.type !== "jarvis:call") return;
    const headers = { "Content-Type": "application/json" };
    if (msg.token) headers.Authorization = "Bearer " + msg.token;
    if (msg.route === "pair") headers["X-Jarvis-Pair"] = "1";
    try {
      const res = await fetch("/" + String(msg.route || "").replace(/^\\/+/, ""), {
        method: msg.method === "GET" ? "GET" : "POST",
        headers,
        body: msg.method === "GET" ? undefined : JSON.stringify(msg.args || {}),
        cache: "no-store",
      });
      const body = await res.text();
      try { event.source.postMessage({ type: "jarvis:result", id: msg.id, status: res.status, body }, event.origin); } catch (e) {}
    } catch (err) {
      try { event.source.postMessage({ type: "jarvis:result", id: msg.id, error: String(err) }, event.origin); } catch (e) {}
    }
  });

  // The opener may have attached its listener after this page loaded; the ping
  // above covers that, and this covers the common case immediately.
  try { window.opener && window.opener.postMessage({ type: "jarvis:ready" }, "*"); } catch (e) {}
</script>
</body></html>`;
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(html);
}

function readBody(req) {
  return new Promise((done, fail) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      // A 20 MB post to a localhost agent is not a real request.
      if (raw.length > 20 * 1024 * 1024) {
        fail(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) return done({});
      try {
        done(JSON.parse(raw));
      } catch {
        fail(new Error("Body was not valid JSON"));
      }
    });
    req.on("error", fail);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  cors(res, origin);

  if (req.method === "OPTIONS") {
    // The preflight is the gate. An origin we do not know never gets the
    // permission headers above, so the browser drops the real request before
    // its body — and therefore its command — ever reaches this process.
    res.writeHead(originAllowed(origin) ? 204 : 403);
    return res.end();
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/relay" && req.method === "GET") {
    return sendHtml(res, relayPage());
  }

  if (path === "/health") {
    return send(res, 200, {
      ok: true,
      version: VERSION,
      name: "jarvis-bridge",
      capabilities: await capabilities(),
      browserRunning: browser.browserRunning(),
      // The page pairs itself through /pair, so no token ever has to be copied.
      pairable: true,
      setup,
      // Where it lives, so the page can show the exact folder if it ever needs re-installing.
      folder: HERE,
    });
  }

  // Automatic pairing. Hands the token ONLY to New Jarvis's own site (the
  // allow-listed origins in guard.mjs), and only on a preflighted request (the
  // custom header forces one), so no other website can read it. A program
  // already on this PC could read out/token.txt anyway, so this gives nothing
  // away that wasn't already on disk — it just stops the owner copying it.
  if (path === "/pair" && req.method === "GET") {
    // A same-origin request (the relay page) carries no Origin header; a
    // cross-origin page always does, and still has to be on the allow-list.
    const sameOrigin = !origin;
    if ((!sameOrigin && !originAllowed(origin)) || req.headers["x-jarvis-pair"] !== "1") {
      return send(res, 403, { error: "Only New Jarvis can pair with this PC." });
    }
    return send(res, 200, { ok: true, token: TOKEN });
  }

  if (origin && !originAllowed(origin)) return send(res, 403, { error: "Origin not allowed." });
  // A web page always sends an Origin; the wake runner (Node's fetch) never
  // does. Belt and braces on top of the secret: even an allowed page that
  // somehow had it could not start a thread that writes without asking.
  if (origin && path === "/harness/start-unattended") {
    return send(res, 403, { error: "Unattended threads can't be started from a web page." });
  }
  if (!tokenMatches(TOKEN, bearer(req.headers))) {
    return send(res, 401, {
      error: "Not paired with this bridge. Open tools/jarvis-bridge/out/token.txt, or run pair.cmd.",
    });
  }

  const route = ROUTES[`${req.method} ${path}`];
  if (!route) return send(res, 404, { error: `No route ${req.method} ${path}` });

  try {
    const body = req.method === "POST" ? await readBody(req) : {};
    const started = Date.now();
    const data = await route(body);
    return send(res, 200, { ok: true, ms: Date.now() - started, ...data });
  } catch (e) {
    const status = e?.status ?? 500;
    // The message is the whole value of a failure here: "No open tab tab_3" is
    // something the agent can recover from, "500" is not.
    return send(res, status, { ok: false, error: String(e?.message ?? e) });
  }
});

// A harness child is a real process doing real work in a worktree. Leaving one
// behind on Ctrl-C means an orphan editing files nobody is watching.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    mcp.shutdown();
    void harness.stopAllThreads().finally(() => process.exit(0));
  });
}

// A self-restart starts the new copy a moment before the old one has let go
// of the port, so try for a couple of seconds before deciding another copy is
// already running.
let bindTries = 0;
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    if (++bindTries <= 6) {
      setTimeout(() => server.listen(PORT, "127.0.0.1"), 500);
      return;
    }
    console.error(`Port ${PORT} is already taken — the bridge is probably already running.`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, "127.0.0.1", async () => {
  // Only now, with the port ours: see AGENTS_SECRET above.
  try {
    writeFileSync(AGENTS_SECRET_FILE, AGENTS_SECRET, { encoding: "utf8", mode: 0o600 });
  } catch (e) {
    console.error(`  could not write ${AGENTS_SECRET_FILE} (${e?.message ?? e}) — 24/7 agents can't edit apps until it can.`);
  }
  // Keep itself working: Startup shortcut, the Start button's jarvis-agent://,
  // and its own packages (see selfheal.mjs). Runs in the background.
  void selfHeal(HERE, () => {
    // Start a fresh copy (it waits for the port) and leave.
    console.log("  restarting with the new packages…");
    server.close();
    spawn("wscript.exe", [join(HERE, "start-hidden.vbs")], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    setTimeout(() => process.exit(0), 300);
  });
  const caps = await capabilities();
  console.log(`jarvis-bridge ${VERSION} listening on http://127.0.0.1:${PORT}`);
  console.log(`  shell ✓   files ✓   system ✓   browser ${caps.browser ? "✓" : "✗ (npx playwright install chromium)"}`);
  for (const h of caps.harnesses ?? []) {
    console.log(`  harness ${h.id.padEnd(9)} ${h.available ? "✓" : `✗ ${h.why}`}`);
  }
  console.log("");
  console.log("  Pair New Jarvis with this token:");
  console.log(`  ${TOKEN}`);
  console.log("");
  console.log(`  Saved to ${TOKEN_FILE}`);
});
