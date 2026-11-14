// ---------------------------------------------------------------------------
// Website Studio — My Websites.
//
// One library, three sources, nothing copied:
//   - every Client Review project (the client sites and the hub apps that have
//     been opened), read where it already lives, ids and link secrets untouched;
//   - App Builder projects that have not produced a site yet (drafts);
//   - hub apps nobody has opened yet, which get a project the first time.
//
// A build that opened a review project is shown ONCE, as that website — the
// draft it came from is folded into it rather than listed beside it.
//
// Pure: no React, no fetch, no storage.
// ---------------------------------------------------------------------------

import type { BuilderProject } from "@/lib/app-builder/types";
import type { EditableApp } from "@/lib/client-review/apps";
import { projectState, STATE_LABEL, type ProjectState } from "@/lib/client-review/list";
import { currentVersion } from "@/lib/client-review/logic";
import type { ClientProject } from "@/lib/client-review/types";

export type CardKind = "site" | "app" | "draft";
export type CardState = ProjectState | "draft" | "not-opened";

/** How a card is opened in the workspace. Exactly one field is set. */
export type CardOpen = { site: string } | { app: string } | { draft: string };

export interface SiteCard {
  /** Stable across reloads: the review project id, `app:<slug>` or `draft:<id>`. */
  key: string;
  kind: CardKind;
  title: string;
  /** The client's name, or "" for the owner's own. */
  client: string;
  /** The address on screen for the current version, or "". */
  url: string;
  /** What the card prints under the title: a host, or an app path. */
  host: string;
  updatedAt: string;
  state: CardState;
  stateLabel: string;
  /** A screenshot or mockup of the site (data URL), when one exists. */
  thumb: string;
  /** Edit requests waiting on the owner. */
  pending: number;
  /** "v3" — the version on screen. */
  version: string;
  open: CardOpen;
}

export const CARD_STATE_LABEL: Record<CardState, string> = {
  ...STATE_LABEL,
  draft: "Draft",
  "not-opened": "Not opened yet",
};

/** A host for an absolute address, the path for a relative one, "" for none. */
export function hostOf(url: string): string {
  if (!url) return "";
  if (url.startsWith("/")) return url;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The best picture there is of a site: its newest screenshot, else a shared mockup. */
export function thumbOf(p: ClientProject): string {
  for (let i = p.versions.length - 1; i >= 0; i--) {
    const v = p.versions[i];
    if (v.image) return v.image;
  }
  return p.mockups?.lanes.find((l) => l.image)?.image ?? "";
}

function siteCard(p: ClientProject): SiteCard {
  const cur = currentVersion(p);
  const url = cur?.siteUrl ?? "";
  const state = projectState(p);
  return {
    key: p.id,
    kind: p.appSlug ? "app" : "site",
    title: p.name,
    client: p.clientName || "",
    url,
    host: hostOf(url),
    updatedAt: p.updatedAt,
    state,
    stateLabel: CARD_STATE_LABEL[state],
    thumb: thumbOf(p),
    pending: p.batches.filter((b) => b.status === "pending").length,
    version: cur?.number ?? p.versions[p.versions.length - 1]?.number ?? "",
    open: { site: p.token },
  };
}

function draftCard(b: BuilderProject): SiteCard {
  const name = b.understanding?.name?.trim() || firstWords(b.idea) || "Untitled";
  return {
    key: `draft:${b.id}`,
    kind: "draft",
    title: name,
    client: b.edit?.clientName ?? "",
    url: b.redesign?.url ?? b.handoff?.built?.url ?? "",
    host: hostOf(b.redesign?.url ?? b.handoff?.built?.url ?? ""),
    updatedAt: b.updatedAt,
    state: "draft",
    stateLabel: b.redesign ? "Redesign draft" : CARD_STATE_LABEL.draft,
    thumb: b.sources?.find((s) => s.thumb)?.thumb ?? "",
    pending: 0,
    version: "",
    open: { draft: b.id },
  };
}

function appCard(a: EditableApp): SiteCard {
  return {
    key: `app:${a.slug}`,
    kind: "app",
    title: a.title,
    client: "",
    url: a.path,
    host: a.path,
    updatedAt: "",
    state: "not-opened",
    stateLabel: CARD_STATE_LABEL["not-opened"],
    thumb: "",
    pending: 0,
    version: "",
    open: { app: a.slug },
  };
}

function firstWords(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 44 ? `${t.slice(0, 43)}…` : t;
}

export interface LibrarySources {
  /** Every Client Review project the owner can see. */
  projects: ClientProject[];
  /** App Builder's projects, newest first or not — order is irrelevant here. */
  drafts?: BuilderProject[];
  /** Hub apps that can be opened (`editableApps()`). */
  apps?: EditableApp[];
}

/**
 * Every website the owner can open, each exactly once.
 *
 * Archived projects are left out (they are still in the store and still open
 * from their own link). A draft whose build already opened a review project
 * is that project; an edit project belongs to the site it edits. A hub app
 * that already has a project is that project.
 */
export function libraryCards({ projects, drafts = [], apps = [] }: LibrarySources): SiteCard[] {
  const live = projects.filter((p) => !p.archived);
  const ids = new Set(live.map((p) => p.id));
  const slugs = new Set(live.map((p) => p.appSlug).filter(Boolean));
  const cards: SiteCard[] = live.map(siteCard);
  for (const b of drafts) {
    if (b.edit) continue; // an edit to an existing site, not a site of its own
    const review = b.handoff?.review?.id;
    if (review && ids.has(review)) continue; // already listed as that website
    cards.push(draftCard(b));
  }
  for (const a of apps) if (!slugs.has(a.slug)) cards.push(appCard(a));
  return cards;
}

export type LibraryFilter = "all" | "client" | "apps" | "active" | "drafts";

export const LIBRARY_FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "client", label: "Client sites" },
  { id: "apps", label: "My apps" },
  { id: "active", label: "Needs you" },
  { id: "drafts", label: "Drafts" },
];

