"use client";

// ---------------------------------------------------------------------------
// A Dashboard folder called "AI Rankings" → the AI Rankings app, one entry at
// a time, only when the owner presses Sync.
//
// The folder is a scratchpad: plenty of what lands in it is never meant for
// the board. So nothing here runs by itself. Each saved entry carries a Sync
// button; pressing it files that one entry, auto-categorised from its NAME
// (plus its link and summary when it has them) by the same classifier the
// app's own "Suggest" button uses, so a synced record lands in the section a
// hand-filed one would.
//
// "Already on the board" is derived — a name or link match against the app's
// records — never stored on the Dashboard item. Storing a record id there would
// go stale the moment the record is renamed or deleted in the app; a match
// can't.
// ---------------------------------------------------------------------------

import { closestPlace } from "@/lib/dashboard/places";
import type { Folder, Item } from "@/lib/recall/types";
import { heuristicSuggestion, type Suggestion } from "./classify";
import { featureIndex } from "./query";
import { addTool, getData } from "./store";
import type { Tool } from "./types";

/** "AI Rankings", "ai ranking", "AI-Rankings" — however the folder was typed. */
export function isRankingsName(name: string): boolean {
  return /^ai\s*[-_]?\s*rankings?$/i.test(name.trim());
}

/** True for the AI Rankings folder and every folder nested inside it. */
export function inRankingsFolder(folders: Folder[], folderId: string | null): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let cur = folderId ? byId.get(folderId) : undefined;
  for (let guard = 0; cur && guard < 20; guard += 1) {
    if (isRankingsName(cur.name)) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A URL reduced to host + path, so http/https, www and a trailing slash don't matter. */
function normUrl(raw: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return "";
  }
}

/** The link a saved entry points at, whichever section it was saved in. */
export function itemUrl(item: Item): string {
  return (item.url || item.fields?.url || "").trim();
}

/** The name the board should carry. A bare-link title is its domain, which is fine. */
export function itemName(item: Item): string {
  return item.title.trim();
}

/** The board record for a name/link, if any — by link first, then by name. */
export function matchTool(nameRaw: string, urlRaw: string, tools: Tool[]): Tool | undefined {
  const url = normUrl(urlRaw);
  if (url) {
    const byUrl = tools.find((t) => t.url && normUrl(t.url) === url);
    if (byUrl) return byUrl;
  }
  const name = normName(nameRaw);
  return name ? tools.find((t) => normName(t.name) === name) : undefined;
}

/** The record this entry already became, if any. */
export function findOnBoard(item: Item, tools: Tool[]): Tool | undefined {
  return matchTool(itemName(item), itemUrl(item), tools);
}

/** What the entry says about itself, minus the URL that is often all a link's summary is. */
function itemSummary(item: Item): string {
  const s = (item.summary || item.body || item.fields?.notes || "").trim();
  return s === itemUrl(item) ? "" : s.slice(0, 600);
}

/**
 * File one entry on the board. Returns the new record and where it went.
 * Never throws for a missing key: the classifier route answers with its
 * keyword heuristic, and if the route itself is unreachable the same heuristic
 * runs here.
 */
export async function syncToRankings(item: Item): Promise<{ tool: Tool; suggestion: Suggestion }> {
  return fileOnBoard(
    { name: itemName(item), url: itemUrl(item), summary: itemSummary(item) },
    "Synced from the AI Rankings folder in Jarvis.",
  );
}

/** The shared filing step — also used by the Tools tab's "Add to AI Rankings". */
export async function fileOnBoard(
  entry: { name: string; url: string; summary: string },
  note: string,
): Promise<{ tool: Tool; suggestion: Suggestion }> {
  const board = getData();
  const existing = matchTool(entry.name, entry.url, board.tools);
  if (existing) return { tool: existing, suggestion: toSuggestion(existing) };

  const { name, url, summary } = entry;

  let suggestion: Suggestion;
  try {
    const res = await fetch("/api/ai-rankings/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        url: url || undefined,
        summary: summary || undefined,
        tree: board.tree,
        knownFeatures: featureIndex(board.tools).map((f) => f.label),
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    suggestion = (await res.json()) as Suggestion;
  } catch {
    suggestion = heuristicSuggestion({ name, url, summary });
  }

  // Same safety net the photo destination uses: a near-miss spelling files
  // into the existing section instead of growing a twin ("Image" / "Images").
  const group = closestPlace(suggestion.group, Object.keys(board.tree)) ?? suggestion.group;
  const category = closestPlace(suggestion.category, board.tree[group] ?? []) ?? suggestion.category;

  const { data, id } = addTool({
    name,
    url,
    summary: suggestion.summary || summary,
    group,
    category,
    tags: suggestion.tags ?? [],
    access: suggestion.access,
    openSource: suggestion.openSource,
    hosting: suggestion.hosting,
    apiKey: suggestion.apiKey,
    haveKey: false,
    pricingNote: suggestion.pricingNote,
    contentRating: suggestion.contentRating,
    // Where it came from, so the record explains itself in the app.
    notes: note,
    // Suggested features are offered one by one inside the app, never written
    // behind the owner's back — the classifier's own rule.
    features: [],
  });
  return { tool: data.tools.find((t) => t.id === id)!, suggestion: { ...suggestion, group, category } };
}

function toSuggestion(t: Tool): Suggestion {
  return {
    group: t.group,
    category: t.category,
    summary: t.summary,
    tags: t.tags,
    access: t.access,
    openSource: t.openSource,
    hosting: t.hosting,
    apiKey: t.apiKey,
    pricingNote: t.pricingNote,
    contentRating: t.contentRating ?? "unknown",
    features: [],
    source: "heuristic",
  };
}
