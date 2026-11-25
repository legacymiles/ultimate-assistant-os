// ---------------------------------------------------------------------------
// App records — one file per app, the truth about what it does.
//
// Every app in the hub has `docs/apps/<slug>.md`. It has two halves:
//
//   Written by hand (kept as is): what it does, its features, what must keep
//   working, what users asked for that is not built yet, and the date the
//   record was last reviewed against the app.
//
//   Read from the code (rewritten by `npm run apps:records`, between the
//   `<!-- code:start -->` / `<!-- code:end -->` markers): pages, folders, API
//   routes and who can call them, sign-in, database tables with their row-level
//   security policies, storage buckets, saved-data keys, env keys, AI calls,
//   scheduled callers and tests. `npm run check:records` (part of verify)
//   fails when this half no longer matches the code, so it cannot go stale.
//
// The same records are written to app-records.json, which Projects Timeline
// shows and the "Change it" prompt is built from.
//
// PURE and import-free at runtime (type imports only): scripts/app-records.mjs
// loads this file straight into Node, so it must not import anything else.
// ---------------------------------------------------------------------------

import type { AppEditEntry, Project } from "../types";

export const CODE_START = "<!-- code:start -->";
export const CODE_END = "<!-- code:end -->";

/** Who can reach a route, from src/lib/hubAccess.ts + the middleware's token list. */
export type Access = "owner" | "public" | "token" | "auth";

export const ACCESS_LABEL: Record<Access, string> = {
  owner: "owner's sign-in",
  public: "public",
  token: "per-account key (no session)",
  auth: "sign-in pages",
};

export interface ApiRoute {
  path: string;
  methods: string[];
  access: Access;
  file: string;
}

/** A fact the scan found, and the files it was found in. */
export interface Fact {
  what: string;
  files: string[];
}

export interface TableFact {
  /** As the code names it, e.g. "recipes". */
  name: string;
  /** schema.table as the migrations define it, when they do. */
  defined: string[];
  rls: boolean;
  policies: string[];
  files: string[];
}

export interface CodeFacts {
  pages: { path: string; access: Access }[];
  folders: string[];
  api: ApiRoute[];
  signIn: Fact[];
  tables: TableFact[];
  buckets: Fact[];
  rpcs: Fact[];
  savedKeys: Fact[];
  serverDocs: string[];
  env: Fact[];
  ai: string[];
  callers: Fact[];
  tests: string[];
}

export interface AppRecord {
  slug: string;
  title: string;
  route: string;
  category: string;
  /** YYYY-MM-DD the hand-written half was last checked against the app; null = never. */
  reviewed: string | null;
  /** YYYY-MM-DD the record was first written from the edit log, when it was. */
  seeded: string | null;
  whatItDoes: string;
  features: string[];
  mustKeep: string[];
  requested: string[];
  code: CodeFacts;
}

export const emptyFacts = (): CodeFacts => ({
  pages: [],
  folders: [],
  api: [],
  signIn: [],
  tables: [],
  buckets: [],
  rpcs: [],
  savedKeys: [],
  serverDocs: [],
  env: [],
  ai: [],
  callers: [],
  tests: [],
});

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** src/app/api/foo/[id]/route.ts → /api/foo/[id] */
export function apiPathOf(file: string): string | null {
  const m = file.replace(/\\/g, "/").match(/^src\/app\/(api\/.*)\/route\.(ts|tsx|js)$/);
  return m ? `/${m[1]}` : null;
}

/** src/app/apps/foo/bar/page.tsx → /apps/foo/bar */
export function pagePathOf(file: string): string | null {
  const m = file.replace(/\\/g, "/").match(/^src\/app\/(apps\/.*)\/page\.(tsx|ts|jsx|js)$/);
  return m ? `/${m[1]}` : null;
}

const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** The HTTP methods a route.ts exports. */
export function routeMethods(text: string): string[] {
  const found = new Set<string>();
  const fn = /export\s+(?:async\s+)?function\s+([A-Z]+)\b/g;
  const cst = /export\s+const\s+([A-Z]+)\s*[=:]/g;
  const re = /export\s*\{([^}]*)\}/g;
  for (const rx of [fn, cst]) for (const m of text.matchAll(rx)) if (HTTP.includes(m[1])) found.add(m[1]);
  for (const m of text.matchAll(re)) {
    for (const part of m[1].split(",")) {
      const name = part.split(/\s+as\s+/).pop()?.trim() ?? "";
      if (HTTP.includes(name)) found.add(name);
    }
  }
  return HTTP.filter((h) => found.has(h));
}

