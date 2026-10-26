import "server-only";

// ---------------------------------------------------------------------------
// Where the memory rules live: one server document per account (daily log +
// findings), in public.server_docs like In Queue — no migration. The memory
// rows themselves stay in jarvis_memories; this doc only holds what sits on
// top of them.
//
// The routers are never stored: they are built on demand from the catalog,
// the skill store and the memory rows, so they can never drift from what is
// actually there.
// ---------------------------------------------------------------------------

import { readDoc, writeDoc } from "@/lib/server/docStore";
import { dataDir } from "@/lib/recall/dataDir";
import type { MemoryContext } from "@/lib/jarvis/server/memory";
import { listMemories } from "@/lib/jarvis/server/memory";
import { listSkills } from "@/lib/jarvis/server/skills";
import { PROJECTS } from "@/lib/catalog";
import { skillMeta } from "@/lib/skills/categories";
import type { Skill } from "@/lib/skills/types";
import { addLog, buildRouters, normalizeRules, type AreaRouter, type LogInput, type RulesDoc } from "../rules";

function docName(uid: string): string {
  return `.memory-rules.${uid.replace(/[^a-zA-Z0-9-]/g, "")}.json`;
}

export async function readRules(uid: string): Promise<RulesDoc> {
  return normalizeRules(await readDoc<RulesDoc>(docName(uid), dataDir()));
}

/** Read, change, write. Throws when the host kept nothing (no service key on a deploy). */
export async function updateRules(uid: string, change: (doc: RulesDoc) => RulesDoc): Promise<RulesDoc> {
  const next = change(await readRules(uid));
  const saved = await writeDoc(docName(uid), dataDir(), next);
  if (!saved) throw new Error("The memory log could not be saved on this host. On a deployed site it needs SUPABASE_SERVICE_ROLE_KEY.");
  return next;
}

/** Log lines riding on another request: never throws, never blocks it. */
export async function noteLog(uid: string, entries: LogInput[]): Promise<void> {
  if (!entries.length) return;
  try {
    await updateRules(uid, (d) => addLog(d, entries).doc);
  } catch {
    /* a log line must never break the work it describes */
  }
}

/** Every area's router, built from what exists right now. */
export async function routersFor(ctx: MemoryContext): Promise<AreaRouter[]> {
  const [skills, memories, rules] = await Promise.all([
    listSkills(ctx).catch(() => []),
    listMemories(ctx, 600).catch(() => []),
    readRules(ctx.userId).catch(() => normalizeRules(null)),
  ]);
  return buildRouters({
    apps: PROJECTS.map((p) => ({ slug: p.slug, title: p.title, category: String(p.category), overview: p.overview })),
    skills: skills.map((s) => {
      const asSkill: Skill = { id: s.name, slug: s.name, title: s.name, overview: s.description, body: "", source: "claude-code", origin: "Personal", createdAt: "", updatedAt: s.updatedAt };
      const m = skillMeta(asSkill);
      return { slug: s.name, title: s.name, overview: s.description, categories: m.categories, command: m.command };
    }),
    memories: memories.map((m) => ({ id: m.id, title: m.title, content: m.content, source: m.source })),
    workflowsWithFindings: Object.keys(rules.findings),
  });
}
