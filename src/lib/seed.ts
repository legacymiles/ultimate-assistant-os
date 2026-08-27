import { PROJECTS, type CatalogProject } from "./catalog";
import type { Project } from "./types";
import { nowIso, uid } from "./utils";
import {
  amheDetailed,
  amheFeatures,
  amheKnowledge,
  amheVersions,
} from "./seed-content/amhe";

// ---------------------------------------------------------------------------
// Projects Timeline auto-population.
//
// Every project in the hub catalog (src/lib/catalog.ts) is automatically
// surfaced as a Project in the Projects Timeline app. New catalog entries
// added in future deploys are merged in without overwriting existing user
// edits — see LocalRepo for the merge logic.
// ---------------------------------------------------------------------------

export function catalogToProject(c: CatalogProject): Project {
  const ts = nowIso();
  const projectId = uid("proj");

  const base: Project = {
    id: projectId,
    catalog_slug: c.slug,
    name: c.title,
    one_liner: c.tag ?? "",
    overview: c.overview,
    created_at: ts,
    updated_at: ts,
    features: [],
    versions: [],
    knowledge: [],
  };

  // Rich seed enrichment for specific projects
  if (c.slug === "amhe") {
    base.detailed = amheDetailed();
    base.features = amheFeatures(projectId);
    const versions = amheVersions(projectId);
    for (const v of versions) {
      for (const f of v.files) f.version_id = v.id;
    }
    base.versions = versions;
    base.knowledge = amheKnowledge(projectId);
  }

  return base;
}

/** Initial set of Timeline projects derived from the hub catalog. */
export function seedProjects(): Project[] {
  return PROJECTS.map(catalogToProject);
}

/** Slugs of all currently shipped catalog projects. */
export function catalogSlugs(): string[] {
  return PROJECTS.map((p) => p.slug);
}
