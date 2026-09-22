#!/usr/bin/env node
// ---------------------------------------------------------------------------
// prep-clips — make footage scrub-ready for a Real Estate Reveal site.
//
//   node prep-clips.mjs <clip.mp4 | folder> --out site/clips [--name 01]
//       → 01.mp4      desktop, 1920 wide, short GOP, no audio, faststart
//         01-m.mp4    mobile, 960 wide, same treatment, smaller
//         01.jpg      first frame (poster, and the no-JS / reduced-motion still)
//         01-last.jpg last frame  (feed it to the NEXT clip as its start frame)
//
//   node prep-clips.mjs --kenburns <photo.jpg> --out site/clips --name 03
//       [--seconds 6] [--move in|out|left|right|up]
//       → the same four files, made from a still with a slow camera move.
//         This is the no-key fallback: the site is complete without a video model.
//
//   node prep-clips.mjs --last <clip.mp4> --out frame.jpg   just grab the last frame
//
// Why re-encode: browsers can only seek to keyframes quickly. Model output usually
// has one keyframe every few seconds, so scrubbing stutters and scrolling backwards
// freezes. A keyframe every 6 frames and no B-frames makes currentTime seeks cheap.
//
// ffmpeg: $FFMPEG, else `ffmpeg` on PATH, else the binary bundled with the Python
// package imageio-ffmpeg (`pip install imageio-ffmpeg`).
// ---------------------------------------------------------------------------

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
// The clip or folder is always the first argument when it is given.
const positional = args[0] && !args[0].startsWith("--") ? [args[0]] : [];

function findFfmpeg() {
  if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) return "ffmpeg";
  for (const py of ["python", "python3", "py"]) {
    const r = spawnSync(py, ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" });
    const p = r.status === 0 ? r.stdout.trim() : "";
    if (p && existsSync(p)) return p;
  }
  console.error("ffmpeg not found. Install it, set FFMPEG=<path>, or: pip install imageio-ffmpeg");
  process.exit(2);
}
const FF = findFfmpeg();
const ff = (a) => execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...a], { stdio: "inherit" });

// Short GOP, no B-frames, no audio, moov atom up front.
const SCRUB = ["-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "6", "-keyint_min", "6",
  "-sc_threshold", "0", "-bf", "0", "-movflags", "+faststart"];

function encode(src, outDir, name) {
  mkdirSync(outDir, { recursive: true });
  const o = (s) => join(outDir, `${name}${s}`);
  ff(["-i", src, ...SCRUB, "-vf", "scale='min(1920,iw)':-2", "-crf", "21", "-preset", "slow", o(".mp4")]);
  ff(["-i", src, ...SCRUB, "-vf", "scale='min(960,iw)':-2", "-crf", "25", "-preset", "slow", o("-m.mp4")]);
  ff(["-i", src, "-frames:v", "1", "-q:v", "3", "-vf", "scale='min(1920,iw)':-2", o(".jpg")]);
  lastFrame(src, o("-last.jpg"));
  const mb = (f) => (statSync(f).size / 1048576).toFixed(1);
  console.log(`✓ ${name}: ${mb(o(".mp4"))} MB desktop · ${mb(o("-m.mp4"))} MB mobile · poster · last frame`);
}

function lastFrame(src, out) {
  // -sseof seeks from the end; 0.2 s back catches the final decodable frame.
  ff(["-sseof", "-0.2", "-i", src, "-update", "1", "-q:v", "2", out]);
}

function kenburns(photo, outDir, name) {
  const secs = Number(flag("seconds", 6));
  const move = String(flag("move", "in"));
  const fps = 30, frames = Math.round(secs * fps), zMax = 1.12;
  // Progress 0→1 across the clip, eased so the move starts and ends softly.
  const p = `(0.5-0.5*cos(PI*on/${frames}))`;
  const zoom = move === "out" ? `${zMax}-(${zMax}-1)*${p}` : move === "in" ? `1+(${zMax}-1)*${p}` : `${zMax}`;
  const cx = "iw/2-(iw/zoom/2)", cy = "ih/2-(ih/zoom/2)";
  const pan = (axis, dir) => `${axis === "x" ? "(iw-iw/zoom)" : "(ih-ih/zoom)"}*${dir > 0 ? p : `(1-${p})`}`;
  const x = move === "left" ? pan("x", -1) : move === "right" ? pan("x", 1) : cx;
  const y = move === "up" ? pan("y", -1) : cy;
  // Upscale first: zoompan rounds to whole pixels, and at 4K the rounding is invisible.
  const vf = `scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,` +
    `zoompan=z='${zoom}':x='${x}':y='${y}':d=${frames}:s=1920x1080:fps=${fps}`;
  const tmp = join(outDir, `${name}.kb-src.mp4`);
  mkdirSync(outDir, { recursive: true });
  ff(["-loop", "1", "-i", photo, "-vf", vf, "-frames:v", String(frames), "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", tmp]);
  encode(tmp, outDir, name);
  try { execFileSync(process.platform === "win32" ? "cmd" : "rm", process.platform === "win32" ? ["/c", "del", "/q", resolve(tmp)] : ["-f", tmp]); } catch {}
}

const out = flag("out", "clips");
if (flag("last")) {
  lastFrame(String(flag("last")), String(out).endsWith(".jpg") ? String(out) : join(String(out), "last.jpg"));
} else if (flag("kenburns")) {
  const photo = String(flag("kenburns"));
  kenburns(photo, String(out), String(flag("name", basename(photo, extname(photo)))));
} else if (positional[0]) {
  const src = positional[0];
  if (statSync(src).isDirectory()) {
    const clips = readdirSync(src).filter((f) => /\.(mp4|mov|webm|mkv)$/i.test(f)).sort();
    clips.forEach((f, i) => encode(join(src, f), String(out), String(i + 1).padStart(2, "0")));
  } else {
    encode(src, String(out), String(flag("name", basename(src, extname(src)))));
  }
} else {
  console.log("usage: prep-clips.mjs <clip|folder> --out dir [--name 01] | --kenburns photo --out dir --name 03 [--move in|out|left|right|up] | --last clip --out f.jpg");
  process.exit(1);
}
