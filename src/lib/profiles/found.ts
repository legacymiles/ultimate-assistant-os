"use client";

// ---------------------------------------------------------------------------
// "Search memory, folders, images, videos for all info on that profile."
//
// Before any brain answers, Profiles looks outside itself: the owner's Jarvis
// memory (Supabase, searched by meaning; the same rows the Memory tab shows)
// and the Dashboard's folders, notes, photos and videos (the Folders and
// Photos tabs). What it finds goes to the brain as FOUND ELSEWHERE, each line
// with an id so an answer can cite it and a new profile can be filled from it.
//
// Best effort and quick: each source has its own short deadline, and nothing
// here ever stops the chat from answering.
// ---------------------------------------------------------------------------

import type { RecallData } from "@/lib/recall/types";
import { readRecall } from "./recallBridge";

export interface Found {
  /** "mem:<id>" or "rec:<id>" */
  id: string;
  source: "Memory" | "Folders" | "Photos";
  title: string;
  text: string;
  /** Where it lives, for the source label: "PHOTOS › LEO". */
  where: string;
  /** A picture, when it is one. */
  src?: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

async function fromMemory(query: string, signal?: AbortSignal): Promise<Found[]> {
  try {
    const res = await fetch("/api/jarvis/memory/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 6 }),
      signal,
    });
    const json = (await res.json().catch(() => ({}))) as { hits?: { id?: string; title?: string; content?: string; source?: string }[] };
    return (json.hits ?? []).slice(0, 6).map((h, i) => ({
      id: `mem:${h.id ?? i}`,
      source: "Memory" as const,
      title: h.title ?? "Memory",
      text: clip((h.content ?? "").replace(/\s+/g, " "), 280),
      where: `MEMORY${h.source ? ` › ${h.source.toUpperCase()}` : ""}`,
    }));
  } catch {
    return [];
  }
}

function pathOf(recall: RecallData, folderId: string | null): string {
  const names: string[] = [];
  let cur = folderId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const f = recall.folders.find((x) => x.id === cur);
    if (!f) break;
    names.unshift(f.name);
    cur = f.parentId;
  }
  return names.join(" › ").toUpperCase();
}

async function fromDashboard(query: string): Promise<Found[]> {
  const recall = await readRecall();
  if (!recall) return [];
  try {
    const { search } = await import("@/lib/recall/search");
    const hits = search(query, recall).items.filter((s) => s.score > 0 && !s.item.tags.includes("profile")).slice(0, 6);
    return hits.map(({ item }) => {
      const where = pathOf(recall, item.folderId) || "INBOX";
      const photo = item.kind === "image" || item.attachment?.category === "video";
      return {
        id: `rec:${item.id}`,
        source: photo ? ("Photos" as const) : ("Folders" as const),
        title: item.title,
        text: clip([item.summary, item.body, item.extract, item.fields ? Object.entries(item.fields).map(([k, v]) => `${k}: ${v}`).join("; ") : ""].filter(Boolean).join(" — ").replace(/\s+/g, " "), 280),
        where,
        src: photo ? item.attachment?.url ?? undefined : undefined,
      };
    });
  } catch {
    return [];
  }
}

/** Everything outside Profiles that matches, from both sources, never slower than ~2.5 s. */
export async function gatherFound(query: string, signal?: AbortSignal): Promise<Found[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const [mem, dash] = await Promise.all([withTimeout(fromMemory(q, signal), 2500, []), withTimeout(fromDashboard(q), 1500, [])]);
  return [...dash, ...mem];
}

/** As it goes into a prompt. */
export function foundBlock(found: Found[]): string {
  if (!found.length) return "";
  return ["FOUND ELSEWHERE (Memory and the Dashboard's Folders/Photos; cite with the ~id)", ...found.map((f) => `~${f.id} [${f.source} · ${f.where}] ${f.title}: ${f.text}`)].join("\n");
}
