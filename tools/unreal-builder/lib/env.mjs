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
  const hubUrl = (process.env.HUB_URL || "").replace(/\/+$/, "");
  const token = process.env.BUILDER_TOKEN || "";
  return {
    hubUrl,
    token,
    model: process.env.BUILDER_MODEL || "",
    // Where game-building skills live, and which one is the default when several are.
    skillDirs: (process.env.BUILDER_SKILL_DIRS || path.join(process.env.USERPROFILE || process.env.HOME || ".", ".claude", "skills"))
      .split(";")
      .filter(Boolean),
    defaultSkill: process.env.BUILDER_DEFAULT_SKILL || "",
    messagePollMs: Number(process.env.BUILDER_MESSAGE_POLL_MS || 5000),
    pollMs: Number(process.env.BUILDER_POLL_MS || 15000),
    maxMinutes: Number(process.env.BUILDER_MAX_MINUTES || 240),
    projectsRoot:
      process.env.GC_PROJECTS_ROOT ||
      path.join(process.env.USERPROFILE || process.env.HOME || ".", "Documents", "Unreal Projects"),
  };
}
