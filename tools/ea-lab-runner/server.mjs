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
//   Upload an EA from the page (or drop one into C:\EA-Lab\inbox) and it is
//   registered, compiled if it is source, installed into the test terminal for
//   its platform, backtested headless, and its report filed.
//
//     .ex4  -> MT4 tester          .mq4 -> compiled with MT4 MetaEditor, then tested
//     .ex5  -> MT5 tester          .mq5 -> compiled with MT5 MetaEditor, then tested
//
// THE RIGS (one test terminal per platform)
//
//   An MT4 install and an MT5 install that are NOT being traded on. Testing
//   rewrites charts, profiles and the tester config, and the runner closes the
//   rig terminal before and after every test - pointing it at a live terminal
//   would close a working account. So a rig is never guessed: the runner lists
//   the installs it can see and the owner picks one per platform on the page
//   (saved to C:\EA-Lab\config.json). EA_LAB_RIG_EXE / EA_LAB_RIG_DATA (MT4)
//   and EA_LAB_MT5_EXE / EA_LAB_MT5_DATA override it.
//
// COMPILING, AS MEASURED ON A REAL METAEDITOR (build 5xxx MT5, 1443 MT4)
//
//   - Paths must be SHORT. A source file under a ~250-character folder made
//     MetaEditor exit without compiling or writing a log. So sources are
//     compiled in C:\EA-Lab\build\<id>, never where they were uploaded from.
//   - /inc must name the MQL4 / MQL5 folder itself (data\MQL5), not the data
//     folder above it - the latter fails every #include <...>.
//   - The exit code is backwards (1 on success, 0 on failure), so success is
//     decided by the "Result: N errors" line and the .ex file existing.
//
// WHAT IT DOES NOT DO
//
//   It never parses a report. Parsing lives in src/lib/ea-lab/report.ts, which
//   is tested; a second parser here would drift from it the first time
//   MetaTrader changed a column. The runner produces the report and the page
//   reads it.
//
//   GET  /                          the EA Lab page (ui/index.html)
//   GET  /health                    { ok, machine, rigs, inbox, library, queue }
//   GET  /rigs                      MT4 and MT5 installs found on this machine
//   POST /rig   { exe }             choose the test terminal for that platform
//   POST /upload  (raw body, X-File-Name header)  take an EA and queue it
//   GET  /library                   every EA the lab knows about
//   GET  /runs                      every completed run (config only)
//   GET  /report/:name              the raw report for a run
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
// A short path outside OneDrive: MetaEditor fails silently on long paths, and
// a sync client holding a lock on an EA mid-copy would fail a test for a reason
// that has nothing to do with the EA.
const ROOT = process.env.EA_LAB_ROOT || "C:\\EA-Lab";
const INBOX = join(ROOT, "inbox");
const RUNS = join(ROOT, "runs");
const REPORTS = join(ROOT, "reports");
const ARCHIVE = join(ROOT, "installed");
const BUILD = join(ROOT, "build");
const LIBRARY = join(ROOT, "library.json");
const CONFIG = join(ROOT, "config.json");

