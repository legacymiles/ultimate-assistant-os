#!/usr/bin/env node
// ---------------------------------------------------------------------------
// EA Lab runner - tests MetaTrader Expert Advisors on the machine it runs on.
//
//   node tools/ea-lab-runner/server.mjs        (or double-click start.cmd)
//
// Then open http://127.0.0.1:42030 on the same machine. The runner serves the
// EA Lab page itself (built into ui/ by build-ui.mjs), so a VPS needs nothing
// but Node and this folder: no hub, no website, no PC. The hub's /apps/ea-lab
// page still works too - it talks to this same bridge on 127.0.0.1:42030.
//
// WHAT IT DOES
//
//   Upload an .ex4 from the page (or drop one into C:\EA-Lab\inbox) and it is
//   registered, installed into the test terminal, backtested headless, and its
//   report filed - without the terminal being touched by hand.
//
// THE RIG (the test terminal)
//
//   An MT4 install that is NOT being traded on. Testing rewrites charts,
//   profiles and the tester config, and the runner closes the rig terminal
//   before and after every test - pointing it at a live terminal would close a
//   working account. So the rig is never guessed: the runner lists the MT4
//   installs it can see and the owner picks one on the page (saved to
//   C:\EA-Lab\config.json). EA_LAB_RIG_EXE / EA_LAB_RIG_DATA override it.
//
// WHAT IT DOES NOT DO
//
//   It never parses a report. Parsing lives in src/lib/ea-lab/report.ts, which
//   is tested against a real report; a second parser here would drift from it
//   the first time MetaTrader changed a column. The runner produces the .htm
//   and the page reads it.
//
//   GET  /                          the EA Lab page (ui/index.html)
//   GET  /health                    { ok, machine, rig, inbox, library, queue }
//   GET  /rigs                      MT4 installs found on this machine
//   POST /rig   { exe, data }       choose the test terminal
//   POST /upload  (raw body, X-File-Name header)  take an EA and queue it
//   GET  /library                   every EA the lab knows about
//   GET  /runs                      every completed run (config only)
//   GET  /report/:id                the raw report HTML for a run
//   POST /scan                      re-scan the inbox now
//   POST /test  { eaId, symbol, timeframe, from, to, model, spread, deposit }
//   GET  /job/:id                   { status, position?, error? }
// ---------------------------------------------------------------------------

import http from "node:http";
import { spawn, execFile } from "node:child_process";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  copyFileSync, renameSync, statSync, rmSync,
} from "node:fs";
import { join, basename, extname, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(HERE, "ui");
const PORT = Number(process.env.EA_LAB_PORT || 42030);
const ALLOWED = [
  /^https:\/\/ultimate-assistant-os\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];
const MAX_UPLOAD = 50 * 1024 * 1024;

// ----- where everything lives ----------------------------------------------
// A short path outside OneDrive: long synced paths have bitten this repo
// before, and a sync client holding a lock on an .ex4 mid-copy would fail a
// test for a reason that has nothing to do with the EA.
const ROOT = process.env.EA_LAB_ROOT || "C:\\EA-Lab";
const INBOX = join(ROOT, "inbox");
const RUNS = join(ROOT, "runs");
const REPORTS = join(ROOT, "reports");
const ARCHIVE = join(ROOT, "installed");
const LIBRARY = join(ROOT, "library.json");
const CONFIG = join(ROOT, "config.json");

for (const d of [ROOT, INBOX, RUNS, REPORTS, ARCHIVE]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ----- the rig ----------------------------------------------------------------
// The owner's PC rig, kept so that machine behaves exactly as before.
const LEGACY_RIG = {
  exe: "C:\\coin demo 2\\terminal.exe",
  data: "C:\\Users\\honey\\AppData\\Roaming\\MetaQuotes\\Terminal\\3779067D7BD3071D2EDED5EC1D73C64A",
};

const readJson = (file, fallback) => {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
};

function chooseRig() {
  if (process.env.EA_LAB_RIG_EXE) {
    return { exe: process.env.EA_LAB_RIG_EXE, data: process.env.EA_LAB_RIG_DATA || dirname(process.env.EA_LAB_RIG_EXE), from: "env" };
  }
  const cfg = readJson(CONFIG, {});
  if (cfg.rigExe && cfg.rigData) return { exe: cfg.rigExe, data: cfg.rigData, from: "config" };
  if (existsSync(LEGACY_RIG.exe) && existsSync(LEGACY_RIG.data)) return { ...LEGACY_RIG, from: "default" };
  return null;
}

let rig = chooseRig();
const rigExperts = () => (rig ? join(rig.data, "MQL4", "Experts") : null);
const rigReady = () => !!rig && existsSync(rig.exe) && existsSync(join(rig.data, "MQL4"));
/** A portable install keeps its data next to terminal.exe and must be launched with /portable. */
const rigPortable = () => !!rig && resolvePath(rig.data).toLowerCase() === resolvePath(dirname(rig.exe)).toLowerCase();

/** origin.txt is UTF-16LE with a BOM on most installs, plain text on some. */
function readOrigin(file) {
  try {
    const buf = readFileSync(file);
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
    return text.replace(/^\uFEFF/, "").trim();
  } catch {
    return "";
  }
}

/** Paths of every terminal.exe running right now, so the page can warn before a live one is picked. */
function runningTerminals() {
  return new Promise((resolve) => {
    execFile("powershell.exe", [
      "-NoProfile", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='terminal.exe'\" | ForEach-Object { $_.ExecutablePath }",
    ], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err) return resolve(new Set());
      resolve(new Set(String(out).split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean)));
    });
  });
}

