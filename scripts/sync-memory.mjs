// Load the owner's master folder into Jarvis's memory, from this PC.
//
//   node scripts/sync-memory.mjs           read, embed and upsert
//   node scripts/sync-memory.mjs --check   list what would be written
//   node scripts/sync-memory.mjs --no-embed  skip embeddings (word search only)
//
// Why this exists: Jarvis's memory lives in Supabase, but the things worth
// remembering — ~100 skills under ~/.claude/skills and every memory file Claude
// Code has written under ~/.claude/projects/*/memory — exist only on this
// machine. The deployed hub cannot read them, so its Sync button can only ever
// reach the eight files that ship in the repo, and the tab sits empty next to a
// hundred skills on disk. The app now syncs itself when it runs here (see
// useMemory.ts); this is the same job from a terminal, for when it is easier to
// run a command than to open a tab — and it is what a scheduled sync would call.
//
// It writes as the owner, using the service-role key in .env.local, because
// there is no browser session at a command line. That key is already local-only;
// this reads it, never prints it. Rows are upserted on (user_id, source,
// external_id), so running it twice updates rather than duplicates, and a later
// sync from the app lands on exactly the same rows.
//
// Local only. It needs .env.local, which does not exist on a deployment.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const check = process.argv.includes("--check");
const noEmbed = process.argv.includes("--no-embed");

/** .env.local as a map. No dependency, and the same file Next reads. */
async function env() {
  const out = {};
  let text;
  try {
    text = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
  } catch {
    die("No .env.local here. Run this from the repo root on the owner's PC.");
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function die(message) {
  console.error(message);
  process.exit(1);
}

/** Root of the Claude Code config dir, matching the app's own rule. */
const claudeHome = () => process.env.CLAUDE_SKILLS_HOME || path.join(homedir(), ".claude");

async function readIfPresent(file, externalId, title) {
  try {
    const [content, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    if (!content.trim()) return null;
    return { externalId, title, content, modified: info.mtime.toISOString() };
  } catch {
    return null;
  }
}

/** The files that ship with the deployment. Kept in step with masterFolder.ts. */
const REPO_FILES = [
  "CLAUDE.md",
  "aios/README.md",
  "aios/connections.md",
  "aios/context/about-me.md",
  "aios/context/about-business.md",
  "aios/context/priorities.md",
  "aios/context/my-computer.md",
  "aios/decisions/log.md",
];

async function repoFiles() {
  const files = await Promise.all(
    REPO_FILES.map((rel) => readIfPresent(path.join(process.cwd(), rel), rel, rel)),
  );
  return files.filter(Boolean);
}

/** Every project's memory folder, then every skill. The half only this PC has. */
async function localFiles() {
  const out = [];
  const root = claudeHome();

  const projects = path.join(root, "projects");
  try {
    for (const project of await readdir(projects)) {
      const dir = path.join(projects, project, "memory");
      let names;
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".md")) continue;
        const rel = `~/.claude/projects/${project}/memory/${name}`;
        const file = await readIfPresent(path.join(dir, name), rel, name.replace(/\.md$/, ""));
        if (file) out.push(file);
      }
    }
  } catch {
    // No ~/.claude on this machine — then this script has nothing to add.
  }

  // Name + description is enough for Jarvis to know what he can ask Claude Code
  // to do; the full body of 98 skills would bury everything else in the ball.
  const skills = path.join(root, "skills");
  try {
    for (const name of await readdir(skills)) {
      const md = await readIfPresent(
        path.join(skills, name, "SKILL.md"),
        `~/.claude/skills/${name}`,
        `Skill: ${name}`,
      );
      if (md) out.push({ ...md, content: md.content.slice(0, 1200) });
    }
  } catch {
    // No skills folder.
  }

  return out;
}

/** The owner's auth user, by the email the hub already trusts. */
async function ownerUser(cfg) {
  const emails = (cfg.HUB_OWNER_EMAILS || "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const res = await fetch(`${cfg.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: cfg.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) die(`Supabase refused the admin call (${res.status}).`);
  const users = (await res.json()).users ?? [];
  if (!users.length) die("No accounts exist in this Supabase project yet — sign in on the hub once first.");
  // The owner's own address when it is declared, otherwise the only account.
  const owner = emails.length
    ? users.find((u) => emails.includes((u.email || "").toLowerCase()))
    : users.length === 1
      ? users[0]
      : null;
  if (!owner) {
    die(
      `Could not tell which account is yours. Set HUB_OWNER_EMAILS in .env.local to one of: ${users
        .map((u) => u.email)
        .join(", ")}`,
    );
  }
  return owner;
}

const EMBED_MODEL = "openai/text-embedding-3-small";
const EMBED_DIMS = 1536;

/** Meaning vectors, or null — a memory without one is still findable by words. */
async function embed(texts, key) {
  if (!key || noEmbed || !texts.length) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts.map((t) => t.slice(0, 8000)) }),
    });
    if (!res.ok) return null;
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
    return null;
  }
}

