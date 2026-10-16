// ---------------------------------------------------------------------------
// Files the funding knowledge base into the Projects Timeline, as Knowledge
// Inbox entries on the Financial Bible project. The data itself lives in this
// folder; these entries are a readable copy of it inside the Timeline, so the
// owner (and the AI Project Analyst) can find it there without opening the app.
//
// Additive only: an entry is added when no entry with its title exists yet.
// Nothing the owner wrote or edited is ever changed or removed.
// ---------------------------------------------------------------------------

import type { KnowledgeEntry, Project } from "../../types";
import { nowIso, uid } from "../../utils";
import { LENDERS } from "./lenders";
import { CHEAT_SHEETS, LEFT_OUT, MISTAKES, SCRIPTS, SEQUENCES, TIPS } from "./playbook";
import { LESSONS } from "./lessons";
import { READ_ON } from "./index";

export const FINANCIAL_BIBLE_SLUG = "financial-bible";
const PREFIX = "Funding KB · ";

const money = (n?: number) => (n ? `$${n.toLocaleString("en-US")}` : "—");

function lenderTable(kind: string, label: string): string {
  const rows = LENDERS.filter((l) => l.kind === kind).map((l) => {
    const products = l.products.map((p) => `${p.side} ${p.kind}${p.max ? ` ≤${money(p.max)}` : ""}${p.docs ? ` (${p.docs}-doc)` : ""}`).join("; ");
    const reqs = [l.minScore && `${l.minScore}+`, l.minTibMonths && `${l.minTibMonths} mo TIB`, l.minMonthlyRevenue && `${money(l.minMonthlyRevenue)}/mo`]
      .filter(Boolean)
      .join(", ");
    const extra = [...(l.rules ?? []), ...(l.tips ?? [])].join(" ");
    return `| ${l.name} | ${products} | ${l.bureaus.join("/") || "—"} | ${l.pull ?? "—"} | ${reqs || "—"} | ${(l.states ?? []).join(" ") || "all"} | ${extra} |`;
  });
  return `**${label}** — from the 6 Figure Funder course, read ${READ_ON}. Confirm with the lender before relying on a figure.\n\n| Lender | Products | Bureaus | Pull | Minimums | States | Rules & tips |\n|---|---|---|---|---|---|---|\n${rows.join("\n")}`;
}

/** Every entry the knowledge base wants in the Timeline, by title. */
export function fundingKnowledge(projectId: string): KnowledgeEntry[] {
  const ts = nowIso();
  const k = (title: string, content: string): KnowledgeEntry => ({
    id: uid("kn"),
    project_id: projectId,
    kind: "documentation",
    title: PREFIX + title,
    content,
    created_at: ts,
  });

  const entries: KnowledgeEntry[] = [
    k(
      "What this is",
      `The Funding room's knowledge base, built from the owner's 6 Figure Funder member library (226 lessons across 4 courses), read ${READ_ON}. Source of truth: \`src/lib/seed-content/financial-bible/\` — lenders.ts, playbook.ts, lessons.ts, and the lesson-by-lesson notes in notes/. Every figure is the course's and is paraphrased; banks change rules, so confirm before relying on one. Techniques that misrepresent a borrower to a lender were deliberately left out — see "Left out on purpose".`,
    ),
    k("Lenders — banks", lenderTable("bank", "Banks")),
    k("Lenders — card issuers", lenderTable("issuer", "Card issuers")),
    k("Lenders — credit unions", lenderTable("credit-union", "Credit unions")),
    k("Lenders — fintech lines", lenderTable("fintech", "Fintech / revenue-based")),
    k("Lenders — alternative & personal-loan lenders", lenderTable("alt-lender", "Alternative and personal-loan lenders")),
  ];

  for (const c of CHEAT_SHEETS) {
    entries.push(k(`Cheat sheet: ${c.title}`, `${c.use}\n\n${c.rows.map((r) => `- **${r.k}** — ${r.v}`).join("\n")}\n\nSource: ${c.src.join(", ")}`));
  }

  const areas: Record<string, string> = { credit: "Credit secrets", bank: "Banking plays", biz: "Business hacks", sales: "Getting clients", ops: "Operations" };
  for (const [area, label] of Object.entries(areas)) {
    const tips = TIPS.filter((t) => t.area === area);
    entries.push(k(label, tips.map((t) => `- **${t.title}** — ${t.body} _(${t.src.join(", ")})_`).join("\n")));
  }

  entries.push(k("Mistakes to avoid", MISTAKES.map((m) => `- **${m.title}** — ${m.cost} **Instead:** ${m.fix}`).join("\n")));
  for (const s of SEQUENCES) {
    entries.push(k(`Sequence: ${s.title}`, `For: ${s.fits}\n\n${s.steps.map((x, i) => `${i + 1}. **${x.title}** — ${x.detail}`).join("\n")}`));
  }
  for (const s of SCRIPTS) entries.push(k(`Script: ${s.title}`, `${s.use}\n\n${s.lines.map((l) => `- ${l}`).join("\n")}`));
  entries.push(k("Left out on purpose", LEFT_OUT.map((x) => `- **${x.what}** ${x.why}`).join("\n")));

  const videoOnly = LESSONS.filter((l) => !l.written);
  entries.push(
    k(
      "Video-only lessons (watch these)",
      `${videoOnly.length} of ${LESSONS.length} lessons had no written notes, so their content is only in the video:\n\n${videoOnly
        .map((l) => `- ${l.course.toUpperCase()} L${l.n} — ${l.title} (${l.module})`)
        .join("\n")}`,
    ),
  );
  return entries;
}

/**
 * Tops up the Financial Bible project with any knowledge-base entry it lacks.
 * Returns true when something was added.
 */
export function topUpFundingKnowledge(projects: Project[]): boolean {
  let changed = false;
  for (const p of projects) {
    if (p.catalog_slug !== FINANCIAL_BIBLE_SLUG) continue;
    const have = new Set(p.knowledge.map((e) => e.title));
    const missing = fundingKnowledge(p.id).filter((e) => !have.has(e.title));
    if (!missing.length) continue;
    p.knowledge = [...p.knowledge, ...missing];
    p.updated_at = nowIso();
    changed = true;
  }
  return changed;
}
