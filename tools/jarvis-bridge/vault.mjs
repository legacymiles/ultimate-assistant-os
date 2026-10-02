// ---------------------------------------------------------------------------
// The Obsidian vault, from the bridge's side.
//
// `files/list`, `files/read` and `files/write` already exist and are already
// capability-gated, so this module is NOT here because the primitives are
// missing. It is here for one reason: round trips. `files/read` reads a single
// file, and every call from the page is a POST carrying an Authorization
// header, which forces a CORS preflight — so a two-thousand-note vault would
// be four thousand requests to read once. `/vault/scan` and `/vault/read`
// collapse that to two.
//
// Everything here is scoped to the vault root. A path that escapes it is
// refused rather than clamped, because quietly reading the wrong folder is how
// a sweep ends up deleting an index it never actually looked at.
//
// Writes are create-or-conflict, never a blind overwrite. The decision about
// WHAT to write lives in src/lib/jarvis/vault/ops.ts, which is pure and tested;
// this file only carries it out.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

/** Where the vault is. Overridable, because not every machine puts it in the same place. */
export function vaultRoot() {
  return resolve(process.env.JARVIS_VAULT || join(homedir(), "Jarvis Vault"));
}

/** Folders that are never notes. `.obsidian` is config and `.trash` is deleted work. */
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules", ".sync", ".stfolder"]);

/** A hard ceiling on a scan, so a vault pointed at the wrong folder cannot run forever. */
const MAX_NOTES = 20_000;

/** Matches the server's own per-note cap. */
const MAX_NOTE_BYTES = 400_000;

function isNote(name) {
  return /\.(md|markdown)$/i.test(name);
}

/** Forward slashes, so a path means the same thing here, in Postgres and in a wikilink. */
function toVaultPath(root, full) {
  return relative(root, full).split(sep).join("/");
}

/**
 * Refuse a path that leaves the vault.
 *
 * `relative()` returning something that starts with `..` is the check — string
 * prefix comparison gets this wrong on Windows, where case and short names
 * both differ from what was typed.
 */
function inside(root, full) {
  const rel = relative(root, full);
  return rel !== "" && !rel.startsWith("..") && !resolve(root, rel).startsWith(`${root}..`);
}

function resolveInVault(root, path) {
  const full = resolve(root, String(path ?? "").replace(/\\/g, "/"));
  if (!inside(root, full)) {
    throw Object.assign(new Error(`Refused: ${path} is outside the vault.`), { status: 403 });
  }
  return full;
}

export function contentHash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}

/**
 * Every note in the vault, with its hash — and no bodies.
 *
 * Hashing means reading each file, which sounds like it defeats the purpose of
 * a bodiless manifest. It does not: the point is that the RESPONSE stays small
 * and the upload stays small. Reading 2000 local files costs a second or two of
 * disk; shipping them all to Vercel on every sweep costs an embedding bill.
 *
 * `truncated` is reported rather than swallowed. A scan that stopped early
 * looks exactly like a vault whose notes were deleted, and the sweep's delete
 * phase refuses to run on a truncated scan for precisely that reason.
 */
export async function scanVault() {
  const root = vaultRoot();

  let exists = true;
  try {
    const s = await stat(root);
    if (!s.isDirectory()) exists = false;
  } catch {
    exists = false;
  }
  if (!exists) {
    // Not an error. A vault that has not been created yet is an ordinary state,
    // and the page says so rather than showing a failure.
    return { root, exists: false, notes: [], truncated: false, skipped: 0 };
  }

  const notes = [];
  let truncated = false;
  let skipped = 0;

  const walk = async (dir) => {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // An unreadable folder is a hole in the scan, and a hole must not be
      // mistaken for an absence — so it counts as a truncation.
      truncated = true;
      return;
    }

    for (const entry of entries) {
      if (truncated) return;
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !isNote(entry.name)) continue;
      if (notes.length >= MAX_NOTES) {
        truncated = true;
        return;
      }

      try {
        const s = await stat(full);
        if (s.size > MAX_NOTE_BYTES) {
          skipped += 1;
          continue;
        }
        const raw = await readFile(full, "utf8");
        notes.push({
          path: toVaultPath(root, full),
          hash: contentHash(raw),
          size: s.size,
          mtime: s.mtime.getTime(),
        });
      } catch {
        // A file that vanished or is locked mid-scan. Same reasoning as an
        // unreadable folder: a gap is not an absence.
        truncated = true;
        return;
      }
    }
  };

  await walk(root);
  return { root, exists: true, notes, truncated, skipped };
}

