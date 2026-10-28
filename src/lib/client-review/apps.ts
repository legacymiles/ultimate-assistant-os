// ---------------------------------------------------------------------------
// Client Review × the owner's own apps.
//
// The owner edits their hub apps the same way a client edits a website: pick
// the app in the Client view's site picker, look at it, point at a spot, type
// what to change, Send & build. Each app gets one Client Review project the
// first time it is opened (made here, pure), framed same-origin at its route,
// with the hub repo as "where the site lives" so approved edits build
// themselves through App Builder → In Queue → Claude Code.
// ---------------------------------------------------------------------------

import { PROJECTS, type CatalogProject } from "@/lib/catalog";
import { isMerged } from "@/lib/studio/plugins";
import { createProject, ReviewError } from "./logic";
import type { ClientProject, ReviewIndex } from "./types";

/** Where the hub's code lives and deploys. */
export const HUB_REPO = "legacymiles/ultimate-assistant-os";
export const HUB_VERCEL_PROJECT = "ultimate-assistant-os";
export const HUB_ORIGIN = "https://ultimate-assistant-os.vercel.app";

export interface EditableApp {
  slug: string;
  title: string;
  category: CatalogProject["category"];
  /** "/apps/<slug>" */
  path: string;
}

/** Client Review can't usefully frame itself. */
const NOT_EDITABLE_HERE = new Set(["client-review"]);

/**
 * Every app the owner can open in the Client view, A→Z. Apps merged into a
 * studio home are left out — their home is listed, and their old routes only
 * redirect into it.
 */
export function editableApps(projects: CatalogProject[] = PROJECTS): EditableApp[] {
  return projects
    .filter((p) => p.status === "live" && p.appUrl?.startsWith("/apps/") && !NOT_EDITABLE_HERE.has(p.slug) && !isMerged(p.slug))
    .map((p) => ({ slug: p.slug, title: p.title, category: p.category, path: p.appUrl! }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function editableApp(slug: unknown, projects: CatalogProject[] = PROJECTS): EditableApp | null {
  if (typeof slug !== "string") return null;
  return editableApps(projects).find((a) => a.slug === slug) ?? null;
}

/** The project already made for this app, if any. */
export function appEntry(index: ReviewIndex, slug: string): ReviewIndex["projects"][number] | null {
  return index.projects.find((p) => p.appSlug === slug && !p.archived) ?? index.projects.find((p) => p.appSlug === slug) ?? null;
}

/**
 * A new Client Review project for one of the owner's apps. v1 frames the app's
 * own route (relative, so it works on the live site, a preview and localhost
 * alike); the hub repo is set so Send & build goes straight to Claude Code.
 */
export function appProject(slug: unknown, now = new Date().toISOString(), projects: CatalogProject[] = PROJECTS): ClientProject {
  const app = editableApp(slug, projects);
  if (!app) throw new ReviewError("That app isn't one Client Review can open.", 404);
  const p = createProject(
    {
      name: app.title,
      clientName: "",
      summary: "The live app.",
      repo: HUB_REPO,
      vercelProject: HUB_VERCEL_PROJECT,
    },
    now,
  );
  p.appSlug = app.slug;
  p.appPath = app.path;
  p.versions[0].siteUrl = app.path;
  p.versions[0].readyAt = now;
  return p;
}

/** An address a person or a headless browser can open: relative app routes get the live hub in front. */
export function absoluteSiteUrl(url: string): string {
  return url.startsWith("/") ? `${HUB_ORIGIN}${url}` : url;
}
