// ---------------------------------------------------------------------------
// Where a lane's facts come from.
//
// The owner's line when they asked for this: "I have all of the information
// about my apps in an app already stored, so it should be extremely easy."
// That app is Projects Timeline — every hub app already has an overview, a long
// write-up and a curated, grouped feature list in it, kept by hand. This module
// is the part that cashes that in: a rebuild lane is handed the real feature
// list rather than a model's guess at what the app does.
//
// Four targets, four sources, one shape (`TargetFacts`) so `buildBrief` never
// learns where anything came from.
// ---------------------------------------------------------------------------

import { PROJECTS } from "@/lib/catalog";
import { getRepo } from "@/lib/repo";
import type { Project } from "@/lib/types";

import type { BriefFeature, Target, TargetFacts } from "./brief";

/**
 * Slugs whose code does not live in a folder of the same name.
 *
 * Straight out of the repo's own CLAUDE.md table. A lane told to rebuild
 * "dashboard" and left to find its own way spends its first several minutes
 * grepping, and sometimes edits the wrong app — `std-safe` is called Tap Safe
 * on screen and `stdsafe` on disk, and nothing in the slug says so.
 */
const FOLDER_OVERRIDES: Record<string, string[]> = {
  dashboard: ["src/components/recall", "src/lib/dashboard"],
  "prompt-architect": ["src/components/blueprint", "src/lib/blueprint"],
  "tiktok-dances": ["src/components/dances", "src/lib/dances", "src/components/dance-studio"],
  "fire-reveal": ["src/components/reveal", "src/lib/reveal"],
  "3d-studio": ["src/components/studio3d", "src/lib/studio3d"],
  "cookbook-genie": ["src/components/cookbook", "src/lib/cookbook"],
  "gods-eye-view": ["src/components/gods-eye", "src/lib/gods-eye"],
  "kart-showcase": ["src/components/kart", "src/lib/kart"],
  "multi-order-calculator": ["src/components/calculator", "src/lib/calculator"],
  "std-safe": ["src/components/stdsafe", "src/lib/stdsafe"],
  "ea-feature-list": ["src/components/ea", "src/lib/ea-features"],
  "website-redesigner": ["src/components/redesigner", "src/lib/redesigner"],
  "seedance-studio": ["src/components/seedance", "src/lib/seedance"],
  "smart-shot-videos": ["src/components/smart-shot", "src/lib/smart-shot"],
  "video-studio-arena": ["src/components/video-studio", "src/lib/video-studio"],
  "skills-library": ["src/components/skills", "src/lib/skills"],
  "slippery-escape": ["src/components/slippery", "src/lib/slippery"],
  "projects-timeline": ["src/components/AppShell.tsx", "src/lib/repo"],
};

/** The folders a slug's code actually lives in. */
export function foldersFor(slug: string): string[] {
  return FOLDER_OVERRIDES[slug] ?? [`src/components/${slug}`, `src/lib/${slug}`];
}

/** Every app the bake-off can be pointed at, newest-catalog-order first. */
export function pickableApps(): Array<{ slug: string; title: string; tagline: string }> {
  return PROJECTS.filter((p) => p.appUrl).map((p) => ({
    slug: p.slug,
    title: p.title,
    tagline: p.tag ?? "",
  }));
}

function toBriefFeatures(project: Project | undefined): BriefFeature[] {
  if (!project?.features?.length) return [];
  return project.features.map((f) => ({
    title: f.title,
    description: f.description ?? "",
    group: f.group === "supporting" ? "supporting" : "core",
  }));
}

/**
 * Facts for one of the owner's own apps.
 *
 * Projects Timeline is the richer source and the catalog is the reliable one,
 * so the catalog supplies the identity (title, tagline, route) and Projects
 * Timeline supplies the depth (the long write-up and the feature list). When
 * Projects Timeline has nothing — a fresh browser, no Supabase — the brief is
 * thinner but still correct, which is the behaviour the repo asks for: degrade
 * visibly, never fail.
 */
export async function factsForApp(slug: string): Promise<TargetFacts> {
  const entry = PROJECTS.find((p) => p.slug === slug);
  let stored: Project | undefined;
  try {
    const projects = await getRepo().getProjects();
    stored = projects.find((p) => p.catalog_slug === slug || p.name === entry?.title);
  } catch {
    // Reading the owner's own notes is a bonus, not a precondition.
    stored = undefined;
  }

  return {
    name: entry?.title ?? stored?.name ?? slug,
    tagline: entry?.tag ?? stored?.one_liner ?? "",
    overview: (stored?.detailed || stored?.overview || entry?.overview || "").trim(),
    features: toBriefFeatures(stored),
    route: entry?.appUrl ?? `/apps/${slug}`,
    folders: foldersFor(slug),
  };
}

/** Facts for an idea that does not exist yet. */
export function factsForIdea(idea: string): TargetFacts {
  const name = titleFromIdea(idea);
  return {
    name,
    tagline: "",
    overview: "",
    features: [],
    route: `/apps/${slugify(name)}`,
    folders: [`src/components/${slugify(name)}`, `src/lib/${slugify(name)}`],
  };
}

/** Facts for a page that already exists inside the hub. */
export function factsForHubPage(route: string): TargetFacts {
  const slug = route.replace(/^\/apps\//, "").replace(/\/$/, "");
  const entry = PROJECTS.find((p) => p.slug === slug);
  return {
    name: entry?.title ?? slug,
    tagline: entry?.tag ?? "",
    overview: entry?.overview ?? "",
    features: [],
    route,
    folders: foldersFor(slug),
  };
}

export interface ScrapeResult {
  title: string;
  summary: string;
  navItems: string[];
  ctas: string[];
  features: BriefFeature[];
}

/**
 * Facts for somebody else's site.
 *
 * The scrape runs on the server (V1's engine already does it); this only shapes
 * the answer. A scrape that fails is not fatal — the lane still gets the URL and
 * whatever the owner typed, which is enough to build from.
 */
export function factsForUrl(url: string, scrape?: ScrapeResult): TargetFacts {
  let host = url;
  try {
    host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    // A URL the browser cannot parse is still a usable label.
  }
  return {
    name: scrape?.title?.trim() || host,
    tagline: "",
    overview: "",
    features: scrape?.features ?? [],
    route: `/apps/${slugify(host)}`,
    folders: [],
    scraped: scrape
      ? {
          title: scrape.title,
          summary: scrape.summary,
          navItems: scrape.navItems,
          ctas: scrape.ctas,
        }
      : undefined,
  };
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "app"
  );
}

/**
 * A name for an idea nobody has named.
 *
 * Deliberately dumb: the first few meaningful words, title-cased. A model could
 * invent something better, but naming the app is a design decision and this
 * module's whole job is to not make those — the lane's design skill can rename
 * it, and the owner can rename it before the run.
 */
export function titleFromIdea(idea: string): string {
  const stop = new Set([
    "a", "an", "the", "that", "which", "for", "with", "and", "or", "of", "to", "in", "on",
    "app", "tool", "site", "website", "page", "build", "make", "me",
  ]);
  const words = idea
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !stop.has(w))
    .slice(0, 3);
  if (!words.length) return "Untitled app";
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/** Resolve whatever the owner picked into the one shape the brief understands. */
export async function factsFor(target: Target, scrape?: ScrapeResult): Promise<TargetFacts> {
  switch (target.kind) {
    case "my-app":
      return factsForApp(target.slug);
    case "new":
      return factsForIdea(target.idea);
    case "url":
      return factsForUrl(target.url, scrape);
    case "hub-page":
      return factsForHubPage(target.route);
  }
}
