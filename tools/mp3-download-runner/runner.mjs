#!/usr/bin/env node
// MP3 Download runner — runs on the PC that has yt-dlp.
//
//   npm run runner        keep asking the hub for jobs and fetch them
//   npm run runner:once   fetch at most one job, then exit
//
// yt-dlp is a program on this machine, so the deployed site cannot use it: on
// Vercel there is no binary and there never will be. Instead the site queues a
// job, this program claims it, runs yt-dlp here, and sends the finished file
// back — so YouTube works from the live site, from a phone, from anywhere,
// while the download itself always happens on this PC over this connection.
//
// Nothing listens on a port. This only ever makes outbound requests, so it
// works behind any router without a single thing being forwarded.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { config, configProblem } from "./lib/env.mjs";

const cfg = config();
const once = process.argv.includes("--once");

const log = (...args) => console.log(new Date().toLocaleTimeString(), ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Files over this go to Storage through a signed link, not through the site. */
const INLINE_LIMIT = 8 * 1024 * 1024;

// --- finding yt-dlp ----------------------------------------------------------

function run(argv, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], [...argv.slice(1), ...args], {
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Where yt-dlp sits when PATH does not mention it.
 *
 * pip drops yt-dlp.exe into a per-user Scripts directory Windows does not add
 * to PATH, and warns about exactly that at install time. Looking on disk means
 * this runner works from a double-clicked shortcut, not only from the terminal
 * that happened to install it.
 */
function candidates() {
  const found = [];
  if (cfg.ytdlpPath) found.push([cfg.ytdlpPath]);
  found.push(["yt-dlp"], ["yt-dlp.exe"], ["python", "-m", "yt_dlp"], ["py", "-m", "yt_dlp"]);

  const roots = [
    process.env.APPDATA ? join(process.env.APPDATA, "Python") : "",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Python") : "",
    "C:\\",
  ].filter(Boolean);
  for (const root of roots) {
    let versions = [];
    try {
      versions = readdirSync(root).filter((d) => /^Python\d/i.test(d));
    } catch {
      continue;
    }
    for (const version of versions) {
      const exe = join(root, version, "Scripts", "yt-dlp.exe");
      if (existsSync(exe)) found.push([exe]);
    }
  }
  for (const p of [
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    "/opt/homebrew/bin/yt-dlp",
    join(homedir(), ".local", "bin", "yt-dlp"),
  ]) {
    if (existsSync(p)) found.push([p]);
  }
  return found;
}

let engine = null;

async function findEngine() {
  for (const argv of candidates()) {
    const res = await run(argv, ["--version"], 12_000);
    if (res.code === 0 && res.stdout.trim()) {
      const ffmpeg = (await run([cfg.ffmpegPath || "ffmpeg"], ["-version"], 8_000)).code === 0;
      return { argv, version: res.stdout.trim().split("\n")[0], ffmpeg };
    }
  }
  return null;
}

// --- the hub -----------------------------------------------------------------

async function hub(path, init = {}) {
  const res = await fetch(cfg.hubUrl + path, {
    ...init,
    headers: { authorization: `Bearer ${cfg.token}`, ...(init.headers ?? {}) },
  });
  return res;
}

async function claim() {
  const res = await hub("/api/mp3-download/runner/claim", { method: "POST" });
  if (res.status === 204) return null;
  if (res.status === 401) throw new Error("The hub rejected this token. Copy a fresh one.");
  if (!res.ok) throw new Error(`Hub answered ${res.status} to a claim.`);
  return res.json();
}

async function reportFailure(jobId, error) {
  await hub("/api/mp3-download/runner/fail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, error: String(error).slice(0, 400) }),
  }).catch(() => undefined);
}

/**
 * Send the finished file back, inline when it is small and through a signed
 * Storage link when it is not.
 *
 * A deployed function body caps at 4.5 MB, so a video must never travel
 * through the site itself. The signed link is the site's answer to that; a hub
 * with no Storage configured says 204 instead and takes the bytes inline.
 */
async function deliver(jobId, file) {
  const info = await stat(file.path);

  if (info.size > INLINE_LIMIT) {
    const signed = await hub("/api/mp3-download/runner/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "sign", jobId }),
    });

    if (signed.status === 200) {
      const { key, url } = await signed.json();
      const put = await fetch(url, {
        method: "PUT",
        headers: { "content-type": file.contentType },
        // A stream, so a 200 MB video never sits in this process's memory.
        body: createReadStream(file.path),
        duplex: "half",
      });
      if (!put.ok) throw new Error(`Storage refused the upload (${put.status}).`);

      const done = await hub("/api/mp3-download/runner/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "done", jobId, key, bytes: info.size }),
      });
      if (!done.ok) throw new Error(`Hub would not record the upload (${done.status}).`);
      return info.size;
    }
    // 204 means the hub has no Supabase Storage. Inline is all that is left,
    // and this file is already past that limit, so say what would fix it
    // rather than letting the upload bounce with a size error.
    if (signed.status === 204) {
      throw new Error(
        `${(info.size / 1024 / 1024).toFixed(0)} MB is too big to send to a hub with no Storage. ` +
          "Set SUPABASE_SERVICE_ROLE_KEY on that hub, or grab this one on the PC directly.",
      );
    }
  }

  const form = new FormData();
  form.set("jobId", jobId);
  form.set("file", new Blob([await readFile(file.path)], { type: file.contentType }), file.name);
  const res = await hub("/api/mp3-download/runner/result", { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Hub answered ${res.status} to the upload.`);
  }
  return info.size;
}

// --- doing the work ----------------------------------------------------------

const CONTENT_TYPES = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  opus: "audio/opus",
  webm: "video/webm",
  mp4: "video/mp4",
  mkv: "video/x-matroska",
};

async function fetchMedia(job, dir) {
  const shared = [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--retries",
    "5",
    "--fragment-retries",
    "5",
    "--extractor-retries",
    "3",
    "--embed-metadata",
  ];
  const perMode =
    job.mode === "video"
      ? ["-f", "bestvideo*+bestaudio/best", "--merge-output-format", "mp4"]
      : [
          "-f",
          "bestaudio/best",
          "-x",
          ...(engine.ffmpeg
            ? ["--audio-format", "mp3", "--audio-quality", "0", "--embed-thumbnail"]
            : []),
        ];

  const argv = [...shared, ...perMode, "-o", join(dir, "grab.%(ext)s"), job.url];

  let res = await run(engine.argv, argv, 280_000);
  let files = (await readdir(dir)).filter((f) => !f.endsWith(".part"));

  // YouTube's intermittent 403 is not fixed by --retries, which re-requests
  // the same signed URL. Only a fresh extraction gets fresh URLs.
  if ((res.code !== 0 || files.length === 0) && /\b403\b|forbidden/i.test(res.stderr)) {
    log("  the site refused it; extracting again");
    res = await run(engine.argv, argv, 280_000);
    files = (await readdir(dir)).filter((f) => !f.endsWith(".part"));
  }

  if (res.code !== 0 || files.length === 0) {
    const why = res.stderr.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400);
    throw new Error(why || "yt-dlp could not download that one.");
  }

  const wanted = job.mode === "video" ? ".mp4" : ".mp3";
  const name = files.find((f) => f.endsWith(wanted)) ?? files[0];
  const ext = (name.split(".").pop() ?? "bin").toLowerCase();
  return {
    path: join(dir, name),
    name: job.filename,
    contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
  };
}

async function handle(job) {
  log(`Job ${job.id.slice(0, 8)} — ${job.mode}: ${job.title}`);
  const dir = await mkdtemp(join(tmpdir(), "mp3dl-runner-"));
  try {
    const file = await fetchMedia(job, dir);
    const bytes = await deliver(job.id, file);
    log(`  sent ${job.filename} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    log(`  failed: ${err.message}`);
    await reportFailure(job.id, err.message);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// --- the loop ----------------------------------------------------------------

async function main() {
  const problem = configProblem(cfg);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  engine = await findEngine();
  if (!engine) {
    console.error(
      "yt-dlp was not found on this machine.\n" +
        "Install it with:  pip install -U yt-dlp    (or: winget install yt-dlp.yt-dlp)\n" +
        "If it is installed but not on PATH, put the full path to yt-dlp.exe in .env as YTDLP_PATH.",
    );
    process.exit(1);
  }

  log(`yt-dlp ${engine.version} via ${engine.argv.join(" ")}${engine.ffmpeg ? " · ffmpeg ready" : " · NO ffmpeg, MP3 conversion is off"}`);
  log(`Listening to ${cfg.hubUrl} — leave this window open.`);

  let quietSince = Date.now();
  for (;;) {
    let job = null;
    try {
      job = await claim();
    } catch (err) {
      log(err.message);
      await sleep(15_000);
      continue;
    }

    if (job) {
      quietSince = Date.now();
      await handle(job);
      if (once) return;
      continue;
    }

    if (once) {
      log("Nothing queued.");
      return;
    }
    // Poll briskly while there is activity, then ease off so an idle runner is
    // not a request every three seconds all night.
    const idleFor = Date.now() - quietSince;
    await sleep(idleFor > 5 * 60_000 ? 15_000 : 4_000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
