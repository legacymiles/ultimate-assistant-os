#!/usr/bin/env node
// ---------------------------------------------------------------------------
// EA Lab runner - tests MetaTrader Expert Advisors on this PC.
//
//   node tools/ea-lab-runner/server.mjs        (or double-click start.cmd)
//
// The hub runs on Vercel and cannot reach this machine or its MetaTrader
// installs. The owner's browser can, so the page talks to this bridge on
// 127.0.0.1:42030, the same pattern as tools/studio-bridge.
//
// WHAT IT DOES
//
//   Drop an .ex4 into C:\EA-Lab\inbox and it is registered, installed into the
//   rig, backtested headless, and its report filed - without the terminal
//   being touched by hand.
//
// THE RIG
//
//   C:\coin demo 2 - an IDLE MT4 install, deliberately not one of the two
//   terminals the owner is logged into and trading. Testing rewrites charts,
//   profiles and the tester config, so pointing this at a live terminal would
//   disturb a working account. The rig already holds XAUUSD history from M1 to
//   MN, which is what makes it usable.
//
// WHAT IT DOES NOT DO
//
//   It never parses a report. Parsing lives in src/lib/ea-lab/report.ts, which
//   is tested against a real report; a second parser here would drift from it
//   the first time MetaTrader changed a column. The runner produces the .htm
//   and the hub reads it.
//
//   GET  /health                    { ok, rig, inbox, library, queue }
//   GET  /library                   every EA the lab knows about
//   GET  /runs                      every completed run (config only)
//   GET  /report/:id                the raw report HTML for a run
//   POST /scan                      re-scan the inbox now
//   POST /test  { eaId, symbol, timeframe, from, to, model, spread, deposit }
//   GET  /job/:id                   { status, position?, error? }
// ---------------------------------------------------------------------------