/**
 * Read several notes in one call.
 *
 * Chunked by the caller; this just refuses an unreasonable ask rather than
 * trying to stream a whole vault into one response.
 */
export async function readNotes({ paths }) {
  const root = vaultRoot();
  const list = Array.isArray(paths) ? paths.slice(0, 400) : [];
  const notes = [];
  const missing = [];

  for (const path of list) {
    try {
      const full = resolveInVault(root, path);
      const s = await stat(full);
      if (!s.isFile() || s.size > MAX_NOTE_BYTES) {
        missing.push(path);
        continue;
      }
      const raw = await readFile(full, "utf8");
      notes.push({
        path: toVaultPath(root, full),
        hash: contentHash(raw),
        raw,
        size: s.size,
        mtime: s.mtime.getTime(),
      });
    } catch {
      missing.push(path);
    }
  }

  return { root, notes, missing };
}

/** One note's current contents, or null when there is no file. For deciding an op. */
export async function peekNote({ path }) {
  const root = vaultRoot();
  const full = resolveInVault(root, path);
  try {
    const raw = await readFile(full, "utf8");
    return { path: toVaultPath(root, full), exists: true, raw, hash: contentHash(raw) };
  } catch {
    return { path: toVaultPath(root, full), exists: false, raw: null, hash: null };
  }
}

/**
 * Write one note's full contents.
 *
 * `ifAbsent` is the create-or-refuse guard: with it set, an existing file is
 * reported rather than replaced, and the caller decides what to do (which, for
 * a captured note, is to write a conflict sibling). Without an explicit
 * `overwrite`, an existing file is never replaced — there is no way to lose a
 * note through this route by forgetting a flag.
 */
export async function writeNote({ path, text, ifAbsent = true, overwrite = false }) {
  const root = vaultRoot();
  const full = resolveInVault(root, path);

  let existing = null;
  try {
    existing = await readFile(full, "utf8");
  } catch {
    existing = null;
  }

  if (existing !== null && ifAbsent && !overwrite) {
    return {
      path: toVaultPath(root, full),
      written: false,
      existed: true,
      hash: contentHash(existing),
      reason: "That note already exists and was not overwritten.",
    };
  }

  await mkdir(resolve(full, ".."), { recursive: true });
  const body = String(text ?? "");
  await writeFile(full, body, "utf8");
  return { path: toVaultPath(root, full), written: true, existed: existing !== null, hash: contentHash(body) };
}

/**
 * Add to the end of a note, creating it if it is not there.
 *
 * The safe write, and the reason the outbox allows only two operations. An
 * append does not depend on what the file contained, so it cannot clobber an
 * edit made on this machine while the capturing device was offline.
 */
export async function appendNote({ path, text }) {
  const root = vaultRoot();
  const full = resolveInVault(root, path);
  const addition = String(text ?? "");

  let existing = null;
  try {
    existing = await readFile(full, "utf8");
  } catch {
    existing = null;
  }

  if (existing === null) {
    await mkdir(resolve(full, ".."), { recursive: true });
    const body = addition.replace(/^\n+/, "");
    await writeFile(full, body, "utf8");
    return { path: toVaultPath(root, full), written: true, created: true, hash: contentHash(body) };
  }

  const body = existing.replace(/\s*$/, "\n") + addition;
  await writeFile(full, body, "utf8");
  return { path: toVaultPath(root, full), written: true, created: false, hash: contentHash(body) };
}

/** Whether the vault is there at all, for the capability row. */
export async function vaultStatus() {
  const root = vaultRoot();
  try {
    const s = await stat(root);
    return { root, exists: s.isDirectory() };
  } catch {
    return { root, exists: false };
  }
}