// ---------------------------------------------------------------------------
// What a source file says
// ---------------------------------------------------------------------------

/** Sign-in and access checks a file uses, in plain words. */
export function signInFacts(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/signInWithOAuth\(\s*\{[^}]*?provider:\s*["'`](\w+)["'`]/g)) {
    out.add(`${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} sign-in (OAuth redirect)`);
  }
  if (/from\s+["'][^"']*lib\/auth\/google["']/.test(text)) out.add("Google sign-in — one tap + button (src/lib/auth/google.ts)");
  if (/\bsignInWithIdToken\(/.test(text)) out.add("Google One Tap sign-in (signInWithIdToken)");
  if (/\bsignInWithOtp\(/.test(text)) out.add("Email magic-link sign-in");
  if (/\bsignInWithPassword\(/.test(text)) out.add("Email + password sign-in");
  if (/\bsignUp\(/.test(text) && /supabase|auth\./.test(text)) out.add("Account sign-up");
  if (/\brequireOwner\b|\bisOwner\(/.test(text)) out.add("Owner-only check (requireOwner / isOwner)");
  if (/\brequireUser\b|auth\.getUser\(|\bcurrentUser\b/.test(text)) out.add("Needs a signed-in user (requireUser / auth.getUser)");
  if (/\bAPP_GATES\b|lib\/appGate["']/.test(text)) out.add("Password gate (src/lib/appGate.ts)");
  return [...out];
}

/** Database tables a file reads or writes with `.from("name")` (not Storage). */
export function tablesUsed(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(\bstorage\s*\.\s*)?\.?from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g)) {
    if (m[1]) continue;
    // `Array.from("x")` and friends are not tables.
    const before = text.slice(Math.max(0, (m.index ?? 0) - 8), m.index ?? 0);
    if (/(Array|Buffer|Uint8Array|Object|Set|Map)\s*$/.test(before)) continue;
    out.add(m[2]);
  }
  return [...out];
}

export function bucketsUsed(text: string): string[] {
  return unique([...text.matchAll(/storage\s*\.\s*from\(\s*["'`]([a-z0-9_-]+)["'`]/g)].map((m) => m[1]));
}

export function rpcsUsed(text: string): string[] {
  return unique([...text.matchAll(/\.rpc\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g)].map((m) => m[1]));
}

/** Saved-data keys: the hub's convention is "<app>:v<n>" (src/lib/sync/appState.ts). */
export function savedKeysUsed(text: string): string[] {
  return unique([...text.matchAll(/["'`]([a-z0-9][a-z0-9-]*(?::[a-z0-9-]+)*:v\d+)["'`]/g)].map((m) => m[1]));
}

export function envUsed(text: string): string[] {
  const names = [
    ...[...text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
    ...[...text.matchAll(/process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g)].map((m) => m[1]),
  ];
  return unique(names.filter((n) => n !== "NODE_ENV"));
}

export const usesServerDocs = (text: string): boolean => /\b(readDoc|writeDoc)\(|server_docs/.test(text);
export const usesAi = (text: string): boolean => /from\s+["'][^"']*lib\/ai\/(provider|decide)["']/.test(text);

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

export interface Policy {
  table: string; // bare name
  qualified: string; // schema.table
  name: string;
  rule: string;
}

/** Every `create policy` and `enable row level security` in the migrations. */
export function parseMigrations(sql: string): { policies: Policy[]; rls: Set<string>; tables: Set<string> } {
  const clean = sql.replace(/--[^\n]*/g, "");
  // In migration order: a later create replaces an earlier one of the same
  // name and a drop removes it — so what is listed is what the database has.
  const live = new Map<string, Policy>();
  const rx = /(create|drop)\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|[a-z0-9_]+)\s+on\s+([a-z0-9_."]+)([\s\S]*?);/gi;
  for (const m of clean.matchAll(rx)) {
    const qualified = qualify(m[3]);
    const name = m[2].replace(/"/g, "");
    const key = `${qualified}·${name}`;
    live.delete(key);
    if (m[1].toLowerCase() === "drop") continue;
    live.set(key, {
      table: qualified.split(".").pop() ?? qualified,
      qualified,
      name,
      rule: m[4].replace(/\s+/g, " ").trim(),
    });
  }
  const policies = [...live.values()];
  const rls = new Set<string>();
  for (const m of clean.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-z0-9_."]+)\s+enable\s+row\s+level\s+security/gi)) {
    rls.add(qualify(m[1]));
  }
  const tables = new Set<string>();
  for (const m of clean.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi)) tables.add(qualify(m[1]));
  return { policies, rls, tables };
}

function qualify(name: string): string {
  const n = name.replace(/"/g, "").toLowerCase();
  return n.includes(".") ? n : `public.${n}`;
}

// ---------------------------------------------------------------------------
// Assemble one app's facts
// ---------------------------------------------------------------------------

export interface ScanInput {
  /** Source files that belong to the app, repo-relative with forward slashes. */
  files: { path: string; text: string }[];
  /** Folders that exist for the app (src/components/x/, src/lib/x/, src/app/api/x/). */
  folders: string[];
  /** All migrations concatenated. */
  migrations: string;
  /** Workflow / cron files that call this app's API: path → text. */
  callers: { path: string; text: string }[];
  access: (path: string) => Access;
}

export function scanApp(input: ScanInput): CodeFacts {
  const facts = emptyFacts();
  const signIn = new Map<string, Set<string>>();
  const tables = new Map<string, Set<string>>();
  const buckets = new Map<string, Set<string>>();
  const rpcs = new Map<string, Set<string>>();
  const keys = new Map<string, Set<string>>();
  const env = new Map<string, Set<string>>();
  const docs = new Set<string>();
  const ai = new Set<string>();
  const add = (map: Map<string, Set<string>>, what: string, file: string) => {
    const set = map.get(what) ?? new Set<string>();
    set.add(file);
    map.set(what, set);
  };

  for (const f of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const page = pagePathOf(f.path);
    if (page) facts.pages.push({ path: page, access: input.access(page) });
    const api = apiPathOf(f.path);
    if (api) facts.api.push({ path: api, methods: routeMethods(f.text), access: input.access(api), file: f.path });
    if (/\.test\.(ts|tsx|mjs)$/.test(f.path)) {
      facts.tests.push(f.path);
      continue; // a test's fixtures are not the app's behaviour
    }
    for (const s of signInFacts(f.text)) add(signIn, s, f.path);
    for (const t of tablesUsed(f.text)) add(tables, t, f.path);
    for (const b of bucketsUsed(f.text)) add(buckets, b, f.path);
    for (const r of rpcsUsed(f.text)) add(rpcs, r, f.path);
    for (const k of savedKeysUsed(f.text)) add(keys, k, f.path);
    for (const e of envUsed(f.text)) add(env, e, f.path);
    if (usesServerDocs(f.text)) docs.add(f.path);
    if (usesAi(f.text)) ai.add(f.path);
  }

  const mig = parseMigrations(input.migrations);
  facts.folders = [...input.folders].sort();
  facts.signIn = toFacts(signIn);
  facts.tables = [...tables.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, files]) => {
      const defined = [...mig.tables].filter((q) => q.split(".").pop() === name).sort();
      const policies = mig.policies
        .filter((p) => p.table === name)
        .map((p) => `${p.qualified} · ${p.name} — ${p.rule}`);
      return {
        name,
        defined,
        rls: defined.some((q) => mig.rls.has(q)),
        policies: unique(policies),
        files: [...files].sort(),
      };
    });
  facts.buckets = toFacts(buckets);
  facts.rpcs = toFacts(rpcs);
  facts.savedKeys = toFacts(keys);
  facts.env = toFacts(env);
  facts.serverDocs = [...docs].sort();
  facts.ai = [...ai].sort();
  facts.callers = input.callers
    .map((c) => {
      const paths = unique(facts.api.map((r) => r.path).filter((p) => c.text.includes(p)));
      return { what: `${c.path} calls ${paths.join(", ")}`, files: [c.path], hit: paths.length > 0 };
    })
    .filter((c) => c.hit)
    .map(({ what, files }) => ({ what, files }))
    .sort((a, b) => a.what.localeCompare(b.what));
  facts.tests.sort();
  facts.pages.sort((a, b) => a.path.localeCompare(b.path));
  facts.api.sort((a, b) => a.path.localeCompare(b.path));
  return facts;
}

function toFacts(map: Map<string, Set<string>>): Fact[] {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([what, files]) => ({ what, files: [...files].sort() }));
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)].sort() as T[];
}

// ---------------------------------------------------------------------------
// The record file
// ---------------------------------------------------------------------------

const code = (s: string) => `\`${s}\``;

function where(files: string[], max = 3): string {
  const shown = files.slice(0, max).map(code).join(", ");
  return files.length > max ? `${shown} +${files.length - max} more` : shown;
}

/** The generated half of a record, markers included. */
export function renderCodeBlock(f: CodeFacts): string {
  const L: string[] = [CODE_START];
  const p = (s = "") => L.push(s);
  p("## From the code");
  p();
  p("_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._");
  p();

  p("### Where it lives");
  p();
  if (f.pages.length) for (const pg of f.pages) p(`- Page ${code(pg.path)} — ${ACCESS_LABEL[pg.access]}`);
  for (const d of f.folders) p(`- ${code(d)}`);
  if (!f.pages.length && !f.folders.length) p("- _No page or folder of its own — it lives inside another app._");
  p();

  p("### Sign-in & who can use it");
  p();
  if (f.signIn.length) for (const s of f.signIn) p(`- ${s.what} — ${where(s.files)}`);
  else p("- _No sign-in code of its own; the hub middleware decides access (see routes below)._");
  p();

  p("### Server routes");
  p();
  if (f.api.length) {
    p("| Methods | Route | Who can call it |");
    p("|---|---|---|");
    for (const r of f.api) p(`| ${r.methods.join(" ") || "—"} | ${code(r.path)} | ${ACCESS_LABEL[r.access]} |`);
  } else p("- _None._");
  p();

  p("### Data & database rules");
  p();
  const anyData = f.tables.length || f.buckets.length || f.rpcs.length || f.savedKeys.length || f.serverDocs.length;
  for (const t of f.tables) {
    const def = t.defined.length ? t.defined.join(", ") : "not created in supabase/migrations";
    p(`- Table ${code(t.name)} (${def}) · RLS ${t.rls ? "on" : t.defined.length ? "**off**" : "unknown"} — used in ${where(t.files)}`);
    for (const pol of t.policies) p(`  - policy ${pol}`);
  }
  for (const b of f.buckets) p(`- Storage bucket ${code(b.what)} — ${where(b.files)}`);
  for (const r of f.rpcs) p(`- Database function ${code(r.what)} — ${where(r.files)}`);
  for (const k of f.savedKeys) p(`- Saved data ${code(k.what)} — ${where(k.files)}`);
  if (f.serverDocs.length) p(`- Server docs (server_docs via readDoc/writeDoc) — ${where(f.serverDocs)}`);
  if (!anyData) p("- _No database, storage or saved data of its own._");
  p();

  p("### Keys & outside services");
  p();
  if (f.env.length) for (const e of f.env) p(`- ${code(e.what)} — ${where(e.files, 2)}`);
  if (f.ai.length) p(`- AI calls through ${code("src/lib/ai/provider.ts")} — ${where(f.ai)}`);
  if (!f.env.length && !f.ai.length) p("- _None._");
  p();

  if (f.callers.length) {
    p("### Called on a schedule");
    p();
    for (const c of f.callers) p(`- ${c.what}`);
    p();
  }

  p("### Tests");
  p();
  if (f.tests.length) for (const t of f.tests) p(`- ${code(t)}`);
  else p("- _None yet._");
  L.push(CODE_END);
  return L.join("\n");
}

/** Put a fresh generated block into a record, keeping everything written by hand. */
export function spliceCodeBlock(md: string, block: string): string {
  const s = markerAt(md, CODE_START);
  const e = s === -1 ? -1 : markerAt(md, CODE_END, s);
  if (s !== -1 && e > s) return `${md.slice(0, s)}${block}${md.slice(e + CODE_END.length)}`;
  return `${md.replace(/\s*$/, "")}\n\n${block}\n`;
}

export interface SeedInput {
  slug: string;
  title: string;
  route: string;
  category: string;
  status: string;
  overview: string;
  edits: AppEditEntry[];
  today: string;
  /** Commits that touched many apps at once (repo-wide chores) — not this app's features. */
  wide?: Set<string>;
}

/** A brand-new record, its Features seeded from the app's edit log. */
export function seedRecord(s: SeedInput): string {
  const wide = s.wide ?? new Set<string>();
  const seen = new Set<string>();
  const picked: AppEditEntry[] = [];
  const ordered = [...s.edits].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const e of [...ordered.filter((x) => x.group === "core"), ...ordered]) {
    if (BOOKKEEPING.test(e.title) || wide.has(e.id.split(":")[0])) continue;
    const key = e.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(e);
    if (picked.length >= 15) break;
  }
  const L: string[] = [];
  L.push(`# ${s.title}`);
  L.push("");
  L.push(`Route: ${code(s.route)} · Category: ${s.category} · ${s.status === "live" ? "Live" : "Coming soon"}`);
  L.push("");
  L.push(`Record reviewed: never — seeded from the edit log on ${s.today}`);
  L.push("");
  L.push(...recordPreamble(s.slug));
  L.push("");
  L.push("## What it does");
  L.push("");
  L.push(s.overview.trim() || "_Not written yet._");
  L.push("");
  L.push("## Features");
  L.push("");
  if (picked.length) {
    L.push("_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._");
    L.push("");
    for (const e of picked) {
      const detail = trim(e.detail.replace(/^[-*]\s+/, ""), 200);
      L.push(`- **${e.title}**${detail ? ` — ${detail}` : ""}`);
    }
  } else L.push("_None written yet._");
  L.push("");
  L.push("## Must keep working");
  L.push("");
  L.push("_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._");
  L.push("");
  L.push("## Requested, not built yet");
  L.push("");
  L.push("_Nothing waiting._");
  L.push("");
  return L.join("\n");
}

/** Commits that only kept the books — not something the app does. */
const BOOKKEEPING = /^(log app edits|timeline log|update (the )?(feature |timeline )?log|record app edits)\b/i;

/** Where a marker sits on a line of its own (prose that mentions it does not count). */
function markerAt(md: string, marker: string, from = 0): number {
  let at = md.indexOf(marker, from);
  while (at !== -1) {
    const lineStart = at === 0 || md[at - 1] === "\n";
    const rest = md.slice(at + marker.length, md.indexOf("\n", at) === -1 ? undefined : md.indexOf("\n", at));
    if (lineStart && !rest.trim()) return at;
    at = md.indexOf(marker, at + 1);
  }
  return -1;
}

export function recordPreamble(slug: string): string[] {
  return [
    "> **This file is the truth about this app.** Read it before changing the app and update it in the",
    "> same commit. Everything above the \"From the code\" block is written by hand and kept; that block",
    "> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of",
    `> \`npm run verify\`) fails when it is stale. Edit prompt: \`npm run change-it -- ${slug} "what to change"\`.`,
  ];
}

function trim(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** The hand-written sections of a record, by heading. */
export function parseRecord(md: string): Pick<AppRecord, "reviewed" | "seeded" | "whatItDoes" | "features" | "mustKeep" | "requested"> {
  const s = markerAt(md, CODE_START);
  const hand = s === -1 ? md : md.slice(0, s);
  const reviewedLine = hand.match(/^Record reviewed:\s*\**\s*(\d{4}-\d{2}-\d{2}|never)\b(.*)$/im);
  const reviewed = reviewedLine && reviewedLine[1] !== "never" ? reviewedLine[1] : null;
  const seeded = reviewedLine?.[2].match(/seeded[^0-9]*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;

  const sections = new Map<string, string>();
  const parts = hand.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const head = (nl === -1 ? part : part.slice(0, nl)).trim().toLowerCase();
    sections.set(head, nl === -1 ? "" : part.slice(nl + 1));
  }
  const find = (...names: string[]) => {
    for (const [head, body] of sections) if (names.some((n) => head.startsWith(n))) return body;
    return "";
  };
  return {
    reviewed,
    seeded,
    whatItDoes: paragraphs(find("what it does", "what it is")),
    features: bullets(find("features")),
    mustKeep: bullets(find("must keep working")),
    requested: bullets(find("requested")),
  };
}

/** Top-level bullets, one string each, with markdown emphasis removed. */
export function bullets(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const top = line.match(/^[-*]\s+(.*)$/);
    if (top) out.push(top[1]);
    else if (/^\s{2,}\S/.test(line) && out.length && !/^\s+[-*]\s/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out.map(plain).filter(Boolean);
}

function paragraphs(body: string): string {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^_.*_$/.test(p) && !p.startsWith(">") && !p.startsWith("#"))
    .join("\n\n");
}

const plain = (s: string) => s.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

export type Freshness =
  | { state: "current"; since: string; behind: 0 }
  | { state: "behind"; since: string; behind: number; edits: AppEditEntry[] }
  | { state: "seeded"; since: string; behind: number; edits: AppEditEntry[] }
  | { state: "never"; behind: number; edits: AppEditEntry[] };

/** How far the hand-written half has fallen behind the edits shipped to the app. */
export function freshness(record: Pick<AppRecord, "reviewed" | "seeded">, edits: AppEditEntry[]): Freshness {
  const since = record.reviewed ?? record.seeded;
  const after = since ? edits.filter((e) => e.date > since) : [...edits];
  const sorted = after.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (!record.reviewed && record.seeded) return { state: "seeded", since: record.seeded, behind: sorted.length, edits: sorted };
  if (!since) return { state: "never", behind: sorted.length, edits: sorted };
  if (!sorted.length) return { state: "current", since, behind: 0 };
  return { state: "behind", since, behind: sorted.length, edits: sorted };
}

export function freshnessLine(f: Freshness): string {
  switch (f.state) {
    case "current":
      return `Up to date — reviewed ${f.since}, no edits since.`;
    case "behind":
      return `${f.behind} edit${f.behind === 1 ? "" : "s"} shipped since this record was reviewed on ${f.since}.`;
    case "seeded":
      return f.behind
        ? `Seeded from the edit log on ${f.since}, not reviewed by hand yet · ${f.behind} edit${f.behind === 1 ? "" : "s"} since.`
        : `Seeded from the edit log on ${f.since}, not reviewed by hand yet.`;
    case "never":
      return "Never reviewed against the app.";
  }
}

// ---------------------------------------------------------------------------
// Change it — the prompt for editing an app that already works
// ---------------------------------------------------------------------------

export interface ChangeItInput {
  name: string;
  request: string;
  record?: AppRecord | null;
  project?: Pick<Project, "overview" | "features" | "knowledge"> | null;
  edits?: AppEditEntry[];
  today?: string;
}

/** Everything a coding agent needs to change one thing and break nothing else. */
export function buildChangeItPrompt(input: ChangeItInput): string {
  const { record, project } = input;
  const edits = [...(input.edits ?? [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const L: string[] = [];
  const p = (s = "") => L.push(s);
  const slug = record?.slug;
  const f = record?.code;

  p(`# Change it — ${input.name}`);
  p();
  p(
    "You are changing an app that already exists and works. Make the change below and nothing else: " +
      "every feature, route, sign-in, data rule and key listed here must work exactly as before when you finish.",
  );
  p();
  p("## The change");
  p();
  p(input.request.trim() || "_Write the change here before sending this prompt._");
  p();

  if (record) {
    p("## Where the code is");
    p();
    p(`- Record (the truth about this app): ${code(`docs/apps/${slug}.md`)} — read it first.`);
    for (const pg of f!.pages) p(`- Page ${code(pg.path)} → ${code(`src/app${pg.path}/page.tsx`)}`);
    for (const d of f!.folders) p(`- ${code(d)}`);
    p("- Read only the files the change touches, plus the tests next to them.");
    p();
  }

  const whatItDoes = record?.whatItDoes || project?.overview || "";
  if (whatItDoes) {
    p("## What it does today");
    p();
    p(whatItDoes);
    p();
  }

  const features = [
    ...new Set([
      ...(record?.features ?? []),
      ...(project?.features ?? []).map((x) => (x.description ? `${x.title} — ${x.description}` : x.title)),
    ]),
  ];
  if (features.length) {
    p("## Features it has (keep all of them)");
    p();
    for (const x of features) p(`- ${x}`);
    p();
  }

  p("## Must keep working");
  p();
  const keep: string[] = [...(record?.mustKeep ?? [])];
  if (f) {
    for (const s of f.signIn) keep.push(`Sign-in: ${s.what}`);
    const special = f.api.filter((r) => r.access !== "owner");
    for (const r of special) keep.push(`${code(r.path)} stays ${ACCESS_LABEL[r.access]}`);
    if (f.api.length) keep.push(`All ${f.api.length} server route${f.api.length === 1 ? "" : "s"} keep their paths, methods and who can call them`);
    for (const t of f.tables) {
      keep.push(
        `Table ${code(t.name)}${t.policies.length ? ` and its ${t.policies.length} row-level security polic${t.policies.length === 1 ? "y" : "ies"}` : ""} — no schema or policy change unless the request asks for one`,
      );
    }
    for (const b of f.buckets) keep.push(`Storage bucket ${code(b.what)}`);
    if (f.serverDocs.length) keep.push("What it stores in server docs keeps its shape — old saved docs must still load");
    if (f.savedKeys.length) keep.push(`Saved data keys ${f.savedKeys.map((k) => code(k.what)).join(", ")} — never rename (saved data would vanish)`);
    if (f.env.length) keep.push(`Keys it reads: ${f.env.map((e) => code(e.what)).join(", ")} — with a key missing it must still load and say what is missing`);
    for (const c of f.callers) keep.push(`Scheduled caller: ${c.what}`);
  }
  if (keep.length) for (const k of keep) p(`- ${k}`);
  else p("- Everything it does today.");
  p();

  if (record?.requested.length) {
    p("## Asked for earlier, not built yet");
    p();
    p("Do not build these unless the change asks for them — but do not make them harder to add.");
    p();
    for (const r of record.requested) p(`- ${r}`);
    p();
  }

  if (record) {
    const fr = freshness(record, edits);
    p("## How current this record is");
    p();
    p(freshnessLine(fr));
    if (fr.state !== "current" && fr.edits.length) {
      p("These edits shipped after the record was reviewed — read the code for them, they are real features too:");
      p();
      for (const e of fr.edits.slice(0, 15)) p(`- ${e.date} — ${e.title}`);
      if (fr.edits.length > 15) p(`- …and ${fr.edits.length - 15} more in ${code("src/lib/timeline/feature-log.json")}`);
    }
    p();
  } else if (edits.length) {
    p("## Recent edits (newest first)");
    p();
    for (const e of edits.slice(0, 15)) p(`- ${e.date} — ${e.title}`);
    p();
  }

  const decisions = (project?.knowledge ?? []).filter((k) => k.kind === "feature_request" || k.kind === "bug_report" || k.kind === "idea");
  if (decisions.length) {
    p("## Notes from the Knowledge Inbox");
    p();
    for (const k of decisions.slice(-10)) p(`- **${k.title || k.kind}** — ${trim(k.content, 240)}`);
    p();
  }

  p("## How to make the change");
  p();
  p(`1. Read ${record ? code(`docs/apps/${slug}.md`) : "the project above"} and only the files the change touches.`);
  p("2. If the change is visible (look, layout or words), show three mockups first with the `website-edit-mockups` skill unless the owner said quick — then build exactly the pick.");
  p("3. Make the change. Reuse what is there; do not rename routes, saved keys, tables or env keys.");
  if (f?.tests.length) p(`4. Run this app's tests: ${f.tests.slice(0, 4).map(code).join(", ")}${f.tests.length > 4 ? " …" : ""} — then ${code("npm run verify")}.`);
  else p(`4. Add a test for the logic you changed, then run ${code("npm run verify")}.`);
  if (record) {
    p(
      `5. Update ${code(`docs/apps/${slug}.md`)} in the same commit: add the change to Features, anything a user would notice breaking to Must keep working, ` +
        `move a built request out of Requested, and set ${code(`Record reviewed: ${input.today ?? "<today>"}`)}. Then ${code("npm run apps:records")}.`,
    );
  } else p("5. Write down what changed in this project's Features.");
  p(`6. Commit as "${input.name}: <what changed, in plain words>", then ${code("npm run timeline:log")}.`);
  p();
  p("## Done when");
  p();
  p("- The change works, shown on the real page.");
  p("- Everything under Must keep working still works.");
  p(`- ${code("npm run verify")} is green${record ? " and the record says what changed" : ""}.`);
  return L.join("\n");
}
