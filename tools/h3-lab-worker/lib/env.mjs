import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Tiny .env loader (no dependency): KEY=value lines, # comments, optional
// quotes. The .env sits beside worker.mjs and is gitignored. Values already in
// the real environment win.

export const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT_DIR = path.join(TOOL_DIR, "out");

export function loadEnv(file = path.join(TOOL_DIR, ".env")) {
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
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
  return out;
}

/** WANGP_DIR may name the Pinokio app folder (…\wan) or its inner app folder (…\wan\app). */
function wangpAppDir(dir) {
  if (existsSync(path.join(dir, "app", "wgp.py"))) return path.join(dir, "app");
  return dir;
}

export function config() {
  loadEnv();
  const wangpDir = process.env.WANGP_DIR || "C:\\pinokio\\api\\wan";
  let mcp;
  try {
    mcp = new URL(process.env.WANGP_MCP || "http://127.0.0.1:42004/mcp");
  } catch {
    mcp = new URL("http://127.0.0.1:42004/mcp");
  }
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    hubUrl: (process.env.HUB_URL || "http://localhost:3000").replace(/\/+$/, ""),
    token: process.env.H3LAB_TOKEN || "",
    wangpDir,
    wangpApp: wangpAppDir(wangpDir),
    mcpHost: mcp.hostname,
    mcpPort: Number(mcp.port) || 80,
    mcpPath: mcp.pathname || "/mcp",
    /** Pinokio's own WanGP web UI. If it is up, it holds the GPU and we never start a second wgp.py. */
    uiPort: num(process.env.WANGP_UI_PORT, 42003),
    tickEveryMin: num(process.env.TICK_EVERY_MIN, 5),
    pollSeconds: num(process.env.H3LAB_POLL_SECONDS, 5),
    thinkTimeoutMin: num(process.env.THINK_TIMEOUT_MIN, 10),
    /** Optional model for `claude -p`. Empty = Claude Code's own default. */
    claudeModel: process.env.CLAUDE_MODEL || "",
    outDir: OUT_DIR,
  };
}

export function configProblem(cfg) {
  if (!cfg.token) return "H3LAB_TOKEN is not set. Mint one in the H3 Prompt Lab › H3 Connection page and paste it into tools/h3-lab-worker/.env.";
  if (!cfg.hubUrl) return "HUB_URL is not set.";
  return null;
}
