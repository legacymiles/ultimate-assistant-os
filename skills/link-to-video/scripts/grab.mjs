#!/usr/bin/env node
// ---------------------------------------------------------------------------
// grab.mjs — a link in, a video file out.
//
//   node grab.mjs "<link or share text>" [options]
//
// One door for every site. yt-dlp does the work; the per-site fallbacks below
// exist only where yt-dlp measurably cannot, and each one announces itself so
// the trail says what actually fetched the file.
//
// Zero npm dependencies on purpose: this has to run from a skill, from a hub
// API route, and from a bare terminal without anybody running `npm install`.
// ---------------------------------------------------------------------------

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

/* ── Finding yt-dlp ──────────────────────────────────────────────────────
   pip installs `yt-dlp.exe` into a per-user Scripts directory that Windows
   does not put on PATH, and it says so at install time — which is why the
   "yt-dlp is not installed" report is so often wrong. Each candidate is a
   full argv, because a pip install may only have the Python module. */

const BINARIES = [
  ...(process.env.YTDLP_PATH ? [[process.env.YTDLP_PATH]] : []),
  ["yt-dlp"],
  ["yt-dlp.exe"],
  ["python", "-m", "yt_dlp"],
  ["py", "-m", "yt_dlp"],
  ["python3", "-m", "yt_dlp"],
];

const EXTRA_DIRS = [
  path.join(homedir(), "AppData/Roaming/Python"),
  path.join(homedir(), "AppData/Local/Programs/Python"),
  path.join(homedir(), ".local/bin"),
];

function scriptDirs() {
  const out = [];
  for (const base of EXTRA_DIRS) {
    if (!existsSync(base)) continue;
    try {
      for (const entry of readdirSync(base)) {
        for (const sub of ["Scripts", ""]) {
          const exe = path.join(base, entry, sub, "yt-dlp.exe");
          if (existsSync(exe)) out.push([exe]);
        }
      }
      if (existsSync(path.join(base, "yt-dlp"))) out.push([path.join(base, "yt-dlp")]);
    } catch {
      // Unreadable directory: just move on to the next candidate.
    }
  }
  return out;
}

let cachedYtDlp = null;
function ytDlp() {
  if (cachedYtDlp) return cachedYtDlp;
  for (const argv of [...BINARIES, ...scriptDirs()]) {
    try {
      execFileSync(argv[0], [...argv.slice(1), "--version"], { stdio: "pipe", timeout: 30_000, windowsHide: true });
      cachedYtDlp = argv;
      return argv;
    } catch {
      // Not this one.
    }
  }
  throw new Error(
    "yt-dlp not found. Install it with:  python -m pip install --user \"yt-dlp[default,curl-cffi]\"\n" +
    "  or set YTDLP_PATH to the executable."
  );
}

/** curl_cffi lets yt-dlp copy a real browser's TLS fingerprint. Measured
 *  2026-09-27: without it TikTok and Dailymotion both fail outright, and with
 *  it both succeed — so a missing install reads as "the site blocked us". */
function hasImpersonation() {
  try {
    const argv = ytDlp();
    const out = execFileSync(argv[0], [...argv.slice(1), "--list-impersonate-targets"], {
      stdio: "pipe", timeout: 30_000, windowsHide: true,
    }).toString();
    return /curl_cffi/.test(out);
  } catch {
    return false;
  }
}

/* ── Which site ─────────────────────────────────────────────────────────── */

const HOSTS = [
  ["youtube", /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["instagram", /(^|\.)(instagram\.com|instagr\.am|ddinstagram\.com)$/],
  ["facebook", /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/],
  ["x", /(^|\.)(x\.com|twitter\.com|vxtwitter\.com|fxtwitter\.com)$/],
  ["reddit", /(^|\.)(reddit\.com|redd\.it)$/],
  ["pinterest", /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/],
  ["vimeo", /(^|\.)vimeo\.com$/],
  ["twitch", /(^|\.)(twitch\.tv|clips\.twitch\.tv)$/],
  ["snapchat", /(^|\.)snapchat\.com$/],
  ["threads", /(^|\.)threads\.(net|com)$/],
  ["bluesky", /(^|\.)bsky\.app$/],
  ["dailymotion", /(^|\.)(dailymotion\.com|dai\.ly)$/],
  ["rumble", /(^|\.)rumble\.com$/],
  ["linkedin", /(^|\.)linkedin\.com$/],
];

/** People paste what the share sheet gives them: "look at this 😋 <url> !!". */
export function firstUrl(text) {
  const m = String(text).match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0].replace(/[),.!?]+$/, "");
  const bare = String(text).trim().match(/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*$/i);
  return bare ? `https://${bare[0]}` : null;
}