import http from "node:http";
import { spawn } from "node:child_process";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  copyFileSync, renameSync, statSync,
} from "node:fs";
import { join, basename, extname } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.EA_LAB_PORT || 42030);
const ALLOWED = [
  /^https:\/\/ultimate-assistant-os\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

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

// The rig: install dir (holds terminal.exe) and data dir (holds MQL4/, history/).
const RIG_EXE = process.env.EA_LAB_RIG_EXE || "C:\\coin demo 2\\terminal.exe";
const RIG_DATA = process.env.EA_LAB_RIG_DATA
  || "C:\\Users\\honey\\AppData\\Roaming\\MetaQuotes\\Terminal\\3779067D7BD3071D2EDED5EC1D73C64A";
const RIG_EXPERTS = join(RIG_DATA, "MQL4", "Experts");

for (const d of [ROOT, INBOX, RUNS, REPORTS, ARCHIVE]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ----- library --------------------------------------------------------------
const loadLibrary = () => {
  try {
    return JSON.parse(readFileSync(LIBRARY, "utf8"));
  } catch {
    return {};
  }
};
const saveLibrary = (lib) => writeFileSync(LIBRARY, JSON.stringify(lib, null, 2));

/** A stable id from the filename, so re-dropping the same EA updates it. */
const idFor = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Take everything in the inbox into the library and install it into the rig.
 * The file is MOVED to `installed/` afterwards so the inbox is always a
 * to-do list rather than a pile that gets re-imported on every scan.
 */
function scanInbox() {
  const lib = loadLibrary();
  const found = [];
  for (const f of readdirSync(INBOX)) {
    const ext = extname(f).toLowerCase();
    if (ext !== ".ex4" && ext !== ".ex5" && ext !== ".mq4" && ext !== ".mq5") continue;
    const name = basename(f, ext);
    const id = idFor(name);
    const src = join(INBOX, f);
    try {
      // Compiled EAs go to the rig; source files are kept but cannot be tested
      // until MetaEditor compiles them, which is the owner's call, not ours.
      const compiled = ext === ".ex4" || ext === ".ex5";
      if (compiled) copyFileSync(src, join(RIG_EXPERTS, f));
      renameSync(src, join(ARCHIVE, f));
      lib[id] = {
        id,
        name,
        platform: ext.includes("4") ? "mt4" : "mt5",
        file: f,
        testable: compiled,
        path: join(ARCHIVE, f),
        addedAt: lib[id]?.addedAt ?? Date.now(),
        seenAt: Date.now(),
        autoTest: lib[id]?.autoTest ?? compiled,
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
  const lib = loadLibrary();
  let added = 0;
  for (const f of readdirSync(RIG_EXPERTS)) {
    if (extname(f).toLowerCase() !== ".ex4") continue;
    const name = basename(f, ".ex4");
    const id = idFor(name);
    if (lib[id]) continue;
    lib[id] = {
      id, name, platform: "mt4", file: f, testable: true,
      path: join(RIG_EXPERTS, f),
      addedAt: statSync(join(RIG_EXPERTS, f)).mtimeMs,
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
 * PATH so only the rig is ever touched -- the owner has other MT4 installs and
 * two logged-in MT5 terminals, and killing one of those would close a live
 * trading session.
 *
 * This is not housekeeping, it is correctness. `TestShutdownTerminal` only
 * fires after a test COMPLETES, so any failure leaves the terminal running,
 * and MetaTrader hands a second launch off to that existing instance and exits
 * immediately -- producing no report. One failed run would otherwise guarantee
 * every run after it failed too, in about a second each.
 */
function closeRigTerminal() {
  return new Promise((resolve) => {
    const ps = spawn("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='terminal.exe'" | `
      + `Where-Object { $_.ExecutablePath -eq '${RIG_EXE.replace(/'/g, "''")}' } | `
      + `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ], { windowsHide: true });
    ps.on("exit", () => setTimeout(resolve, 1500)); // let the file locks clear
    ps.on("error", () => resolve());
  });
}

function runTest(job) {
  return new Promise(async (resolve) => {
    await closeRigTerminal();
    const lib = loadLibrary();
    const ea = lib[job.eaId];
    if (!ea) return resolve({ error: `unknown EA ${job.eaId}` });
    if (!ea.testable) return resolve({ error: `${ea.name} is source, not compiled - open it in MetaEditor and compile first` });

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
    const logDir = join(RIG_DATA, "tester", "logs");
    try { rmSync(logDir, { recursive: true, force: true }); } catch {}

    const started = Date.now();
    let timedOut = false;
    const child = spawn(RIG_EXE, [iniPath], { windowsHide: true, detached: false });

    // A tester run that never finishes would hold the queue forever. MT4 also
    // exits 0 while having produced nothing, so the report's existence - not
    // the exit code - is what decides success.
    const budget = Number(job.timeoutMs || process.env.EA_LAB_TIMEOUT_MS || 900_000);
    const killAt = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch {}
    }, budget);

    child.on("exit", async () => {
      clearTimeout(killAt);
      await closeRigTerminal();
      const seconds = Math.round((Date.now() - started) / 1000);

      // How much the EA wrote is diagnostic, not trivia: it separates "this EA
      // is pathologically slow" from "this run was misconfigured", and those
      // two need completely different fixes. The first version of this error
      // blamed missing history for a timeout and sent two rounds of debugging
      // in the wrong direction.
      let logMb = 0;
      try {
        for (const f of readdirSync(logDir)) logMb += statSync(join(logDir, f)).size;
        logMb = Math.round(logMb / 1e6);
      } catch {}

      const produced = join(RIG_DATA, `${reportName}.htm`);
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
            : "the tester produced no report - check the symbol exists on the rig, that history "
              + "covers the range, and that the EA loads",
        });
      }
      const kept = join(REPORTS, `${reportName}.htm`);
      copyFileSync(produced, kept);
      const gif = join(RIG_DATA, `${reportName}.gif`);
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
    if (!out.error) {
      writeFileSync(join(RUNS, `${job.id}.json`), JSON.stringify({
        id: job.id, eaId: job.eaId, symbol: job.symbol, timeframe: job.timeframe,
        from: job.from, to: job.to, sample: job.sample, model: job.model,
        spread: job.spread, deposit: job.deposit, report: basename(out.report),
        seconds: out.seconds, logMb: out.logMb ?? 0, ranAt: job.finishedAt,
      }, null, 2));
    }
  } catch (e) {
    Object.assign(job, { status: "failed", error: e.message, finishedAt: Date.now() });
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
    // Default split: the older two thirds in sample, the newest third held back.
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

// ----- HTTP -----------------------------------------------------------------
function cors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED.some((re) => re.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    return true;
  }
  return !origin;
}

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve) => {
  let s = "";
  req.on("data", (c) => { s += c; });
  req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } });
});

const server = http.createServer(async (req, res) => {
  if (!cors(req, res)) return json(res, 403, { error: "origin not allowed" });
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === "/health") {
    return json(res, 200, {
      ok: true,
      rig: { exe: RIG_EXE, present: existsSync(RIG_EXE), data: RIG_DATA },
      inbox: INBOX,
      waiting: existsSync(INBOX) ? readdirSync(INBOX).length : 0,
      library: Object.keys(loadLibrary()).length,
      queue: queue.length + (working ? 1 : 0),
    });
  }

  if (path === "/library") return json(res, 200, Object.values(loadLibrary()));

  if (path === "/runs") {
    const out = readdirSync(RUNS)
      .filter((f) => f.endsWith(".json"))
      .map((f) => { try { return JSON.parse(readFileSync(join(RUNS, f), "utf8")); } catch { return null; } })
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
    // Anything dropped is meant to be tested; that is the point of the folder.
    const queued = found
      .filter((id) => loadLibrary()[id]?.autoTest)
      .map((id) => enqueue({ eaId: id }).id);
    return json(res, 200, { found, adopted, queued });
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
  for (const id of found) {
    if (loadLibrary()[id]?.autoTest) {
      console.log(`inbox: ${id} -> queued`);
      enqueue({ eaId: id });
    }
  }
}, 4000);

server.listen(PORT, "127.0.0.1", () => {
  const adopted = adoptRigExperts();
  console.log(`EA Lab runner on http://127.0.0.1:${PORT}`);
  console.log(`  rig    ${RIG_EXE}${existsSync(RIG_EXE) ? "" : "   *** NOT FOUND ***"}`);
  console.log(`  inbox  ${INBOX}   <- drop .ex4 / .ex5 files here`);
  console.log(`  library ${Object.keys(loadLibrary()).length} EAs${adopted ? ` (${adopted} adopted from the rig)` : ""}`);
});
