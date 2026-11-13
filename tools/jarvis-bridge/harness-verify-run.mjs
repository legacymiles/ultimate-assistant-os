// ---------------------------------------------------------------------------
// The verify gate's hands: run a step, start the app, look at it, write down
// what happened. The rules for what any of it means are in harness-verify.mjs.
//
// Three things here are deliberate:
//
//   Every child is started with scrubEnv()'s environment, never the bridge's
//   own. The bridge holds every key on this PC. That includes the hidden
//   browser, which runs the pages of an app nobody has read yet.
//
//   A `{ shell }` step is a FIXED string from planChecks. Nothing read from
//   the folder — a file name, a branch, a script's contents — is ever spliced
//   into a shell line here.
//
//   Nothing the gate starts is left running, and nothing it waits on can make
//   it wait for ever. Every child's whole tree is ended when the gate is done
//   with it, and every question asked of a page has a ceiling.
// ---------------------------------------------------------------------------

import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer as createNet } from "node:net";
import path from "node:path";

import { killTree } from "./harness-preview.mjs";
import {
  LIMITS, MAX_DEPTH, MAX_PAGES, crawlLinks, fingerprint, finishLinks, isPublicAddress, judgeResponse, planChecks, scrubEnv,
} from "./harness-verify.mjs";

const WINDOWS = process.platform === "win32";
const SPAWN = { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: !WINDOWS };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

/**
 * Wait for `work`, but only for `ms`.
 *
 * What was being waited on is left to finish or fail by itself; the error
 * thrown here is marked `late` so a caller can tell "too slow" from "broke".
 */
function within(ms, work, why = "It did not finish in time.") {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(why), { late: true })), ms);
  });
  return Promise.race([Promise.resolve(work), late]).finally(() => clearTimeout(timer));
}

/** Run a small system tool and hand back what it printed, or "" for any trouble at all. */
function said(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 5_000, maxBuffer: 4_000_000 }, (err, stdout) => resolve(err ? "" : String(stdout)));
  });
}

/** The same site? Compared as parsed origins: as text, port 5173 is the start of port 51730. */
export function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** What is in the folder, in the shape planChecks reads. */
export function readFacts(cwd) {
  const names = existsSync(cwd) ? readdirSync(cwd) : [];
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8").replace(/^﻿/, ""));
  } catch {
    /* no package.json, or not JSON: a plain folder */
  }
  // What a build made comes first. A Vite project has an index.html at its top
  // too, and that one is the source: serving it shows a page with no script.
  const staticDir = ["dist", "out", "build", ".", "public"].find((d) => existsSync(path.join(cwd, d, "index.html"))) ?? "";
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

// --- keeping hold of what a child starts -------------------------------------
//
// killTree() walks down from a live process. Once that process has exited there
// is nothing to walk from, and a build script is free to leave a child behind:
// a watcher, a daemon, a dev server it forgot. Asking afterwards "whose child
// was this?" does not work either. The orphan's parent is a script that has
// already gone, and so is every process between it and the one started here.
//
// On Windows the one thing that follows a tree for certain is a job object: the
// system puts every process a member starts into the same job, whoever its
// parent is and however quickly that parent dies, and ending the job ends them
// all and nothing else. Node cannot make one, so one hidden PowerShell is kept
// while there is work, and it makes them. Elsewhere the process group that
// `detached: true` gives each child does the same work.