export function detect(text) {
  const raw = firstUrl(text);
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  return { url, site: HOSTS.find(([, re]) => re.test(host))?.[0] ?? "web" };
}

/* ── Cookies ─────────────────────────────────────────────────────────────
   The single biggest unlock. Instagram, Vimeo and most Facebook posts are
   not "broken" — they are asking who you are, and this is the answer. */

function cookieArgs(opts) {
  if (opts.cookies) return ["--cookies", opts.cookies];
  const browser = opts.cookiesFromBrowser || process.env.YTDLP_COOKIES_FROM_BROWSER;
  if (browser) return ["--cookies-from-browser", browser];
  const file = process.env[`YTDLP_COOKIES_${opts.site.toUpperCase()}_FILE`];
  return file ? ["--cookies", file] : [];
}

/* ── yt-dlp ──────────────────────────────────────────────────────────────
   Prefer one file that already carries H.264 in MP4 — what every social site
   serves, and what every editor and video model accepts without a re-encode.
   A single stream also needs no ffmpeg to merge. */

function formatFor(maxHeight) {
  const h = maxHeight ? `[height<=${maxHeight}]` : "";
  return [
    `b[ext=mp4][vcodec^=avc1]${h}`,        // one file, already H.264/mp4
    `bv[ext=mp4][vcodec^=avc1]${h}+ba[ext=m4a]`,
    `b[ext=mp4]${h}`,
    `bv*${h}+ba`,
    `b${h}`,
    "bv*+ba/b",                             // last resort: whatever exists
  ].join("/");
}

function run(argv, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(argv[0], [...argv.slice(1), ...args], {
      timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout: String(stdout), stderr: String(stderr) }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const LOGIN_HINT = /sign in|log ?in|login|cookies|not a bot|private|age.?restricted|rate.?limit|registered users|empty media response|only works when logged-in/i;
/** Facebook and Instagram never say "log in" to a program. They serve a page
 *  with the video stripped out, which yt-dlp reports as a parse failure. */
const WALL_HINT = /cannot parse data|unable to extract|no video formats|unexpected response/i;
const WALLED_SITES = new Set(["facebook", "instagram", "threads"]);

async function viaYtDlp(url, opts) {
  const argv = ytDlp();
  const args = [
    "--no-playlist", "--no-warnings", "--no-progress", "--no-mtime",
    "--socket-timeout", "20", "--retries", "2",
    "--match-filter", "!is_live",
    "--js-runtimes", `node:${process.execPath}`,
    // Anything that has to be merged lands as mp4, so a caller never has to
    // wonder whether it got .webm or .mkv this time.
    "--merge-output-format", "mp4",
    "-f", formatFor(opts.maxHeight),
    "-o", path.join(opts.outDir, "%(title).80B [%(id)s].%(ext)s"),
    "--print", "after_move:%(.{id,title,description,uploader,uploader_url,duration,thumbnail,width,height,ext,filepath,webpage_url})j",
    ...cookieArgs(opts),
    ...(opts.audio ? ["-x", "--audio-format", "mp3"] : []),
    ...(opts.maxBytes ? ["--max-filesize", String(opts.maxBytes)] : []),
    ...(opts.extra ?? []),
    url.href,
  ];

  let stdout;
  try {
    ({ stdout } = await run(argv, args, opts.timeoutMs));
  } catch (err) {
    if (err.killed) throw new Error("yt-dlp took too long.");
    const line = (err.stderr ?? "").split("\n").reverse().find((l) => l.includes("ERROR")) ?? err.message;
    // yt-dlp's login errors carry a paragraph of FAQ links. Keep the sentence
    // that says what happened; the way out is printed once at the end.
    const msg = line
      .replace(/^.*?ERROR:\s*/, "")
      .replace(/\[[^\]]+\]\s*[\w-]+:\s*/, "")
      .replace(/\s*(See |Check if |Otherwise, |Confirm you are on |please report )[\s\S]*$/i, "")
      .trim();
    const walled = LOGIN_HINT.test(msg) || (WALLED_SITES.has(opts.site) && WALL_HINT.test(msg));
    throw Object.assign(new Error(msg.slice(0, 200) || "yt-dlp failed."), { needsLogin: walled && !cookieArgs(opts).length });
  }

  const info = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() || "{}");
  if (!info.filepath) throw new Error("yt-dlp produced no file (the video may exceed --max-bytes).");
  return {
    file: info.filepath,
    id: info.id ?? "",
    title: info.title ?? "",
    caption: info.description ?? "",
    author: info.uploader ?? "",
    authorUrl: info.uploader_url ?? "",
    durationSec: Number(info.duration) || null,
    width: Number(info.width) || null,
    height: Number(info.height) || null,
    thumbnail: info.thumbnail ?? null,
    sourceUrl: info.webpage_url ?? url.href,
    via: "yt-dlp",
  };
}

