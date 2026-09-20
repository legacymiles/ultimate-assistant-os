import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Tiny .env loader (no dependency): KEY=value lines, # comments, optional
// quotes. Values already in the real environment win.

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return out;
}

export function config() {
  loadEnv();
  const home = os.homedir();
  return {
    hubUrl: (process.env.HUB_URL || "http://localhost:3000").replace(/\/+$/, ""),
    token: process.env.HUB_TOKEN || "",
    /** Where each project's working folder is created. */
    workDir: process.env.VIDEO_STUDIO_WORK_DIR || path.join(home, "VideoStudioArena"),
    /** Model for the Claude Code session. Empty = Claude Code's own default. */
    model: process.env.RUNNER_MODEL || "",
    openrouterKey: process.env.OPENROUTER_API_KEY || "",
    /** Seconds between polls when there is nothing to do. */
    pollSeconds: Number(process.env.RUNNER_POLL_SECONDS || 5),
    /** Hard ceiling on one job, in minutes. An Unreal render is slow but not infinite. */
    jobTimeoutMinutes: Number(process.env.RUNNER_JOB_TIMEOUT_MINUTES || 90),
  };
}

export function configProblem(cfg) {
  if (!cfg.token) return "HUB_TOKEN is not set. Create one in Video Studio Arena › Integrations.";
  if (!cfg.hubUrl) return "HUB_URL is not set.";
  return null;
}
