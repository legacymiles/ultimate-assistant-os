import { PROJECTS, type CatalogProject } from "./catalog";
import type { Project } from "./types";
import { nowIso, uid } from "./utils";
import {
  amheDetailed,
  amheFeatures,
  amheKnowledge,
  amheVersions,
} from "./seed-content/amhe";
import {
  recallDetailed,
  recallFeatures,
  recallKnowledge,
  recallVersions,
} from "./seed-content/recall";

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

  applyEnrichment(base);
  return base;
}

/**
 * Rich, hand-written content for projects that have it.
 * Kept separate from catalogToProject so it can also be applied later, as a
 * backfill onto projects that were seeded before the content was written.
 */
export function applyEnrichment(base: Project): boolean {
  const projectId = base.id;

  if (base.catalog_slug === "amhe") {
    base.detailed = amheDetailed();
    base.features = amheFeatures(projectId);
    const versions = amheVersions(projectId);
    for (const v of versions) {
      for (const f of v.files) f.version_id = v.id;
    }
    base.versions = versions;
    base.knowledge = amheKnowledge(projectId);
    return true;
  }

  // Both slugs: the app is now "dashboard", but timeline rows written before
  // the rename still carry "recall" and would otherwise lose their content.
  if (base.catalog_slug === "dashboard" || base.catalog_slug === "recall") {
    base.detailed = recallDetailed();
    base.features = recallFeatures(projectId);
    base.versions = recallVersions(projectId);
    base.knowledge = recallKnowledge(projectId);
    return true;
  }

  return false;
}

/** True when a project still looks exactly as the catalog seeded it. */
export function isPristine(p: Project): boolean {
  return (
    !p.detailed?.trim() &&
    p.features.length === 0 &&
    p.versions.length === 0 &&
    p.knowledge.length === 0
  );
}

/**
 * Backfill rich content onto catalog projects the user has never touched.
 * Only ever fills a project that is completely empty, so a project someone has
 * written into is never overwritten.
 */
export function backfillEnrichment(projects: Project[]): boolean {
  let changed = false;
  for (const p of projects) {
    if (!p.catalog_slug || !isPristine(p)) continue;
    const c = PROJECTS.find((x) => x.slug === p.catalog_slug);
    if (applyEnrichment(p)) {
      // The stored overview is the older catalog copy; refresh it too, since a
      // pristine project has no user edits to protect.
      if (c) p.overview = c.overview;
      p.updated_at = nowIso();
      changed = true;
    }
  }
  return changed;
}

/** Initial set of Timeline projects derived from the hub catalog. */
export function seedProjects(): Project[] {
  return PROJECTS.map(catalogToProject);
}

/** Slugs of all currently shipped catalog projects. */
export function catalogSlugs(): string[] {
  return PROJECTS.map((p) => p.slug);
}
