// ---------------------------------------------------------------------------
// The yt-dlp engine. Server-only, and local-only in practice.
//
// yt-dlp is a binary on the owner's machine, not a dependency of this repo:
// nothing here installs it, imports it, or ships it. That has one deliberate
// consequence — this source is dark on Vercel and alive on the PC, which is
// the right shape for a tool that reaches out to a site on the owner's behalf.
// When the binary is missing the app says exactly that and the other sources
// keep working, per the hub rule that a missing dependency degrades visibly.
//
// Search runs through yt-dlp's own `ytsearch:` (no API key, no quota). Every
// hit is scored against the metadata the owner CONFIRMED in stage 2, which is
// the whole reason this app exists: "first result for the song name" is how
// you end up with a sped-up edit, a lyric video with an intro, or a cover.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { rank, scoreCandidate } from "./match";
import type { Candidate, Licence, Track } from "./types";

/**
 * True on a deployed serverless host, where no binary of ours can ever exist.
 *
 * Worth knowing apart from "not installed": telling somebody to run
 * `pip install` to fix a page served from Vercel is advice they cannot act on,
 * and it reads as the app being broken rather than as this source being local
 * by design.
 */
function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/** Each entry is an argv: some installs only have the Python module. */
const BINARY_CANDIDATES: string[][] = [
  ["yt-dlp"],
  ["yt-dlp.exe"],
  ["python", "-m", "yt_dlp"],
  ["py", "-m", "yt_dlp"],
  ["python3", "-m", "yt_dlp"],
];

/**
 * Places a yt-dlp binary sits when PATH does not mention it.
 *
 * pip drops `yt-dlp.exe` into a per-user Scripts directory that Windows does
 * not add to PATH, and it warns about exactly that at install time. A dev
 * server started from a shell with a thinner PATH than the one that installed
 * it then reports yt-dlp missing while the file is right there — which is how
 * this was found. Looking on disk costs a few `existsSync` calls and removes a
 * whole class of "it works for me" between two terminals on one machine.
 */
