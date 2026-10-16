// "File into Projects Timeline" — works on either Timeline backend.
//
// Local mode already tops itself up on every load (src/lib/repo/local.ts). In
// Supabase mode projects aren't seeded from the catalog, so this finds (or
// creates) the Financial Bible project and adds whichever knowledge-base
// entries it doesn't have yet. Additive only.

import { getRepo } from "@/lib/repo";
import { FINANCIAL_BIBLE_SLUG, fundingKnowledge } from "@/lib/seed-content/financial-bible/timeline";

export interface FileResult {
  added: number;
  total: number;
  projectName: string;
}

export async function fileFundingIntoTimeline(): Promise<FileResult> {
  const repo = getRepo();
  const projects = await repo.getProjects();
  let project =
    projects.find((p) => p.catalog_slug === FINANCIAL_BIBLE_SLUG) ??
    projects.find((p) => p.name.trim().toLowerCase() === "financial bible");

  if (!project) {
    project = await repo.createProject({
      name: "Financial Bible",
      one_liner: "The book of money plays",
      overview: "Build plans, funding playbook and lender knowledge base.",
    });
  }

  const have = new Set(project.knowledge.map((e) => e.title));
  const wanted = fundingKnowledge(project.id);
  const missing = wanted.filter((e) => !have.has(e.title));
  for (const e of missing) {
    await repo.addKnowledge(project.id, { kind: e.kind, title: e.title, content: e.content });
  }
  return { added: missing.length, total: wanted.length, projectName: project.name };
}