for (const d of [ROOT, INBOX, RUNS, REPORTS, ARCHIVE, BUILD]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ----- platforms --------------------------------------------------------------
const PLATFORMS = {
  mt4: { label: "MT4", exe: "terminal.exe", editor: "metaeditor.exe", mql: "MQL4", compiled: ".ex4", source: ".mq4" },
  mt5: { label: "MT5", exe: "terminal64.exe", editor: "metaeditor64.exe", mql: "MQL5", compiled: ".ex5", source: ".mq5" },
};
const EXT = {
  ".ex4": { platform: "mt4", kind: "compiled" },
  ".mq4": { platform: "mt4", kind: "source" },
  ".ex5": { platform: "mt5", kind: "compiled" },
  ".mq5": { platform: "mt5", kind: "source" },
};
const TERMINAL_EXES = new Set(["terminal.exe", "terminal64.exe"]);

// ----- the rigs ---------------------------------------------------------------
// The owner's PC MT4 rig, kept so that machine behaves exactly as before.
const LEGACY_MT4 = {
  exe: "C:\\coin demo 2\\terminal.exe",
  data: "C:\\Users\\honey\\AppData\\Roaming\\MetaQuotes\\Terminal\\3779067D7BD3071D2EDED5EC1D73C64A",
};

const readJson = (file, fallback) => {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
};

function loadRigs() {
  const cfg = readJson(CONFIG, {});
  const out = { mt4: null, mt5: null };
  if (cfg.rigs?.mt4?.exe) out.mt4 = cfg.rigs.mt4;
  else if (cfg.rigExe && cfg.rigData) out.mt4 = { exe: cfg.rigExe, data: cfg.rigData };   // old config shape
  else if (existsSync(LEGACY_MT4.exe) && existsSync(LEGACY_MT4.data)) out.mt4 = LEGACY_MT4;
  if (cfg.rigs?.mt5?.exe) out.mt5 = cfg.rigs.mt5;
  const env = (exeVar, dataVar) => process.env[exeVar]
    ? { exe: process.env[exeVar], data: process.env[dataVar] || dirname(process.env[exeVar]) }
    : null;
  out.mt4 = env("EA_LAB_RIG_EXE", "EA_LAB_RIG_DATA") ?? out.mt4;
  out.mt5 = env("EA_LAB_MT5_EXE", "EA_LAB_MT5_DATA") ?? out.mt5;
  return out;
}

const rigs = loadRigs();
const same = (a, b) => resolvePath(a).toLowerCase() === resolvePath(b).toLowerCase();
const rigReady = (p) => !!rigs[p] && existsSync(rigs[p].exe) && existsSync(join(rigs[p].data, PLATFORMS[p].mql));
/** A portable install keeps its data next to the exe and must be launched with /portable. */
const rigPortable = (p) => !!rigs[p] && same(rigs[p].data, dirname(rigs[p].exe));
const rigExperts = (p) => (rigs[p] ? join(rigs[p].data, PLATFORMS[p].mql, "Experts") : null);

/** origin.txt is UTF-16LE with a BOM on most installs, plain text on some. */
function readText(file) {
  try {
    const buf = readFileSync(file);
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
    return text.replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
}

/** Paths of every MetaTrader terminal running right now, so the page can warn before a live one is picked. */
function runningTerminals() {
  return new Promise((resolve) => {
    execFile("powershell.exe", [
      "-NoProfile", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='terminal.exe' OR Name='terminal64.exe'\" | ForEach-Object { $_.ExecutablePath }",
    ], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err) return resolve(new Set());
      resolve(new Set(String(out).split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean)));
    });
  });
}

/** Every MT4 and MT5 install this machine has: AppData data folders, plus portable installs. */
async function findRigs() {
  const found = new Map();
  const add = (platform, exe, data, portable) => {
    const key = exe.toLowerCase();
    if (!found.has(key)) found.set(key, { platform, exe, data, portable, name: basename(dirname(exe)) });
  };

  const base = join(process.env.APPDATA || "", "MetaQuotes", "Terminal");
  if (process.env.APPDATA && existsSync(base)) {
    for (const d of readdirSync(base)) {
      const data = join(base, d);
      const install = readText(join(data, "origin.txt")).trim();
      if (!install) continue;
      for (const [p, P] of Object.entries(PLATFORMS)) {
        const exe = join(install, P.exe);
        if (existsSync(join(data, P.mql)) && existsSync(exe)) add(p, exe, data, false);
      }
    }
  }

  // Portable installs, which keep MQL4 / MQL5 beside the exe.
  const roots = ["C:\\", "C:\\Program Files (x86)", "C:\\Program Files", "D:\\"];
  for (const r of roots) {
    let dirs = [];
    try { dirs = readdirSync(r, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(r, e.name)); } catch { continue; }
    for (const dir of dirs) {
      for (const [p, P] of Object.entries(PLATFORMS)) {
        const exe = join(dir, P.exe);
        if (!found.has(exe.toLowerCase()) && existsSync(exe) && existsSync(join(dir, P.mql))) add(p, exe, dir, true);
      }
    }
  }

  const live = await runningTerminals();
  return [...found.values()].map((r) => ({
    ...r,
    running: live.has(r.exe.toLowerCase()),
    chosen: !!rigs[r.platform] && same(rigs[r.platform].exe, r.exe),
    experts: (() => {
      try {
        const ext = PLATFORMS[r.platform].compiled;
        return readdirSync(join(r.data, PLATFORMS[r.platform].mql, "Experts")).filter((f) => f.toLowerCase().endsWith(ext)).length;
      } catch { return 0; }
    })(),
  }));
}