/* ── Fallbacks, only where yt-dlp measurably cannot ───────────────────── */

function sniff(buf) {
  if (buf.length > 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") return "mp4";
  if (buf.length > 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return "webm";
  return null;
}

async function save(bytes, outDir, base) {
  const ext = sniff(bytes);
  if (!ext) throw new Error("what came back was not a video file");
  const safe = (base || "video").replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 80) || "video";
  const file = path.join(outDir, `${safe}.${ext}`);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, bytes);
  return file;
}

async function getBytes(url, maxBytes) {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000), headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`download returned ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (maxBytes && buf.length > maxBytes) throw new Error("larger than --max-bytes");
  return buf;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** tikwm mirrors TikTok without a watermark and without curl_cffi. Kept as the
 *  second string for TikTok because yt-dlp's TikTok extractor is one of the
 *  most frequently broken, and this has outlived several of those breakages. */
async function viaTikwm(url, opts) {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url.href)}`, { signal: AbortSignal.timeout(30_000) });
  const json = await res.json();
  const d = json?.code === 0 ? json.data : null;
  if (!d?.play) throw new Error(json?.msg || "the mirror had no video");
  const file = await save(await getBytes(new URL(d.hdplay || d.play, "https://www.tikwm.com").href, opts.maxBytes), opts.outDir, d.title || d.id);
  return {
    file, id: String(d.id ?? ""), title: String(d.title ?? "").slice(0, 120),
    caption: Array.isArray(d.content_desc) ? d.content_desc.join("\n") : String(d.title ?? ""),
    author: String(d.author?.nickname ?? ""), authorUrl: "",
    durationSec: Number(d.duration) || null, width: null, height: null,
    thumbnail: d.cover ?? null, sourceUrl: url.href, via: "tikwm mirror",
  };
}

