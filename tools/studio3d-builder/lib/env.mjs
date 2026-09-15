import { readFileSync } from "node:fs";
import path from "node:path";
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return out;
}

export function config() {
  loadEnv();
  const home = process.env.USERPROFILE || process.env.HOME || ".";
  const studioRoot = process.env.STUDIO3D_ROOT || path.join(home, "Documents", "3D Studio");
  return {
    hubUrl: (process.env.HUB_URL || "").replace(/\/+$/, ""),
    token: process.env.BUILDER_TOKEN || "",
    model: process.env.BUILDER_MODEL || "",
    pollMs: Number(process.env.BUILDER_POLL_MS || 15000),
    maxMinutes: Number(process.env.BUILDER_MAX_MINUTES || 240),
    studioRoot,
    blenderPath: process.env.BLENDER_PATH || "",
    cascadeurPath: process.env.CASCADEUR_PATH || "",
    mixamoLibrary: process.env.MIXAMO_LIBRARY || path.join(studioRoot, "_library", "mixamo"),
    skillDir: process.env.STUDIO3D_SKILL_DIR || path.join(home, ".claude", "skills", "animation-director"),
    home,
  };
}
