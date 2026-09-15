import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

// What this PC has for the studio: Blender (and whether Claude can drive it
// through Blender MCP), Cascadeur (and its MCP), and the local Mixamo library.
// Posted to the hub with every claim so the site can say what will really be
// used and what falls back to Blender.

/** "Blender 5.0.1\n\tbuild date: …" → "5.0.1" */
export function parseBlenderVersion(stdout) {
  return String(stdout).match(/Blender\s+(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null;
}

/** Compare dotted versions numerically; newest first when used with sort. */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export async function findBlender(configured) {
  if (configured) return existsSync(configured) ? configured : null;
  const roots = [
    "C:\\Program Files\\Blender Foundation",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Blender Foundation"),
  ];
  const found = [];
  for (const root of roots) {
    let dirs = [];
    try {
      dirs = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const exe = path.join(root, d, "blender.exe");
      if (existsSync(exe)) found.push({ exe, version: d.match(/(\d+(?:\.\d+)+)/)?.[1] ?? "0" });
    }
  }
  const steam = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender\\blender.exe";
  if (existsSync(steam)) found.push({ exe: steam, version: "0" });
  found.sort((a, b) => compareVersions(a.version, b.version));
  return found[0]?.exe ?? null;
}

export function findCascadeur(configured) {
  const candidates = [configured, "C:\\Program Files\\Cascadeur\\cascadeur.exe", path.join(process.env.LOCALAPPDATA || "", "Programs", "Cascadeur", "cascadeur.exe")].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function run(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => resolve(err ? "" : stdout));
  });
}

/** Names of user-scope and project-scope MCP servers Claude Code knows about. */
export async function mcpServers(home) {
  try {
    const cfg = JSON.parse(await fs.readFile(path.join(home, ".claude.json"), "utf8"));
    const names = new Set(Object.keys(cfg.mcpServers ?? {}));
    for (const p of Object.values(cfg.projects ?? {})) for (const n of Object.keys(p?.mcpServers ?? {})) names.add(n);
    return names;
  } catch {
    return new Set();
  }
}

export async function mixamoLibrary(dir) {
  const clips = [];
  let characters = 0;
  try {
    for (const name of await fs.readdir(dir)) {
      if (/\.fbx$/i.test(name)) clips.push(name.replace(/\.fbx$/i, ""));
    }
  } catch {
    /* no library yet */
  }
  try {
    characters = (await fs.readdir(path.join(dir, "characters"))).filter((n) => /\.fbx$/i.test(n)).length;
  } catch {
    /* none */
  }
  return { clips: clips.sort(), characters };
}

let cache = null;

/** Detect everything. The Blender version check spawns Blender, so it is cached for 10 minutes. */
export async function detectCapabilities(cfg, { fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 10 * 60_000) {
    return { ...cache.value, mixamo: await mixamoLibrary(cfg.mixamoLibrary) };
  }
  const blenderExe = await findBlender(cfg.blenderPath);
  const version = blenderExe ? parseBlenderVersion(await run(blenderExe, ["--version"], 30_000)) : null;
  const cascadeurExe = findCascadeur(cfg.cascadeurPath);
  const servers = await mcpServers(cfg.home);
  const value = {
    blender: { found: Boolean(blenderExe), version: version ?? undefined },
    blenderMcp: servers.has("blender"),
    cascadeur: { found: Boolean(cascadeurExe) },
    cascadeurMcp: servers.has("cascadeur"),
    mixamo: await mixamoLibrary(cfg.mixamoLibrary),
    paths: { blender: blenderExe, cascadeur: cascadeurExe, mixamoLibrary: cfg.mixamoLibrary },
  };
  cache = { at: Date.now(), value };
  return value;
}