/** fxtwitter reads a public post's media without an X API key. */
async function viaFxTwitter(url, opts) {
  const id = url.pathname.match(/\/status(?:es)?\/(\d+)/)?.[1];
  if (!id) throw new Error("no status id in that link");
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`, { signal: AbortSignal.timeout(30_000) });
  const json = await res.json();
  const videos = json?.tweet?.media?.videos ?? [];
  const best = videos.filter((v) => v?.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  if (!best) throw new Error(json?.message === "NOT_FOUND" ? "that post does not exist or is protected" : "that post has no video");
  const text = String(json.tweet.text ?? "");
  const file = await save(await getBytes(best.url, opts.maxBytes), opts.outDir, text.slice(0, 60) || id);
  return {
    file, id, title: text.slice(0, 120), caption: text,
    author: String(json.tweet.author?.name ?? ""), authorUrl: String(json.tweet.author?.url ?? ""),
    durationSec: Number(best.duration) || null, width: Number(best.width) || null, height: Number(best.height) || null,
    thumbnail: best.thumbnail_url ?? null, sourceUrl: url.href, via: "fxtwitter",
  };
}

/** Your own cobalt instance (github.com/imputnet/cobalt). The public one
 *  forbids third-party use, so this only runs when COBALT_API_URL is set. */
async function viaCobalt(url, opts) {
  const api = process.env.COBALT_API_URL;
  if (!api) throw new Error("not configured (set COBALT_API_URL to your own instance)");
  const headers = { accept: "application/json", "content-type": "application/json" };
  if (process.env.COBALT_API_KEY) headers.authorization = `Api-Key ${process.env.COBALT_API_KEY}`;
  const res = await fetch(api, {
    method: "POST", headers,
    body: JSON.stringify({ url: url.href, videoQuality: String(opts.maxHeight ?? 1080), youtubeVideoCodec: "h264", downloadMode: "auto" }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => ({}));
  if (json.status === "error") throw new Error(String(json.error?.code ?? "error"));
  const link = json.status === "tunnel" || json.status === "redirect" ? json.url
    : json.status === "picker" ? json.picker?.find((p) => p.type === "video")?.url : null;
  if (!link) throw new Error("no video in the response");
  const file = await save(await getBytes(link, opts.maxBytes), opts.outDir, json.filename || "video");
  return {
    file, id: "", title: String(json.filename ?? ""), caption: "", author: "", authorUrl: "",
    durationSec: null, width: null, height: null, thumbnail: null, sourceUrl: url.href, via: "cobalt",
  };
}

/** The page's own og:video tag — the last resort, and the only one that works
 *  on a small site nobody has written an extractor for. */
async function viaOgVideo(url, opts) {
  const res = await fetch(url.href, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  const html = await res.text();
  const meta = {};
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["']([^"']+)["'][^>]+content=["']([^"']*)["']/gi)) meta[m[1]] = m[2];
  const video = meta["og:video:secure_url"] ?? meta["og:video:url"] ?? meta["og:video"];
  if (!video || !/^https?:\/\//i.test(video)) throw new Error("the page has no og:video tag");
  const file = await save(await getBytes(video.replace(/&amp;/g, "&"), opts.maxBytes), opts.outDir, meta["og:title"] || "video");
  return {
    file, id: "", title: meta["og:title"] ?? "", caption: meta["og:description"] ?? "", author: "", authorUrl: "",
    durationSec: null, width: null, height: null, thumbnail: meta["og:image"] ?? null, sourceUrl: url.href, via: "og:video",
  };
}

/* ── The ladder ──────────────────────────────────────────────────────────
   yt-dlp first nearly everywhere, because it alone carries the caption, the
   author and the duration, and it alone is maintained against site changes.
   Ordering below is measured, not guessed — see references/platforms.md. */

const LADDER = {
  tiktok: ["yt-dlp", "tikwm", "cobalt"],
  x: ["yt-dlp", "fxtwitter", "cobalt"],
  web: ["og:video", "yt-dlp", "cobalt"],
  default: ["yt-dlp", "cobalt", "og:video"],
};

const STRATEGIES = { "yt-dlp": viaYtDlp, tikwm: viaTikwm, fxtwitter: viaFxTwitter, cobalt: viaCobalt, "og:video": viaOgVideo };

export async function grab(input, options = {}) {
  const found = detect(input);
  if (!found) throw new Error("That doesn't look like a link.");
  const { url, site } = found;

  const opts = {
    site,
    outDir: options.outDir ?? process.cwd(),
    audio: options.audio ?? false,
    // 1080 by default: above that the file stops being useful to an editor or
    // a video model and starts being a download. --max-height 0 lifts it.
    maxHeight: options.maxHeight === 0 ? null : (options.maxHeight ?? 1080),
    maxBytes: options.maxBytes ?? null,
    cookies: options.cookies ?? null,
    cookiesFromBrowser: options.cookiesFromBrowser ?? null,
    timeoutMs: options.timeoutMs ?? 300_000,
    extra: options.extra ?? [],
  };
  mkdirSync(opts.outDir, { recursive: true });

  const trail = [];
  let needsLogin = false;

  for (const name of LADDER[site] ?? LADDER.default) {
    try {
      const got = await STRATEGIES[name](url, opts);
      trail.push(`${name}: got the video.`);
      const size = statSync(got.file).size;
      return { ...got, site, bytes: size, trail };
    } catch (err) {
      if (err.needsLogin) needsLogin = true;
      trail.push(`${name}: ${err.message}`);
    }
  }

  const err = new Error(
    needsLogin
      ? `${site} only shows this to a signed-in account. Re-run with --cookies-from-browser chrome (see references/cookies.md), or open the post and save the video yourself.`
      : `Couldn't get a video out of that ${site} link.`
  );
  err.trail = trail;
  err.needsLogin = needsLogin;
  throw err;
}