const H = (cfg, extra = {}) => ({
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  ...extra,
});

/**
 * Write a batch, updating whatever is already there.
 *
 * Not an upsert, and this is the whole reason memory was empty: the unique
 * index an upsert would infer here is PARTIAL (`where external_id is not
 * null`), and Postgres will not use a partial index for ON CONFLICT unless the
 * statement repeats the predicate — which PostgREST cannot say. Every sync the
 * app has ever run died on that as a 42P10. So the rows that already exist are
 * looked up and patched by id, and only the rest are inserted: correct against
 * the schema as it stands today, and still correct once the index is total.
 */
async function writeRows(cfg, userId, rows, sofar) {
  const list = rows.map((r) => `"${r.external_id}"`).join(",");
  const found = await fetch(
    `${cfg.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jarvis_memories` +
      `?user_id=eq.${userId}&external_id=in.(${encodeURIComponent(list)})&select=id,source,external_id`,
    { headers: H(cfg) },
  );
  if (!found.ok) {
    die(`\nSaved ${sofar}, then the lookup failed: ${found.status} ${(await found.text()).slice(0, 300)}`);
  }
  const key = (r) => `${r.source}\u0000${r.external_id}`;
  const existing = new Map((await found.json()).map((r) => [key(r), r.id]));

  const fresh = [];
  for (const row of rows) {
    const id = existing.get(key(row));
    if (!id) {
      fresh.push(row);
      continue;
    }
    const res = await fetch(`${cfg.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jarvis_memories?id=eq.${id}`, {
      method: "PATCH",
      headers: H(cfg, { Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    });
    if (!res.ok) die(`\nSaved ${sofar}, then an update failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  if (fresh.length) {
    const res = await fetch(`${cfg.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jarvis_memories`, {
      method: "POST",
      headers: H(cfg, { Prefer: "return=minimal" }),
      body: JSON.stringify(fresh),
    });
    if (!res.ok) die(`\nSaved ${sofar}, then the insert failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return rows.length;
}

async function main() {
  const cfg = await env();
  if (!cfg.NEXT_PUBLIC_SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) {
    die("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be in .env.local.");
  }

  const [repo, local] = await Promise.all([repoFiles(), localFiles()]);
  const files = [...repo, ...local];
  const skills = local.filter((f) => f.externalId.includes("/skills/")).length;
  console.log(
    `${files.length} files: ${repo.length} from the repo, ${local.length - skills} Claude memory files, ${skills} skills.`,
  );
  if (!files.length) die("Nothing to sync — is ~/.claude on this machine?");

  if (check) {
    for (const f of files) console.log(`  ${f.externalId}`);
    console.log("\n--check: nothing was written.");
    return;
  }

  const owner = await ownerUser(cfg);
  console.log(`Writing as ${owner.email}.`);

  let saved = 0;
  let embedded = 0;
  for (let i = 0; i < files.length; i += 20) {
    const batch = files.slice(i, i + 20);
    const vectors = await embed(
      batch.map((f) => `${f.title}\n\n${f.content}`),
      cfg.OPENROUTER_API_KEY,
    );
    if (vectors) embedded += batch.length;
    const rows = batch.map((f, n) => ({
      user_id: owner.id,
      profile_id: "owner",
      source: f.externalId.includes("/skills/") ? "skill" : "master-folder",
      title: f.title.slice(0, 300),
      content: f.content,
      origin: f.externalId,
      external_id: f.externalId,
      embedding: vectors?.[n] ?? null,
      captured_at: f.modified || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    saved += await writeRows(cfg, owner.id, rows, saved);
    process.stdout.write(`\r  saved ${saved}/${files.length}`);
  }
  console.log(
    `\nDone. ${saved} memories, ${embedded} of them searchable by meaning${
      embedded < saved ? " (the rest by words only — no OpenRouter key, or the embedding call failed)" : ""
    }.`,
  );
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