function matches(c: SiteCard, f: LibraryFilter): boolean {
  switch (f) {
    case "client":
      return c.kind === "site";
    case "apps":
      return c.kind === "app";
    case "active":
      return c.state === "waiting" || c.state === "building" || c.state === "being-created";
    case "drafts":
      return c.kind === "draft";
    default:
      return true;
  }
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** How many cards each filter would show — the numbers on the filter chips. */
export function filterCounts(cards: SiteCard[]): Record<LibraryFilter, number> {
  return Object.fromEntries(LIBRARY_FILTERS.map((f) => [f.id, cards.filter((c) => matches(c, f.id)).length])) as Record<
    LibraryFilter,
    number
  >;
}

/**
 * Filter, search, then order. Search reads the name, the client and the
 * address, so "buildflip", "glow spa" and "vercel.app" all find a site.
 *
 * Order: what is waiting on the owner, then what is building, then most
 * recently changed; things never opened sink to the bottom A–Z so the library
 * leads with real work rather than with forty untouched app tiles.
 */
export function filterCards(cards: SiteCard[], { query = "", filter = "all" as LibraryFilter } = {}): SiteCard[] {
  const q = norm(query);
  const rank = (c: SiteCard) =>
    c.state === "waiting" ? 0 : c.state === "building" || c.state === "being-created" ? 1 : c.state === "not-opened" ? 3 : 2;
  const time = (c: SiteCard) => {
    const t = Date.parse(c.updatedAt);
    return Number.isFinite(t) ? t : 0;
  };
  return cards
    .filter((c) => matches(c, filter))
    .filter((c) => !q || norm(`${c.title} ${c.client} ${c.host}`).includes(q))
    .sort((a, b) => rank(a) - rank(b) || time(b) - time(a) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

/** "just now", "12 min ago", "3 h ago", "yesterday", "9 days ago", then the date. */
export function ago(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The workspace address for a card. One route for every kind of website. */
export function workspaceHref(open: CardOpen, base = "/apps/website-studio"): string {
  if ("site" in open) return `${base}?site=${encodeURIComponent(open.site)}`;
  if ("app" in open) return `${base}?app=${encodeURIComponent(open.app)}`;
  return `${base}?p=${encodeURIComponent(open.draft)}`;
}