function discoverBinaries(): string[][] {
  const found: string[][] = [];
  const home = homedir();
  const roots = [
    process.env.APPDATA ? join(process.env.APPDATA, "Python") : "",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Python") : "",
    "C:\\",
  ].filter(Boolean);

  // Windows: <root>/Python3xx/Scripts/yt-dlp.exe
  for (const root of roots) {
    let versions: string[];
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

  // macOS and Linux, including a pipx or --user install.
  for (const path of [
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    "/opt/homebrew/bin/yt-dlp",
    join(home, ".local", "bin", "yt-dlp"),
  ]) {
    try {
      if (existsSync(path)) found.push([path]);
    } catch {
      // An unreadable path is simply not a candidate.
    }
  }

  return found;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(argv: string[], args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], [...argv.slice(1), ...args], {
      windowsHide: true,
      // No shell: the arguments include a user-supplied URL, and a shell would
      // make that a command-injection surface. spawn passes argv straight.
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export interface YtdlpStatus {
  ok: boolean;
  /** How it is invoked, e.g. ["python", "-m", "yt_dlp"]. */
  argv: string[] | null;
  version: string | null;
  /** MP3 extraction needs ffmpeg; without it yt-dlp can only save the raw m4a. */
  ffmpeg: boolean;
  message: string;
}

let cached: { at: number; status: YtdlpStatus } | null = null;

async function hasFfmpeg(): Promise<boolean> {
  const bin = process.env.FFMPEG_PATH || "ffmpeg";
  const res = await run([bin], ["-version"], 8_000);
  return res.code === 0;
}

/** Find yt-dlp, remembering the answer for a minute so the UI can poll freely. */
export async function ytdlpStatus(force = false): Promise<YtdlpStatus> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.status;

  const configured = process.env.YTDLP_PATH?.trim();
  const attempts = [
    ...(configured ? [[configured]] : []),
    ...BINARY_CANDIDATES,
    ...discoverBinaries(),
  ];

  let status: YtdlpStatus = {
    ok: false,
    argv: null,
    version: null,
    ffmpeg: false,
    message: isServerless()
      ? "yt-dlp is a program on your own machine and this page is served from a host that has "
        + "none — so downloading happens on your PC, not here. Set the runner up once in the "
        + "“Your PC” tab and this site will hand it the work."
      : "yt-dlp was not found from this server. Install it with `pip install -U yt-dlp` (or "
        + "`winget install yt-dlp.yt-dlp`). If it is already installed, its folder is probably "
        + "not on this terminal's PATH — set YTDLP_PATH in .env.local to the full path of "
        + "yt-dlp.exe and restart the server. The other sources work without it.",
  };

  for (const argv of attempts) {
    const res = await run(argv, ["--version"], 10_000);
    if (res.code === 0 && res.stdout.trim()) {
      const ffmpeg = await hasFfmpeg();
      status = {
        ok: true,
        argv,
        version: res.stdout.trim().split("\n")[0],
        ffmpeg,
        message: ffmpeg
          ? "Ready — " + argv.join(" ")
          : "yt-dlp is here but ffmpeg is not, so audio cannot be converted to MP3. "
            + "Install ffmpeg, or take the original format.",
      };
      break;
    }
  }

  cached = { at: Date.now(), status };
  return status;
}

// --- search ----------------------------------------------------------------

interface FlatEntry {
  id?: string;
  title?: string;
  duration?: number | null;
  channel?: string;
  uploader?: string;
  url?: string;
  live_status?: string | null;
}

/**
 * The top YouTube results for the confirmed track, scored against it.
 *
 * `--flat-playlist` keeps this to one network round trip: the per-video page
 * is only fetched when the owner actually downloads one.
 */
export async function searchYouTube(track: Track, limit = 8): Promise<Candidate[]> {
  const status = await ytdlpStatus();
  if (!status.ok || !status.argv) return [];

  const query = `ytsearch${limit}:${track.artist} ${track.title}`.replace(/\s+/g, " ").trim();
  const res = await run(
    status.argv,
    ["--dump-json", "--flat-playlist", "--no-warnings", "--no-playlist", query],
    45_000,
  );
  if (res.code !== 0) return [];

  const out: Candidate[] = [];
  for (const line of res.stdout.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    let entry: FlatEntry;
    try {
      entry = JSON.parse(text) as FlatEntry;
    } catch {
      continue;
    }
    if (!entry.id || !entry.title) continue;
    // A live stream has no end; it is never the song.
    if (entry.live_status === "is_live" || entry.live_status === "is_upcoming") continue;

    const creator = entry.channel ?? entry.uploader ?? "Unknown channel";
    const durationMs = entry.duration ? Math.round(entry.duration * 1000) : null;
    const { score, reasons } = scoreCandidate(track, { title: entry.title, creator, durationMs });

    out.push({
      id: "youtube:" + entry.id,
      provider: "youtube",
      providerLabel: "YouTube",
      title: entry.title,
      creator,
      pageUrl: "https://www.youtube.com/watch?v=" + entry.id,
      fileUrl: "https://www.youtube.com/watch?v=" + entry.id,
      format: status.ffmpeg ? "MP3" : "M4A",
      bytes: null,
      durationMs,
      licence: {
        kind: "youtube",
        label: "YouTube · rights not verified",
        url: "https://www.youtube.com/watch?v=" + entry.id,
      },
      score,
      reasons,
    });
  }

  // YouTube nearly always has the song, so an empty table here reads as a
  // broken app rather than an honest "no". Rows that clear the bar are the
  // answer; when none do, the three best are shown anyway with the scores
  // they earned, so the owner can judge instead of being told nothing exists.
  const confident = out.filter((c) => c.score >= 30);
  if (confident.length > 0) return confident;
  // Nothing convincing. Show the best few anyway rather than an empty table —
  // but never a row that matched on nothing, which is what a mangled query or
  // a song the site simply does not have looks like.
  return rank(out.filter((c) => c.score >= 15)).slice(0, 3);
}

// --- pasted links ----------------------------------------------------------

/**
 * Sites the paste box will hand to yt-dlp.
 *
 * yt-dlp supports something like a thousand extractors, and this list is a
 * fraction of them — deliberately. The URL arrives from the browser, so an
 * unrestricted gate would let the route fetch any host the deployment can
 * reach, including its own network. These are the video and audio sites worth
 * pasting; adding one is adding a line, and the refusal names the rule rather
 * than pretending the link is malformed.
 */
const SUPPORTED_HOSTS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "dailymotion.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "fb.watch",
  "twitter.com",
  "x.com",
  "reddit.com",
  "twitch.tv",
  "soundcloud.com",
  "bandcamp.com",
  "mixcloud.com",
  "archive.org",
  "nicovideo.jp",
  "bilibili.com",
  "rumble.com",
  "odysee.com",
];

function hostOf(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    return null;
  }
}

