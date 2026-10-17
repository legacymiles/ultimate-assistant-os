import "server-only";

// ---------------------------------------------------------------------------
// The skill store: one home for every skill, whichever device made it.
//
// A skill is stored as ONE row in jarvis_memories (source "skill"), keyed by
// the same external id the master-folder sync has always used —
// `~/.claude/skills/<name>` — so a skill saved from a phone, pushed from the
// VPS, or scanned on the PC lands on the same row instead of three. The row's
// `content` is a short searchable summary (so the Memory ball and search_memory
// find it); the full SKILL.md and its reference files live in `meta`, which is
// what get_skill and the PC/VPS pull hand back.
//
// Last write wins. The hash gate in saveMemories means re-saving an unchanged
// skill writes nothing and costs no embedding.
// ---------------------------------------------------------------------------

import {
  hashSkill,
  normalizeFiles,
  skillDescription,
  skillSize,
  SKILL_TOTAL_MAX,
  validSkillName,
  type SkillFiles,
} from "../skillFormat.mjs";
import { saveMemories, type MemoryContext } from "./memory";

const PREFIX = "~/.claude/skills/";

export const skillKey = (name: string) => `${PREFIX}${name}`;
export const nameFromKey = (key: string) => (key.startsWith(PREFIX) ? key.slice(PREFIX.length) : "");

export interface SkillSummary {
  name: string;
  description: string;
  hash: string;
  updatedAt: string;
  updatedFrom: string;
  /** False for old summary-only rows (no full body stored) — never written to disk. */
  complete: boolean;
}

export interface StoredSkill extends SkillSummary {
  body: string;
  files: SkillFiles;
}

export class SkillError extends Error {}

/** Save (create or replace) one skill. Returns whether anything changed. */
export async function saveSkill(
  ctx: MemoryContext,
  input: { name: string; body: string; files?: unknown; origin?: string },
): Promise<{ name: string; changed: boolean; hash: string }> {
  const name = String(input.name ?? "").trim();
  if (!validSkillName(name)) {
    throw new SkillError("Skill name must be 1–64 letters, digits, dots, dashes or underscores (e.g. my-skill).");
  }
  const body = String(input.body ?? "");
  if (!body.trim()) throw new SkillError("The skill body (SKILL.md) is empty.");
  if (!/^---\r?\n[\s\S]*?\r?\n---/.test(body)) {
    throw new SkillError('SKILL.md must start with YAML frontmatter: ---\\nname: …\\ndescription: …\\n---');
  }
  const files = normalizeFiles(input.files);
  if (skillSize(body, files) > SKILL_TOTAL_MAX) {
    throw new SkillError(`That skill is over ${Math.round(SKILL_TOTAL_MAX / 1000)} KB with its references — trim the references.`);
  }
  const hash = hashSkill(body, files);
  const description = skillDescription(body);
  const origin = String(input.origin ?? "").trim() || "connector";

  const { saved } = await saveMemories(ctx, [
    {
      source: "skill",
      title: `Skill: ${name}`,
      content: `Skill "${name}": ${description || "a Claude Code skill."}\n\n${body.slice(0, 1500)}`,
      origin,
      tags: ["skill", name],
      externalId: skillKey(name),
      meta: { hash, body, files, updatedFrom: origin, description },
    },
  ]);
  return { name, changed: saved > 0, hash };
}

interface Row {
  external_id: string | null;
  content: string;
  updated_at: string;
  hash?: string | null;
  updated_from?: string | null;
  description?: string | null;
}

/** Every stored skill, without bodies (cheap — bodies stay in the database). */
export async function listSkills(ctx: MemoryContext): Promise<SkillSummary[]> {
  const { data, error } = await ctx.db
    .from("jarvis_memories")
    .select("external_id,content,updated_at,hash:meta->>hash,updated_from:meta->>updatedFrom,description:meta->>description")
    .eq("user_id", ctx.userId)
    .eq("profile_id", ctx.profileId)
    .eq("source", "skill")
    .order("external_id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[])
    .map((r) => {
      const name = nameFromKey(r.external_id ?? "");
      const firstLine = (r.content ?? "").split("\n")[0].replace(/^Skill "[^"]*":\s*/, "");
      return {
        name,
        description: r.description || firstLine.slice(0, 300),
        hash: r.hash ?? "",
        updatedAt: r.updated_at,
        updatedFrom: r.updated_from ?? "",
        // Every canonical write stores a hash alongside the full body; old
        // summary-only rows from before the skill store have neither.
        complete: Boolean(r.hash),
      };
    })
    .filter((s) => validSkillName(s.name));
}

/** One skill with its full SKILL.md and references, or null. */
export async function getSkill(ctx: MemoryContext, name: string): Promise<StoredSkill | null> {
  if (!validSkillName(name)) return null;
  const { data, error } = await ctx.db
    .from("jarvis_memories")
    .select("external_id,content,updated_at,meta")
    .eq("user_id", ctx.userId)
    .eq("profile_id", ctx.profileId)
    .eq("source", "skill")
    .eq("external_id", skillKey(name))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const meta = (data.meta ?? {}) as { body?: string; files?: unknown; hash?: string; updatedFrom?: string; description?: string };
  const complete = typeof meta.body === "string" && meta.body.length > 0;
  const body = complete ? (meta.body as string) : String(data.content ?? "");
  const files = complete ? normalizeFiles(meta.files) : {};
  return {
    name,
    description: meta.description || skillDescription(body),
    hash: meta.hash || hashSkill(body, files),
    updatedAt: data.updated_at,
    updatedFrom: meta.updatedFrom ?? "",
    complete,
    body,
    files,
  };
}