/** Every MT4 install this machine has: AppData data folders, plus portable installs. */
async function findRigs() {
  const found = new Map();
  const add = (exe, data, portable) => {
    const key = exe.toLowerCase();
    if (!found.has(key)) found.set(key, { exe, data, portable, name: basename(dirname(exe)) });
  };

  const base = join(process.env.APPDATA || "", "MetaQuotes", "Terminal");
  if (process.env.APPDATA && existsSync(base)) {
    for (const d of readdirSync(base)) {
      const data = join(base, d);
      if (!existsSync(join(data, "MQL4"))) continue;   // MT5 data folders hold MQL5
      const install = readOrigin(join(data, "origin.txt"));
      const exe = install && join(install, "terminal.exe");
      if (exe && existsSync(exe)) add(exe, data, false);
    }
  }

  // Portable installs, and installs whose data folder was never created yet.
  const roots = ["C:\\", "C:\\Program Files (x86)", "C:\\Program Files", "D:\\"];
  for (const r of roots) {
    let dirs = [];
    try { dirs = readdirSync(r, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(r, e.name)); } catch { continue; }
    for (const dir of dirs) {
      const exe = join(dir, "terminal.exe");
      if (!existsSync(exe) || found.has(exe.toLowerCase())) continue;
      if (existsSync(join(dir, "MQL4"))) add(exe, dir, true);
    }
  }

  const live = await runningTerminals();
  return [...found.values()].map((r) => ({
    ...r,
    running: live.has(r.exe.toLowerCase()),
    chosen: !!rig && rig.exe.toLowerCase() === r.exe.toLowerCase(),
    experts: (() => { try { return readdirSync(join(r.data, "MQL4", "Experts")).filter((f) => f.toLowerCase().endsWith(".ex4")).length; } catch { return 0; } })(),
  }));
}

// ----- library --------------------------------------------------------------
const loadLibrary = () => readJson(LIBRARY, {});
const saveLibrary = (lib) => writeFileSync(LIBRARY, JSON.stringify(lib, null, 2));

/** A stable id from the filename, so re-dropping the same EA updates it. */
const idFor = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const EA_EXT = new Set([".ex4", ".ex5", ".mq4", ".mq5"]);

/**
 * Take everything in the inbox into the library. The file is MOVED to
 * `installed/` so the inbox is always a to-do list rather than a pile that gets
 * re-imported on every scan. It is copied into the rig at test time, so an EA
 * can be uploaded before a test terminal has been chosen.
 */
