import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { editorCmdExe } from "./paths.mjs";
import { watchSdkChecks } from "./sdkcheck.mjs";

// Real-looking assets for Game Creator games, from Poly Haven (polyhaven.com):
// every model and texture there is CC0, needs no account or key, and ships
// PBR maps. Models come down as glTF with their textures; surfaces as
// base colour + normal (DirectX) + ARM (AO/roughness/metal) texture sets.
//
// Importing needs the engine, so it runs Unreal's Python commandlet
// (scripts/import_assets.py) against the project while the editor is closed.

const API = "https://api.polyhaven.com";
const here = path.dirname(fileURLToPath(import.meta.url));
// Forward slashes: Unreal reads "\t" in a command-line path (…\tools\…) as a tab.
const IMPORT_SCRIPT = path.join(here, "..", "scripts", "import_assets.py").split(path.sep).join("/");

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "game-creator-unreal-bridge" } });
  if (!res.ok) throw new Error(`Poly Haven ${url} -> HTTP ${res.status}`);
  return res.json();
}

const catalogCache = new Map();
async function catalog(type) {
  if (!catalogCache.has(type)) catalogCache.set(type, await getJson(`${API}/assets?t=${type}`));
  return catalogCache.get(type);
}

/**
 * Search Poly Haven. `type` is "models" or "textures". Every query word must
 * appear in the id, name, tags or categories. Best matches (most downloaded) first.
 */
export async function searchAssets({ type = "models", query = "", limit = 25 } = {}) {
  if (!["models", "textures"].includes(type)) throw new Error('type must be "models" or "textures"');
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const [id, a] of Object.entries(await catalog(type))) {
    const hay = [id, a.name, ...(a.tags ?? []), ...(a.categories ?? [])].join(" ").toLowerCase();
    if (words.every((w) => hay.includes(w))) {
      hits.push({ id, name: a.name, categories: a.categories ?? [], tags: (a.tags ?? []).slice(0, 8), downloads: a.download_count ?? 0 });
    }
  }
  hits.sort((x, y) => y.downloads - x.downloads);
  return hits.slice(0, limit).map(({ downloads, ...h }) => h);
}

async function download(url, file) {
  try {
    const st = await fs.stat(file);
    if (st.size > 0) return; // already fetched on an earlier run
  } catch {
    /* not there yet */
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}

/** Pick the requested resolution, else the nearest smaller one, else anything. */
export function pickRes(byRes, want) {
  if (!byRes) return null;
  const order = ["1k", "2k", "4k", "8k"];
  if (byRes[want]) return byRes[want];
  for (const r of order.slice(0, Math.max(0, order.indexOf(want))).reverse()) if (byRes[r]) return byRes[r];
  for (const r of order) if (byRes[r]) return byRes[r];
  return null;
}

export async function downloadModel(id, dir, res = "1k") {
  const files = await getJson(`${API}/files/${encodeURIComponent(id)}`);
  const g = pickRes(files.gltf, res)?.gltf;
  if (!g) throw new Error(`Poly Haven model "${id}" has no glTF download`);
  const root = path.join(dir, "models", id);
  const main = path.join(root, path.basename(new URL(g.url).pathname));
  await download(g.url, main);
  await Promise.all(Object.entries(g.include ?? {}).map(([rel, f]) => download(f.url, path.join(root, rel))));
  return { id, file: main };
}

const SURFACE_MAPS = { baseColor: "Diffuse", normal: "nor_dx", arm: "arm" };

export async function downloadSurface(id, dir, res = "2k") {
  const files = await getJson(`${API}/files/${encodeURIComponent(id)}`);
  const out = { id };
  for (const [slot, key] of Object.entries(SURFACE_MAPS)) {
    const pick = pickRes(files[key], res);
    const f = pick?.jpg ?? pick?.png;
    if (!f) {
      if (slot === "arm") continue; // a few sets have no packed ARM; roughness falls back to a constant
      throw new Error(`Poly Haven texture "${id}" has no ${key} map`);
    }
    const file = path.join(dir, "surfaces", id, path.basename(new URL(f.url).pathname));
    await download(f.url, file);
    out[slot] = file;
  }
  return out;
}

/** Run the Python import commandlet. Resolves with the script's JSON report. */
export function runImport(uproject, manifest, { timeoutMs = 10 * 60_000 } = {}) {
  return new Promise(async (resolve, reject) => {
    const dir = path.join(path.dirname(uproject), "GameCreator", "downloads");
    const manifestFile = path.join(dir, "import-manifest.json");
    const reportFile = path.join(dir, "import-report.json");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({ ...manifest, report: reportFile }, null, 2), "utf8");
    await fs.rm(reportFile, { force: true });

    const args = [uproject, "-run=pythonscript", `-script=${IMPORT_SCRIPT}`, "-unattended", "-nop4", "-nosplash", "-NullRHI"];
    const child = spawn(editorCmdExe(), args, {
      env: { ...process.env, GC_IMPORT_MANIFEST: manifestFile },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const tail = [];
    const keep = (d) => {
      for (const line of String(d).split(/\r?\n/)) {
        if (/GCIMPORT|Error|LogPython/i.test(line)) tail.push(line.trim());
        if (tail.length > 60) tail.shift();
      }
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const stopSdkWatch = watchSdkChecks({ onUnstick: (n) => tail.push(`GCIMPORT ended ${n} stuck SDK check(s)`) });
    // Kill the whole tree: a hung import is usually a child Build.bat
    // (the engine's SDK check) spinning on its lock file.
    const timer = setTimeout(() => {
      tail.push(`GCIMPORT timed out after ${Math.round(timeoutMs / 60000)} min`);
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      stopSdkWatch();
      reject(err);
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      stopSdkWatch();
      try {
        resolve({ code, ...JSON.parse(await fs.readFile(reportFile, "utf8")) });
      } catch {
        reject(new Error(`Import commandlet exited ${code} without a report.\n${tail.join("\n")}`));
      }
    });
  });
}

/**
 * Download Poly Haven models and surfaces into <project>/GameCreator/downloads
 * and import them under /Game/PolyHaven. The editor must be closed.
 */
export async function addAssets(project, { models = [], surfaces = [], modelRes = "1k", surfaceRes = "2k" } = {}) {
  const dir = path.join(project.projectDir, "GameCreator", "downloads");
  const failed = [];
  const got = { models: [], surfaces: [] };
  for (const id of models) {
    try {
      got.models.push(await downloadModel(id, dir, modelRes));
    } catch (err) {
      failed.push({ id, error: err.message });
    }
  }
  for (const id of surfaces) {
    try {
      got.surfaces.push(await downloadSurface(id, dir, surfaceRes));
    } catch (err) {
      failed.push({ id, error: err.message });
    }
  }
  if (!got.models.length && !got.surfaces.length) return { imported: { models: [], surfaces: [] }, failed };
  let report;
  try {
    report = await runImport(project.uproject, got);
  } catch (err) {
    // One retry: a first commandlet run on a fresh project can stall once on
    // the engine's platform-SDK check and then succeed.
    report = await runImport(project.uproject, got).catch((again) => {
      throw new Error(`${err.message}
--- retry ---
${again.message}`);
    });
  }
  return { ...report, failed: [...failed, ...(report.failed ?? [])] };
}
