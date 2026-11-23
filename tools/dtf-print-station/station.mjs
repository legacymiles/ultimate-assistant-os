#!/usr/bin/env node
// ---------------------------------------------------------------------------
// DTF print station — the Windows companion for DTF Studio's print bridge.
//
// Runs on the production PC next to ColorboxRIP and the Lancelot M1630 Pro.
// It does four things and nothing else:
//   1. polls the website for print jobs the owner sent to the station queue;
//   2. downloads each print file into <exportDir>\<order number>\ with a
//      job.json and a PRODUCTION.txt, then tells the website "downloaded";
//   3. shows the jobs on a page at http://127.0.0.1:<port> (this PC only);
//   4. when the operator clicks, opens the file for ColorboxRIP and reports
//      "opened", "printed" or a problem.
//
// It never prints. It never talks to the printer or to ColorboxRIP beyond
// starting the program / selecting the file in Explorer. Every status after
// "downloaded" is an operator's click. If the website is unreachable it keeps
// working from its saved state, queues the operator's reports, and retries
// with backoff.
//
// Zero npm dependencies. Node 22 or newer.
//   node station.mjs [--config <path to station.config.json>]
// ---------------------------------------------------------------------------

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as L from "./lib.mjs";

const VERSION = "1.0.0";
const HERE = path.dirname(fileURLToPath(import.meta.url));

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`DTF print station needs Node.js 22 or newer. This PC has ${process.versions.node}. Install the LTS from https://nodejs.org and run again.`);
  process.exit(1);
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const CONFIG_PATH = path.resolve(argValue("--config") ?? path.join(HERE, "station.config.json"));
const STATE_PATH = path.join(path.dirname(CONFIG_PATH), "state.json");

// ----- errors -------------------------------------------------------------------

/** The website answered with an error status. */
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Something the operator can fix on this PC; shown as-is. */
class LocalError extends Error {}

/** Unreachable, timed out, or the website itself is failing — worth retrying later. */
function isTransient(e) {
  if (e instanceof ApiError) return e.status >= 500 || e.status === 408 || e.status === 429;
  if (e instanceof LocalError) return false;
  const name = e && typeof e === "object" ? e.name : "";
  return name === "TypeError" || name === "AbortError" || name === "TimeoutError";
}

function plain(e) {
  if (e instanceof ApiError || e instanceof LocalError) return e.message;
  if (e && typeof e === "object" && "code" in e) {
    const code = e.code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      return "Windows would not let the station write the file — it may be open in ColorboxRIP or another program, or the folder is read-only. Close it and the station will try again.";
    }
    if (code === "ENOSPC") return "The disk is full. Free some space in the export folder's drive.";
    if (code === "ENOENT") return "A file or folder the station needs is missing.";
  }
  const name = e && typeof e === "object" ? e.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "The website took too long to answer.";
  if (name === "TypeError") return "The website could not be reached (no internet, wrong siteUrl, or the site is down).";
  return e instanceof Error ? e.message : String(e);
}

// ----- config ---------------------------------------------------------------------

