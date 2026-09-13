// ---------------------------------------------------------------------------
// yt-dlp — the open-source downloader (github.com/yt-dlp/yt-dlp) that knows
// how to pull the actual video file out of YouTube, Instagram, Facebook, X,
// TikTok and ~1,800 other sites.
//
// Finding the binary, in order:
//   1. YTDLP_PATH                 an explicit path you installed yourself
//   2. `yt-dlp` on PATH           pip / winget / brew installs
//   3. the official standalone    downloaded once from the pinned GitHub release
//      release binary             into the temp dir, SHA-256 checked against the
//                                 release's own SHA2-256SUMS before it is ever run
//
// (3) is what makes this work on Vercel, where nothing can be pre-installed:
// the Linux build is one ~40 MB file that runs from /tmp. Set
// YTDLP_AUTO_DOWNLOAD=0 to forbid it.
//
// Sites that hide videos from logged-out visitors (Instagram almost always,
// Facebook and YouTube sometimes) need cookies from a logged-in browser; see
// cookiesFor(). Without them the error says so rather than failing vaguely.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Platform } from "./platform";

const RELEASE = process.env.YTDLP_VERSION || "2026.08.19";
const RELEASE_BASE = `https://github.com/yt-dlp/yt-dlp/releases/download/${RELEASE}`;

export class YtDlpError extends Error {
  constructor(
    message: string,
    /** The site wants a logged-in session (cookies) for this video. */
    public needsLogin = false,
  ) {
    super(message);
  }
}

function assetName(): string | null {
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos";
  if (process.platform === "linux") return process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  return null;
}

function run(file: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout: String(stdout), stderr: String(stderr) }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function works(file: string): Promise<boolean> {
  try {
    await run(file, ["--version"], 30_000);
    return true;
  } catch {
    return false;
  }
}

