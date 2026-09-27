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
//   POST /browser/read                { tabId? }          → text + refs
//   POST /browser/click               { tabId?, ref|selector|text }
//   POST /browser/type                { tabId?, ref, value, submit? }
//   POST /browser/press               { tabId?, key }
//   POST /browser/scroll              { tabId?, direction?, amount? }
//   POST /browser/navigate            { tabId?, url? , action? }
//   POST /browser/screenshot          { tabId?, fullPage? }
//   POST /browser/close               { tabId }
//   POST /browser/quit                close the whole browser
//   POST /files/list|read|write
//   POST /system/windows|focus|launch|screenshot|info
//   POST /system/clipboard/read|write
//
// Every route but /health needs `Authorization: Bearer <token>`. The token is
// printed by start.cmd and lives in out/token.txt. See guard.mjs for why the
// token, not the origin check, is the thing actually holding the door.
// ---------------------------------------------------------------------------

import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bearer, originAllowed, refuseReason, tokenMatches } from "./guard.mjs";
import * as browser from "./browser.mjs";
import * as computer from "./computer.mjs";

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
  "POST /shell": async (body) => {
    const why = refuseReason(body.command);
    if (why) throw Object.assign(new Error(`Refused: that command ${why}.`), { status: 403 });
    return computer.runCommand(body);
  },

  "POST /browser/open": (b) => browser.openTab({ ...b, profileDir: PROFILE }),
  "POST /browser/tabs": async () => ({ tabs: await browser.listTabs() }),
  "POST /browser/read": (b) => browser.readTab(b),
  "POST /browser/click": (b) => browser.clickTab(b),
  "POST /browser/type": (b) => browser.typeTab(b),
  "POST /browser/press": (b) => browser.pressTab(b),
  "POST /browser/scroll": (b) => browser.scrollTab(b),
  "POST /browser/navigate": (b) => browser.navigateTab(b),
  "POST /browser/screenshot": (b) => browser.shotTab(b),
  "POST /browser/close": (b) => browser.closeTab(b),
  "POST /browser/quit": () => browser.shutdownBrowser(),

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
  return { shell: true, files: true, system: true, browser, browserWhy: why };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function cors(res, origin) {
  if (origin && originAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
    });
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

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already taken — the bridge is probably already running.`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, "127.0.0.1", async () => {
  const caps = await capabilities();
  console.log(`jarvis-bridge ${VERSION} listening on http://127.0.0.1:${PORT}`);
  console.log(`  shell ✓   files ✓   system ✓   browser ${caps.browser ? "✓" : "✗ (npx playwright install chromium)"}`);
  console.log("");
  console.log("  Pair New Jarvis with this token:");
  console.log(`  ${TOKEN}`);
  console.log("");
  console.log(`  Saved to ${TOKEN_FILE}`);
});
