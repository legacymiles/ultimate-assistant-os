// Index the owner's whole folder into Jarvis's memory, as retrievable chunks.
//
//   node scripts/sync-folder-rag.mjs                index everything under cwd
//   node scripts/sync-folder-rag.mjs --check        list what would be written
//   node scripts/sync-folder-rag.mjs --only src/lib/jarvis   one subtree
//   node scripts/sync-folder-rag.mjs --limit 50     first N files, for a smoke run
//   node scripts/sync-folder-rag.mjs --force        rewrite even where nothing changed
//   node scripts/sync-folder-rag.mjs --no-prune     keep rows for files that are gone
//   node scripts/sync-folder-rag.mjs --no-embed     word search only
//   node scripts/sync-folder-rag.mjs --root <dir>   index a different folder
//
// Why this exists: sync-memory.mjs mirrors a HAND-PICKED list — eight repo
// files, the memory notes Claude Code leaves under ~/.claude/projects, and the
// first 1200 characters of each skill. Everything else in the folder (3,600-odd
// text files: the app's own source, every doc, spec, migration and script) is
// invisible to memory, so a question like "how does the memory sync decide what
// changed" cannot be answered from memory at all, about a folder that contains
// the answer twice. This walks the whole folder instead.
//
// It is a retrieval index, not a bigger pile of notes. Files are split into
// ~1,500-character chunks along their own seams — markdown headings, the blank
// line between two functions — and each chunk is embedded and stored as its own
// row. A search then returns the paragraph that answers the question, with the
// path and line range it came from, instead of a 2,000-line file that happens
// to contain the word somewhere.
//
// Rows are written under source "file", which lib/jarvis/types.ts already
// declares (label "Files") and which nothing else writes to. So this lands
// beside the curated "master-folder" and "skill" memories without touching
// them, gets its own filter in the Memory tab, and is reachable from
// search_memory — which passes no source filter, so one question searches the
// curated notes and the whole folder together.
//
// Each chunk stores a hash of its own text in meta. A second run re-reads every
// file but only embeds and writes the chunks that actually changed, so keeping
// the index current costs seconds rather than a full re-embed.
//
// Local only, like sync-memory.mjs: it needs .env.local and writes with the
// service-role key, because there is no browser session at a command line. It
// reads that key, never prints it.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// --- arguments --------------------------------------------------------------

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
function opt(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : fallback;
}

const check = has("check");
const force = has("force");
const noEmbed = has("no-embed");
const only = opt("only");
const limit = Number(opt("limit", "0")) || 0;
const ROOT = path.resolve(opt("root", process.cwd()));

// Pruning deletes rows whose file no longer exists. That is only safe when this
// run saw the whole folder: with --only or --limit the list is deliberately
// partial, and sweeping against it would forget most of the index.
const fullRun = !only && !limit;
const prune = fullRun && !has("no-prune");

function die(message) {
  console.error(message);
  process.exit(1);
}

/**
 * fetch, with the patience a 30,000-chunk run needs.
 *
 * One transient "fetch failed" — a dropped packet, a reset Supabase connection
 * — used to end the whole run, because an exception out of fetch is not an HTTP
 * status and nothing caught it. At ~480 round trips per full index that is not
 * an edge case: the first real run died this way at 12%, twenty minutes in.
 *
 * Retrying is safe because every write is an upsert keyed on
 * (user_id, source, external_id), so repeating one changes nothing. A refusal
 * the server actually means (a bad key, a bad statement) is returned as-is on
 * the first try — it will not improve by being asked again.
 */
async function request(url, init, what) {
  let last = "";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    if (attempt < 5) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
  }
  return die(`\n${what} failed 5 times in a row (${last}). Nothing is lost — re-run and it resumes.`);
}

// --- what counts as a file worth remembering --------------------------------

/** Build output, dependencies and caches: never the owner's own writing. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build", "out", "coverage",
  ".vercel", ".turbo", ".cache", "__pycache__", ".venv", "venv",
  ".playwright-mcp", ".pytest_cache", ".mypy_cache", ".gradle", "target",
]);

/** Dev-server scratch dirs this repo makes per port (.next-preview-3211, …). */
const SKIP_DIR_PREFIXES = [".next-preview-", ".preview-data-", ".data"];

