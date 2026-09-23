import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Tiny .env loader (no dependency): KEY=value lines, # comments, optional
// quotes. Values already in the real environment win. Same shape as the other
// runners in tools/, so one idea covers all of them.

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadEnv(file = path.join(here, "..", ".env")) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return out;
}

export function config() {
  loadEnv();
  return {
    /** The hub to serve. The live site by default — that is the whole point. */
    hubUrl: (process.env.HUB_URL || "https://ultimate-assistant-os.vercel.app").replace(/\/+$/, ""),
    token: process.env.HUB_TOKEN || "",
    /** Full path to yt-dlp, for when its folder is not on PATH. */
    ytdlpPath: process.env.YTDLP_PATH || "",
    ffmpegPath: process.env.FFMPEG_PATH || "",
  };
}

/** A sentence naming what is missing, or null when it can start. */
export function configProblem(cfg) {
  if (!cfg.token) {
    return (
      "No HUB_TOKEN.\n\n" +
      "Open MP3 Download on the hub, go to the 'Your PC' tab, press 'Create a token',\n" +
      "then copy .env.example to .env in this folder and paste the token in.\n"
    );
  }
  if (!/^https?:\/\//.test(cfg.hubUrl)) {
    return `HUB_URL does not look like a URL: ${cfg.hubUrl}`;
  }
  return null;
}