// ----- library --------------------------------------------------------------
/** Entries written by older runners lack `kind`; fill it in from the file. */
const loadLibrary = () => {
  const lib = readJson(LIBRARY, {});
  for (const ea of Object.values(lib)) {
    const info = EXT[extname(ea.file || "").toLowerCase()];
    if (info) {
      ea.kind ??= info.kind;
      ea.platform = info.platform;
    }
    ea.testable = true;
  }
  return lib;
};
const saveLibrary = (lib) => writeFileSync(LIBRARY, JSON.stringify(lib, null, 2));
const updateEa = (id, patch) => {
  const lib = loadLibrary();
  if (lib[id]) { Object.assign(lib[id], patch); saveLibrary(lib); }
};

/**
 * A stable id from the filename, so re-dropping the same EA updates it, and so
 * MyEA.mq4 and MyEA.ex4 are one EA. MT5 gets a suffix: an MT4 and an MT5 build
 * of the same EA are different programs with different results.
 */
const idFor = (name, platform) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + (platform === "mt5" ? "-mt5" : "");

/**
 * Take everything in the inbox into the library. The file is MOVED to
 * `installed/` so the inbox is always a to-do list rather than a pile that gets
 * re-imported on every scan. Compiling and installing into the rig happen at
 * test time, so an EA can be uploaded before a test terminal is chosen.
 */
function scanInbox() {
  const lib = loadLibrary();
  const found = [];
  for (const f of readdirSync(INBOX)) {
    const ext = extname(f).toLowerCase();
    const info = EXT[ext];
    if (!info) continue;
    const name = basename(f, extname(f));
    const id = idFor(name, info.platform);
    try {
      renameSync(join(INBOX, f), join(ARCHIVE, f));
      lib[id] = {
        id,
        name,
        platform: info.platform,
        kind: info.kind,
        file: f,
        testable: true,
        path: join(ARCHIVE, f),
        compiled: null,
        compileError: null,
        addedAt: lib[id]?.addedAt ?? Date.now(),
        seenAt: Date.now(),
        autoTest: true,
      };
      found.push(id);
    } catch (e) {
      console.error(`inbox: could not take ${f}: ${e.message}`);
    }
  }
  if (found.length) saveLibrary(lib);
  return found;
}

/** EAs already sitting in a rig, so the library is not empty on first run. */
function adoptRigExperts() {
  const lib = loadLibrary();
  let added = 0;
  for (const p of Object.keys(PLATFORMS)) {
    const dir = rigExperts(p);
    if (!dir || !existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (extname(f).toLowerCase() !== PLATFORMS[p].compiled) continue;
      const name = basename(f, extname(f));
      const id = idFor(name, p);
      if (lib[id]) continue;
      lib[id] = {
        id, name, platform: p, kind: "compiled", file: f, testable: true,
        path: join(dir, f),
        addedAt: statSync(join(dir, f)).mtimeMs,
        seenAt: Date.now(),
        autoTest: false,   // adopted, not dropped: the owner chooses what to run
      };
      added++;
    }
  }
  if (added) saveLibrary(lib);
  return added;
}