const HOLDER = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace W -Name K -MemberDefinition @'
[DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateJobObject(IntPtr a, string n);
[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
[DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
[DllImport("kernel32.dll")] public static extern bool TerminateJobObject(IntPtr job, uint code);
[DllImport("kernel32.dll")] public static extern bool IsProcessInJob(IntPtr proc, IntPtr job, out bool result);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
'@
$jobs = @{}
function InJob($job, $id) {
  $h = [W.K]::OpenProcess(0x1000, $false, [uint32]$id)
  if ($h -eq [IntPtr]::Zero) { return $false }
  $in = $false
  $ok = [W.K]::IsProcessInJob($h, $job, [ref]$in)
  [void][W.K]::CloseHandle($h)
  return ($ok -and $in)
}
function Take($job, $id, $depth) {
  $h = [W.K]::OpenProcess(0x0101, $false, [uint32]$id)
  if ($h -eq [IntPtr]::Zero) { return $false }
  $ok = [W.K]::AssignProcessToJobObject($job, $h)
  [void][W.K]::CloseHandle($h)
  # A child it started in the instant before this ran is outside the job, and
  # so is everything that child starts. Look once, and take those in as well.
  # Only ones born after it: a pid is reused, and an old process can still
  # carry this number as its parent's.
  if ($ok -and $depth -lt 4) {
    $rows = @(Get-CimInstance -Query "SELECT ProcessId,ParentProcessId,CreationDate FROM Win32_Process WHERE ProcessId=$id OR ParentProcessId=$id")
    $me = $rows | Where-Object { $_.ProcessId -eq $id } | Select-Object -First 1
    foreach ($r in $rows) {
      if ($me -and $r.ProcessId -ne $id -and $r.CreationDate -ge $me.CreationDate -and -not (InJob $job $r.ProcessId)) {
        [void](Take $job $r.ProcessId ($depth + 1))
      }
    }
  }
  return $ok
}
[Console]::Out.WriteLine('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  $out = 'no'
  try {
    if ($p[0] -eq 'hold') {
      $job = [W.K]::CreateJobObject([IntPtr]::Zero, $null)
      if (Take $job $p[2] 0) { $jobs[$p[1]] = $job; $out = 'yes' } else { [void][W.K]::CloseHandle($job) }
    } elseif ($p[0] -eq 'has') {
      if ($jobs.ContainsKey($p[1]) -and (InJob $jobs[$p[1]] $p[2])) { $out = 'yes' }
    } elseif ($p[0] -eq 'end') {
      if ($jobs.ContainsKey($p[1])) {
        [void][W.K]::TerminateJobObject($jobs[$p[1]], 1)
        [void][W.K]::CloseHandle($jobs[$p[1]])
        $jobs.Remove($p[1])
        $out = 'yes'
      }
    }
  } catch { $out = 'no' }
  [Console]::Out.WriteLine($out)
}
`;

let holder = null;
let holderFailed = false;
let jobs = 0;

/** The one PowerShell that holds the jobs, started when first needed. Null where there is none. */
function getHolder() {
  if (!WINDOWS || holderFailed) return null;
  if (holder) return holder;
  let ps;
  try {
    ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(HOLDER, "utf16le").toString("base64")],
      { windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: scrubEnv(process.env) },
    );
  } catch {
    holderFailed = true;
    return null;
  }
  const waiting = [];
  let rest = "";
  const h = { held: 0, idle: null, gone: false };
  const gone = () => {
    if (h.gone) return;
    h.gone = true;
    if (holder === h) holder = null;
    clearTimeout(h.idle);
    // Everyone still waiting is told "no", which every caller reads as "could
    // not": nothing here may wait on a PowerShell that has stopped answering.
    for (const answer of waiting.splice(0)) answer("no");
    try {
      ps.kill();
    } catch {
      /* already gone */
    }
  };
  ps.once("error", gone);
  ps.once("exit", gone);
  ps.stdin.on("error", () => {});
  ps.stdout.on("data", (chunk) => {
    rest += chunk;
    for (let at = rest.indexOf("\n"); at >= 0; at = rest.indexOf("\n")) {
      const line = rest.slice(0, at).trim();
      rest = rest.slice(at + 1);
      waiting.shift()?.(line);
    }
  });
  /** One line in, one line back. An answer that does not come in time ends this holder. */
  h.ask = (line, ms = 8_000) => new Promise((resolve) => {
    if (h.gone) {
      resolve("no");
      return;
    }
    const timer = setTimeout(gone, ms);
    waiting.push((answer) => {
      clearTimeout(timer);
      resolve(answer);
    });
    if (line) ps.stdin.write(`${line}\n`);
  });
  h.ready = h.ask("", 20_000).then((line) => {
    // No PowerShell, or one that may not load the few system calls this needs.
    // It is not tried again: every later child would wait the same 20 seconds.
    if (line !== "ready") {
      holderFailed = true;
      gone();
    }
    return line === "ready";
  });
  /** Nothing held: it is let go after a short while, and started again when next needed. */
  h.rest = () => {
    if (h.held > 0 || h.gone) return;
    h.idle = setTimeout(() => {
      if (holder === h) holder = null;
      ps.stdin.end();
    }, 20_000);
    h.idle.unref?.();
  };
  // It must never be the reason the bridge (or a test run) cannot exit.
  ps.unref();
  ps.stdin.unref?.();
  ps.stdout.unref?.();
  holder = h;
  return h;
}

/** Called before a child is started, so the hold can be taken the moment it exists. */
async function treesReady() {
  const h = getHolder();
  if (h) await h.ready;
}

/** Take hold of a child that has just been started, and of everything it goes on to start. */
async function holdTree(pid) {
  const tree = { pid, job: "", by: null };
  const h = pid ? getHolder() : null;
  if (!h || !(await h.ready)) return tree;
  clearTimeout(h.idle);
  h.held += 1;
  const job = `j${++jobs}`;
  if ((await h.ask(`hold ${job} ${pid}`)) === "yes") return Object.assign(tree, { job, by: h });
  h.held -= 1;
  h.rest();
  return tree;
}

/** Is this process one the child started, however far down? "No" when that cannot be found out. */
async function inTree(tree, pid) {
  if (WINDOWS) return Boolean(tree.job) && (await tree.by.ask(`has ${tree.job} ${pid}`)) === "yes";
  if (!tree.pid) return false;
  return Number((await said("ps", ["-o", "pgid=", "-p", String(pid)])).trim()) === tree.pid;
}

/**
 * End everything the child started that is still running. Never throws, and
 * never touches a process the child did not start.
 */
async function sweep(tree) {
  if (!WINDOWS) {
    try {
      if (tree.pid) process.kill(-tree.pid, "SIGKILL");
    } catch {
      /* nobody left in the group, which is the outcome we wanted */
    }
    return;
  }
  if (!tree.job) return;
  const { job, by } = tree;
  tree.job = "";
  await by.ask(`end ${job}`);
  by.held -= 1;
  by.rest();
}

/** Run one planned step to its end, its ceiling, or an abort. Never throws. */
export async function runStep(step, { cwd, env, signal }) {
  const started = Date.now();
  const ran = step.run.shell ?? `node ${step.run.node.join(" ")}`;
  await treesReady();
  let held = null;
  const row = await new Promise((resolve) => {
    const child = step.run.node
      ? spawn(process.execPath, step.run.node, { ...SPAWN, cwd, env })
      : spawn(step.run.shell, { ...SPAWN, cwd, env, shell: true });
    held = holdTree(child.pid);
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
      void held.then(sweep);
    };
    const timer = setTimeout(() => stop(`It ran past ${Math.max(1, Math.round(step.limit / 60_000))} minute(s) and was stopped.`), step.limit);
    const onAbort = () => stop("Stopped.");
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    let grace = null;
    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
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
    // `exit` can arrive before the last of stdout and stderr; `close` is the
    // one that means the pipes are drained. A grandchild that outlives the step
    // holds a pipe open and keeps `close` from coming, so whatever is left of
    // the tree is ended here. The short wait is for a PC where that could not
    // be done: it settles with what was collected.
    let exitCode = null;
    child.once("exit", (code) => {
      exitCode = code ?? 1;
      void held.then(sweep);
      grace = setTimeout(() => done(exitCode), 1_500);
    });
    child.once("close", (code) => done(code ?? exitCode ?? 1));
  });
  // A step that is over has no business still running anything.
  await sweep(await held);
  return row;
}

/** A port nothing is listening on, chosen by the OS. */
export async function freePort() {
  for (let tries = 1; ; tries++) {
    const port = await new Promise((resolve, reject) => {
      const probe = createNet();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const { port: got } = probe.address();
        probe.close(() => resolve(got));
      });
    });
    // IPv4 and IPv6 keep separate lists of ports, and startApp also asks [::1]
    // and localhost. A port free here but answered there would have the gate
    // open some other program's pages and judge this build by them, so the
    // port is only handed out once nothing answers on it under any name.
    if (tries >= 20 || !(await whereAnswers(port))) return port;
  }
}

async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4_000), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

// Every name this PC has for itself. On many PCs "localhost" is ::1 first, so
// Vite and friends listen on IPv6 only and never answer on 127.0.0.1.
const LOOPBACKS = ["127.0.0.1", "[::1]", "localhost"];

/**
 * The address this port answers on, or "".
 *
 * Asked all at once: a refusal comes back at once, but an address that says
 * nothing costs the whole wait, and this is asked again and again while an app
 * boots. 127.0.0.1 wins when several answer, as it always has.
 */
async function whereAnswers(port) {
  const urls = LOOPBACKS.map((host) => `http://${host}:${port}`);
  const asked = urls.map(answers);
  for (let i = 0; i < urls.length; i++) if (await asked[i]) return urls[i];
  return "";
}

/** The pids listening on a port, or [] when that cannot be found out. */
async function listeners(port) {
  const pids = new Set();
  if (WINDOWS) {
    for (const line of (await said("netstat", ["-ano"])).split(/\r?\n/)) {
      const hit = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
      if (hit && Number(hit[1]) === port) pids.add(Number(hit[2]));
    }
  } else {
    for (const pid of (await said("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])).split(/\s+/)) {
      if (Number(pid) > 0) pids.add(Number(pid));
    }
  }
  return [...pids];
}

/** Is every program listening on this port one the app itself started? */
async function ownsPort(tree, port) {
  const pids = await listeners(port);
  if (!pids.length) return false;
  for (const pid of pids) if (!(await inTree(tree, pid))) return false;
  return true;
}

// The bridge's own door. An app must never get the gate to open the bridge.
const BRIDGE_PORT = Number(process.env.JARVIS_BRIDGE_PORT || 42020);

/** Every port an address in the log names, in the order they were printed. */
function portsIn(log) {
  const found = [...log.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/gi)].map((m) => Number(m[1]));
  return [...new Set(found)];
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
    // This runs inside the bridge itself. A folder an agent made can hold
    // anything (a directory called index.html, a file that cannot be read),
    // and an error thrown here would take the whole bridge down with it.
    try {
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
      if (statSync(file, { throwIfNoEntry: false })?.isDirectory()) file = path.join(file, "index.html");
      if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      const body = readFileSync(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      if (res.headersSent) res.destroy();
      else res.writeHead(500, { "Content-Type": "text/plain" }).end("That file could not be read.");
    }
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
 * addresses. One of those is believed only when the program listening there is
 * one this app started: a log line also names the API it proxies to, the
 * database it uses, or anything else it likes, and the gate must not open
 * somebody else's server and call it this build.
 *
 * The `url` handed back is the address that answered, spelled the way it
 * answered: the crawl uses it as the origin, and a page loaded from [::1] is
 * not same-origin with 127.0.0.1.
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

  await treesReady();
  const childEnv = { ...env, PORT: String(port) };
  const child = boot.kind === "node"
    ? spawn(process.execPath, boot.args.map((a) => (a === "{port}" ? String(port) : a)), { ...SPAWN, cwd, env: childEnv })
    : spawn(boot.command, { ...SPAWN, cwd, env: childEnv, shell: true });
  const held = holdTree(child.pid);
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
  const tree = await held;
  // The tree from its top, and then whatever it had already cut loose.
  const stop = async () => {
    await killTree(child.pid);
    await sweep(tree);
  };

  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      await stop();
      throw new Error("Stopped.");
    }
    if (exited !== null) {
      await stop();
      throw new Error(`It exited (code ${exited}) before it answered.\n${log.slice(-1_200)}`);
    }
    const mine = await whereAnswers(port);
    if (mine) return { url: mine, log: () => log, stop };
    for (const other of portsIn(log)) {
      if (other === port || other === BRIDGE_PORT || !(await ownsPort(tree, other))) continue;
      const theirs = await whereAnswers(other);
      if (theirs) return { url: theirs, log: () => log, stop };
    }
    await sleep(500);
  }
  await stop();
  const waited = limit >= 60_000 ? `${Math.round(limit / 60_000)} minutes` : `${Math.round(limit / 1_000)} seconds`;
  throw new Error(`It did not answer within ${waited}.\n${log.slice(-1_200)}`);
}

// --- looking at it -----------------------------------------------------------

let chromium = null;

/**
 * A fresh, hidden browser. Never the signed-in profile in out/browser-profile,
 * and never the bridge's environment: it runs pages nobody has read.
 */
async function launch() {
  if (!chromium) ({ chromium } = await import("playwright"));
  return chromium.launch({ headless: true, env: scrubEnv(process.env) });
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
  viewport: "A page has no viewport tag, so a phone shows it as a shrunken desktop page",
  hung: "A page stopped responding",
  offsite: "A page sends you to another site",
  download: "A page is a file to download, not a page",
  none: "No page could be opened",
};

// How long one question to a page may take. A page whose script is stuck in a
// loop never answers, and Playwright would wait for it for ever.
const PAGE_OP = 5_000;

const shot = (page, file) =>
  within(PAGE_OP * 2, page.screenshot({ path: file, type: "jpeg", quality: 60, timeout: PAGE_OP * 2 })).catch(() => {});
const shut = (page) => within(PAGE_OP, page.close()).catch(() => {});

/** Load one page and collect everything that went wrong on it. */
async function visit(cx, origin, at) {
  const page = await within(PAGE_OP * 2, cx.newPage(), "The hidden browser did not open a new page.");
  const errors = [];
  const notes = [];
  const add = (kind, evidence, where = at, status = 0) => {
    if (!errors.some((e) => e.kind === kind && e.evidence === evidence)) errors.push({ kind, evidence, where, status });
  };
  // Another site's script: an advert, a chat widget, an analytics tag. Only a
  // web address on a different origin counts as one. No address at all, or a
  // bundler's own name for the app's code (webpack-internal:, blob:), is the
  // app speaking.
  const elsewhere = (url) => /^(https?|wss?):/i.test(url) && !sameOrigin(url, origin);
  page.on("pageerror", (e) => add("pageerror", String(e?.message ?? e)));
  page.on("console", (m) => {
    // "Failed to load resource" is the browser repeating a response that
    // judgeResponse has already seen, including the 401s it only notes.
    if (m.type() !== "error" || /^Failed to load resource/i.test(m.text())) return;
    // What somebody else's script complains about is not this build's to fix,
    // and it comes and goes with their servers.
    if (elsewhere(m.location()?.url ?? "")) return;
    add("console", m.text().slice(0, 600));
  });
  page.on("requestfailed", (req) => {
    const why = req.failure()?.errorText ?? "";
    if (sameOrigin(req.url(), origin) && !/ERR_ABORTED/i.test(why)) add("request", `${req.method()} ${req.url()} failed: ${why}`);
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
    if (verdict === "fail") add("status", line, document ? at : new URL(res.url()).pathname, res.status());
    else if (verdict === "note") notes.push(line);
  });

  const seen = { page, status: 0, download: false, hung: false, offsite: false, errors, notes, hrefs: [] };
  let loaded = false;
  try {
    const res = await page.goto(`${origin}${at}`, { waitUntil: "load", timeout: 30_000 });
    seen.status = res?.status() ?? 0;
    loaded = true;
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  } catch (e) {
    // A browser that died is not a page that did not load. That is thrown on,
    // and crawl() reports it as what it is.
    if (!cx.browser()?.isConnected()) throw e;
    // A link with no file extension can still be a file: /export, sent as an
    // attachment. The browser refuses to open it as a page, and it is not one.
    if (/download is starting/i.test(firstLine(e))) seen.download = true;
    else add("navigation", firstLine(e));
  }
  if (seen.download) return seen;

  // A redirect off the app ends on somebody else's page with a clean 200, and
  // every event from it is another site's and ignored. Left alone, that reads
  // as a home page with nothing wrong with it.
  const landed = page.url();
  if (elsewhere(landed)) {
    seen.offsite = true;
    add("offsite", `${at} sends you to another site: ${new URL(landed).host}`);
    return seen;
  }

  try {
    seen.hrefs = await within(PAGE_OP, page.$$eval("a[href]", (as) => as.map((a) => a.href)));
  } catch (e) {
    if (!cx.browser()?.isConnected()) throw e;
    // Too slow to answer one small question is a page a person cannot use
    // either. Said once: a page that never finished loading has already been
    // reported as that.
    if (e?.late) {
      seen.hung = true;
      if (loaded) add("hung", `The page loaded and then did not answer for ${PAGE_OP / 1_000} seconds. A script on it is probably stuck in a loop.`);
    }
  }
  return seen;
}

/** One thing the crawl saw go wrong, in the shape the report keeps. */
export const asFailure = (e) => ({
  // fingerprint() flattens every standalone number in the evidence, so a page
  // that went from 404 to 500 would keep its id and read as "the repair
  // changed nothing". The status is carried here, where numbers are kept.
  id: fingerprint({ step: "crawl", page: e.kind === "status" && e.status ? `${e.where}:status:${e.status}` : `${e.where}:${e.kind}`, evidence: e.evidence }),
  step: "crawl",
  page: e.where,
  title: `${TITLE[e.kind]}: ${e.where}`,
  ran: "",
  evidence: e.evidence,
});

/**
 * How far a swipe slides the page sideways on a phone, in px.
 *
 * Measured by doing it. scrollWidth also counts what the page clips and can
 * never be scrolled to, and asking the page to scroll itself moves content a
 * finger cannot. Tried at three heights, because a swipe that lands on a
 * carousel moves the carousel.
 */
async function slides(page) {
  for (const y of [120, 420, 720]) {
    await within(PAGE_OP, page.mouse.move(195, y));
    await within(PAGE_OP, page.mouse.wheel(300, 0));
    await sleep(200);
    const x = await within(PAGE_OP, page.evaluate(() => Math.round(window.scrollX + (window.visualViewport?.offsetLeft ?? 0))));
    if (x > 1) return x;
  }
  return 0;
}

/**
 * Open the app's own pages and write down what broke.
 *
 * It navigates and nothing else: no clicks, no typing, no submits. Without a
 * contract the gate does not know what a click should do.
 *
 * A browser that cannot start throws: nothing was looked at. One that dies
 * part-way does not. What it had already found is still true, so it comes back
 * with `crashed` saying why the list stops where it does.
 *
 * It always comes back. At its time limit, or when it is called off, the
 * browser is closed, which ends whatever a page was being asked at that
 * moment; `cut` says which of the two it was.
 */
export async function crawl({ origin, paths = [], dir = "", signal, limit = LIMITS.crawl, depth: maxDepth = MAX_DEPTH, launch: open = launch }) {
  const b = await open();
  const pages = [];
  const failures = [];
  const notes = [];
  let crashed = "";
  let cut = "";
  const close = () => within(10_000, b.close()).catch(() => {});
  const end = (why) => {
    if (cut) return;
    cut = why;
    void close();
  };
  const timer = setTimeout(() => end("time"), limit);
  const onAbort = () => end("abort");
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  try {
    // acceptDownloads: a link can turn out to be a file, and nothing the app
    // under test serves is saved on this PC.
    const cx = await b.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: false });
    const queue = [...new Set(["/", ...paths])].map((at) => ({ at, depth: 0 }));
    const seen = new Set(queue.map((q) => q.at));
    let phone = true;
    while (queue.length && pages.length < MAX_PAGES && !cut) {
      const { at, depth } = queue.shift();
      const r = await visit(cx, origin, at);
      // The phone pass opens the home page again. There is nothing to measure
      // on one that is a file, somebody else's site, or not answering.
      if (at === "/" && (r.download || r.offsite || r.hung)) phone = false;
      if (r.download) {
        // Followed from a link, a download is simply not a page. The home page
        // and the pages the gate was TOLD to open are another matter: there is
        // meant to be a page there.
        if (depth === 0) failures.push(asFailure({ kind: "download", where: at, evidence: `${at} is sent as a file to download, so there is no page there to open.` }));
        await shut(r.page);
        continue;
      }
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
      if (at === "/" && dir && !r.hung) await shot(r.page, path.join(dir, "home-1280.jpg"));
      await shut(r.page);
    }

    // The home page again, the size of a phone. Only what is phone-specific is
    // recorded here; its errors were already seen at desktop width.
    if (!cut && phone) {
      const small = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, acceptDownloads: false });
      const r = await visit(small, origin, "/");
      // Measured only when the home page itself came back. An error page, the
      // app's or the browser's own, is not the layout the build made.
      if (r.status > 0 && r.status < 400 && !r.download && !r.offsite && !r.hung) {
        const tagged = await within(PAGE_OP, r.page.evaluate(() => Boolean(document.querySelector('meta[name="viewport" i]')))).catch(() => null);
        if (tagged === false) {
          // Without the tag a phone lays every page out about 980px wide and
          // shrinks it. Reported as "980px wide" that sends the agent after a
          // layout that is fine; the missing line is the whole fault.
          failures.push(asFailure({
            kind: "viewport",
            where: "/",
            evidence: 'The page has no <meta name="viewport"> tag, so a phone draws it as a wide desktop page and shrinks it to fit. Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside <head>.',
          }));
        } else if (tagged) {
          const wide = await within(PAGE_OP, r.page.evaluate(() => document.documentElement.scrollWidth)).catch(() => 0);
          // Wider than the screen is only a fault if a finger can get there.
          const slid = wide > 391 ? await slides(r.page).catch(() => 0) : 0;
          if (slid > 0) failures.push(asFailure({ kind: "overflow", where: "/", evidence: `The page is ${wide}px wide on a 390px screen, and a swipe slides it ${slid}px sideways.` }));
        }
      }
      if (dir && !r.hung) await shot(r.page, path.join(dir, "home-390.jpg"));
      await shut(r.page);
    }
  } catch (e) {
    // Ended on purpose is not a crash: the error is only the browser being
    // closed under whatever page was open.
    if (!cut) crashed = firstLine(e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    await close();
  }
  // A crawl that opened nothing has not looked at the build. That is never
  // "nothing wrong". (A browser that died is the PC's trouble, and a crawl
  // that was called off decides nothing: neither is said here.)
  if (!crashed && cut !== "abort" && pages.length === 0 && failures.length === 0) {
    failures.push(asFailure({
      kind: "none",
      where: "/",
      evidence: cut === "time"
        ? `The home page had not finished opening when the time for opening pages ran out (${Math.round(limit / 1_000)} seconds).`
        : "The app answered, but no page of it could be opened.",
    }));
  }
  // One broken shared file (a logo, a stylesheet) fails on every page that
  // uses it, with the same id each time. It is one fault and is listed once.
  const once = new Map();
  for (const f of failures) if (!once.has(f.id)) once.set(f.id, f);
  return { pages, failures: [...once.values()], notes: [...new Set(notes)], crashed, cut };
}

