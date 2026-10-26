// ---------------------------------------------------------------------------
// Memory rules — how Jarvis's memory is kept tidy, on top of the database.
//
// The Supabase memory rows stay the one source of truth (every device reads
// them). These rules sit on top, borrowed from the "Obsidian as a backend"
// setup the owner liked, minus the part that would break a multi-user website
// (a folder of files on one PC):
//
//   1. HUMAN vs MACHINE. What the owner wrote by hand (notes, their profile,
//      their vault) is theirs: an agent may read it and link to it, never
//      rewrite or delete it. Agents write into their own side (chat facts,
//      the daily log, findings) and can make a mess there.
//
//   2. A ROUTER PER AREA. Each area of the owner's world (an app category, a
//      skill category, client sites…) gets a short index of what lives there,
//      so an agent reads the map first and opens only what the task needs.
//
//   3. A DAILY LOG. Every agent (Jarvis chat, Claude Code on the PC/VPS,
//      claude.ai) writes what it did into today's log, so nobody has to
//      journal and the timeline can show who changed what.
//
//   4. FINDINGS PER WORKFLOW. What worked and what flopped on each run of a
//      workflow, read before the next run, so every run beats the last.
//
// Pure — the server store, the connector and the map all share it.
// ---------------------------------------------------------------------------

import type { MemorySource } from "@/lib/jarvis/types";

// ----- 1. human vs machine ---------------------------------------------------------

/** Sources only the owner writes. Agents read them; they never rewrite or delete them. */
export const OWNER_SOURCES: MemorySource[] = ["vault", "note", "profile"];

export function isOwnerSource(source: MemorySource | string | null | undefined): boolean {
  return OWNER_SOURCES.includes(source as MemorySource);
}

/**
 * The source an agent's save is filed under. An agent asking to save "as a
 * note" is still an agent: it lands on the machine side, as "chat".
 */
export function agentSource(asked: MemorySource | string | undefined, allowed: readonly MemorySource[]): MemorySource {
  const a = asked as MemorySource;
  if (!a || !allowed.includes(a) || isOwnerSource(a) || a === "master-folder") return "chat";
  return a;
}

/** Why an agent may not delete this memory, or null when it may. */
export function agentDeleteRefusal(source: MemorySource): string | null {
  if (source === "vault" || source === "master-folder") return null; // the caller explains mirrors itself
  if (isOwnerSource(source)) {
    return "That memory is one the owner wrote by hand, so agents can read it but not delete it. Ask the owner to remove it in Jarvis › Memory.";
  }
  return null;
}

// ----- the per-account document ------------------------------------------------------

export interface LogEntry {
  /** ISO time. */
  at: string;
  /** Who did it: "jarvis", "claude-code", "claude-ai", a machine name… */
  by: string;
  text: string;
  /** The app, skill or workflow it touched, when known ("cook-connect", "studio:film-3d"). */
  about?: string;
}

export interface Finding {
  at: string;
  by: string;
  text: string;
  /** Worked, flopped, or just a note. */
  kind: "win" | "miss" | "note";
}

export interface RulesDoc {
  v: 1;
  /** Local-day key (YYYY-MM-DD, in the timezone the writer gave) → entries, oldest first. */
  log: Record<string, LogEntry[]>;
  /** Workflow / skill key → findings, newest last. */
  findings: Record<string, Finding[]>;
}

export const EMPTY_RULES: RulesDoc = { v: 1, log: {}, findings: {} };

/** How long the daily log is kept. Older days are dropped; they live on in git and the map's history. */
export const LOG_DAYS = 45;
export const LOG_PER_DAY = 200;
export const FINDINGS_PER_WORKFLOW = 60;
const TEXT_MAX = 600;