// ----- processes ------------------------------------------------------------
/**
 * A MetaTrader switch with a path: /compile:"C:\a b\x.mq5". MetaTrader only
 * understands the quotes INSIDE the switch -- Node's default quoting wraps the
 * whole argument ("/compile:C:\a b\x.mq5"), which MetaEditor silently ignores,
 * so any EA or folder with a space in its name failed to compile.
 */
const sw = (flag, path) => `${flag}"${path}"`;

/**
 * Run a program to completion (or until `ms`), resolving with how it ended.
 * Arguments are passed verbatim, already quoted with `sw` where they hold paths.
 */
function runProgram(exe, args, ms) {
  return new Promise((resolve) => {
    let child;
    try {
      // argv0 carries the quoted name into the command line; `exe` stays
      // unquoted so Windows can still find the program.
      child = spawn(exe, args, { windowsHide: true, windowsVerbatimArguments: true, argv0: `"${exe}"` });
    } catch (e) { return resolve({ error: e.message }); }
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, ms);
    child.on("error", (e) => { clearTimeout(t); resolve({ error: e.message }); });
    child.on("exit", (code) => { clearTimeout(t); resolve({ code, timedOut }); });
  });
}

/**
 * Close anything still open from a previous run in the rig's install folder --
 * the terminal and, for MT5, its tester agent -- matched by EXECUTABLE PATH so
 * only the rig is ever touched. Other installs may be live trading sessions.
 *
 * This is not housekeeping, it is correctness. Shutdown-after-test only fires
 * when a test COMPLETES, so any failure leaves the terminal running, and
 * MetaTrader hands a second launch off to that existing instance and exits
 * immediately -- producing no report. One failed run would otherwise guarantee
 * every run after it failed too, in about a second each.
 */
