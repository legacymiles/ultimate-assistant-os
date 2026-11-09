// ---------------------------------------------------------------------------
// AI Rankings — carrying records from the old private board to the public one.
//
// The old board lived in the owner's browser (localStorage + app_state sync),
// filed as group › category with free-text categories. Only its AI records
// have a home on the public leaderboard; everything else (editors, password
// managers, trading terminals) stays where it was and is counted, not lost.
// ---------------------------------------------------------------------------

import { categoryFromLabel } from "./leaderboard";
import type { Model } from "./leaderboard";
import type { Tool } from "./types";

/** The old seed tree's AI categories, mapped to the new ids. */
const OLD_AI: Record<string, string> = {
  llm: "llm",
  image: "image",
  video: "text-to-video",
  music: "music",
  voice: "tts",
  "agent coding": "coding-agents",
  "3d": "3d",
  tools: "platforms",
};

export function categoryForOld(tool: Pick<Tool, "group" | "category">): string | null {
  if (tool.group !== "AI") return null;
  const key = tool.category.trim().toLowerCase();
  return OLD_AI[key] ?? categoryFromLabel(tool.category);
}

function hfIdFrom(url: string): string | undefined {
  const m = /huggingface\.co\/([\w.-]+\/[\w.-]+)/i.exec(url);
  return m && !/^(spaces|datasets|docs|blog)\//i.test(m[1]) ? m[1] : undefined;
}

/**
 * The old rank was a hand-placed position (1 = best); the nearest honest
 * reading is a rating that falls a point per place, floored at 5.
 */
function ratingFromRank(rank?: number): number | undefined {
  return rank === undefined ? undefined : Math.max(5, 10 - (rank - 1));
}

export function fromOldBoard(tools: Tool[]): { models: Partial<Model>[]; skipped: number } {
  const models: Partial<Model>[] = [];
  let skipped = 0;
  for (const t of tools) {
    const category = categoryForOld(t);
    if (!category || !t.url) {
      skipped += 1;
      continue;
    }
    const loved = t.features.filter((f) => f.verdict === "love" || f.verdict === "good").map((f) => f.text);
    models.push({
      name: t.name,
      maker: "",
      category,
      url: t.url,
      hfId: hfIdFrom(t.url),
      summary: t.summary,
      // The old board never knew release dates; when it was added is the best
      // lower bound there is, and the owner can correct it in the sheet.
      releasedAt: t.addedAt.slice(0, 10),
      openSource: t.openSource,
      runsLocally: t.hosting !== "hosted",
      access: t.access,
      features: loved.length ? loved : t.features.map((f) => f.text),
      tags: t.tags,
      myRating: ratingFromRank(t.rank),
      note: t.notes,
      contentRating: t.contentRating,
    });
  }
  return { models, skipped };
}
