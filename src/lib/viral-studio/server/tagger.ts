// ---------------------------------------------------------------------------
// Auto-tags for Viral Studio clips: mood and the tab's categories, read from
// the title, caption, poster and song. One AI call tags a whole batch; with no
// AI key (or a failed call) the keyword guess in filters.ts stands in, so the
// filters always have something to work with.
// ---------------------------------------------------------------------------

import "server-only";

import { aiConfigured, aiFetch, DEFAULT_MODEL } from "@/lib/ai/provider";

import { CATEGORIES, MOODS, coerceTags, guessTags } from "../filters";
import type { ClipTags, TabId } from "../types";

export interface TagInput {
  id: string;
  tab: TabId;
  title: string;
  author?: string;
  caption?: string;
  song?: string;
  isSong?: boolean;
}

function textOf(i: TagInput): string {
  return [i.title, i.caption, i.author, i.song].filter(Boolean).join(" · ").slice(0, 400);
}

export async function tagClips(items: TagInput[]): Promise<Record<string, ClipTags>> {
  const out: Record<string, ClipTags> = {};
  for (const i of items) out[i.id] = guessTags(textOf(i), i.tab, i.isSong);
  if (!items.length || !aiConfigured()) return out;

  const lists = (["audio", "fights", "dances", "motion"] as TabId[])
    .filter((t) => items.some((i) => i.tab === t))
    .map((t) => `${t}: ${CATEGORIES[t].join(", ")}`)
    .join("\n");
  const prompt =
    `Tag these short social-media clips for a library's filters.\n` +
    `Moods (pick 1–2): ${MOODS.join(", ")}\n` +
    `Categories by tab (pick 1–3 from that clip's tab only):\n${lists}\n` +
    `For audio clips: "Song" when it's a released song; "Funny sound" or "Voiceover" when it's someone talking or a skit.\n` +
    `Return JSON {"tags": {"<id>": {"moods": [...], "categories": [...]}}}.\n\n` +
    items.map((i) => `${i.id} [${i.tab}]${i.isSong ? " [song]" : ""}: ${textOf(i) || "(no text)"}`).join("\n");

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You tag video clips. Use only the labels offered. JSON only." },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return out;
    const json = await res.json();
    const parsed = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}");
    const tags = parsed?.tags ?? {};
    for (const i of items) {
      const t = coerceTags(tags[i.id], i.tab);
      // A model that tagged nothing loses to the keyword guess.
      if (t.moods.length || t.categories.length) {
        out[i.id] = {
          moods: t.moods.length ? t.moods : out[i.id].moods,
          categories: t.categories.length ? t.categories : out[i.id].categories,
        };
      }
    }
  } catch {
    // The keyword guess already stands.
  }
  return out;
}