function loadConfig() {
  let text;
  try {
    text = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch {
    console.error(
      [
        "",
        `No station config at ${CONFIG_PATH}.`,
        "",
        "  1. On the website, open DTF Production > Print bridge and click Pair station.",
        "  2. Copy station.config.example.json to station.config.json (same folder).",
        "  3. Paste the token into \"token\" and set \"siteUrl\" to the website address.",
        "  4. Run start-station.cmd again.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  let raw;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (e) {
    console.error(`station.config.json is not valid JSON: ${e instanceof Error ? e.message : e}`);
    console.error('Tip: every backslash in a Windows path must be doubled, like "C:\\\\DTF\\\\Print Jobs".');
    process.exit(1);
  }
  const { config, errors, warnings } = L.normalizeConfig(raw);
  if (errors.length) {
    console.error("station.config.json needs fixing:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  for (const w of warnings) console.warn(`Note: ${w}`);
  if (config.colorboxRipPath && !/\.exe$/i.test(config.colorboxRipPath)) {
    console.warn("Note: colorboxRipPath should point at the ColorboxRIP .exe itself, not a shortcut (.lnk).");
  }
  return config;
}

const config = loadConfig();
const POLL_MS = config.pollSeconds * 1000;

// ----- state ------------------------------------------------------------------------

function loadState() {
  let text;
  try {
    text = fs.readFileSync(STATE_PATH, "utf8");
  } catch {
    return L.emptyState();
  }
  try {
    return L.normalizeState(JSON.parse(text));
  } catch {
    const backup = STATE_PATH.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
    try {
      fs.renameSync(STATE_PATH, backup);
    } catch {
      /* keep going with an empty state */
    }
    console.warn(`state.json could not be read; it was kept as ${path.basename(backup)} and the station starts fresh.`);
    return L.emptyState();
  }
}

let state = loadState();
if (!state.localKey || state.localKey.length < 24) state.localKey = crypto.randomBytes(24).toString("base64url");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (e) {
      if (i >= 4 || !(e && (e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES"))) throw e;
      await sleep(120 * (i + 1));
    }
  }
}

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data);
  try {
    await renameRetry(tmp, file);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

let stateChain = Promise.resolve();
function saveState() {
  const snapshot = JSON.stringify(state, null, 2);
  stateChain = stateChain
    .then(() => writeAtomic(STATE_PATH, snapshot))
    .catch((e) => log(`Could not save state.json: ${plain(e)}`, "warn"));
  return stateChain;
}

// ----- runtime + activity log -----------------------------------------------------------

const runtime = {
  version: 1,
  conn: config.token ? "starting" : "unpaired",
  message: config.token ? "Connecting to the website…" : "No token in station.config.json. Pair this PC from DTF Production › Print bridge.",
  failures: 0,
  lastOkAt: null,
  nextAttemptAt: null,
  diskError: null,
  loose: [],
  events: [],
  ripFound: config.colorboxRipPath ? fs.existsSync(config.colorboxRipPath) : false,
};

function bump() {
  runtime.version++;
}

function now() {
  return new Date().toISOString();
}

function log(message, level = "info") {
  const at = now();
  runtime.events.unshift({ at, level, message });
  if (runtime.events.length > 120) runtime.events.length = 120;
  const line = `[${at.slice(11, 19)}] ${message}`;
  if (level === "warn") console.warn(line);
  else console.log(line);
  bump();
}

function setConn(conn, message) {
  if (runtime.conn !== conn) log(message, conn === "online" ? "info" : "warn");
  if (runtime.conn === conn && runtime.message === message) return;
  runtime.conn = conn;
  runtime.message = message;
  bump();
}

// ----- website API ------------------------------------------------------------------

async function api(method, pathname, { body, timeoutMs = 30_000, followRedirect = false } = {}) {
  const headers = {
    Authorization: `Bearer ${config.token}`,
    "x-dtf-station-host": L.headerSafe(os.hostname()),
    "x-dtf-export-dir": L.headerSafe(config.exportDir),
    "User-Agent": `dtf-print-station/${VERSION}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(config.siteUrl + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    // Only the print-file download may redirect: with cloud storage the site
    // answers with a short-lived signed storage link (large PNGs cannot pass
    // through a serverless function). fetch drops the bearer token on that
    // cross-origin hop, so the token never leaves the website.
    redirect: followRedirect ? "follow" : "error",
  });
  if (!res.ok) {
    let message = `The website answered ${res.status}.`;
    try {
      const j = await res.json();
      if (j && typeof j.error === "string") message = j.error;
    } catch {
      /* not JSON */
    }
    if (res.status === 401) message = `${message} Pair this PC again from DTF Production › Print bridge and paste the new token.`;
    if (res.status === 404 && pathname.startsWith("/api/dtf/station/jobs")) {
      message = "The website has no print-bridge endpoint at that address. Check siteUrl in station.config.json.";
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

// ----- files on disk -------------------------------------------------------------------

function entriesForOrder(orderId) {
  const order = { front: 0, back: 1, "sleeve-left": 2, "sleeve-right": 3 };
  return Object.values(state.jobs)
    .filter((e) => e.job.orderId === orderId)
    .sort((a, b) => (order[a.job.side] ?? 9) - (order[b.job.side] ?? 9) || String(a.job.jobId).localeCompare(String(b.job.jobId)));
}

async function writeOrderFiles(orderId) {
  const entries = entriesForOrder(orderId).filter((e) => e.local?.file);
  if (!entries.length) return;
  const p = L.jobPaths(config.exportDir, entries[0].job);
  try {
    await fsp.mkdir(p.dir, { recursive: true });
    const at = now();
    await writeAtomic(p.jobJson, JSON.stringify(L.orderJson(entries, state.printer, at), null, 2));
    await writeAtomic(p.production, L.productionText(entries, state.printer?.ripOwns ?? L.DEFAULT_RIP_OWNS, at));
  } catch (e) {
    log(`Could not write job.json / PRODUCTION.txt for ${entries[0].job.orderNumber}: ${plain(e)}`, "warn");
  }
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function downloadJob(entry) {
  const j = entry.job;
  const p = L.jobPaths(config.exportDir, j);
  if (!L.isInside(config.exportDir, p.png)) throw new LocalError("Refused a file name that would land outside the export folder.");
  await fsp.mkdir(p.dir, { recursive: true });
  const res = await api(
    "GET",
    `/api/dtf/station/file?order=${encodeURIComponent(j.orderId)}&job=${encodeURIComponent(j.jobId)}`,
    { timeoutMs: 180_000, followRedirect: true },
  );
  const buf = Buffer.from(await res.arrayBuffer());
  if (!L.isPng(buf)) throw new LocalError("The website sent something that is not a PNG, so it was not saved.");
  if (j.file?.bytes && buf.length !== j.file.bytes) {
    log(`${j.orderNumber} ${j.sideLabel}: file is ${L.formatBytes(buf.length)}, the website listed ${L.formatBytes(j.file.bytes)}. Saved anyway.`, "warn");
  }
  const digest = sha256(buf);
  let same = false;
  try {
    same = sha256(await fsp.readFile(p.png)) === digest;
  } catch {
    same = false;
  }
  if (!same) {
    await fsp.writeFile(p.part, buf);
    try {
      await renameRetry(p.part, p.png);
    } catch (e) {
      await fsp.rm(p.part, { force: true }).catch(() => {});
      throw e;
    }
  }
  const st = await fsp.stat(p.png);
  entry.local = {
    ...entry.local,
    file: p.png,
    sha256: digest,
    bytes: buf.length,
    downloadedAt: now(),
    onDisk: true,
    mtimeMs: st.mtimeMs,
    redownload: false,
  };
  entry.lastError = null;
  if (entry.serverStatus === "queued" && !entry.pending.some((r) => r.status === "downloaded")) {
    entry.pending.push({ status: "downloaded", path: p.png, at: now() });
    entry.status = "downloaded";
  }
  entry.updatedAt = now();
  await writeOrderFiles(j.orderId);
  await saveState();
  log(`${same ? "Already had" : "Saved"} ${path.basename(p.png)} in ${path.basename(p.dir)}.`);
}

async function downloadDue() {
  for (const entry of Object.values(state.jobs)) {
    if (!L.needsDownload(entry)) continue;
    try {
      await downloadJob(entry);
    } catch (e) {
      if (isTransient(e) || (e instanceof ApiError && e.status === 401)) throw e;
      entry.lastError = plain(e);
      entry.local = { ...entry.local, redownload: false };
      log(`${entry.job.orderNumber} ${entry.job.sideLabel}: ${entry.lastError}`, "warn");
      await saveState();
    }
  }
}

async function flushOutbox() {
  for (const entry of Object.values(state.jobs)) {
    while (entry.pending.length) {
      const rep = entry.pending[0];
      try {
        const res = await api("POST", "/api/dtf/station/status", {
          body: { orderId: entry.job.orderId, jobId: entry.job.jobId, status: rep.status, path: rep.path, error: rep.error },
        });
        const data = await res.json().catch(() => ({}));
        entry.pending.shift();
        if (data && data.job && typeof data.job === "object") {
          entry.job = { ...entry.job, ...data.job };
          entry.serverStatus = data.job.status;
        }
        if (!entry.pending.length && entry.status !== "withdrawn") entry.status = entry.serverStatus ?? entry.status;
        entry.lastError = null;
        entry.updatedAt = now();
        log(`Told the website: ${entry.job.orderNumber} ${entry.job.sideLabel} ${rep.status}.`);
      } catch (e) {
        if (isTransient(e) || (e instanceof ApiError && e.status === 401)) throw e;
        entry.pending.shift();
        entry.lastError = `The website did not accept "${rep.status}": ${plain(e)}`;
        if (!entry.pending.length && entry.status !== "withdrawn") entry.status = entry.serverStatus ?? entry.status;
        log(`${entry.job.orderNumber} ${entry.job.sideLabel}: ${entry.lastError}`, "warn");
      }
      await saveState();
      await writeOrderFiles(entry.job.orderId);
    }
  }
}

// ----- the export folder: watch it, scan it ---------------------------------------------

const IGNORE = new Set(["job.json", "production.txt"]);

async function scanDisk() {
  const known = new Map();
  for (const e of Object.values(state.jobs)) if (e.local?.file) known.set(path.resolve(e.local.file).toLowerCase(), e);
  let changed = false;
  for (const e of known.values()) {
    let onDisk = false;
    let mtimeMs = e.local.mtimeMs ?? null;
    try {
      const st = await fsp.stat(e.local.file);
      onDisk = st.isFile();
      mtimeMs = st.mtimeMs;
    } catch {
      onDisk = false;
    }
    if (onDisk !== e.local.onDisk || mtimeMs !== e.local.mtimeMs) {
      if (onDisk !== e.local.onDisk) {
        log(`${path.basename(e.local.file)} ${onDisk ? "is back in" : "was removed from"} the export folder.`, onDisk ? "info" : "warn");
      }
      e.local = { ...e.local, onDisk, mtimeMs };
      changed = true;
    }
  }

  const loose = [];
  try {
    const top = await fsp.readdir(config.exportDir, { withFileTypes: true });
    for (const d of top) {
      if (loose.length >= 300) break;
      const full = path.join(config.exportDir, d.name);
      if (d.isFile()) {
        if (!known.has(full.toLowerCase())) loose.push(await looseInfo(full, ""));
        continue;
      }
      if (!d.isDirectory()) continue;
      let inner = [];
      try {
        inner = await fsp.readdir(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of inner) {
        if (loose.length >= 300) break;
        if (!f.isFile()) continue;
        const lower = f.name.toLowerCase();
        if (IGNORE.has(lower) || lower.endsWith(".part") || lower.endsWith(".tmp")) continue;
        const fp = path.join(full, f.name);
        if (!known.has(fp.toLowerCase())) loose.push(await looseInfo(fp, d.name));
      }
    }
    if (runtime.diskError) {
      runtime.diskError = null;
      changed = true;
    }
  } catch (e) {
    const msg = `The export folder ${config.exportDir} cannot be read: ${plain(e)}`;
    if (runtime.diskError !== msg) {
      runtime.diskError = msg;
      changed = true;
    }
  }
  const sig = JSON.stringify(loose);
  if (sig !== JSON.stringify(runtime.loose)) {
    runtime.loose = loose;
    changed = true;
  }
  if (changed) {
    bump();
    await saveState();
  }
}

async function looseInfo(full, folder) {
  let bytes = 0;
  let mtime = null;
  try {
    const st = await fsp.stat(full);
    bytes = st.size;
    mtime = new Date(st.mtimeMs).toISOString();
  } catch {
    /* vanished between readdir and stat */
  }
  return { rel: path.relative(config.exportDir, full), name: path.basename(full), folder, bytes, mtime };
}

let scanTimer = null;
function scanSoon() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => scanDisk().catch((e) => log(`Folder scan failed: ${plain(e)}`, "warn")), 500);
}

let watcher = null;
function watchExportDir() {
  try {
    fs.mkdirSync(config.exportDir, { recursive: true });
  } catch (e) {
    runtime.diskError = `Could not create the export folder ${config.exportDir}: ${plain(e)}`;
    log(runtime.diskError, "warn");
    setTimeout(watchExportDir, 30_000);
    return;
  }
  try {
    watcher = fs.watch(config.exportDir, { recursive: true }, () => scanSoon());
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
      log("Lost the watch on the export folder; trying again in 10 seconds.", "warn");
      setTimeout(watchExportDir, 10_000);
    });
  } catch (e) {
    log(`Cannot watch the export folder (${plain(e)}). Changes made by hand will show on the next poll.`, "warn");
  }
  scanSoon();
}

// ----- the sync loop -----------------------------------------------------------------------

let syncing = false;
let syncAgain = false;
let syncTimer = null;

async function sync() {
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  clearTimeout(syncTimer);
  let delay = POLL_MS;
  try {
    if (!config.token) {
      setConn("unpaired", "No token in station.config.json. Pair this PC from DTF Production › Print bridge.");
      delay = 60_000;
      return;
    }
    await flushOutbox();
    const res = await api("GET", "/api/dtf/station/jobs");
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.jobs)) throw new ApiError(502, "The website sent an unexpected reply to the job list.");

    const before = state.jobs;
    const beforeSig = JSON.stringify(before);
    state = L.mergeServerJobs(state, data.jobs, now());
    if (data.printer && Array.isArray(data.printer.ripOwns)) state.printer = data.printer;
    state = L.pruneState(state, Date.now());
    const touched = new Set();
    for (const e of Object.values(state.jobs)) {
      const prev = before[e.key];
      if (e.local?.file && (!prev || JSON.stringify(prev.job) !== JSON.stringify(e.job) || prev.status !== e.status)) touched.add(e.job.orderId);
      if (prev && prev.status !== "withdrawn" && e.status === "withdrawn") {
        log(`${e.job.orderNumber} ${e.job.sideLabel} was taken out of the queue on the website. Its file stays in the folder.`, "warn");
      }
      if (!prev) log(`New job: ${e.job.orderNumber} ${e.job.sideLabel} (${e.job.zoneLabel}).`);
    }
    if (JSON.stringify(state.jobs) !== beforeSig) bump();
    await saveState();
    runtime.failures = 0;
    runtime.lastOkAt = now();
    setConn("online", "Connected to the website.");

    await downloadDue();
    await flushOutbox();
    for (const id of touched) await writeOrderFiles(id);
    await scanDisk();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      setConn("unpaired", e.message);
      delay = 60_000;
    } else if (isTransient(e)) {
      runtime.failures++;
      delay = L.backoffMs(runtime.failures, POLL_MS);
      setConn("offline", `${plain(e)} Retrying in ${Math.round(delay / 1000)} s. Files already here still work.`);
    } else {
      runtime.failures++;
      delay = L.backoffMs(runtime.failures, POLL_MS);
      setConn("error", `${plain(e)} Retrying in ${Math.round(delay / 1000)} s.`);
    }
  } finally {
    syncing = false;
    // No bump here: the page refreshes the banner on its own, and re-rendering
    // the job list every poll would swap buttons out from under the cursor.
    runtime.nextAttemptAt = new Date(Date.now() + delay).toISOString();
    syncTimer = setTimeout(sync, delay);
    if (syncAgain) {
      syncAgain = false;
      setImmediate(sync);
    }
  }
}

// ----- opening files (operator clicks only) ---------------------------------------------------

function launch(exe, args) {
  const child = spawn(exe, args, { detached: true, stdio: "ignore", cwd: path.dirname(exe) });
  child.on("error", (e) => log(`Could not start ${path.basename(exe)}: ${plain(e)}`, "warn"));
  child.unref();
}

function reveal(file) {
  let child;
  if (process.platform === "win32") {
    // explorer wants /select,"<path>" as one verbatim argument. Windows paths
    // cannot contain a double quote, so this cannot be broken out of.
    child = spawn("explorer.exe", [`/select,"${file}"`], { windowsVerbatimArguments: true, detached: true, stdio: "ignore" });
  } else if (process.platform === "darwin") {
    child = spawn("open", ["-R", file], { detached: true, stdio: "ignore" });
  } else {
    child = spawn("xdg-open", [path.dirname(file)], { detached: true, stdio: "ignore" });
  }
  child.on("error", (e) => log(`Could not open the folder: ${plain(e)}`, "warn"));
  child.unref();
}

function isRunning(exe) {
  if (process.platform !== "win32") return Promise.resolve(false);
  const image = path.basename(exe);
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH", "/FO", "CSV"], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      resolve(!err && String(stdout).toLowerCase().includes(`"${image.toLowerCase()}"`));
    });
  });
}

function entryFile(entry) {
  const file = entry.local?.file;
  if (!file) throw new LocalError("This job's file has not been downloaded yet.");
  if (!L.isInside(config.exportDir, file)) throw new LocalError("This job's file is outside the export folder set in station.config.json.");
  if (!fs.existsSync(file)) throw new LocalError("The file is no longer in the export folder. Click Download again.");
  return file;
}

function queueReport(entry, status, extra = {}) {
  if (!L.canStationReport(entry.status, status)) {
    throw new LocalError(`This job is "${entry.status}", so it cannot be marked ${status}.`);
  }
  if (!(status === "opened" && entry.status === "opened")) entry.pending.push({ status, at: now(), ...extra });
  entry.status = status;
  entry.updatedAt = now();
}

async function act(action, key, body) {
  if (action === "sync") return { message: "Checking the website now." };
  if (action === "reveal-loose") {
    const rel = String(body.rel ?? "");
    const full = path.resolve(config.exportDir, rel);
    if (!rel || !L.isInside(config.exportDir, full) || !fs.existsSync(full)) throw new LocalError("That file is not in the export folder.");
    reveal(full);
    return { message: "Opened the folder." };
  }
  const entry = state.jobs[key];
  if (!entry) throw new LocalError("That job is not on this station.");
  const name = `${entry.job.orderNumber} ${entry.job.sideLabel}`;

  switch (action) {
    case "open": {
      const file = entryFile(entry);
      if (!L.canStationReport(entry.status, "opened")) throw new LocalError(`This job is "${entry.status}" and cannot be opened from here.`);
      let message;
      if (config.openMode === "argument") {
        if (!config.colorboxRipPath || !fs.existsSync(config.colorboxRipPath)) {
          throw new LocalError("colorboxRipPath in station.config.json does not point at an existing file.");
        }
        launch(config.colorboxRipPath, [file]);
        message = "Asked ColorboxRIP to open the file.";
      } else {
        if (config.colorboxRipPath && fs.existsSync(config.colorboxRipPath)) {
          if (await isRunning(config.colorboxRipPath)) {
            message = "ColorboxRIP is already running. The file is selected in Explorer — drag it into ColorboxRIP or use its Import.";
          } else {
            launch(config.colorboxRipPath, []);
            message = "Started ColorboxRIP and selected the file in Explorer — drag it in or use ColorboxRIP's Import.";
          }
        } else {
          message = "Selected the file in Explorer — drag it into ColorboxRIP or use its Import.";
        }
        reveal(file);
      }
      // A poll may have replaced the entry object while we waited on tasklist.
      queueReport(state.jobs[key] ?? entry, "opened");
      log(`${name}: opened for ColorboxRIP.`);
      return { message };
    }
    case "reveal":
      reveal(entryFile(entry));
      return { message: "Opened the folder with the file selected." };
    case "printed":
      queueReport(entry, "printed");
      entry.local = { ...entry.local, printedAt: now() };
      log(`${name}: marked printed by the operator.`);
      return { message: `${name} marked printed.` };
    case "problem": {
      const text = String(body.text ?? "").trim().slice(0, 500);
      if (!text) throw new LocalError("Write what went wrong first.");
      queueReport(entry, "failed", { error: text });
      entry.local = { ...entry.local, problem: text };
      log(`${name}: problem reported — ${text}`, "warn");
      return { message: `${name} reported as a problem.` };
    }
    case "redownload":
      if (entry.status === "withdrawn") throw new LocalError("This job was taken out of the queue on the website, so its file cannot be fetched.");
      entry.local = { ...entry.local, redownload: true };
      entry.lastError = null;
      return { message: "Downloading it again." };
    default:
      throw new LocalError("Unknown action.");
  }
}

// ----- the local page ----------------------------------------------------------------------

const COOKIE = "dtf_station_key";
const keyBuf = () => Buffer.from(state.localKey);

function keyOk(candidate) {
  if (typeof candidate !== "string" || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = keyBuf();
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function securityHeaders(res, nonce) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src ${nonce ? `'nonce-${nonce}'` : "'none'"}; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  );
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

function readBody(req, limit = 16_384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new LocalError("Request too large."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function snapshot() {
  return {
    version: runtime.version,
    station: {
      host: os.hostname(),
      exportDir: config.exportDir,
      siteUrl: config.siteUrl,
      openMode: config.openMode,
      ripConfigured: Boolean(config.colorboxRipPath),
      ripFound: runtime.ripFound,
      pollSeconds: config.pollSeconds,
      appVersion: VERSION,
    },
    conn: {
      state: runtime.conn,
      message: runtime.message,
      lastOkAt: runtime.lastOkAt,
      nextAttemptAt: runtime.nextAttemptAt,
      failures: runtime.failures,
    },
    printer: state.printer,
    diskError: runtime.diskError,
    jobs: Object.values(state.jobs).map((e) => ({
      key: e.key,
      job: e.job,
      status: e.status,
      serverStatus: e.serverStatus,
      pending: e.pending.map((p) => p.status),
      file: e.local?.file ?? null,
      fileName: e.local?.file ? path.basename(e.local.file) : null,
      onDisk: Boolean(e.local?.onDisk),
      mtimeMs: e.local?.mtimeMs ?? null,
      downloadedAt: e.local?.downloadedAt ?? null,
      problem: e.local?.problem ?? null,
      lastError: e.lastError ?? null,
      withdrawnAt: e.withdrawnAt ?? null,
      updatedAt: e.updatedAt ?? null,
    })),
    loose: runtime.loose,
    events: runtime.events.slice(0, 60),
  };
}

async function handle(req, res) {
  const port = config.port;
  if (!L.isLoopbackHost(req.headers.host, port)) return sendText(res, 403, "This page only answers on 127.0.0.1.");
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const cookies = L.parseCookies(req.headers.cookie);
  const authed = keyOk(cookies[COOKIE]);

  if (req.method === "GET" && url.pathname === "/") {
    const q = url.searchParams.get("key");
    if (q !== null) {
      securityHeaders(res);
      if (!keyOk(q)) return sendText(res, 401, "That station key is not right. Use the link printed in the station's console window.");
      res.writeHead(303, {
        "Set-Cookie": `${COOKIE}=${encodeURIComponent(state.localKey)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
        Location: "/",
        "Cache-Control": "no-store",
      });
      return res.end();
    }
    if (!authed) {
      securityHeaders(res);
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(lockedPage());
    }
    const nonce = crypto.randomBytes(16).toString("base64");
    securityHeaders(res, nonce);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(pageHtml(nonce, state.localKey));
  }

  if (!authed) return sendJson(res, 401, { error: "Open the station link with ?key= from the console window first." });

  if (req.method === "GET" && url.pathname === "/api/state") return sendJson(res, 200, snapshot());

  if (req.method === "GET" && url.pathname === "/file") {
    const entry = state.jobs[url.searchParams.get("k") ?? ""];
    const file = entry?.local?.file;
    if (!file || !L.isInside(config.exportDir, file)) return sendText(res, 404, "No such file.");
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      return sendText(res, 404, "The file is not in the export folder.");
    }
    const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
    securityHeaders(res);
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": st.size, ETag: etag, "Cache-Control": "private, no-cache" });
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/action") {
    if (!keyOk(req.headers["x-station-key"])) return sendJson(res, 403, { error: "Missing station key header." });
    const origin = req.headers.origin;
    if (origin && !L.isLoopbackHost(origin.replace(/^https?:\/\//, ""), port)) return sendJson(res, 403, { error: "Wrong origin." });
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return sendJson(res, 400, { error: "Send JSON." });
    }
    try {
      const result = await act(String(body.action ?? ""), String(body.key ?? ""), body);
      await saveState();
      if (body.key && state.jobs[body.key]) await writeOrderFiles(state.jobs[body.key].job.orderId);
      bump();
      setImmediate(sync);
      return sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      return sendJson(res, e instanceof LocalError ? 409 : 500, { error: plain(e) });
    }
  }

  return sendText(res, 404, "Not found.");
}

function lockedPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DTF Print Station</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0C0E;color:#ECEEF2;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:440px;padding:28px;background:#14161A;border:1px solid rgba(255,255,255,.07);border-radius:10px}h1{font-size:15px;margin:0 0 8px}p{color:#8D939E;margin:0}</style></head>
<body><main><h1>Station locked</h1><p>Open the link printed in the print station's console window. It ends in <code>?key=…</code> and only needs to be opened once on this PC.</p></main></body></html>`;
}

// The page is one self-contained document. The client script avoids template
// literals so it can live inside this one.
function pageHtml(nonce, key) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DTF Print Station</title>
<style>
:root{--bg:#0B0C0E;--sf:#14161A;--sf2:#191C21;--hl:rgba(255,255,255,.07);--hl2:rgba(255,255,255,.12);--tx:#ECEEF2;--mu:#8D939E;--ac:#5EE1FF;--warn:#F2B66D;--mono:ui-monospace,"Cascadia Mono",Consolas,monospace}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--tx);font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
header{position:sticky;top:0;z-index:5;background:rgba(11,12,14,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--hl)}
.bar{max-width:1280px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.brand{font-weight:600;letter-spacing:.01em}
.brand small{color:var(--mu);font-weight:400;margin-left:8px}
.meta{color:var(--mu);display:flex;gap:4px 14px;flex-wrap:wrap;font-size:12px;min-width:0;flex:1 1 320px}
.meta>span{min-width:0;overflow-wrap:anywhere}
.spacer{flex:1}
.conn{display:flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid var(--hl);border-radius:999px;font-size:12px;color:var(--mu);max-width:min(560px,100%);min-width:0}
.conn i{width:7px;height:7px;border-radius:50%;background:var(--mu);flex:none}
.conn[data-s=online] i{background:var(--ac);box-shadow:0 0 0 3px rgba(94,225,255,.15)}
.conn[data-s=offline] i,.conn[data-s=error] i,.conn[data-s=unpaired] i{background:var(--warn)}
.conn span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:6px;border:1px solid var(--hl2);background:transparent;cursor:pointer;font-size:12px;white-space:nowrap}
.btn:hover{background:rgba(255,255,255,.04)}
.btn:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.btn.primary{background:var(--ac);color:#071216;border-color:var(--ac);font-weight:600}
.btn.primary:hover{filter:brightness(1.08)}
.btn[disabled]{opacity:.4;cursor:not-allowed}
main{max-width:1280px;margin:0 auto;padding:18px 20px 80px}
.notice{border:1px solid var(--hl);border-left:2px solid var(--warn);background:var(--sf);padding:10px 14px;border-radius:8px;margin-bottom:14px;color:var(--tx)}
h2{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mu);margin:26px 0 10px;display:flex;gap:10px;align-items:baseline}
h2 .count{font-family:var(--mono);color:var(--tx);letter-spacing:0}
.order{background:var(--sf);border:1px solid var(--hl);border-radius:10px;margin-bottom:12px;overflow:hidden}
.ohead{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--hl)}
.onum{font-family:var(--mono);font-size:14px;font-weight:600}
.ocust{color:var(--tx)}
.osum{color:var(--mu)}
.swatch{display:inline-block;width:10px;height:10px;border-radius:2px;border:1px solid var(--hl2);vertical-align:-1px;margin-right:5px}
.notes{padding:10px 16px;border-bottom:1px solid var(--hl);color:var(--tx);white-space:pre-wrap;background:var(--sf2)}
.notes b{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mu);font-weight:600;margin-right:8px}
.job{display:grid;grid-template-columns:148px 1fr auto;gap:16px;padding:14px 16px;border-top:1px solid var(--hl)}
.job:first-of-type{border-top:0}
.thumb{width:148px;height:148px;border-radius:6px;border:1px solid var(--hl);background-color:#202329;background-image:linear-gradient(45deg,#2a2e35 25%,transparent 25%),linear-gradient(-45deg,#2a2e35 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2e35 75%),linear-gradient(-45deg,transparent 75%,#2a2e35 75%);background-size:14px 14px;background-position:0 0,0 7px,7px -7px,-7px 0;display:grid;place-items:center;overflow:hidden;color:var(--mu);font-size:11px;text-align:center;padding:6px}
.thumb img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.jtitle{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.jtitle b{font-size:14px;font-weight:600}
.pill{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--hl2);color:var(--mu);white-space:nowrap}
.pill.ac{color:var(--ac);border-color:rgba(94,225,255,.35)}
.pill.solid{background:var(--ac);border-color:var(--ac);color:#071216;font-weight:600}
.pill.warn{color:var(--warn);border-color:rgba(242,182,109,.35)}
dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px 18px;margin:0}
dt{font-size:11px;color:var(--mu)}
dd{margin:0}
.path{margin-top:8px;font-family:var(--mono);font-size:11px;color:var(--mu);word-break:break-all}
.err{margin-top:8px;color:var(--warn)}
.acts{display:flex;flex-direction:column;gap:6px;min-width:150px}
.empty{padding:28px;text-align:center;color:var(--mu);border:1px dashed var(--hl2);border-radius:10px}
table{width:100%;border-collapse:collapse;background:var(--sf);border:1px solid var(--hl);border-radius:10px;overflow:hidden}
td,th{padding:8px 12px;border-top:1px solid var(--hl);text-align:left;font-weight:400}
th{color:var(--mu);font-size:11px;border-top:0}
.log{font-family:var(--mono);font-size:11.5px;color:var(--mu);background:var(--sf);border:1px solid var(--hl);border-radius:10px;padding:10px 14px;max-height:260px;overflow:auto}
.log div{padding:2px 0}
.log .w{color:var(--warn)}
.log time{color:#5d636d;margin-right:10px}
dialog{background:var(--sf);color:var(--tx);border:1px solid var(--hl2);border-radius:10px;padding:0;width:min(460px,92vw)}
dialog::backdrop{background:rgba(0,0,0,.6)}
.dlg{padding:18px}
.dlg h3{margin:0 0 6px;font-size:15px}
.dlg p{margin:0 0 12px;color:var(--mu)}
.dlg textarea:focus-visible{outline:2px solid var(--ac);outline-offset:1px}
.dlg textarea{width:100%;min-height:90px;background:var(--bg);color:var(--tx);border:1px solid var(--hl2);border-radius:6px;padding:8px;font:inherit;resize:vertical}
.dlg .row{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:var(--sf2);border:1px solid var(--hl2);padding:9px 14px;border-radius:8px;max-width:90vw;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.on{opacity:1}
.toast.bad{border-color:rgba(242,182,109,.5);color:var(--warn)}
details summary{cursor:pointer;color:var(--mu);margin:22px 0 10px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600}
@media (max-width:760px){.job{grid-template-columns:96px 1fr}.thumb{width:96px;height:96px}.acts{grid-column:1/-1;flex-direction:row;flex-wrap:wrap}}
@media (prefers-reduced-motion:reduce){.toast{transition:none}}
</style>
</head>
<body>
<header><div class="bar">
  <div class="brand">DTF Print Station<small id="host"></small></div>
  <div class="meta"><span>Export folder <span class="mono" id="dir"></span></span><span id="rip"></span></div>
  <div class="conn" id="conn" data-s="starting"><i></i><span id="connText">Starting…</span></div>
  <button class="btn" id="syncBtn" type="button">Check now</button>
</div></header>
<main>
  <div id="notices"></div>
  <h2>To print <span class="count" id="activeCount">0</span></h2>
  <div id="active"></div>
  <details id="doneWrap"><summary>Done and removed <span class="mono" id="doneCount">0</span></summary><div id="done"></div></details>
  <h2>Other files in the export folder <span class="count" id="looseCount">0</span></h2>
  <div id="loose"></div>
  <h2>Activity</h2>
  <div class="log" id="log"></div>
</main>
<dialog id="dlg"><form method="dialog" class="dlg" id="dlgForm">
  <h3 id="dlgTitle"></h3><p id="dlgBody"></p>
  <textarea id="dlgText" placeholder="What went wrong? e.g. white layer missing, banding, wrong size" maxlength="500"></textarea>
  <div class="row"><button class="btn" value="cancel" type="submit">Cancel</button><button class="btn primary" id="dlgOk" value="ok" type="submit">Confirm</button></div>
</form></dialog>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
(function(){
"use strict";
var KEY = ${JSON.stringify(key)};
var lastVersion = -1;
var data = null;
var LABEL = {queued:"Downloading",downloaded:"In export folder",opened:"Opened in RIP",printed:"Printed",failed:"Problem reported",withdrawn:"Removed from queue"};
var CONN = {online:"Online",offline:"Offline — retrying",unpaired:"Not paired",error:"Error",starting:"Connecting"};

function $(id){return document.getElementById(id);}
function h(tag, attrs, kids){
  var el = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    var v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.slice(0,2) === "on") el.addEventListener(k.slice(2), v);
    else if (k === "style") el.setAttribute("style", v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  (kids || []).forEach(function(c){ if (c == null || c === false) return; el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
  return el;
}
function n1(x){ var n = Number(x); return isFinite(n) ? n.toFixed(1) : "?"; }
function bytes(b){ b = Number(b)||0; if (b < 1024) return b + " B"; if (b < 1048576) return Math.round(b/1024) + " KB"; return (b/1048576).toFixed(1) + " MB"; }
function when(iso){ if (!iso) return "—"; var d = new Date(iso); return d.toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}); }
function ago(iso){ if (!iso) return "never"; var s = Math.round((Date.now() - Date.parse(iso))/1000); if (s < 60) return s + " s ago"; if (s < 3600) return Math.round(s/60) + " min ago"; return Math.round(s/3600) + " h ago"; }
function press(j){
  var off = Number(j.pressCenterOffsetCm);
  var across = !isFinite(off) || Math.abs(off) < 0.05 ? "centred" : (Math.abs(off).toFixed(1) + " cm " + (off > 0 ? "right" : "left") + " of centre");
  return n1(j.pressTopCm) + " cm below collar, " + across;
}

var toastTimer;
function toast(msg, bad){
  var t = $("toast"); t.textContent = msg; t.className = "toast on" + (bad ? " bad" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.className = "toast"; }, 4200);
}

function ask(opts){
  return new Promise(function(resolve){
    var d = $("dlg");
    $("dlgTitle").textContent = opts.title;
    $("dlgBody").textContent = opts.body;
    $("dlgOk").textContent = opts.ok || "Confirm";
    var ta = $("dlgText"); ta.value = ""; ta.style.display = opts.input ? "block" : "none";
    d.returnValue = "";
    function done(){ d.removeEventListener("close", done); resolve(d.returnValue === "ok" ? (opts.input ? ta.value.trim() : true) : null); }
    d.addEventListener("close", done);
    d.showModal();
    if (opts.input) ta.focus();
  });
}

function act(action, key, extra){
  var body = {action: action, key: key};
  if (extra) for (var k in extra) body[k] = extra[k];
  return fetch("/api/action", {method:"POST", headers:{"Content-Type":"application/json","x-station-key":KEY}, body: JSON.stringify(body), credentials:"same-origin"})
    .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || "That did not work."); return j; }); })
    .then(function(j){ if (j.message) toast(j.message); poll(true); })
    .catch(function(e){ toast(e.message, true); });
}

function jobCard(e){
  var j = e.job; var f = j.file || {};
  var st = e.status;
  var pills = [h("span", {class: "pill " + (st === "downloaded" ? "solid" : st === "opened" ? "ac" : st === "failed" || st === "withdrawn" ? "warn" : ""), text: LABEL[st] || st})];
  if (e.pending.length) pills.push(h("span", {class:"pill warn", text:"Waiting to tell the website"}));
  if (e.file && !e.onDisk) pills.push(h("span", {class:"pill warn", text:"Missing from folder"}));
  if (f.upsampled) pills.push(h("span", {class:"pill warn", text:"Upsampled — check at 100%"}));

  var thumb = e.file && e.onDisk
    ? h("div", {class:"thumb"}, [h("img", {src: "/file?k=" + encodeURIComponent(e.key) + "&v=" + (e.mtimeMs || 0), alt: j.orderNumber + " " + j.sideLabel + " artwork", loading:"lazy", decoding:"async"})])
    : h("div", {class:"thumb"}, [st === "queued" ? "Downloading…" : "No file on this PC"]);

  var dl = h("dl", null, [
    h("div", null, [h("dt", {text:"Placement"}), h("dd", {text: j.sideLabel + " · " + j.zoneLabel})]),
    h("div", null, [h("dt", {text:"Press position"}), h("dd", {text: press(j)})]),
    h("div", null, [h("dt", {text:"Artwork size"}), h("dd", {class:"mono", text: n1(j.artworkWidthCm) + " × " + n1(j.artworkHeightCm) + " cm"})]),
    h("div", null, [h("dt", {text:"Pixels"}), h("dd", {class:"mono", text: f.widthPx ? (f.widthPx + " × " + f.heightPx + " px @ " + f.dpi + " dpi") : "—"})]),
    h("div", null, [h("dt", {text:"Lowest source DPI"}), h("dd", {class:"mono", text: f.minSourceDpi != null ? String(Math.round(f.minSourceDpi)) : "—"})]),
    h("div", null, [h("dt", {text:"File size"}), h("dd", {class:"mono", text: f.bytes ? bytes(f.bytes) : "—"})]),
    h("div", null, [h("dt", {text:"Garment"}), h("dd", null, [h("span", {class:"swatch", style:"background:" + (/^#[0-9a-fA-F]{3,8}$/.test(j.colorHex) ? j.colorHex : "transparent")}), j.garment + " · " + j.colorName])]),
    h("div", null, [h("dt", {text:"Size · Qty"}), h("dd", {class:"mono", text: j.size + " · " + j.quantity})]),
    h("div", null, [h("dt", {text:"Downloaded · Opened · Printed"}), h("dd", {class:"mono", text: when(e.downloadedAt || j.exportedAt) + " · " + when(j.openedAt) + " · " + when(j.printedAt)})])
  ]);

  var info = h("div", null, [
    h("div", {class:"jtitle"}, [h("b", {text: j.sideLabel + " — " + j.zoneLabel})].concat(pills)),
    dl,
    e.file ? h("div", {class:"path", text: e.file}) : null,
    e.problem && st === "failed" ? h("div", {class:"err", text: "Problem: " + e.problem}) : null,
    e.lastError ? h("div", {class:"err", text: e.lastError}) : null
  ]);

  var canOpen = (st === "downloaded" || st === "opened") && e.onDisk;
  var canPrint = st === "downloaded" || st === "opened";
  var canFail = st === "queued" || st === "downloaded" || st === "opened";
  var name = j.orderNumber + " " + j.sideLabel;
  var acts = h("div", {class:"acts"}, [
    h("button", {class:"btn primary", type:"button", disabled: !canOpen, onclick: function(){ act("open", e.key); }, text:"Open in ColorboxRIP"}),
    h("button", {class:"btn", type:"button", disabled: !(e.file && e.onDisk), onclick: function(){ act("reveal", e.key); }, text:"Show in folder"}),
    h("button", {class:"btn", type:"button", disabled: !canPrint, onclick: function(){
      ask({title:"Mark " + name + " printed?", body:"Only if the transfer came off the printer correctly. This tells the website it is printed and moves the order on to heat transfer.", ok:"Mark printed"})
        .then(function(ok){ if (ok) act("printed", e.key); });
    }, text:"Mark printed"}),
    h("button", {class:"btn", type:"button", disabled: !canFail, onclick: function(){
      ask({title:"Report a problem with " + name, body:"The website will show this print as failed with your note, so the owner can fix the file and send it again.", ok:"Report problem", input:true})
        .then(function(text){ if (text) act("problem", e.key, {text: text}); else if (text === "") toast("Write what went wrong first.", true); });
    }, text:"Report problem"}),
    (e.file && !e.onDisk) || e.lastError ? h("button", {class:"btn", type:"button", disabled: st === "withdrawn", onclick: function(){ act("redownload", e.key); }, text:"Download again"}) : null
  ]);
  return h("div", {class:"job"}, [thumb, info, acts]);
}

function orderBlock(list){
  var j = list[0].job;
  var kids = [h("div", {class:"ohead"}, [
    h("span", {class:"onum", text: j.orderNumber}),
    h("span", {class:"ocust", text: j.customerName || "—"}),
    h("span", {class:"osum"}, [h("span", {class:"swatch", style:"background:" + (/^#[0-9a-fA-F]{3,8}$/.test(j.colorHex) ? j.colorHex : "transparent")}), j.garment + " · " + j.colorName + " · " + j.size + " · qty " + j.quantity]),
    h("span", {class:"osum mono", text: "ordered " + when(j.orderCreatedAt)})
  ])];
  if (j.productionNotes) kids.push(h("div", {class:"notes"}, [h("b", {text:"Production notes"}), j.productionNotes]));
  if (j.customerNote) kids.push(h("div", {class:"notes"}, [h("b", {text:"Customer note"}), j.customerNote]));
  list.forEach(function(e){ kids.push(jobCard(e)); });
  return h("div", {class:"order"}, kids);
}

function group(entries){
  var map = {}; var order = [];
  entries.forEach(function(e){ var id = e.job.orderId; if (!map[id]) { map[id] = []; order.push(id); } map[id].push(e); });
  order.sort(function(a, b){ return String(map[a][0].job.orderCreatedAt).localeCompare(String(map[b][0].job.orderCreatedAt)); });
  return order.map(function(id){ return map[id]; });
}

function render(){
  var s = data;
  $("host").textContent = s.station.host + " · v" + s.station.appVersion;
  $("dir").textContent = s.station.exportDir;
  $("rip").textContent = s.station.ripConfigured ? (s.station.ripFound ? "ColorboxRIP found" : "ColorboxRIP path not found") : "ColorboxRIP path not set";
  var c = $("conn"); c.setAttribute("data-s", s.conn.state);
  $("connText").textContent = (CONN[s.conn.state] || s.conn.state) + " — " + (s.conn.state === "online" ? ("synced " + ago(s.conn.lastOkAt)) : s.conn.message);
  c.title = s.conn.message;

  var notices = $("notices"); notices.textContent = "";
  if (s.conn.state === "unpaired") notices.appendChild(h("div", {class:"notice", text: s.conn.message}));
  if (s.conn.state === "offline") notices.appendChild(h("div", {class:"notice", text: "The website cannot be reached. Files already in the export folder still open and print; your clicks are saved and sent when the connection is back."}));
  if (s.diskError) notices.appendChild(h("div", {class:"notice", text: s.diskError}));
  if (s.station.openMode === "argument") notices.appendChild(h("div", {class:"notice", text: "openMode is \\"argument\\": the file path is passed to ColorboxRIP on launch. Only use this if your ColorboxRIP build accepts a file argument — test it once."}));

  var active = s.jobs.filter(function(e){ return e.status === "queued" || e.status === "downloaded" || e.status === "opened"; });
  var done = s.jobs.filter(function(e){ return !(e.status === "queued" || e.status === "downloaded" || e.status === "opened"); })
    .sort(function(a, b){ return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  $("activeCount").textContent = String(active.length);
  $("doneCount").textContent = String(done.length);
  var A = $("active"); A.textContent = "";
  if (!active.length) A.appendChild(h("div", {class:"empty", text: s.conn.state === "online" ? "Nothing waiting. Jobs the owner sends to the print station appear here within " + s.station.pollSeconds + " seconds." : "No jobs on this PC yet."}));
  group(active).forEach(function(list){ A.appendChild(orderBlock(list)); });
  var D = $("done"); D.textContent = "";
  group(done).forEach(function(list){ D.appendChild(orderBlock(list)); });

  $("looseCount").textContent = String(s.loose.length);
  var Lz = $("loose"); Lz.textContent = "";
  if (!s.loose.length) Lz.appendChild(h("div", {class:"empty", text:"None. Files you copy into the export folder by hand show up here."}));
  else Lz.appendChild(h("table", null, [h("thead", null, [h("tr", null, [h("th", {text:"File"}), h("th", {text:"Folder"}), h("th", {text:"Size"}), h("th", {text:"Changed"}), h("th", null, [])])]),
    h("tbody", null, s.loose.map(function(f){ return h("tr", null, [h("td", {class:"mono", text:f.name}), h("td", {class:"mono", text:f.folder || "(top level)"}), h("td", {class:"mono", text:bytes(f.bytes)}), h("td", {class:"mono", text:when(f.mtime)}),
      h("td", null, [h("button", {class:"btn", type:"button", onclick:function(){ act("reveal-loose", "", {rel: f.rel}); }, text:"Show in folder"})])]); }))]));

  var log = $("log"); log.textContent = "";
  s.events.forEach(function(ev){ log.appendChild(h("div", {class: ev.level === "warn" ? "w" : ""}, [h("time", {text: new Date(ev.at).toLocaleTimeString()}), ev.message])); });
}

function poll(force){
  return fetch("/api/state", {credentials:"same-origin", cache:"no-store"})
    .then(function(r){ if (r.status === 401) { location.reload(); throw new Error("locked"); } return r.json(); })
    .then(function(s){
      var dialogOpen = $("dlg").open;
      if (force || s.version !== lastVersion) { data = s; lastVersion = s.version; if (!dialogOpen) render(); }
      else if (data) { data.conn = s.conn; $("connText").textContent = (CONN[s.conn.state] || s.conn.state) + " — " + (s.conn.state === "online" ? ("synced " + ago(s.conn.lastOkAt)) : s.conn.message); }
    })
    .catch(function(){ var c = $("conn"); c.setAttribute("data-s", "error"); $("connText").textContent = "The station program is not running."; });
}

$("syncBtn").addEventListener("click", function(){ act("sync", ""); });
$("dlg").addEventListener("close", function(){ if (data) render(); });
poll(true);
setInterval(poll, 2500);
})();
</script>
</body>
</html>`;
}

// ----- start -----------------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    try {
      sendJson(res, 500, { error: plain(e) });
    } catch {
      res.destroy();
    }
  });
});

server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use — the station is probably already running. Close the other window, or set a different "port" in station.config.json.`);
  } else {
    console.error(`The station page could not start: ${plain(e)}`);
  }
  process.exit(1);
});

server.listen(config.port, "127.0.0.1", async () => {
  await saveState();
  const link = `http://127.0.0.1:${config.port}/?key=${encodeURIComponent(state.localKey)}`;
  console.log("");
  console.log("  DTF print station is running.");
  console.log(`  Website:       ${config.siteUrl}`);
  console.log(`  Export folder: ${config.exportDir}`);
  console.log(`  Open mode:     ${config.openMode}${config.colorboxRipPath ? ` (${config.colorboxRipPath}${runtime.ripFound ? "" : " — NOT FOUND"})` : " (no ColorboxRIP path set)"}`);
  console.log("");
  console.log("  Open this link on this PC (once; it remembers you):");
  console.log(`  ${link}`);
  console.log("");
  console.log("  It never prints by itself. Leave this window open; close it to stop the station.");
  console.log("");
  watchExportDir();
  sync();
});

async function shutdown() {
  console.log("Stopping the print station…");
  clearTimeout(syncTimer);
  watcher?.close();
  server.close();
  await saveState();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