function scanInbox() {
  const lib = loadLibrary();
  const found = [];
  for (const f of readdirSync(INBOX)) {
    const ext = extname(f).toLowerCase();
    if (!EA_EXT.has(ext)) continue;
    const name = basename(f, ext);
    const id = idFor(name);
    try {
      renameSync(join(INBOX, f), join(ARCHIVE, f));
      // Only a compiled MT4 EA can go through the MT4 tester. Source has to be
      // compiled in MetaEditor first; .ex5 needs an MT5 rig, which this is not.
      const testable = ext === ".ex4";
      lib[id] = {
        id,
        name,
        platform: ext.includes("4") ? "mt4" : "mt5",
        file: f,
        testable,
        path: join(ARCHIVE, f),
        addedAt: lib[id]?.addedAt ?? Date.now(),
        seenAt: Date.now(),
        autoTest: lib[id]?.autoTest ?? testable,
      };
      found.push(id);
    } catch (e) {
      console.error(`inbox: could not take ${f}: ${e.message}`);
    }
  }
  if (found.length) saveLibrary(lib);
  return found;
}

/** EAs already sitting in the rig, so the library is not empty on first run. */
function adoptRigExperts() {
  const dir = rigExperts();
  if (!dir || !existsSync(dir)) return 0;
  const lib = loadLibrary();
  let added = 0;
  for (const f of readdirSync(dir)) {
    if (extname(f).toLowerCase() !== ".ex4") continue;
    const name = basename(f, ".ex4");
    const id = idFor(name);
    if (lib[id]) continue;
    lib[id] = {
      id, name, platform: "mt4", file: f, testable: true,
      path: join(dir, f),
      addedAt: statSync(join(dir, f)).mtimeMs,
      seenAt: Date.now(),
      autoTest: false,   // adopted, not dropped: the owner chooses what to run
    };
    added++;
  }
  if (added) saveLibrary(lib);
  return added;
}

