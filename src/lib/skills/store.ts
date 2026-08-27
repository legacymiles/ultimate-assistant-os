// ---------------------------------------------------------------------------
// Skills Library — data access.
// Uses Supabase (with per-user RLS) when configured; otherwise falls back to
// localStorage so the app is fully usable in local/demo mode with no backend.
// This mirrors how every other app in the hub degrades gracefully.
// ---------------------------------------------------------------------------

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { FEATURED_SKILLS } from "./seed-skills";
import type { ScannedSkill, Skill, SkillDraft } from "./types";

const LS_KEY = "skills-library:v1";

/**
 * Merge the built-in featured skills into a fetched list. A real skill (synced
 * or hand-added) that shares a featured skill's slug or title wins, so nothing
 * ever double-shows if the user later installs/syncs the same skill themselves.
 */
function withFeatured(fetched: Skill[]): Skill[] {
  const slugs = new Set(fetched.map((s) => s.slug).filter(Boolean));
  const titles = new Set(fetched.map((s) => s.title.trim().toLowerCase()));
  const extras = FEATURED_SKILLS.filter(
    (f) => !slugs.has(f.slug) && !titles.has(f.title.trim().toLowerCase()),
  );
  return [...extras, ...fetched];
}

function uid(): string {
  return "sk_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function normalize(draft: SkillDraft): SkillDraft {
  return {
    title: draft.title.trim(),
    overview: draft.overview.trim(),
    body: draft.body,
  };
}

/** True when data is backed by Supabase (real accounts); false = local mode. */
export function isCloudBacked(): boolean {
  return getSupabaseBrowserClient() !== null;
}

// ----- localStorage backend ------------------------------------------------
function lsRead(): Skill[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const list = raw ? (JSON.parse(raw) as Skill[]) : [];
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

function lsWrite(skills: Skill[]): void {
  window.localStorage.setItem(LS_KEY, JSON.stringify(skills));
}

// ----- Supabase row mapping ------------------------------------------------
interface SkillRow {
  id: string;
  title: string;
  overview: string | null;
  body: string | null;
  source: string | null;
  slug: string | null;
  origin: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    title: row.title,
    overview: row.overview ?? "",
    body: row.body ?? "",
    source: row.source === "claude-code" ? "claude-code" : "manual",
    slug: row.slug ?? null,
    origin: row.origin ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ----- Public API ----------------------------------------------------------
export async function listSkills(): Promise<Skill[]> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return withFeatured(lsRead());

  const { data, error } = await sb
    .from("skills")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return withFeatured((data ?? []).map(rowToSkill));
}

export async function createSkill(draft: SkillDraft): Promise<Skill> {
  const clean = normalize(draft);
  const sb = getSupabaseBrowserClient();

  if (!sb) {
    const now = new Date().toISOString();
    const skill: Skill = {
      id: uid(),
      ...clean,
      source: "manual",
      slug: null,
      origin: null,
      createdAt: now,
      updatedAt: now,
    };
    lsWrite([skill, ...lsRead()]);
    return skill;
  }

  const { data: userData } = await sb.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("You must be signed in to add a skill.");

  const { data, error } = await sb
    .from("skills")
    .insert({ user_id: userId, source: "manual", ...clean })
    .select("*")
    .single();
  if (error) throw error;
  return rowToSkill(data as SkillRow);
}

export async function updateSkill(id: string, draft: SkillDraft): Promise<Skill> {
  const clean = normalize(draft);
  const sb = getSupabaseBrowserClient();

  if (!sb) {
    const all = lsRead();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error("Skill not found.");
    all[idx] = { ...all[idx], ...clean, updatedAt: new Date().toISOString() };
    lsWrite(all);
    return all[idx];
  }

  const { data, error } = await sb
    .from("skills")
    .update(clean)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToSkill(data as SkillRow);
}

export async function deleteSkill(id: string): Promise<void> {
  const sb = getSupabaseBrowserClient();

  if (!sb) {
    lsWrite(lsRead().filter((s) => s.id !== id));
    return;
  }

  const { error } = await sb.from("skills").delete().eq("id", id);
  if (error) throw error;
}

// ----- Sync from Claude Code -----------------------------------------------
export interface SyncResult {
  /** Whether the server could see the skill files at all (true locally). */
  available: boolean;
  /** Number of skills synced (added or updated). */
  count: number;
  error?: string;
}

async function upsertScanned(scanned: ScannedSkill[]): Promise<number> {
  const sb = getSupabaseBrowserClient();

  if (!sb) {
    const all = lsRead();
    const bySlug = new Map(all.filter((s) => s.slug).map((s) => [s.slug, s]));
    const now = new Date().toISOString();
    for (const sc of scanned) {
      const existing = bySlug.get(sc.slug);
      if (existing) {
        existing.title = sc.title;
        existing.overview = sc.overview;
        existing.body = sc.body;
        existing.origin = sc.origin;
        existing.source = "claude-code";
        existing.updatedAt = now;
      } else {
        const skill: Skill = {
          id: uid(),
          title: sc.title,
          overview: sc.overview,
          body: sc.body,
          source: "claude-code",
          slug: sc.slug,
          origin: sc.origin,
          createdAt: now,
          updatedAt: now,
        };
        all.push(skill);
        bySlug.set(sc.slug, skill);
      }
    }
    lsWrite(all);
    return scanned.length;
  }

  const { data: userData } = await sb.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("You must be signed in to sync.");

  const rows = scanned.map((sc) => ({
    user_id: userId,
    title: sc.title,
    overview: sc.overview,
    body: sc.body,
    source: "claude-code",
    slug: sc.slug,
    origin: sc.origin,
  }));

  const { error } = await sb.from("skills").upsert(rows, {
    onConflict: "user_id,slug",
  });
  if (error) throw error;
  return scanned.length;
}

/**
 * Ask the server to scan the local Claude Code skill files, then upsert them.
 * Never throws — returns a result the UI can show. When the app runs on a
 * deployed server (no local files), `available` is false and nothing changes.
 */
export async function syncFromClaudeCode(): Promise<SyncResult> {
  let scanned: ScannedSkill[] = [];
  let available = false;
  try {
    const res = await fetch("/api/skills/scan", { cache: "no-store" });
    if (!res.ok) throw new Error(`Scan failed (${res.status}).`);
    const data = (await res.json()) as { available?: boolean; skills?: ScannedSkill[] };
    available = Boolean(data.available);
    scanned = Array.isArray(data.skills) ? data.skills : [];
  } catch (err) {
    return { available: false, count: 0, error: err instanceof Error ? err.message : "Scan failed." };
  }

  if (scanned.length === 0) return { available, count: 0 };

  try {
    const count = await upsertScanned(scanned);
    return { available, count };
  } catch (err) {
    return { available, count: 0, error: err instanceof Error ? err.message : "Could not save synced skills." };
  }
}
