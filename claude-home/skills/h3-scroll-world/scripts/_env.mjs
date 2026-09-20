// Shared helpers for the h3-scroll-world scripts. Zero npm dependencies.
//
// Keys come from the process environment first, then a .env.local in the
// current directory, then the owner's hub .env.local. Values are never printed.

import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, resolve } from "node:path";

export const HUB = "C:/Users/honey/OneDrive/Desktop/claude code files";

function parseEnvFile(p) {
  const out = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = { ...parseEnvFile(resolve(HUB, ".env.local")), ...parseEnvFile(resolve(process.cwd(), ".env.local")) };

export function env(name) {
  return process.env[name] || fileEnv[name] || "";
}

/** Minimal --flag value parser; repeated flags collect into arrays. */
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    const val = next === undefined || next.startsWith("--") ? true : (i++, next);
    if (key in out) out[key] = [].concat(out[key], val);
    else out[key] = val;
  }
  return out;
}

export function die(msg, code = 1) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

export function ffmpegPath() {
  if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {
    /* not on PATH */
  }
  const local = resolve(HUB, "node_modules/ffmpeg-static/ffmpeg.exe");
  return existsSync(local) ? local : null;
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/**
 * A local image as a data URL. Images over maxBytes are re-encoded to a
 * 1280-wide JPEG with ffmpeg (when available) so requests stay small.
 */
export function imageDataUrl(file, maxBytes = 1_500_000) {
  if (!existsSync(file)) die(`image not found: ${file}`);
  let bytes = readFileSync(file);
  let mime = MIME[extname(file).toLowerCase()] || "image/png";
  if (statSync(file).size > maxBytes) {
    const ff = ffmpegPath();
    if (ff) {
      bytes = execFileSync(ff, ["-v", "error", "-i", file, "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], {
        maxBuffer: 64 * 1024 * 1024,
      });
      mime = "image/jpeg";
    }
  }
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