const clip = (s: unknown, n = TEXT_MAX) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** "Studio:Film-3D " → "studio:film-3d". Anything that can't be a key → "". */
export function workflowKey(raw: unknown): string {
  const k = String(raw ?? "")
    .trim()
    .replace(/^[@/]+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-");
  return /^[a-z0-9][a-z0-9._:-]{0,119}$/.test(k) ? k : "";
}

/** A fresh, valid copy of whatever was stored. */
export function normalizeRules(raw: unknown): RulesDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<RulesDoc>;
  const log: RulesDoc["log"] = {};
  for (const [day, list] of Object.entries(r.log ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(list)) continue;
    const ok = list.filter((e) => e && typeof e.text === "string" && e.text.trim()).map((e) => ({ ...e }));
    if (ok.length) log[day] = ok.slice(-LOG_PER_DAY);
  }
  const findings: RulesDoc["findings"] = {};
  for (const [k, list] of Object.entries(r.findings ?? {})) {
    const key = workflowKey(k);
    if (!key || !Array.isArray(list)) continue;
    const ok = list.filter((f) => f && typeof f.text === "string" && f.text.trim()).map((f) => ({ ...f }));
    if (ok.length) findings[key] = ok.slice(-FINDINGS_PER_WORKFLOW);
  }
  return { v: 1, log, findings };
}

/** The day key for an instant in a timezone. Falls back to UTC on a bad zone. */
export function dayKey(at: Date | string | number = Date.now(), timeZone?: string): string {
  const d = new Date(at);
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function pruneDays(log: RulesDoc["log"], today: string): RulesDoc["log"] {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - LOG_DAYS * 86_400_000).toISOString().slice(0, 10);
  const out: RulesDoc["log"] = {};
  for (const [day, list] of Object.entries(log)) if (day >= cutoff) out[day] = list;
  return out;
}

// ----- 3. the daily log -------------------------------------------------------------

export interface LogInput {
  text: string;
  by: string;
  about?: string;
  at?: string;
  timeZone?: string;
}

/**
 * Add entries to the log. The same line from the same writer on the same day
 * is written once, so a retried hook or a re-run turn never doubles a line.
 */
export function addLog(doc: RulesDoc, entries: LogInput[], now = Date.now()): { doc: RulesDoc; added: number } {
  const next: RulesDoc = { ...doc, log: { ...doc.log } };
  let added = 0;
  let today = dayKey(now);
  for (const e of entries) {
    const text = clip(e.text);
    const by = clip(e.by, 60) || "agent";
    if (!text) continue;
    const t = e.at && Number.isFinite(Date.parse(e.at)) && Date.parse(e.at) <= now + 300_000 ? new Date(e.at) : new Date(now);
    const day = dayKey(t, e.timeZone);
    today = day > today ? day : today;
    const list = [...(next.log[day] ?? [])];
    if (list.some((x) => x.text === text && x.by === by)) continue;
    const about = workflowKey(e.about) || undefined;
    list.push({ at: t.toISOString(), by, text, ...(about ? { about } : {}) });
    list.sort((a, b) => a.at.localeCompare(b.at));
    next.log[day] = list.slice(-LOG_PER_DAY);
    added += 1;
  }
  next.log = pruneDays(next.log, today);
  return { doc: next, added };
}

/** The last `days` days of log, newest day first. */
export function recentLog(doc: RulesDoc, days = 7): { day: string; entries: LogEntry[] }[] {
  return Object.keys(doc.log)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, days)
    .map((day) => ({ day, entries: doc.log[day] }));
}

/** One day's log as markdown, for the vault export and for agents. */
export function logMarkdown(day: string, entries: LogEntry[]): string {
  const lines = entries.map((e) => `- ${e.at.slice(11, 16)} **${e.by}**${e.about ? ` (${e.about})` : ""} — ${e.text}`);
  return [`# Daily log — ${day}`, "", ...(lines.length ? lines : ["_Nothing logged._"])].join("\n");
}

// ----- 4. findings ------------------------------------------------------------------

export interface FindingInput {
  workflow: string;
  text: string;
  by: string;
  kind?: Finding["kind"];
  at?: string;
}

const isKind = (k: unknown): k is Finding["kind"] => k === "win" || k === "miss" || k === "note";