/** Things with no prose or code in them. Embedding these would cost and say nothing. */
const SKIP_EXT = new Set([
  "webp", "png", "jpg", "jpeg", "gif", "ico", "bmp", "avif", "tiff", "psd", "ai",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "wav", "ogg", "m4a", "flac", "aac",
  "mp4", "mov", "webm", "avi", "mkv", "gifv",
  "zip", "gz", "tgz", "tar", "rar", "7z", "bz2", "xz",
  "pdf", "exe", "dll", "so", "dylib", "bin", "dat", "wasm",
  "blend", "blend1", "fbx", "glb", "gltf", "obj", "stl", "usdz",
  "onnx", "safetensors", "pt", "pth", "ckpt", "npy", "npz",
  "db", "sqlite", "sqlite3", "tsbuildinfo", "map", "lock", "ics",
]);

/** Generated or vendored files that are large, repetitive and not worth a chunk. */
const SKIP_NAMES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
  "poetry.lock", "Cargo.lock", "composer.lock",
]);

const MAX_FILE_BYTES = 400_000;

function skipPath(rel) {
  const parts = rel.split("/");
  for (const part of parts.slice(0, -1)) {
    if (SKIP_DIRS.has(part)) return true;
    if (SKIP_DIR_PREFIXES.some((p) => part.startsWith(p))) return true;
  }
  const name = parts[parts.length - 1];
  if (SKIP_NAMES.has(name)) return true;
  if (/\.min\.(js|css|mjs)$/.test(name)) return true;
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return SKIP_EXT.has(ext);
}

/**
 * Every file in the folder, as paths relative to its root.
 *
 * git already knows which files are the owner's and which are build output, so
 * ask it first: `ls-files -co --exclude-standard` is tracked files plus
 * untracked ones that .gitignore does not cover. Outside a repo, walk instead.
 */
async function listFiles(root) {
  try {
    const { stdout } = await execFileAsync(
      "git", ["-C", root, "ls-files", "-co", "--exclude-standard"],
      { maxBuffer: 128 * 1024 * 1024 },
    );
    const names = [...new Set(stdout.split("\n").map((s) => s.trim()).filter(Boolean))];
    if (names.length) return names;
  } catch {
    // Not a git repo, or no git on PATH — fall through to the walk.
  }
  const out = [];
  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || SKIP_DIR_PREFIXES.some((p) => e.name.startsWith(p))) continue;
        await walk(path.join(dir, e.name), rel);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  }
  await walk(root, "");
  return out;
}

/** Read one file, or explain in one word why it was left out. */
async function readCandidate(root, rel) {
  let info;
  try {
    info = await stat(path.join(root, rel));
  } catch {
    return { skip: "gone" };
  }
  if (!info.isFile()) return { skip: "gone" };
  if (info.size > MAX_FILE_BYTES) return { skip: "huge" };
  if (info.size === 0) return { skip: "empty" };

  const buf = await readFile(path.join(root, rel));
  // A NUL byte in the first 8 KB is the standard "this is not text" test, and
  // catches the binaries that arrive with an innocent extension.
  if (buf.subarray(0, 8192).includes(0)) return { skip: "binary" };

  const text = buf.toString("utf8");
  if (!text.trim()) return { skip: "empty" };
  // Minified or single-line generated output: one chunk of it would be noise.
  if (buf.length > 20_000 && text.split("\n").some((l) => l.length > 5000)) {
    return { skip: "minified" };
  }
  return { text, modified: info.mtime.toISOString() };
}

// --- chunking ---------------------------------------------------------------

const TARGET = 1500; // characters we aim for
const MAX_CHUNK = 2400; // hard ceiling before we break mid-paragraph
const MAX_CHUNKS = 120; // one enormous file must not drown the index