/** Can this PC reach the internet at all? One small address made for exactly this question. */
async function online() {
  try {
    await fetch("https://www.gstatic.com/generate_204", { redirect: "manual", signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Does the address the agent printed actually open, without a login?
 *
 * `offline: true` means the question could not be asked: this PC has no way
 * out to the internet just now. That is not something the build got wrong.
 */
export async function checkLive(url, fetcher = fetch, probe = online) {
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
    // A dead address and a PC with no internet fail the same way. One look at
    // an address that is always there tells them apart.
    if (!(await probe())) return { ok: false, offline: true, evidence: `This PC could not reach the internet, so ${url} was not opened.` };
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
 *
 * `broken` on the report means the gate could not finish looking, for a reason
 * that is this PC's and not the build's. It is never a pass, and it adds
 * nothing to `failures`: there is nothing there for the agent to repair.
 *
 * `launch` is how the hidden browser is opened, `fetcher` and `probe` how the
 * live address is asked for, and `limits` overrides the ceilings in LIMITS.
 * They are there for tests; the bridge passes none of them.
 */
export async function runGate({
  cwd, project = false, base = "", text = "", paths = [], dir, onStep = () => {}, signal, env = process.env,
  launch: open = launch, fetcher = fetch, probe, limits = {},
}) {
  const startedAt = Date.now();
  const ceilings = { ...LIMITS, ...limits };
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
  let broken = "";
  const built = !failures.some((f) => f.step === "install" || f.step === "build");
  // How to start it is decided now, not before the steps ran: the folder a
  // build writes (dist/index.html) is not there until it has been built, and a
  // project with nothing but a build script would otherwise never be opened.
  const { boot } = planChecks({ ...readFacts(cwd), project, base });
  if (!boot) {
    skip("boot", "Start it", "Nothing here says how to start it: no start or dev script, and no index.html.");
  } else if (!built) {
    skip("boot", "Start it", "Skipped because it did not build.");
    skip("crawl", "Open every page", "Skipped because it did not build.");
  } else if (!signal?.aborted) {
    const ran = boot.command ?? (boot.args ? `node ${boot.args.join(" ")}` : `serve ${boot.dir}`);
    const t0 = Date.now();
    let app = null;
    try {
      app = await startApp({ cwd, boot, env: clean, signal, limit: ceilings.boot });
      record({ id: "boot", label: "Start it", ok: true, advisory: false, skipped: false, ms: Date.now() - t0, ran, tail: "" });
    } catch (e) {
      const evidence = String(e?.message ?? e);
      record({ id: "boot", label: "Start it", ok: false, advisory: false, skipped: false, ms: Date.now() - t0, ran, tail: evidence });
      if (!signal?.aborted) failed("boot", "It did not start", ran, evidence);
    }
    if (app) {
      // From here the app is running, and whatever happens next it is stopped:
      // the crawl closes its own browser, and this closes the app.
      try {
        const t1 = Date.now();
        let seen = null;
        try {
          // A new project is crawled link by link. A worktree of a big existing
          // site is not: following the hub's home page would open forty unrelated
          // apps and fail an edit for an error that was already there. It opens
          // the home page and the pages it was told to, and nothing else.
          seen = await crawl({ origin: app.url, paths, dir, signal, limit: ceilings.crawl, depth: project ? MAX_DEPTH : 0, launch: open });
        } catch (e) {
          // No browser on this PC is the PC's problem, not the build's. It is
          // not a pass either: a build nobody looked at has not been checked.
          broken = `The hidden browser could not start, so no page was opened: ${firstLine(e)}`;
          skip("crawl", "Open every page", broken);
          advice.push(broken);
        }
        if (seen) {
          pages = seen.pages;
          failures.push(...seen.failures);
          advice.push(...seen.notes.slice(0, 20));
          let tail = "";
          if (seen.crashed && !signal?.aborted) {
            tail = `The hidden browser stopped while opening pages, after ${pages.length} of them: ${seen.crashed}`;
            // What it found before it stopped is real and goes back to be
            // fixed; the next check opens the rest. If it had found nothing,
            // "no failures" only means nobody finished looking.
            if (seen.failures.length) advice.push(tail);
            else broken = tail;
          } else if (seen.cut === "time") {
            tail = `It ran out of time for opening pages after ${pages.length} of them, so the rest were not looked at.`;
            advice.push(tail);
          }
          record({ id: "crawl", label: "Open every page", ok: seen.failures.length === 0 && !seen.crashed, advisory: false, skipped: false, ms: Date.now() - t1, ran: `${pages.length} page(s)`, tail });
        }
      } finally {
        await app.stop().catch(() => {});
      }
    }
  }

  const { live } = finishLinks(text);
  if (live && !signal?.aborted) {
    if (!isPublicAddress(live)) {
      // The agent wrote this address, and the bridge sits inside the owner's
      // network. An address on this PC or a private network is never fetched:
      // it could be the router, another app, or the bridge itself. It is also
      // not a live address anyone else could open.
      const why = `The address it printed, ${live}, is on this PC or a private network, so it was not opened. A live address is one anybody can reach.`;
      skip("live", "Open the live address", why);
      advice.push(why);
    } else {
      const t2 = Date.now();
      const r = await checkLive(live, fetcher, probe);
      if (r.offline) {
        skip("live", "Open the live address", r.evidence);
        advice.push(r.evidence);
      } else {
        record({ id: "live", label: "Open the live address", ok: r.ok, advisory: false, skipped: false, ms: Date.now() - t2, ran: `GET ${live}`, tail: r.evidence });
        if (!r.ok) failed("live", "The live address does not open", `GET ${live}`, r.evidence, live);
      }
    }
  }

  if (!signal?.aborted && !steps.some((s) => !s.skipped)) {
    failed("none", "There was nothing to check", "", "No package.json scripts and no index.html were found in the project folder.");
  }

  const report = {
    startedAt,
    ms: Date.now() - startedAt,
    passed: failures.length === 0 && !broken && !signal?.aborted,
    aborted: Boolean(signal?.aborted),
    steps,
    pages,
    advice,
    failures,
  };
  // An aborted run decides nothing, so it is not called broken either. And a
  // run that found real failures is not broken: those go back to the agent
  // this round, and the browser's trouble is only a line of advice until the
  // build has nothing else wrong with it.
  if (broken && !report.aborted && failures.length === 0) Object.assign(report, { broken: true, brokenWhy: broken });
  writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}
