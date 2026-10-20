// ---------------------------------------------------------------------------
// YouTube videos — recommendations, the pure half.
//
// Three tiers, best available wins, and the app works with none of the keys:
//   1. YOUTUBE_API_KEY  → real videos from YouTube search, thumbnails and all.
//   2. an AI key        → the model reads the saved titles and suggests what
//                         to search next, each with a one-line reason.
//   3. nothing          → taste read from the titles here (repeated words and
//                         channels), each pick a YouTube search.
// Everything in this file is shared by the route and its tests.
// ---------------------------------------------------------------------------

export interface TasteItem {
  title?: string;
  author?: string;
  platform: string;
  videoId?: string;
}

export interface Recommendation {
  id: string;
  title: string;
  reason: string;
  url: string;
  /** A real video (tier 1) or a search to run (tiers 2–3). */
  type: "video" | "search";
  videoId?: string;
  thumb?: string;
  channel?: string;
}

export type RecMode = "youtube" | "ai" | "basic" | "empty";

export interface RecResponse {
  mode: RecMode;
  items: Recommendation[];
  /** Plain-English line about where these came from. */
  note: string;
}

const STOP = new Set(
  "a an the and or but of to in on for with at by from is are was were be been it its this that these those my your our their you we i me how what why when who which vs versus feat ft official video videos full new best top episode ep part pt live short shorts tiktok reel reels hd 4k 1080p music lyrics lyric audio remix ever get got make made do does did not no yes so just can will one two first last day days week year years 2023 2024 2025 2026 &"
    .split(/\s+/),
);

/** Words that show up across the saved titles, with how many titles use each. */
export function termCounts(items: TasteItem[]): [string, number][] {
  const count = new Map<string, number>();
  for (const it of items) {
    const words = new Set(
      (it.title ?? "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
        .split(/\s+/)
        .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
        .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)),
    );
    for (const w of words) count.set(w, (count.get(w) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The most repeated words, most repeated first. */
export function topTerms(items: TasteItem[], max = 6): string[] {
  return termCounts(items)
    .slice(0, max)
    .map(([w]) => w);
}

/** Channels saved more than once, or the most recent ones. */
export function topChannels(items: TasteItem[], max = 3): string[] {
  const count = new Map<string, number>();
  for (const it of items) if (it.author) count.set(it.author, (count.get(it.author) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([a]) => a);
}

export const searchUrl = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

const titleCase = (q: string) => q.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());

/**
 * Tier 3: no keys at all. Still useful, never empty when anything is saved.
 * Searches pair the strongest theme with the other words that repeat, so
 * "sourdough" + "crumb" rather than two unrelated one-off words.
 */
export function basicRecommendations(items: TasteItem[]): Recommendation[] {
  const out: Recommendation[] = [];
  for (const ch of topChannels(items)) {
    out.push({ id: `ch-${slug(ch)}`, title: `More from ${ch}`, reason: "You've saved their videos", url: searchUrl(ch), type: "search", channel: ch });
  }
  const counts = termCounts(items);
  const repeated = counts.filter(([, c]) => c > 1).map(([w]) => w);
  const theme = repeated[0] ?? counts[0]?.[0];
  if (theme) {
    out.push({ id: `t-${slug(theme)}`, title: titleCase(theme), reason: "Your most saved topic", url: searchUrl(theme), type: "search" });
    const partners = [...repeated.slice(1), ...counts.map(([w]) => w).filter((w) => !repeated.includes(w))].filter((w) => w !== theme);
    for (const w of partners.slice(0, 5)) {
      const q = `${theme} ${w}`;
      out.push({ id: `t-${slug(q)}`, title: titleCase(q), reason: repeated.includes(w) ? "Keeps coming up in what you save" : "Close to what you save", url: searchUrl(q), type: "search" });
    }
  }
  return dedupe(out).slice(0, 8);
}

/** Search phrases to run against YouTube (tier 1), from the taste alone. */
export function queriesFor(items: TasteItem[], max = 3): string[] {
  const qs: string[] = [];
  const terms = topTerms(items, 6);
  if (terms.length >= 2) qs.push(terms.slice(0, 3).join(" "));
  for (const ch of topChannels(items, 2)) qs.push(ch);
  if (terms.length > 3) qs.push(terms.slice(3, 6).join(" "));
  const recent = items.find((i) => i.title)?.title;
  if (recent && qs.length < max) qs.push(recent.slice(0, 60));
  return [...new Set(qs)].slice(0, max);
}

/** The model's prompt for tier 2. Kept here so it is reviewed with the code. */
export function aiPrompt(items: TasteItem[]): string {
  const lines = items
    .filter((i) => i.title || i.author)
    .slice(0, 25)
    .map((i) => `- ${i.title ?? "(untitled)"}${i.author ? ` — ${i.author}` : ""} [${i.platform}]`)
    .join("\n");
  return `Here are videos a person saved to watch later, newest first:
${lines}

Suggest 8 things they would likely enjoy watching next. Mix closely related picks with a few that widen their taste. Each pick is a YouTube search phrase someone would actually type, not a made-up video title.

Answer with only JSON: {"items":[{"title":"short display title","query":"youtube search phrase","reason":"one short line on why, under 12 words"}]}`;
}

/** Read the model's answer. Anything malformed becomes an empty list, never a throw. */
export function parseAi(text: string): Recommendation[] {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return [];
  try {
    const items = (JSON.parse(m[0]) as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    const out: Recommendation[] = [];
    for (const raw of items) {
      const it = raw as { title?: unknown; query?: unknown; reason?: unknown };
      const q = typeof it.query === "string" ? it.query.trim() : typeof it.title === "string" ? it.title.trim() : "";
      if (!q) continue;
      const title = (typeof it.title === "string" && it.title.trim()) || q;
      out.push({ id: `ai-${slug(q)}`, title: title.slice(0, 80), reason: typeof it.reason === "string" ? it.reason.slice(0, 120) : "", url: searchUrl(q), type: "search" });
    }
    return dedupe(out).slice(0, 8);
  } catch {
    return [];
  }
}

export function dedupe(list: Recommendation[]): Recommendation[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const k = r.videoId ? `v:${r.videoId}` : r.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