/** Only a real YouTube watch/short URL. Used by the search-driven rows. */
export function isYouTubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    return host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com";
  } catch {
    return false;
  }
}

/** Any host on the paste box's guest list. */
export function isSupportedMediaUrl(raw: string): boolean {
  const host = hostOf(raw);
  if (!host) return false;
  return SUPPORTED_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

/** The sites the paste box advertises, for the hint under the field. */
export const SUPPORTED_SITE_NAMES = [
  "YouTube",
  "Vimeo",
  "TikTok",
  "Instagram",
  "Facebook",
  "X",
  "Reddit",
  "Twitch",
  "SoundCloud",
  "Bandcamp",
  "Mixcloud",
  "Dailymotion",
  "Archive.org",
  "Rumble",
  "Odysee",
  "Bilibili",
];

export interface LinkProbe {
  id: string;
  title: string;
  creator: string;
  /** Which extractor answered — "Youtube", "TikTok", "SoundCloud"… */
  siteLabel: string;
  pageUrl: string;
  durationMs: number | null;
  thumbnail: string | null;
  /** yyyy-mm-dd, or "" when the site does not say. */
  uploaded: string;
  /** Exactly what the site states, never a guess. */
  licence: Licence;
  isLive: boolean;
  approxBytes: number | null;
}

interface DumpJson {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  creator?: string;
  duration?: number | null;
  thumbnail?: string | null;
  upload_date?: string;
  license?: string | null;
  extractor_key?: string;
  webpage_url?: string;
  is_live?: boolean;
  filesize_approx?: number | null;
  _type?: string;
}

/**
 * Read a pasted link's metadata without downloading anything.
 *
 * The paste box exists to skip the search, not to skip the confirmation: one
 * cheap call gets the real title, channel, runtime and — the part worth having
 * — whatever licence the site actually states, so a Creative Commons upload is
 * visibly different from everything else before any file is fetched.
 */
export async function probeLink(url: string): Promise<LinkProbe> {
  const status = await ytdlpStatus();
  if (!status.ok || !status.argv) throw new Error(status.message);
  if (!isSupportedMediaUrl(url)) {
    throw new Error(
      "That host is not on this app's list. It takes links from " +
        SUPPORTED_SITE_NAMES.slice(0, 6).join(", ") +
        " and a handful of others.",
    );
  }

  const res = await run(
    status.argv,
    ["--dump-single-json", "--no-playlist", "--no-warnings", "--skip-download", url],
    60_000,
  );
  if (res.code !== 0) {
    const why = res.stderr.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400);
    throw new Error(why || "yt-dlp could not read that link.");
  }

  let data: DumpJson;
  try {
    data = JSON.parse(res.stdout.trim()) as DumpJson;
  } catch {
    throw new Error("yt-dlp answered with something that was not a video.");
  }
  if (data._type === "playlist") {
    throw new Error("That link is a playlist or a channel. Paste one video.");
  }

  const stated = (data.license ?? "").trim();
  // A site that states a licence is telling you something; a site that says
  // nothing is not, and the row must not round that silence up to permission.
  const licence: Licence = /creative commons/i.test(stated)
    ? { kind: "cc", label: stated.replace(/\s*\(reuse allowed\)\s*$/i, "").trim(), url }
    : { kind: "youtube", label: stated || "Rights not verified", url };

  const day = data.upload_date ?? "";
  return {
    id: data.id ?? url,
    title: data.title ?? "Untitled",
    creator: data.channel ?? data.uploader ?? data.creator ?? "Unknown",
    siteLabel: data.extractor_key ?? "Link",
    pageUrl: data.webpage_url ?? url,
    durationMs: data.duration ? Math.round(data.duration * 1000) : null,
    thumbnail: data.thumbnail ?? null,
    uploaded: /^\d{8}$/.test(day)
      ? day.slice(0, 4) + "-" + day.slice(4, 6) + "-" + day.slice(6)
      : "",
    licence,
    isLive: Boolean(data.is_live),
    approxBytes: data.filesize_approx ?? null,
  };
}