/** Lines that are a natural place to cut: a blank line, a heading, a new top-level thing. */
function isSeam(line) {
  if (line === undefined) return false;
  if (line.trim() === "") return true;
  if (/^#{1,6}\s/.test(line)) return true;
  if (/^(export |function |class |const |let |async |def |type |interface |#{1,6} |--- )/.test(line)) return true;
  return false;
}

/** The markdown heading in force at a given line, so a chunk can say where it sits. */
function headingAt(lines, upto) {
  for (let i = Math.min(upto, lines.length - 1); i >= 0; i -= 1) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(lines[i]);
    if (m) return m[1].slice(0, 80);
  }
  return "";
}

/**
 * Split one file into chunks, preferring to end on a seam.
 *
 * Greedy, with a one-chunk look-back: fill until TARGET, then fall back to the
 * last seam seen after 60% of the target, so a cut lands between paragraphs
 * rather than through a sentence. Chunks overlap by two lines, which is what
 * keeps a definition that straddles a boundary findable from either side.
 */
function chunkFile(text) {
  const lines = text.split("\n");
  const chunks = [];
  let start = 0;

  while (start < lines.length && chunks.length < MAX_CHUNKS) {
    let end = start;
    let len = 0;
    let seam = -1;

    while (end < lines.length) {
      const add = lines[end].length + 1;
      if (len + add > MAX_CHUNK && end > start) break;
      len += add;
      end += 1;
      if (len >= TARGET * 0.6 && isSeam(lines[end])) seam = end;
      if (len >= TARGET) {
        if (seam > start) end = seam;
        break;
      }
    }
    if (end === start) end = start + 1; // a single line longer than MAX_CHUNK

    const body = lines.slice(start, end).join("\n");
    if (body.trim()) chunks.push({ body, from: start + 1, to: end });

    // Step back two lines so the seam is covered by both neighbours. end > start
    // always holds here, and back is 0 for short chunks, so start strictly grows.
    const back = end - start > 3 ? 2 : 0;
    start = Math.max(end - back, start + 1);
  }

  return { chunks, truncated: start < lines.length };
}

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** Turn one file into the rows it should occupy, content and key included. */
function rowsForFile(rel, text, modified) {
  const lines = text.split("\n");
  const { chunks, truncated } = chunkFile(text);
  const n = chunks.length;
  return chunks.map((c, i) => {
    const heading = /\.mdx?$/.test(rel) ? headingAt(lines, c.from - 1) : "";
    const where = `${rel}${heading ? ` › ${heading}` : ""}`;
    // The header is part of the embedded text on purpose: it is what makes a
    // retrieved chunk self-describing, and what lets "the memory sync script"
    // match a chunk whose body never repeats its own filename.
    const header = `${where} (part ${i + 1} of ${n}, lines ${c.from}-${c.to})`;
    const content = `${header}\n\n${c.body}`;
    return {
      externalId: `${rel}#${String(i + 1).padStart(3, "0")}`,
      title: (n === 1 ? where : `${where} (${i + 1}/${n})`).slice(0, 300),
      content,
      origin: rel,
      modified,
      hash: sha(content),
      meta: {
        hash: sha(content),
        path: rel,
        chunk: i + 1,
        chunks: n,
        lines: [c.from, c.to],
        ...(heading ? { heading } : {}),
        ...(truncated && i === n - 1 ? { truncated: true } : {}),
      },
    };
  });
}

// --- the hub's Supabase -----------------------------------------------------

/** .env.local as a map. No dependency, and the same file Next reads. */
async function env() {
  let text;
  try {
    text = await readFile(path.join(ROOT, ".env.local"), "utf8");
  } catch {
    die(`No .env.local in ${ROOT}. Run this from the repo root on the owner's PC.`);
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const H = (cfg, extra = {}) => ({
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  ...extra,
});

/** The owner's auth user, by the email the hub already trusts. Same rule as sync-memory.mjs. */
async function ownerUser(cfg) {
  const emails = (cfg.HUB_OWNER_EMAILS || "")
    .split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const res = await request(
    `${cfg.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=200`,
    { headers: { apikey: cfg.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}` } },
    "Looking up the owner's account",
  );
  if (!res.ok) die(`Supabase refused the admin call (${res.status}).`);
  const users = (await res.json()).users ?? [];
  if (!users.length) die("No accounts exist in this Supabase project yet — sign in on the hub once first.");
  const owner = emails.length
    ? users.find((u) => emails.includes((u.email || "").toLowerCase()))
    : users.length === 1 ? users[0] : null;
  if (!owner) {
    die(`Could not tell which account is yours. Set HUB_OWNER_EMAILS in .env.local to one of: ${users.map((u) => u.email).join(", ")}`);
  }
  return owner;
}

const SOURCE = "file";

/**
 * Every key already in the index, with the hash of what is stored there and
 * whether that row actually got a vector.
 *
 * The `embedded` half matters more than it looks. The hash alone decides "has
 * this text changed", so a chunk written during an embedding outage — correct
 * text, null embedding — would match on every later run and be skipped forever,
 * silently stranded in word-search-only. Carrying the flag means the next run
 * repairs it.
 */
async function existingRows(cfg, userId) {
  const out = new Map();
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const url =
      `${cfg.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jarvis_memories` +
      `?user_id=eq.${userId}&source=eq.${SOURCE}&select=external_id,meta` +
      `&order=external_id.asc&limit=${page}&offset=${offset}`;
    const res = await request(url, { headers: H(cfg) }, "Reading the existing index");
    if (!res.ok) die(`Could not read the existing index: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const rows = await res.json();
    for (const r of rows) {
      out.set(r.external_id, { hash: r.meta?.hash ?? null, embedded: r.meta?.embedded === true });
    }
    if (rows.length < page) return out;
  }
}

const EMBED_MODEL = "openai/text-embedding-3-small";
const EMBED_DIMS = 1536;

/** Meaning vectors, or null — a chunk without one is still findable by words. */
async function embed(texts, key) {
  if (!key || noEmbed || !texts.length) return null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: EMBED_MODEL, input: texts.map((t) => t.slice(0, 8000)) }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return null;
      }
      const rows = (await res.json()).data;
      if (!Array.isArray(rows) || rows.length !== texts.length) return null;
      const out = [];
      for (let i = 0; i < rows.length; i += 1) {
        const v = rows[i]?.embedding;
        // A wrong width would corrupt the column: refuse rather than write it.
        if (!Array.isArray(v) || v.length !== EMBED_DIMS) return null;
        out[rows[i]?.index ?? i] = v;
      }
      return out;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

/**
 * Write a batch.
 *
 * The unique index on (user_id, source, external_id) was made TOTAL by
 * migration 20260925120000, so a real upsert works and is worth having at this
 * row count. It used to be partial, which is what made every ON CONFLICT fail
 * with 42P10 — so if this index is ever reverted, or this runs against an older
 * database, fall back to the lookup-and-patch sync-memory.mjs still uses.
 */
let canUpsert = true;

async function writeRows(cfg, userId, rows) {
  if (canUpsert) {
    const res = await request(
      `${cfg.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jarvis_memories?on_conflict=user_id,source,external_id`,
      {
        method: "POST",
        headers: H(cfg, { Prefer: "return=minimal,resolution=merge-duplicates" }),
        body: JSON.stringify(rows),
      },
      "Writing a batch of chunks",
    );
    if (res.ok) return rows.length;
    const body = await res.text();
    if (!body.includes("42P10")) {
      die(`\nA write failed: ${res.status} ${body.slice(0, 400)}`);
    }
    console.log("\n  (no usable unique index — falling back to lookup-and-patch)");
    canUpsert = false;
  }

  const list = rows.map((r) => `"${r.external_id}"`).join(",");
  const found = await request(
    `${cfg.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jarvis_memories` +
      `?user_id=eq.${userId}&source=eq.${SOURCE}&external_id=in.(${encodeURIComponent(list)})&select=id,external_id`,
    { headers: H(cfg) },
    "Looking up a batch",
  );
  if (!found.ok) die(`\nThe lookup failed: ${found.status} ${(await found.text()).slice(0, 300)}`);
  const existing = new Map((await found.json()).map((r) => [r.external_id, r.id]));

  const fresh = [];
  for (const row of rows) {
    const id = existing.get(row.external_id);
    if (!id) {
      fresh.push(row);
      continue;
    }
    const res = await request(
      `${cfg.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jarvis_memories?id=eq.${id}`,
      { method: "PATCH", headers: H(cfg, { Prefer: "return=minimal" }), body: JSON.stringify(row) },
      "Updating a chunk",
    );
    if (!res.ok) die(`\nAn update failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  if (fresh.length) {
    const res = await request(
      `${cfg.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jarvis_memories`,
      { method: "POST", headers: H(cfg, { Prefer: "return=minimal" }), body: JSON.stringify(fresh) },
      "Inserting a batch",
    );
    if (!res.ok) die(`\nAn insert failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return rows.length;
}

/** Forget chunks whose file, or whose part of a file, no longer exists. */
async function pruneKeys(cfg, userId, keys) {
  let gone = 0;
  for (let i = 0; i < keys.length; i += 80) {
    const batch = keys.slice(i, i + 80);
    const list = batch.map((k) => `"${k}"`).join(",");
    const res = await request(
      `${cfg.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jarvis_memories` +
        `?user_id=eq.${userId}&source=eq.${SOURCE}&external_id=in.(${encodeURIComponent(list)})`,
      { method: "DELETE", headers: H(cfg, { Prefer: "return=minimal" }) },
      "Forgetting stale chunks",
    );
    if (!res.ok) die(`\nA delete failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    gone += batch.length;
  }
  return gone;
}

// --- the run ----------------------------------------------------------------

async function main() {
  console.log(`Indexing ${ROOT}`);

  const names = (await listFiles(ROOT))
    .filter((rel) => !skipPath(rel))
    .filter((rel) => (only ? rel.startsWith(only.replace(/\\/g, "/")) : true))
    .sort();
  const files = limit ? names.slice(0, limit) : names;
  if (!files.length) die("No files matched. Check --root and --only.");

  const skipped = { huge: 0, binary: 0, empty: 0, minified: 0, gone: 0 };
  const wanted = []; // every row this folder should have, in file order
  let bytes = 0;

  for (const rel of files) {
    const got = await readCandidate(ROOT, rel);
    if (got.skip) {
      skipped[got.skip] += 1;
      continue;
    }
    bytes += got.text.length;
    wanted.push(...rowsForFile(rel, got.text, got.modified));
  }

  const left = Object.entries(skipped).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ");
  console.log(
    `${files.length} files → ${wanted.length} chunks from ${(bytes / 1048576).toFixed(1)} MB` +
      (left ? ` (left out: ${left})` : ""),
  );

  if (check) {
    const byFile = new Map();
    for (const r of wanted) byFile.set(r.origin, (byFile.get(r.origin) ?? 0) + 1);
    for (const [rel, n] of [...byFile].slice(0, 60)) console.log(`  ${rel} — ${n}`);
    if (byFile.size > 60) console.log(`  … and ${byFile.size - 60} more files`);
    console.log(`\n--check: nothing was written. ~${Math.round(bytes / 4 / 1000)}k tokens to embed in full.`);
    return;
  }

  const cfg = await env();
  if (!cfg.NEXT_PUBLIC_SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) {
    die("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be in .env.local.");
  }
  const owner = await ownerUser(cfg);
  console.log(`Writing as ${owner.email}.`);

  const existing = await existingRows(cfg, owner.id);
  // Done means the same text AND — unless this run is not embedding at all — a
  // vector to go with it, so a chunk stranded by an embedding outage comes back.
  const done = (r) => {
    const was = existing.get(r.externalId);
    return was?.hash === r.hash && (noEmbed || was.embedded);
  };
  const todo = force ? wanted : wanted.filter((r) => !done(r));
  const stranded = force
    ? 0
    : wanted.filter((r) => existing.get(r.externalId)?.hash === r.hash && !done(r)).length;
  console.log(
    `${existing.size} chunks already indexed; ${todo.length} to write` +
      (todo.length < wanted.length ? `, ${wanted.length - todo.length} unchanged` : "") +
      (stranded ? ` (${stranded} of them re-embedded, written before without a vector)` : ""),
  );

  let saved = 0;
  let embedded = 0;
  const BATCH = 64;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const vectors = await embed(batch.map((r) => r.content), cfg.OPENROUTER_API_KEY);
    if (vectors) embedded += batch.length;
    const rows = batch.map((r, n) => ({
      user_id: owner.id,
      profile_id: "owner",
      source: SOURCE,
      title: r.title,
      content: r.content,
      origin: r.origin,
      tags: [],
      meta: { ...r.meta, embedded: Boolean(vectors?.[n]) },
      external_id: r.externalId,
      embedding: vectors?.[n] ?? null,
      captured_at: r.modified,
      updated_at: new Date().toISOString(),
    }));
    saved += await writeRows(cfg, owner.id, rows);
    process.stdout.write(`\r  wrote ${saved}/${todo.length}`);
  }
  if (todo.length) process.stdout.write("\n");

  let pruned = 0;
  if (prune) {
    const keep = new Set(wanted.map((r) => r.externalId));
    const stale = [...existing.keys()].filter((k) => !keep.has(k));
    if (stale.length) {
      pruned = await pruneKeys(cfg, owner.id, stale);
      console.log(`Forgot ${pruned} chunks whose file is gone or was rewritten shorter.`);
    }
  } else if (fullRun) {
    console.log("Pruning skipped (--no-prune).");
  }

  const total = wanted.length;
  console.log(
    `Done. ${total} chunks indexed from ${files.length} files` +
      `; ${saved} written this run` +
      (embedded < saved ? `, ${saved - embedded} of them word-search only (no OpenRouter key, or the embedding call failed)` : "") +
      (pruned ? `, ${pruned} forgotten` : "") +
      ".",
  );
  if (!fullRun) console.log("Partial run (--only/--limit): nothing was pruned.");
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
