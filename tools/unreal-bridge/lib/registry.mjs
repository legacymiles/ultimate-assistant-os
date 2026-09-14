import { promises as fs } from "node:fs";
import path from "node:path";
import { stateDir } from "./paths.mjs";

// The PC-side list of games: which game id lives in which project folder.
//
// The bridge writes it when a project is created, the builder reads it to find
// the folder to watch, and the ueos:// handler reads it to open or play a game
// the website links to. One small JSON file; no locking needed because only one
// build runs at a time.

function registryPath() {
  return path.join(stateDir(), "registry.json");
}

async function load() {
  try {
    const raw = await fs.readFile(registryPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function save(all) {
  await fs.mkdir(stateDir(), { recursive: true });
  const tmp = `${registryPath()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
  await fs.rename(tmp, registryPath());
}

/** Insert or merge one game. Returns the stored entry. */
export async function upsert(entry) {
  if (!entry?.id) throw new Error("registry entry needs an id");
  const all = await load();
  all[entry.id] = { ...all[entry.id], ...entry };
  await save(all);
  return all[entry.id];
}

export async function get(id) {
  return (await load())[id] ?? null;
}

/** Newest first. */
export async function list() {
  return Object.values(await load()).sort((a, b) =>
    String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
  );
}

/** The entry whose .uproject matches, compared case-insensitively (Windows). */
export async function findByUproject(uproject) {
  const want = path.resolve(uproject).toLowerCase();
  return (await list()).find((e) => e.uproject && path.resolve(e.uproject).toLowerCase() === want) ?? null;
}