async function downloadRelease(asset: string): Promise<string> {
  const dir = process.env.YTDLP_CACHE_DIR || path.join(os.tmpdir(), "yt-dlp", RELEASE);
  const target = path.join(dir, asset);
  try {
    await fs.access(target);
    return target;
  } catch {
    // Not cached yet.
  }

  const sums = await fetch(`${RELEASE_BASE}/SHA2-256SUMS`, { signal: AbortSignal.timeout(30_000) });
  if (!sums.ok) throw new YtDlpError(`Couldn't read yt-dlp's checksums (${sums.status}).`);
  const expected = (await sums.text())
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find(([, name]) => name === asset)?.[0];
  if (!expected) throw new YtDlpError(`yt-dlp ${RELEASE} has no checksum for ${asset}.`);

  const res = await fetch(`${RELEASE_BASE}/${asset}`, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new YtDlpError(`Couldn't download yt-dlp (${res.status}).`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new YtDlpError("The downloaded yt-dlp failed its checksum, so it was not run.");

  await fs.mkdir(dir, { recursive: true });
  const partial = `${target}.${process.pid}.part`;
  await fs.writeFile(partial, bytes, { mode: 0o755 });
  await fs.rename(partial, target).catch(async () => {
    // Another request finished the same download first.
    await fs.unlink(partial).catch(() => undefined);
  });
  return target;
}

let resolving: Promise<string> | null = null;

/** The yt-dlp executable to run, fetching the pinned release if nothing is installed. */
export function ytDlpBinary(): Promise<string> {
  if (!resolving) {
    resolving = (async () => {
      const explicit = process.env.YTDLP_PATH;
      if (explicit) {
        if (await works(explicit)) return explicit;
        throw new YtDlpError(`YTDLP_PATH is set to ${explicit}, but that doesn't run.`);
      }
      if (await works("yt-dlp")) return "yt-dlp";
      if (process.env.YTDLP_AUTO_DOWNLOAD === "0") throw new YtDlpError("yt-dlp isn't installed and auto-download is off.");
      const asset = assetName();
      if (!asset) throw new YtDlpError(`No yt-dlp build for ${process.platform}/${process.arch}.`);
      return downloadRelease(asset);
    })();
    // A failure isn't cached; the next request tries again.
    resolving.catch(() => (resolving = null));
  }
  return resolving;
}

/**
 * Netscape-format cookies for a site, from YTDLP_COOKIES_<SITE> (the file's
 * text, or the same text base64-encoded — easier to paste into Vercel) or
 * YTDLP_COOKIES_<SITE>_FILE (a path). Export them from a logged-in browser
 * with an extension such as "Get cookies.txt LOCALLY".
 */
export async function cookiesFor(platform: Platform): Promise<string | null> {
  const name = `YTDLP_COOKIES_${platform.toUpperCase()}`;
  const file = process.env[`${name}_FILE`];
  if (file) return fs.readFile(file, "utf8").catch(() => null);
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  if (raw.includes("\t") || raw.startsWith("#")) return raw.replace(/\\n/g, "\n");
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export interface YtDlpVideo {
  bytes: Buffer;
  ext: string;
  title: string;
  uploader: string;
  durationSec: number | null;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
}

/**
 * Prefer one file that already has H.264 in MP4 (what TikTok, Instagram,
 * Facebook and X serve). YouTube only offers that combined at low quality, so
 * the next choice is H.264 video-only up to 1080p — a motion reference needs
 * no audio, and a single stream needs no ffmpeg to merge.
 */
const FORMAT = [
  "b[ext=mp4][vcodec^=avc1][height<=1080]",
  "bv[ext=mp4][vcodec^=avc1][height<=1080]",
  "b[ext=mp4][height<=1080]",
  "bv[ext=mp4][height<=1080]",
  "b[ext=mp4]",
  "b",
].join("/");

const LOGIN_HINT = /sign in|log ?in|login|cookies|confirm you.?re not a bot|private|age.?restricted|rate.?limit|not available in your country|registered users/i;

export async function ytDlpDownload(url: string, platform: Platform, opts: { maxBytes: number; timeoutMs?: number }): Promise<YtDlpVideo> {
  const bin = await ytDlpBinary();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ytdlp-"));
  try {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--no-mtime",
      "--socket-timeout", "20",
      "--retries", "2",
      "--max-filesize", String(opts.maxBytes),
      "--match-filter", "!is_live",
      // YouTube's player needs a JavaScript runtime; this process already is one.
      "--js-runtimes", `node:${process.execPath}`,
      "-f", FORMAT,
      "-o", path.join(dir, "video.%(ext)s"),
      "--print", "after_move:%(.{title,uploader,duration,thumbnail,width,height,ext,filepath})j",
    ];
    const cookies = await cookiesFor(platform);
    if (cookies) {
      const cookieFile = path.join(dir, "cookies.txt");
      await fs.writeFile(cookieFile, cookies);
      args.push("--cookies", cookieFile);
    }
    args.push(url);

    let stdout: string;
    try {
      ({ stdout } = await run(bin, args, opts.timeoutMs ?? 150_000));
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
      if (e.killed) throw new YtDlpError("yt-dlp took too long.");
      const line = (e.stderr ?? "").split("\n").reverse().find((l) => l.includes("ERROR")) ?? e.message;
      const message = line.replace(/^.*?ERROR:\s*/, "").replace(/\[[^\]]+\]\s*[\w-]+:\s*/, "").trim();
      throw new YtDlpError(message.slice(0, 300) || "yt-dlp failed.", LOGIN_HINT.test(message) && !cookies);
    }

    const info = JSON.parse(stdout.trim().split("\n").pop() || "{}") as Record<string, unknown>;
    const filepath = String(info.filepath ?? "");
    if (!filepath) throw new YtDlpError("yt-dlp didn't produce a file — the video may be larger than the limit.");
    const bytes = await fs.readFile(filepath);
    return {
      bytes,
      ext: String(info.ext ?? path.extname(filepath).slice(1)),
      title: String(info.title ?? ""),
      uploader: String(info.uploader ?? ""),
      durationSec: Number(info.duration) || null,
      thumbnail: typeof info.thumbnail === "string" ? info.thumbnail : null,
      width: Number(info.width) || null,
      height: Number(info.height) || null,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