// --- download --------------------------------------------------------------

export type GrabMode = "audio" | "video";

export interface Extracted {
  /** Absolute path of the finished file in a temp directory. */
  path: string;
  /** The directory to delete once the file has been handed over. */
  dir: string;
  filename: string;
  bytes: number;
  contentType: string;
}

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  opus: "audio/opus",
  ogg: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

/**
 * Pull one URL and hand back a finished file on disk.
 *
 * To a temp file rather than straight down the response, so a failure is a
 * readable error instead of a truncated file in the owner's downloads, and so
 * the real byte count reaches the library row. The caller must delete `dir`.
 */
export async function extractMedia(
  url: string,
  basename: string,
  mode: GrabMode = "audio",
): Promise<Extracted> {
  const status = await ytdlpStatus();
  if (!status.ok || !status.argv) throw new Error(status.message);
  if (!isSupportedMediaUrl(url)) throw new Error("That host is not on this app's list.");
  if (mode === "video" && !status.ffmpeg) {
    throw new Error("Video needs ffmpeg to join the picture to the sound, and it is not here.");
  }

  const dir = await mkdtemp(join(tmpdir(), "mp3dl-"));
  try {
    const shared = [
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      // YouTube hands out an intermittent 403 on the media URLs; left alone it
      // surfaces as "that video failed" for a video that works on the retry.
      "--retries",
      "5",
      "--fragment-retries",
      "5",
      "--extractor-retries",
      "3",
      "--embed-metadata",
    ];

    const perMode =
      mode === "video"
        ? ["-f", "bestvideo*+bestaudio/best", "--merge-output-format", "mp4"]
        : [
            "-f",
            "bestaudio/best",
            "-x",
            ...(status.ffmpeg
              ? ["--audio-format", "mp3", "--audio-quality", "0", "--embed-thumbnail"]
              : []),
          ];

    const argv = [...shared, ...perMode, "-o", join(dir, "grab.%(ext)s"), url];

    let res = await run(status.argv, argv, 140_000);
    let files = (await readdir(dir)).filter((f) => !f.endsWith(".part"));

    // YouTube hands out a 403 on the media URLs often enough to matter, and
    // --retries cannot fix it: it re-requests the SAME signed URL and gets the
    // same refusal. Only a fresh extraction produces fresh URLs, so a 403 is
    // worth exactly one more full attempt. Measured, not guessed — the same
    // video failed and then succeeded twice in a row minutes apart.
    if ((res.code !== 0 || files.length === 0) && /\b403\b|forbidden/i.test(res.stderr)) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      await mkdir(dir, { recursive: true });
      res = await run(status.argv, argv, 140_000);
      files = (await readdir(dir)).filter((f) => !f.endsWith(".part"));
    }

    if (res.code !== 0 || files.length === 0) {
      const why = res.stderr.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400);
      throw new Error(
        why
          ? why + " — the site refused it; trying again in a moment often works."
          : "yt-dlp could not download that one.",
      );
    }

    const wanted = mode === "video" ? ".mp4" : ".mp3";
    const name = files.find((f) => f.endsWith(wanted)) ?? files[0];
    const path = join(dir, name);
    const ext = (name.split(".").pop() ?? "bin").toLowerCase();
    const info = await stat(path);

    return {
      path,
      dir,
      filename: basename.replace(/\.[a-z0-9]{2,4}$/i, "") + "." + ext,
      bytes: info.size,
      contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
    };
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}
