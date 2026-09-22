#!/usr/bin/env node
// ffprobe stand-in: prints {width,height,fps,duration,frames,audio} for a video,
// parsed from `ffmpeg -i`. Works with the hub's ffmpeg-static (which has no ffprobe).
//
//   node probe.mjs clip.mp4

import { spawnSync } from "node:child_process";
import { die, ffmpegPath } from "./_env.mjs";

const file = process.argv[2];
if (!file) die("usage: node probe.mjs <video>");
const ff = ffmpegPath();
if (!ff) die("ffmpeg not found (PATH, $FFMPEG, or the hub's ffmpeg-static)");

const info = spawnSync(ff, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr || "";
const dur = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
const video = info.match(/Stream #\S+.*Video: .*?(\d{2,5})x(\d{2,5})[^\n]*?([\d.]+) fps/);
if (!video) die(`no video stream found in ${file}`);

const duration = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : null;
const fps = Number(video[3]);
console.log(
  JSON.stringify({
    width: Number(video[1]),
    height: Number(video[2]),
    fps,
    duration,
    frames: duration ? Math.round(duration * fps) : null,
    audio: /Stream #\S+.*Audio:/.test(info),
  }),
);