// ----- running a test -------------------------------------------------------
const fmtDate = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`;
};

const MODEL_CODE = { "every-tick": 0, "control-points": 1, "open-prices": 2 };

/**
 * Close any terminal still open from a previous run, matched by EXECUTABLE
 * PATH so only the rig is ever touched -- other MT4/MT5 installs on the machine
 * may be live trading sessions.
 *
 * This is not housekeeping, it is correctness. `TestShutdownTerminal` only
 * fires after a test COMPLETES, so any failure leaves the terminal running,
 * and MetaTrader hands a second launch off to that existing instance and exits
 * immediately -- producing no report. One failed run would otherwise guarantee
 * every run after it failed too, in about a second each.
 */
function closeRigTerminal() {
  return new Promise((resolve) => {
    if (!rig) return resolve();
    const ps = spawn("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='terminal.exe'" | `
      + `Where-Object { $_.ExecutablePath -eq '${rig.exe.replace(/'/g, "''")}' } | `
      + `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ], { windowsHide: true });
    ps.on("exit", () => setTimeout(resolve, 1500)); // let the file locks clear
    ps.on("error", () => resolve());
  });
}

function runTest(job) {
  return new Promise(async (resolve) => {
    if (!rigReady()) {
      return resolve({ error: "no test terminal chosen yet - pick an MT4 install on the EA Lab page" });
    }
    await closeRigTerminal();
    const lib = loadLibrary();
    const ea = lib[job.eaId];
    if (!ea) return resolve({ error: `unknown EA ${job.eaId}` });
    if (!ea.testable) {
      return resolve({
        error: ea.platform === "mt5"
          ? `${ea.name} is an MT5 EA - this rig is MT4, so it cannot be tested here yet`
          : `${ea.name} is source, not compiled - open it in MetaEditor and compile first`,
      });
    }

    // Install into the rig now, so a re-upload of the same name always tests the new file.
    const experts = rigExperts();
    try {
      mkdirSync(experts, { recursive: true });
      const target = join(experts, ea.file);
      if (resolvePath(ea.path).toLowerCase() !== resolvePath(target).toLowerCase()) copyFileSync(ea.path, target);
    } catch (e) {
      return resolve({ error: `could not install ${ea.file} into the test terminal: ${e.message}` });
    }

    const reportName = `ealab-${job.id}`;
    const ini = [
      "[Tester]",
      `TestExpert=${ea.name}`,
      `TestSymbol=${job.symbol}`,
      `TestPeriod=${job.timeframe}`,
      `TestModel=${MODEL_CODE[job.model] ?? 0}`,
      `TestSpread=${job.spread ?? 20}`,
      "TestOptimization=false",
      "TestDateEnable=true",
      `TestFromDate=${fmtDate(job.from)}`,
      `TestToDate=${fmtDate(job.to)}`,
      `TestReport=${reportName}`,
      "TestReplaceReport=true",
      "TestShutdownTerminal=true",
      "TestVisualEnable=false",
      "",
    ].join("\r\n");

    const iniPath = join(ROOT, `${job.id}.ini`);
    writeFileSync(iniPath, ini, "latin1");

    // Clear the tester log first. An EA that logs on every tick is not a
    // theoretical problem: one hedge EA in this library churns a grid of
    // pending orders and wrote 2.4 GB in fifteen minutes, on a disk that was
    // already 93% full. Left alone it fills the drive and the log itself
    // becomes the reason the next test is slow.
    const logDir = join(rig.data, "tester", "logs");
    try { rmSync(logDir, { recursive: true, force: true }); } catch {}

    const started = Date.now();
    let timedOut = false;
    const args = rigPortable() ? ["/portable", iniPath] : [iniPath];
    const child = spawn(rig.exe, args, { windowsHide: true, detached: false });

    // A tester run that never finishes would hold the queue forever. MT4 also
    // exits 0 while having produced nothing, so the report's existence - not
    // the exit code - is what decides success.
    const budget = Number(job.timeoutMs || process.env.EA_LAB_TIMEOUT_MS || 900_000);
    const killAt = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch {}
    }, budget);
    child.on("error", (e) => {
      clearTimeout(killAt);
      resolve({ error: `could not start the test terminal: ${e.message}` });
    });

    child.on("exit", async () => {
      clearTimeout(killAt);
      await closeRigTerminal();
      const seconds = Math.round((Date.now() - started) / 1000);

      // How much the EA wrote is diagnostic, not trivia: it separates "this EA
      // is pathologically slow" from "this run was misconfigured", and those
      // two need completely different fixes.
      let logMb = 0;
      try {
        for (const f of readdirSync(logDir)) logMb += statSync(join(logDir, f)).size;
        logMb = Math.round(logMb / 1e6);
      } catch {}

      const produced = join(rig.data, `${reportName}.htm`);
      if (!existsSync(produced)) {
        return resolve({
          seconds,
          logMb,
          error: timedOut
            ? `still running after ${Math.round(budget / 1000)}s and was stopped`
              + (logMb > 200
                ? `. It wrote ${logMb} MB of tester log, so it is logging or churning orders on `
                  + `every tick - test a shorter period, or accept that this EA is simply slow.`
                : `. Try a shorter period.`)
            : `the tester produced no report - check ${job.symbol} exists on the test terminal, that its `
              + "history covers the range (open a chart and let it download), and that the EA loads",
        });
      }
      const kept = join(REPORTS, `${reportName}.htm`);
      copyFileSync(produced, kept);
      const gif = join(rig.data, `${reportName}.gif`);
      if (existsSync(gif)) copyFileSync(gif, join(REPORTS, `${reportName}.gif`));
      try { rmSync(logDir, { recursive: true, force: true }); } catch {}
      resolve({ report: kept, seconds, logMb });
    });
  });
}

// ----- queue ----------------------------------------------------------------
// One terminal, so one test at a time. Two testers sharing a rig would fight
// over the same config and report filenames.
const jobs = new Map();
const queue = [];
let working = false;
let lastFailure = null;

async function pump() {
  if (working) return;
  const job = queue.shift();
  if (!job) return;
  working = true;
  job.status = "running";
  job.startedAt = Date.now();
  try {
    const out = await runTest(job);
    Object.assign(job, out, { status: out.error ? "failed" : "done", finishedAt: Date.now() });
    if (out.error) {
      const name = loadLibrary()[job.eaId]?.name ?? job.eaId;
      lastFailure = { eaId: job.eaId, name, error: out.error, at: job.finishedAt };
      console.error(`test ${job.id} (${name}) failed: ${out.error}`);
    } else {
      lastFailure = null;
      writeFileSync(join(RUNS, `${job.id}.json`), JSON.stringify({
        id: job.id, eaId: job.eaId, symbol: job.symbol, timeframe: job.timeframe,
        from: job.from, to: job.to, sample: job.sample, model: job.model,
        spread: job.spread, deposit: job.deposit, report: basename(out.report),
        seconds: out.seconds, logMb: out.logMb ?? 0, ranAt: job.finishedAt,
      }, null, 2));
    }
  } catch (e) {
    Object.assign(job, { status: "failed", error: e.message, finishedAt: Date.now() });
    lastFailure = { eaId: job.eaId, name: job.eaId, error: e.message, at: job.finishedAt };
  }
  working = false;
  queue.forEach((j, i) => { j.position = i + 1; });
  pump();
}

function enqueue(body) {
  const now = Date.now();
  const job = {
    id: randomUUID().slice(0, 8),
    eaId: body.eaId,
    symbol: body.symbol || "XAUUSD",
    timeframe: body.timeframe || "H1",
    from: body.from ?? now - 365 * 86_400_000,
    to: body.to ?? now,
    sample: body.sample || "full",
    model: body.model || "every-tick",
    spread: body.spread ?? 20,
    deposit: body.deposit ?? 10_000,
    status: "queued",
    position: queue.length + 1,
    queuedAt: now,
  };
  jobs.set(job.id, job);
  queue.push(job);
  pump();
  return job;
}

/** Queue every newly-taken EA that is meant to test itself. */
const queueFound = (found) => found
  .filter((id) => loadLibrary()[id]?.autoTest)
  .map((id) => enqueue({ eaId: id }).id);

// ----- HTTP -----------------------------------------------------------------
function cors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED.some((re) => re.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-File-Name");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    return true;
  }
  return !origin;
}

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const readRaw = (req, limit) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > limit) { reject(new Error("too large")); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

const readBody = async (req) => {
  try { return JSON.parse((await readRaw(req, 1_000_000)).toString("utf8") || "{}"); } catch { return {}; }
};

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
};

const server = http.createServer(async (req, res) => {
  if (!cors(req, res)) return json(res, 403, { error: "origin not allowed" });
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (req.method === "GET" && STATIC[path]) {
    const [file, type] = STATIC[path];
    const full = join(UI, file);
    if (!existsSync(full)) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("The EA Lab page has not been built. On the PC, run: node tools/ea-lab-runner/build-ui.mjs");
    }
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    return res.end(readFileSync(full));
  }

  if (path === "/health") {
    return json(res, 200, {
      ok: true,
      machine: hostname(),
      rig: {
        exe: rig?.exe ?? null,
        data: rig?.data ?? null,
        present: rigReady(),
        chosen: !!rig,
      },
      inbox: INBOX,
      waiting: existsSync(INBOX) ? readdirSync(INBOX).length : 0,
      library: Object.keys(loadLibrary()).length,
      queue: queue.length + (working ? 1 : 0),
      lastFailure,
    });
  }

  if (path === "/rigs") return json(res, 200, await findRigs());

  if (path === "/rig" && req.method === "POST") {
    const body = await readBody(req);
    const pick = (await findRigs()).find((r) => r.exe.toLowerCase() === String(body.exe || "").toLowerCase());
    if (!pick) return json(res, 400, { error: "that is not an MT4 install on this machine" });
    writeFileSync(CONFIG, JSON.stringify({ ...readJson(CONFIG, {}), rigExe: pick.exe, rigData: pick.data }, null, 2));
    rig = { exe: pick.exe, data: pick.data, from: "config" };
    const adopted = adoptRigExperts();
    console.log(`rig    ${rig.exe} (chosen on the page)`);
    pump();
    return json(res, 200, { ok: true, rig, adopted });
  }

  if (path === "/upload" && req.method === "POST") {
    const raw = decodeURIComponent(String(req.headers["x-file-name"] || ""));
    const name = basename(raw).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
    if (!name || !EA_EXT.has(extname(name).toLowerCase())) {
      return json(res, 400, { error: "send an .ex4 (or .ex5 / .mq4 / .mq5) file" });
    }
    let data;
    try { data = await readRaw(req, MAX_UPLOAD); } catch {
      return json(res, 413, { error: "file is larger than 50 MB - that is not an EA" });
    }
    if (!data.length) return json(res, 400, { error: "the file was empty" });
    writeFileSync(join(INBOX, name), data);
    const found = scanInbox();
    const queued = queueFound(found);
    const id = idFor(basename(name, extname(name)));
    console.log(`upload: ${name} -> ${queued.length ? "queued" : "filed"}`);
    return json(res, 200, { id, ea: loadLibrary()[id] ?? null, queued });
  }

  if (path === "/library") return json(res, 200, Object.values(loadLibrary()));

  if (path === "/runs") {
    const out = readdirSync(RUNS)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(join(RUNS, f), null))
      .filter(Boolean);
    return json(res, 200, out);
  }

  if (path.startsWith("/report/")) {
    const name = basename(path.slice("/report/".length));
    const file = join(REPORTS, name.endsWith(".htm") ? name : `${name}.htm`);
    if (!existsSync(file)) return json(res, 404, { error: "no such report" });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(readFileSync(file));
  }

  if (path === "/scan" && req.method === "POST") {
    const found = scanInbox();
    const adopted = adoptRigExperts();
    return json(res, 200, { found, adopted, queued: queueFound(found) });
  }

  if (path === "/test" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.eaId) return json(res, 400, { error: "eaId required" });
    return json(res, 200, enqueue(body));
  }

  if (path.startsWith("/job/")) {
    const job = jobs.get(path.slice("/job/".length));
    return job ? json(res, 200, job) : json(res, 404, { error: "no such job" });
  }

  return json(res, 404, { error: "not found" });
});

// Watch the inbox so a dropped file is picked up without anyone asking.
// Polling, not fs.watch: a file still being written by a download or a
// OneDrive sync reports as present long before it is complete, and a poll that
// waits for the size to stop changing is the simplest thing that survives it.
const sizes = new Map();
setInterval(() => {
  if (!existsSync(INBOX)) return;
  let settled = false;
  for (const f of readdirSync(INBOX)) {
    let size;
    try { size = statSync(join(INBOX, f)).size; } catch { continue; }
    if (sizes.get(f) === size) { settled = true; } else { sizes.set(f, size); }
  }
  if (!settled) return;
  const found = scanInbox();
  for (const f of [...sizes.keys()]) if (!existsSync(join(INBOX, f))) sizes.delete(f);
  for (const id of queueFound(found)) console.log(`inbox: queued ${id}`);
}, 4000);

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use - the EA Lab runner is probably already running.`);
    console.error(`Open http://127.0.0.1:${PORT} in a browser on this machine.`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  const adopted = adoptRigExperts();
  console.log(`EA Lab runner on ${hostname()}`);
  console.log(`  open   http://127.0.0.1:${PORT}   <- the EA Lab page, on this machine`);
  console.log(`  rig    ${rig ? `${rig.exe}${rigReady() ? "" : "   *** NOT FOUND ***"}` : "not chosen yet - pick one on the page"}`);
  console.log(`  inbox  ${INBOX}   <- or drop .ex4 files here`);
  console.log(`  library ${Object.keys(loadLibrary()).length} EAs${adopted ? ` (${adopted} adopted from the rig)` : ""}`);
});
