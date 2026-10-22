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
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bearer, originAllowed, refuseReason, tokenMatches } from "./guard.mjs";
import { selfHeal, setup } from "./selfheal.mjs";
import { spawn } from "node:child_process";
import * as browser from "./browser.mjs";
import * as computer from "./computer.mjs";
import * as vault from "./vault.mjs";
import * as harness from "./harness.mjs";

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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ROUTES = {
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
  "POST /harness/start": (b) => harness.startThread(b),
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
    shell: true,
    files: true,
    system: true,
    browser,
    browserWhy: why,
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
    if (!originAllowed(origin) || req.headers["x-jarvis-pair"] !== "1") {
      return send(res, 403, { error: "Only New Jarvis can pair with this PC." });
    }
    return send(res, 200, { ok: true, token: TOKEN });
  }

  if (origin && !originAllowed(origin)) return send(res, 403, { error: "Origin not allowed." });
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