/* ── CLI ─────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--audio") opts.audio = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--check") opts.check = true;
    else if (a === "--out") opts.outDir = argv[++i];
    else if (a === "--max-height") opts.maxHeight = Number(argv[++i]);
    else if (a === "--max-bytes") opts.maxBytes = Number(argv[++i]);
    else if (a === "--cookies") opts.cookies = argv[++i];
    else if (a === "--cookies-from-browser") opts.cookiesFromBrowser = argv[++i];
    else if (a === "--timeout") opts.timeoutMs = Number(argv[++i]) * 1000;
    else opts._.push(a);
  }
  return opts;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.check) {
    try {
      const argv = ytDlp();
      const version = execFileSync(argv[0], [...argv.slice(1), "--version"], { stdio: "pipe", windowsHide: true }).toString().trim();
      console.log(`yt-dlp        ${version}  (${argv.join(" ")})`);
      const imp = hasImpersonation();
      console.log(`impersonation ${imp ? "available" : "MISSING — TikTok and Dailymotion will fail"}`);
      if (!imp) console.log(`              fix: python -m pip install --user "yt-dlp[default,curl-cffi]"`);
      let ff = "missing — --audio and merged formats will fail";
      try {
        execFileSync("ffmpeg", ["-version"], { stdio: "pipe", windowsHide: true });
        ff = "available";
      } catch { /* left as missing */ }
      console.log(`ffmpeg        ${ff}`);
      console.log(`cobalt        ${process.env.COBALT_API_URL ? "configured" : "not configured (optional)"}`);
      process.exit(imp ? 0 : 1);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }

  const input = opts._.join(" ");
  if (!input) {
    console.error(`grab.mjs — a link in, a video file out.

  node grab.mjs "<link or share text>" [options]

  --out <dir>                   where to save (default: here)
  --audio                       extract mp3 instead of video (needs ffmpeg)
  --max-height <px>             cap the resolution (default 1080; 0 = uncapped)
  --max-bytes <n>               refuse anything larger
  --cookies-from-browser <b>    chrome | firefox | edge | brave | safari
  --cookies <file>              a cookies.txt instead
  --timeout <seconds>           default 300
  --json                        print metadata as JSON
  --check                       report the toolchain and exit`);
    process.exit(1);
  }

  try {
    if (!opts.json) console.error(`Fetching ${detect(input)?.site ?? "?"} …`);
    const got = await grab(input, opts);
    if (opts.json) {
      console.log(JSON.stringify(got, null, 2));
    } else {
      for (const line of got.trail) console.error(`  ${line}`);
      const mb = (got.bytes / 1024 / 1024).toFixed(1);
      console.error(`\n${got.title || "(untitled)"}${got.author ? ` — ${got.author}` : ""}`);
      console.error(`${got.durationSec ? `${Math.round(got.durationSec)}s · ` : ""}${mb} MB · via ${got.via}`);
      console.log(got.file);
    }
  } catch (err) {
    for (const line of err.trail ?? []) console.error(`  ${line}`);
    console.error(`\n${err.message}`);
    process.exit(err.needsLogin ? 2 : 1);
  }
}