function closeRigTerminal(p) {
  return new Promise((resolve) => {
    if (!rigs[p]) return resolve();
    const dir = dirname(rigs[p].exe).replace(/'/g, "''").replace(/\\$/, "");
    const ps = spawn("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='terminal.exe' OR Name='terminal64.exe' OR Name='metatester64.exe'" | `
      + `Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}\\', [StringComparison]::OrdinalIgnoreCase) } | `
      + `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ], { windowsHide: true });
    ps.on("exit", () => setTimeout(resolve, 1500)); // let the file locks clear
    ps.on("error", () => resolve());
  });
}

// ----- compiling ------------------------------------------------------------
/** MetaEditor lives beside the terminal; its capitalisation varies by broker build. */
function findEditor(p) {
  const dir = dirname(rigs[p].exe);
  try {
    const hit = readdirSync(dir).find((f) => f.toLowerCase() === PLATFORMS[p].editor);
    return hit ? join(dir, hit) : null;
  } catch { return null; }
}

/** Turn MetaEditor's log into a few lines the owner can act on. */
function explainCompileLog(text) {
  const errors = text.split(/\r?\n/).filter((l) => /:\s*error\s+\d+:/i.test(l));
  const missing = errors
    .map((l) => l.match(/file '([^']+)' not found/i)?.[1])
    .filter(Boolean)
    .map((f) => basename(f));
  if (missing.length) {
    return `it needs include file${missing.length > 1 ? "s" : ""} the test terminal does not have: `
      + `${[...new Set(missing)].join(", ")}. Compile it in MetaEditor where those files are and upload the compiled EA instead.`;
  }
  const lines = errors.slice(0, 3).map((l) => {
    const m = l.match(/\((\d+),\d+\)\s*:\s*error\s+\d+:\s*(.*)$/i);
    return m ? `line ${m[1]}: ${m[2].trim()}` : l.replace(/^.*?:\s*error\s+\d+:\s*/i, "").trim();
  });
  const n = text.match(/Result:\s*(\d+)\s*error/i)?.[1] ?? String(errors.length);
  return `${n} compile error${n === "1" ? "" : "s"}${lines.length ? ` - ${lines.join("; ")}` : ""}`;
}

/** Compile a source EA with its platform's MetaEditor. Resolves { file, path } or { error }. */
async function compileEa(ea) {
  const P = PLATFORMS[ea.platform];
  const editor = findEditor(ea.platform);
  if (!editor) return { error: `MetaEditor was not found next to ${rigs[ea.platform].exe}, so source cannot be compiled` };

  const dir = join(BUILD, ea.id);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  mkdirSync(dir, { recursive: true });
  const src = join(dir, ea.file);
  copyFileSync(ea.path, src);
  const log = join(dir, "compile.log");

  const args = [sw("/compile:", src), sw("/log:", log), sw("/inc:", join(rigs[ea.platform].data, P.mql))];
  if (rigPortable(ea.platform)) args.push("/portable");
  const ran = await runProgram(editor, args, 180_000);
  if (ran.error) return { error: `could not start MetaEditor: ${ran.error}` };
  if (ran.timedOut) return { error: "MetaEditor was still compiling after 3 minutes and was stopped" };

  const text = readText(log);
  const out = join(dir, basename(ea.file, extname(ea.file)) + P.compiled);
  const errorsReported = Number(text.match(/Result:\s*(\d+)\s*error/i)?.[1] ?? 0);
  if (!existsSync(out) || errorsReported > 0) {
    return { error: `did not compile: ${text ? explainCompileLog(text) : "MetaEditor wrote no log"}` };
  }
  const kept = join(ARCHIVE, basename(out));
  copyFileSync(out, kept);
  return { file: basename(out), path: kept };
}

// ----- running a test -------------------------------------------------------
const fmtDate = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`;
};

// MT4: 0 every tick, 1 control points, 2 open prices.
// MT5: 4 every tick based on REAL ticks (the broker's own history, the best a
// tester can do), 1 one-minute OHLC, 2 open prices.
const MODEL_CODE = {
  mt4: { "every-tick": 0, "control-points": 1, "open-prices": 2 },
  mt5: { "every-tick": 4, "control-points": 1, "open-prices": 2 },
};

function testerIni(p, job, expert, reportName) {
  if (p === "mt4") {
    return {
      encoding: "latin1",
      text: [
        "[Tester]",
        `TestExpert=${expert}`,
        `TestSymbol=${job.symbol}`,
        `TestPeriod=${job.timeframe}`,
        `TestModel=${MODEL_CODE.mt4[job.model] ?? 0}`,
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
      ].join("\r\n"),
    };
  }
  // MT5 reads its own .ini files as UTF-16LE, so that is what it is given.
  return {
    encoding: "utf16le",
    text: "\uFEFF" + [
      "[Tester]",
      `Expert=${expert}`,
      `Symbol=${job.symbol}`,
      `Period=${job.timeframe}`,
      `Model=${MODEL_CODE.mt5[job.model] ?? 4}`,
      "Optimization=0",
      `FromDate=${fmtDate(job.from)}`,
      `ToDate=${fmtDate(job.to)}`,
      "ForwardMode=0",
      `Deposit=${job.deposit ?? 10000}`,
      "ExecutionMode=0",
      "Visual=0",
      `Report=${reportName}`,
      "ReplaceReport=1",
      "ShutdownTerminal=1",
      "",
    ].join("\r\n"),
  };
}

/** Where each platform's tester writes its logs, which an EA can fill with gigabytes. */
function testerLogDirs(p) {
  const data = rigs[p].data;
  if (p === "mt4") return [join(data, "tester", "logs")];
  const dirs = [join(data, "Tester", "logs")];
  try {
    for (const d of readdirSync(join(data, "Tester"))) {
      if (/^Agent-/i.test(d)) dirs.push(join(data, "Tester", d, "logs"));
    }
  } catch {}
  return dirs;
}

const logSizeMb = (dirs) => {
  let bytes = 0;
  for (const d of dirs) {
    try { for (const f of readdirSync(d)) bytes += statSync(join(d, f)).size; } catch {}
  }
  return Math.round(bytes / 1e6);
};

/** The report MetaTrader wrote, whatever extension this build chose for it. */
function findReport(p, reportName) {
  const data = rigs[p].data;
  try {
    const hits = readdirSync(data).filter((f) => {
      const lower = f.toLowerCase();
      return lower.startsWith(reportName.toLowerCase()) && /\.(htm|html|xml)$/.test(lower);
    });
    hits.sort((a, b) => Number(/\.xml$/i.test(a)) - Number(/\.xml$/i.test(b)));   // HTML first
    return hits[0] ? join(data, hits[0]) : null;
  } catch { return null; }
}

async function runTest(job) {
  const lib = loadLibrary();
  const ea = lib[job.eaId];
  if (!ea) return { error: `unknown EA ${job.eaId}` };
  const p = ea.platform;
  const P = PLATFORMS[p];
  if (!rigReady(p)) {
    return { error: `no ${P.label} test terminal chosen yet - pick an ${P.label} install on the EA Lab page` };
  }
  job.platform = p;
  await closeRigTerminal(p);

  // Source is compiled every time it is tested, so a re-upload is never
  // tested against a stale build.
  let binary = { file: ea.file, path: ea.path };
  if (ea.kind === "source") {
    job.status = "compiling";
    const built = await compileEa(ea);
    if (built.error) {
      updateEa(ea.id, { compileError: built.error });
      return { error: built.error };
    }
    updateEa(ea.id, { compileError: null, compiled: { file: built.file, path: built.path, at: Date.now() } });
    binary = built;
    job.status = "running";
  }

  // Install into the rig now, so a re-upload of the same name always tests the new file.
  const experts = rigExperts(p);
  try {
    mkdirSync(experts, { recursive: true });
    const target = join(experts, binary.file);
    if (!same(binary.path, target)) copyFileSync(binary.path, target);
  } catch (e) {
    return { error: `could not install ${binary.file} into the ${P.label} test terminal: ${e.message}` };
  }

  const reportName = `ealab-${job.id}`;
  const expert = basename(binary.file, extname(binary.file));
  const ini = testerIni(p, job, expert, reportName);
  const iniPath = join(ROOT, `${job.id}.ini`);
  writeFileSync(iniPath, ini.text, ini.encoding);

  // Clear the tester logs first. An EA that logs on every tick is not a
  // theoretical problem: one hedge EA in this library churns a grid of pending
  // orders and wrote 2.4 GB in fifteen minutes, on a disk that was already 93%
  // full. Left alone it fills the drive and the log itself becomes the reason
  // the next test is slow.
  const logDirs = testerLogDirs(p);
  for (const d of logDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

  const started = Date.now();
  const args = [
    ...(rigPortable(p) ? ["/portable"] : []),
    p === "mt4" ? `"${iniPath}"` : sw("/config:", iniPath),
  ];
  // A tester run that never finishes would hold the queue forever. MetaTrader
  // also exits 0 while having produced nothing, so the report's existence - not
  // the exit code - is what decides success.
  const budget = Number(job.timeoutMs || process.env.EA_LAB_TIMEOUT_MS || 900_000);
  const ran = await runProgram(rigs[p].exe, args, budget);
  await closeRigTerminal(p);
  const seconds = Math.round((Date.now() - started) / 1000);
  if (ran.error) return { seconds, error: `could not start the ${P.label} test terminal: ${ran.error}` };

  // How much the EA wrote is diagnostic, not trivia: it separates "this EA is
  // pathologically slow" from "this run was misconfigured", and those two need
  // completely different fixes.
  const logMb = logSizeMb(logDirs);

  const produced = findReport(p, reportName);
  if (!produced) {
    return {
      seconds,
      logMb,
      error: ran.timedOut
        ? `still running after ${Math.round(budget / 1000)}s and was stopped`
          + (logMb > 200
            ? `. It wrote ${logMb} MB of tester log, so it is logging or churning orders on `
              + `every tick - test a shorter period, or accept that this EA is simply slow.`
            : `. Try a shorter period.`)
        : `the ${P.label} tester produced no report - check ${job.symbol} exists on the test terminal, `
          + "that its history covers the range (open a chart and let it download), that the terminal "
          + "is logged in, and that the EA loads",
    };
  }
  const kept = join(REPORTS, basename(produced));
  copyFileSync(produced, kept);
  for (const d of logDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  return { report: kept, seconds, logMb };
}

// ----- queue ----------------------------------------------------------------
// One test at a time. Two testers sharing a rig would fight over the same
// config and report filenames, and one at a time keeps a small VPS responsive.
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
        id: job.id, eaId: job.eaId, platform: job.platform, symbol: job.symbol, timeframe: job.timeframe,
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

const rigStatus = (p) => ({
  exe: rigs[p]?.exe ?? null,
  data: rigs[p]?.data ?? null,
  present: rigReady(p),
});

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
      rigs: { mt4: rigStatus("mt4"), mt5: rigStatus("mt5") },
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
    const pick = (await findRigs()).find((r) => same(r.exe, String(body.exe || "")));
    if (!pick) return json(res, 400, { error: "that is not an MT4 or MT5 install on this machine" });
    const cfg = readJson(CONFIG, {});
    const saved = { ...(cfg.rigs ?? {}) };
    if (!saved.mt4 && cfg.rigExe) saved.mt4 = { exe: cfg.rigExe, data: cfg.rigData };
    saved[pick.platform] = { exe: pick.exe, data: pick.data };
    delete cfg.rigExe;
    delete cfg.rigData;
    writeFileSync(CONFIG, JSON.stringify({ ...cfg, rigs: saved }, null, 2));
    rigs[pick.platform] = { exe: pick.exe, data: pick.data };
    const adopted = adoptRigExperts();
    console.log(`rig    ${PLATFORMS[pick.platform].label} ${pick.exe} (chosen on the page)`);
    pump();
    return json(res, 200, { ok: true, platform: pick.platform, adopted });
  }

  if (path === "/upload" && req.method === "POST") {
    let raw = String(req.headers["x-file-name"] || "");
    try { raw = decodeURIComponent(raw); } catch {}
    const name = basename(raw.replace(/\\/g, "/")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
    const info = EXT[extname(name).toLowerCase()];
    if (!name || !info) {
      return json(res, 400, { error: "send an EA file: .ex4, .mq4, .ex5 or .mq5" });
    }
    let data;
    try { data = await readRaw(req, MAX_UPLOAD); } catch {
      return json(res, 413, { error: "file is larger than 50 MB - that is not an EA" });
    }
    if (!data.length) return json(res, 400, { error: "the file was empty" });
    writeFileSync(join(INBOX, name), data);
    const found = scanInbox();
    const queued = queueFound(found);
    const id = idFor(basename(name, extname(name)), info.platform);
    console.log(`upload: ${name} -> ${queued.length ? "queued" : "filed"}`);
    return json(res, 200, { id, ea: loadLibrary()[id] ?? null, queued, rigReady: rigReady(info.platform) });
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
    const name = basename(decodeURIComponent(path.slice("/report/".length)));
    const file = join(REPORTS, /\.(htm|html|xml)$/i.test(name) ? name : `${name}.htm`);
    if (!existsSync(file)) return json(res, 404, { error: "no such report" });
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
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
  const show = (p) => rigs[p]
    ? `${rigs[p].exe}${rigReady(p) ? "" : "   *** NOT FOUND ***"}`
    : "not chosen yet - pick one on the page";
  console.log(`EA Lab runner on ${hostname()}`);
  console.log(`  open   http://127.0.0.1:${PORT}   <- the EA Lab page, on this machine`);
  console.log(`  MT4    ${show("mt4")}`);
  console.log(`  MT5    ${show("mt5")}`);
  console.log(`  inbox  ${INBOX}   <- or drop .ex4 / .mq4 / .ex5 / .mq5 files here`);
  console.log(`  library ${Object.keys(loadLibrary()).length} EAs${adopted ? ` (${adopted} adopted from the rigs)` : ""}`);
});
