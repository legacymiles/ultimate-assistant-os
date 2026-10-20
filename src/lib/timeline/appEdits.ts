// ---------------------------------------------------------------------------
// Projects Timeline › App edits and Folders.
//
// Every change shipped to an app is recorded in feature-log.json (written by
// scripts/timeline-log.mjs from git, after every commit). This file lays that
// log over whatever projects the timeline has saved:
//
//   - an app with a saved project gets its edits attached (newest first),
//   - an app with no saved project still shows up, as a "virtual" project
//     built from the hub catalog, so the timeline is never empty — that is
//     what went wrong before: the cloud copy had no projects and nothing
//     ever wrote app edits into it.
//
// The log is read-only data. Nothing here writes to the database, so the
// owner's own titles, notes and features are never touched.
//
// Folders are special pages in the timeline sidebar that hold a design
// system rather than a project — today "Game Play Design Styling".
// ---------------------------------------------------------------------------

import LOG from "./feature-log.json";
import { PROJECTS, type CatalogProject } from "../catalog";
import type { AppEditEntry, Project } from "../types";

export const APP_EDITS = LOG as AppEditEntry[];

/** Apps that left the hub catalog (now inside Jarvis, or retired) but still have a history. */
export const EXTRA_APPS: { slug: string; title: string; tag: string }[] = [
  { slug: "dashboard", title: "Dashboard (Recall)", tag: "Notes, lists, links and the photo inbox" },
  { slug: "skills-library", title: "Skills Library", tag: "Every skill, its nicknames and categories" },
  { slug: "cookbook-genie", title: "Cookbook Genie", tag: "Recipes from one sentence" },
  { slug: "multi-order-calculator", title: "Multi-Order Calculator", tag: "Price out many orders at once" },
  { slug: "slippery-escape", title: "Slippery Escape", tag: "A sliding escape game" },
  { slug: "voice-studio", title: "Voice Studio", tag: "Voice clips and text to speech" },
  { slug: "soundprint", title: "Soundprint", tag: "What a song is made of" },
];

export interface TimelineFolder {
  id: string;
  name: string;
  blurb: string;
  /** The app slugs whose look this folder controls. */
  apps: string[];
}

export const GAME_STYLING_FOLDER: TimelineFolder = {
  id: "folder:game-play-design-styling",
  name: "Game Play Design Styling",
  blurb: "Cinematic moments, suit attacks and holiday themes for the card table",
  apps: ["cook-connect"],
};

export const FOLDERS: TimelineFolder[] = [GAME_STYLING_FOLDER];

export const isFolderId = (id: string | null | undefined): boolean => !!id && id.startsWith("folder:");
export const isVirtualId = (id: string | null | undefined): boolean => !!id && id.startsWith("catalog:");

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Edits grouped by app, newest first. */
export function editsBySlug(edits: AppEditEntry[]): Map<string, AppEditEntry[]> {
  const out = new Map<string, AppEditEntry[]>();
  for (const e of edits) {
    const list = out.get(e.slug) ?? [];
    list.push(e);
    out.set(e.slug, list);
  }
  for (const list of out.values()) list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

const asIso = (date: string) => `${date}T12:00:00.000Z`;

/** Attach edits to saved projects and add a project for every app that has none. */
export function overlayAppEdits(
  projects: Project[],
  edits: AppEditEntry[] = APP_EDITS,
  catalog: Pick<CatalogProject, "slug" | "title" | "tag" | "overview">[] = PROJECTS,
): Project[] {
  const bySlug = editsBySlug(edits);
  const apps = [
    ...catalog.map((c) => ({ slug: c.slug, title: c.title, tag: c.tag ?? "", overview: c.overview })),
    ...EXTRA_APPS.filter((x) => !catalog.some((c) => c.slug === x.slug)).map((x) => ({ ...x, overview: "" })),
  ];

  const claimed = new Set<string>();
  const slugFor = (p: Project): string | undefined => {
    if (p.catalog_slug) return p.catalog_slug;
    const app = apps.find((a) => norm(a.title) === norm(p.name));
    return app?.slug;
  };

  const out: Project[] = projects.map((p) => {
    const slug = slugFor(p);
    if (!slug || claimed.has(slug)) return p;
    claimed.add(slug);
    const list = bySlug.get(slug) ?? [];
    if (!list.length) return { ...p, catalog_slug: p.catalog_slug ?? slug };
    // A shipped change is the truest "last touched" — saved timestamps can be
    // the moment a project was first seeded, which says nothing about the app.
    // A project edited by hand after it was created still counts, though.
    const edited = +new Date(p.updated_at) - +new Date(p.created_at) > 60_000;
    const latest = asIso(list[0].date);
    const activity = edited && p.updated_at > latest ? p.updated_at : latest;
    return { ...p, catalog_slug: p.catalog_slug ?? slug, edits: list, activity_at: activity };
  });

  for (const app of apps) {
    if (claimed.has(app.slug)) continue;
    const list = bySlug.get(app.slug) ?? [];
    const inCatalog = catalog.some((c) => c.slug === app.slug);
    if (!inCatalog && !list.length) continue;
    const first = list.at(-1)?.date;
    const latest = list[0]?.date;
    out.push({
      id: `catalog:${app.slug}`,
      catalog_slug: app.slug,
      name: app.title,
      one_liner: app.tag,
      overview: app.overview,
      created_at: first ? asIso(first) : "2026-06-25T12:00:00.000Z",
      updated_at: latest ? asIso(latest) : "2026-06-25T12:00:00.000Z",
      features: [],
      versions: [],
      knowledge: [],
      edits: list,
      activity_at: latest ? asIso(latest) : undefined,
      virtual: true,
    });
  }

  return out.sort((a, b) => +new Date(activityOf(b)) - +new Date(activityOf(a)));
}

/** When a project last changed, for ordering and the sidebar's "x days ago". */
export function activityOf(p: Project): string {
  return p.activity_at ?? p.updated_at;
}

/**
 * The most recent app edits across everything, in plain lines — what Jarvis's
 * Improvements engine reads to learn what is being built.
 */
export function recentEditsDigest(edits: AppEditEntry[] = APP_EDITS, limit = 25, titles?: Record<string, string>): string {
  const name = (slug: string) =>
    titles?.[slug]
    ?? PROJECTS.find((p) => p.slug === slug)?.title
    ?? EXTRA_APPS.find((x) => x.slug === slug)?.title
    ?? slug;
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const e of [...edits].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))) {
    // One line per change, even when it touched several apps.
    const key = `${e.date}:${e.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${e.date} · ${name(e.slug)}: ${e.title}`);
    if (lines.length >= limit) break;
  }
  return lines.join("\n");
}