/** Add a finding. An identical finding already on file is not added twice. */
export function addFinding(doc: RulesDoc, f: FindingInput, now = Date.now()): { doc: RulesDoc; added: boolean; key: string } {
  const key = workflowKey(f.workflow);
  const text = clip(f.text);
  if (!key || !text) return { doc, added: false, key };
  const list = [...(doc.findings[key] ?? [])];
  if (list.some((x) => x.text.toLowerCase() === text.toLowerCase())) return { doc, added: false, key };
  list.push({ at: new Date(now).toISOString(), by: clip(f.by, 60) || "agent", text, kind: isKind(f.kind) ? f.kind : "note" });
  return { doc: { ...doc, findings: { ...doc.findings, [key]: list.slice(-FINDINGS_PER_WORKFLOW) } }, added: true, key };
}

/** Keys a workflow can be filed under — "film-3d" and "studio:film-3d" are the same workflow. */
export function findingKeys(workflow: string): string[] {
  const k = workflowKey(workflow);
  if (!k) return [];
  const bare = k.replace(/^studio:/, "");
  return [...new Set([k, bare, `studio:${bare}`])];
}

export function findingsFor(doc: RulesDoc, workflow: string): Finding[] {
  const out: Finding[] = [];
  for (const k of findingKeys(workflow)) out.push(...(doc.findings[k] ?? []));
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * What an agent reads before running a workflow. Misses first — they are the
 * ones that stop a mistake being made twice — then wins, newest first, capped.
 */
export function findingsBlock(doc: RulesDoc, workflow: string, max = 15): string {
  const all = findingsFor(doc, workflow);
  if (!all.length) return "";
  const pick = [...all.filter((f) => f.kind === "miss"), ...all.filter((f) => f.kind !== "miss")]
    .slice(-max * 2)
    .sort((a, b) => (a.kind === "miss" ? -1 : 0) - (b.kind === "miss" ? -1 : 0) || b.at.localeCompare(a.at))
    .slice(0, max);
  const mark = { win: "Worked", miss: "Avoid", note: "Note" } as const;
  return [
    `FINDINGS FROM PAST RUNS OF ${workflowKey(workflow).toUpperCase()} — read before this run; do not repeat what to avoid:`,
    ...pick.map((f) => `- ${mark[f.kind]}: ${f.text} (${f.at.slice(0, 10)})`),
  ].join("\n");
}

// ----- 2. area routers -----------------------------------------------------------------

export interface RouterItem {
  kind: "app" | "skill" | "client" | "memory" | "workflow";
  name: string;
  /** How to reach it: a /command, a /apps/ link, a memory id. */
  ref?: string;
  line?: string;
}

export interface AreaRouter {
  /** "apps/ai", "skills/video-editing", "clients", "memories". */
  key: string;
  title: string;
  /** One line: what this area is for. */
  purpose: string;
  items: RouterItem[];
}

export interface RouterInputs {
  apps: { slug: string; title: string; category: string; overview?: string }[];
  skills: { slug: string; title: string; overview?: string; categories: string[]; command?: string }[];
  clients?: { id: string; name: string; clientName?: string }[];
  memories?: { id: string; title: string; content: string; source: string }[];
  workflowsWithFindings?: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * One router per area, built from what exists — never hand-maintained, so it
 * can't go stale. An agent calls get_router() for the index of areas, then
 * get_router(area) for one, then opens only what it needs.
 */
export function buildRouters(input: RouterInputs): AreaRouter[] {
  const out = new Map<string, AreaRouter>();
  const area = (key: string, title: string, purpose: string) => {
    let a = out.get(key);
    if (!a) out.set(key, (a = { key, title, purpose, items: [] }));
    return a;
  };
  for (const a of input.apps) {
    area(`apps/${slug(a.category || "apps")}`, `${a.category || "Apps"} apps`, `The owner's ${(a.category || "").toLowerCase() || "hub"} apps: open the page, or the code under src/.`).items.push({
      kind: "app",
      name: a.title,
      ref: `/apps/${a.slug}`,
      line: clip(a.overview, 140),
    });
  }
  for (const s of input.skills) {
    const cat = s.categories[0] || "Other";
    area(`skills/${slug(cat)}`, `${cat} skills`, `Skills for ${cat.toLowerCase()} work. Load one with get_skill before doing that kind of job.`).items.push({
      kind: "skill",
      name: s.title || s.slug,
      ref: s.command || `/${s.slug}`,
      line: clip(s.overview, 140),
    });
  }
  for (const c of input.clients ?? []) {
    area("clients", "Client sites", "Websites built for clients. Edits go through Client Review › Approve & build.").items.push({
      kind: "client",
      name: c.name,
      ref: "/apps/client-review",
      line: c.clientName ? `for ${c.clientName}` : undefined,
    });
  }
  for (const w of input.workflowsWithFindings ?? []) {
    area("findings", "Findings", "What past runs of each workflow learned. Read a workflow's findings before running it.").items.push({ kind: "workflow", name: w, ref: `get_findings ${w}` });
  }
  // Owner-written memories get an area of their own, so agents see what is the owner's.
  const owner = (input.memories ?? []).filter((m) => isOwnerSource(m.source));
  for (const m of owner.slice(0, 80)) {
    area("owner-notes", "Owner's notes", "Written by the owner. Read and follow; never rewrite or delete.").items.push({ kind: "memory", name: clip(m.title || m.content, 100), ref: m.id });
  }
  for (const a of out.values()) a.items.sort((x, y) => x.name.localeCompare(y.name));
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The index of every area: what an agent reads first. */
export function routerIndex(routers: AreaRouter[]): string {
  return [
    "# Jarvis memory map — areas",
    "Call get_router with an area key to see what lives there. Owner's notes are read-only for agents.",
    "",
    ...routers.map((r) => `- \`${r.key}\` — ${r.title} (${r.items.length}): ${r.purpose}`),
  ].join("\n");
}

/** One area's router as markdown. */
export function routerMarkdown(r: AreaRouter, max = 120): string {
  const rows = r.items.slice(0, max).map((i) => `- ${i.name}${i.ref ? ` — \`${i.ref}\`` : ""}${i.line ? `: ${i.line}` : ""}`);
  const more = r.items.length > max ? [`- …and ${r.items.length - max} more`] : [];
  return [`# ${r.title}`, r.purpose, "", ...rows, ...more].join("\n");
}

/** Find an area by key, or by a loose name ("video", "clients"). */
export function findRouter(routers: AreaRouter[], q: string): AreaRouter | null {
  const k = q.toLowerCase().trim();
  if (!k) return null;
  return (
    routers.find((r) => r.key === k) ??
    routers.find((r) => r.key.endsWith(`/${slug(k)}`)) ??
    routers.find((r) => r.title.toLowerCase().includes(k)) ??
    null
  );
}

// ----- the markdown copy (for Claude Code on the PC / VPS) --------------------------------

/**
 * The whole rules layer as a folder of markdown files — what the PC writes
 * into its Jarvis Vault so Claude Code reads the same memory as plain text.
 * Paths use forward slashes; the writer maps them to the OS.
 */
export function vaultFiles(doc: RulesDoc, routers: AreaRouter[]): Record<string, string> {
  const files: Record<string, string> = {};
  files["AGENTS.md"] = [
    "# Jarvis memory — read me first",
    "",
    "This folder is a copy of Jarvis's memory rules. The database on the Jarvis website is the source of truth; this copy is rewritten on every sync, so edit through Jarvis, not here.",
    "",
    "- `areas/` — one router per area. Read `areas/INDEX.md`, then only the area your task needs.",
    "- `log/` — the daily log. Log what you did with the jarvis-memory tool `log_activity`.",
    "- `findings/` — what past runs of each workflow learned. Read it before running that workflow; add to it with `add_finding`.",
    "- Owner's notes (area `owner-notes`) are read-only for agents.",
  ].join("\n");
  files["areas/INDEX.md"] = routerIndex(routers);
  for (const r of routers) files[`areas/${r.key.replace(/\//g, "--")}.md`] = routerMarkdown(r, 400);
  for (const { day, entries } of recentLog(doc, LOG_DAYS)) files[`log/${day}.md`] = logMarkdown(day, entries);
  for (const [k, list] of Object.entries(doc.findings)) {
    files[`findings/${k.replace(/:/g, "--")}.md`] = [
      `# Findings — ${k}`,
      "",
      ...list.map((f) => `- ${f.at.slice(0, 10)} [${f.kind}] ${f.text} _(by ${f.by})_`),
    ].join("\n");
  }
  return files;
}
