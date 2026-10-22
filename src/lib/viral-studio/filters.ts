// ---------------------------------------------------------------------------
// Viral Studio Content — filters for every tab: mood, how hot it is right
// now, and the tab's own categories (genres for audio, fight styles, dance
// styles, sports).
//
// Tags come from the auto-tagger when a clip is added (or the keyword guess
// below when no AI key is set), and the owner can change them by hand.
// "Hot right now" is worked out from views per day since posting, not from a
// fixed view count, so a week-old clip at 2M beats a five-year-old one at 5M.
//
// Pure: everything is a function of its arguments.
// ---------------------------------------------------------------------------

import type { Clip, ClipStats, ClipTags, TabId } from "./types";

export const MOODS = ["Hype", "Funny", "Chill", "Feel-good", "Sad", "Romantic", "Dark", "Motivational", "Epic", "Satisfying"] as const;

export const CATEGORIES: Record<TabId, readonly string[]> = {
  audio: ["Song", "Funny sound", "Voiceover", "Remix / sped up", "Sound effect", "Hip-hop", "R&B", "Pop", "Afrobeats", "Latin", "Country", "EDM", "Gospel", "Throwback"],
  fights: ["Boxing", "MMA", "Street", "Wrestling", "Kickboxing", "Knockout", "Sports brawl", "Self-defense", "Sparring"],
  dances: ["Trend", "Hip-hop", "Afro", "Shuffle", "Couples", "Group", "Choreo", "Freestyle", "Line dance", "Kids"],
  motion: ["Surfing", "Basketball", "Football", "Skate", "Snow", "Bikes / BMX", "Parkour", "Rap performance", "Gym", "Extreme", "Cars"],
};

export type Heat = "trending" | "rising" | "popular" | "classic";

export const HEAT_LABEL: Record<Heat, string> = {
  trending: "Trending now",
  rising: "Rising",
  popular: "Popular",
  classic: "Classic",
};
export const HEATS: readonly Heat[] = ["trending", "rising", "popular", "classic"];

const DAY = 86_400_000;

/** How hot a clip is, from its views and age. Null when the numbers aren't known. */
export function heatOf(stats: ClipStats | undefined, now = Date.now()): Heat | null {
  const views = stats?.views ?? null;
  if (views === null || views === undefined || !Number.isFinite(views)) return null;
  const posted = stats?.postedAt ? Date.parse(stats.postedAt) : NaN;
  const days = Number.isFinite(posted) ? Math.max(1, (now - posted) / DAY) : null;
  if (days !== null) {
    const perDay = views / days;
    if (days <= 21 && (perDay >= 50_000 || views >= 1_000_000)) return "trending";
    if (days <= 45 && perDay >= 2_000) return "rising";
    if (days > 365 && views >= 500_000) return "classic";
  }
  if (views >= 1_000_000) return "popular";
  return null;
}

/** "1.2M views" — short enough for a tile. */
export function shortCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  if (n >= 1e9) return `${trim(n / 1e9)}B`;
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e3) return `${trim(n / 1e3)}K`;
  return String(Math.round(n));
}
function trim(x: number): string {
  return (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString();
}

export interface Filter {
  moods: string[];
  heats: Heat[];
  categories: string[];
  sort: "newest" | "hottest";
}

export const NO_FILTER: Filter = { moods: [], heats: [], categories: [], sort: "newest" };

export function isFiltering(f: Filter): boolean {
  return f.moods.length > 0 || f.heats.length > 0 || f.categories.length > 0;
}

/** Any of the picked moods AND any of the picked heats AND any of the picked categories. */
export function matches(clip: Clip, f: Filter, now = Date.now()): boolean {
  const tags = clip.tags;
  if (f.moods.length && !f.moods.some((m) => tags?.moods.includes(m))) return false;
  if (f.categories.length && !f.categories.some((c) => tags?.categories.includes(c))) return false;
  if (f.heats.length) {
    const h = heatOf(clip.stats, now);
    if (!h || !f.heats.includes(h)) return false;
  }
  return true;
}

/** Views per day, for "Hottest first". Unknown numbers sort last. */
export function heatScore(stats: ClipStats | undefined, now = Date.now()): number {
  const views = stats?.views;
  if (views === null || views === undefined || !Number.isFinite(views)) return -1;
  const posted = stats?.postedAt ? Date.parse(stats.postedAt) : NaN;
  const days = Number.isFinite(posted) ? Math.max(1, (now - posted) / DAY) : 365;
  return views / days;
}

/** The clips to show: filtered, then newest first (the board's own order) or hottest first. */
export function applyFilter(clips: Clip[], f: Filter, now = Date.now()): Clip[] {
  const kept = clips.filter((c) => matches(c, f, now));
  if (f.sort === "hottest") return kept.map((c, i) => ({ c, i, s: heatScore(c.stats, now) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
  return kept;
}

/** How many clips each option would leave, so empty options can be dimmed. */
export function optionCounts(clips: Clip[], now = Date.now()): { moods: Record<string, number>; heats: Record<string, number>; categories: Record<string, number> } {
  const moods: Record<string, number> = {};
  const heats: Record<string, number> = {};
  const categories: Record<string, number> = {};
  for (const c of clips) {
    for (const m of c.tags?.moods ?? []) moods[m] = (moods[m] ?? 0) + 1;
    for (const k of c.tags?.categories ?? []) categories[k] = (categories[k] ?? 0) + 1;
    const h = heatOf(c.stats, now);
    if (h) heats[h] = (heats[h] ?? 0) + 1;
  }
  return { moods, heats, categories };
}

/** Keep only known moods and this tab's categories; the auto-tagger gets at most 2 moods and 3 categories. */
export function coerceTags(raw: unknown, tab: TabId): ClipTags {
  const r = (raw ?? {}) as { moods?: unknown; categories?: unknown; byHand?: unknown };
  const pick = (list: unknown, allowed: readonly string[], max: number) => {
    if (!Array.isArray(list)) return [];
    const lower = new Map(allowed.map((a) => [a.toLowerCase(), a]));
    const out: string[] = [];
    for (const x of list) {
      const hit = lower.get(String(x).trim().toLowerCase());
      if (hit && !out.includes(hit)) out.push(hit);
      if (out.length >= max) break;
    }
    return out;
  };
  // The tagger is held to a few; the owner's own picks are kept whole.
  const byHand = r.byHand === true;
  return {
    moods: pick(r.moods, MOODS, byHand ? MOODS.length : 2),
    categories: pick(r.categories, CATEGORIES[tab], byHand ? CATEGORIES[tab].length : 3),
    ...(byHand ? { byHand: true } : {}),
  };
}

const MOOD_WORDS: [string, RegExp][] = [
  ["Funny", /\b(funny|lol|lmao|😂|🤣|joke|prank|comedy|meme|skit|hilarious|bruh)\b|😂|🤣/i],
  ["Hype", /\b(hype|lit|fire|🔥|crazy|insane|go hard|banger|turn up|energy)\b|🔥/i],
  ["Chill", /\b(chill|vibe|vibes|lofi|lo-fi|relax|calm|smooth|sunset)\b/i],
  ["Sad", /\b(sad|cry|heartbreak|broken|miss you|tears|💔)\b|💔/i],
  ["Romantic", /\b(love|couple|romantic|baby|bae|valentine|❤️|wedding)\b|❤️/i],
  ["Dark", /\b(dark|phonk|evil|scary|creepy|villain|drill)\b/i],
  ["Motivational", /\b(motivation|motivational|grind|never give up|discipline|mindset|gym)\b/i],
  ["Epic", /\b(epic|legendary|goat|cinematic|unreal|clutch)\b/i],
  ["Feel-good", /\b(happy|wholesome|smile|feel good|good vibes|cute|joy)\b/i],
  ["Satisfying", /\b(satisfying|smooth|perfect|clean)\b/i],
];

const CATEGORY_WORDS: Record<TabId, [string, RegExp][]> = {
  audio: [
    ["Funny sound", /\b(funny|lol|lmao|meme|joke|skit|prank)\b|😂|🤣/i],
    ["Voiceover", /\b(voice ?over|speech|quote|motivational speech|says|said)\b/i],
    ["Remix / sped up", /\b(remix|sped up|slowed|reverb|nightcore|mashup|edit audio)\b/i],
    ["Sound effect", /\b(sound effect|sfx|bruh sound|vine boom)\b/i],
    ["Hip-hop", /\b(rap|hip ?hop|drill|trap)\b/i],
    ["R&B", /\b(r&b|rnb|soul)\b/i],
    ["Afrobeats", /\b(afro|amapiano|afrobeats?)\b/i],
    ["Latin", /\b(reggaeton|latin|bachata|salsa|cumbia)\b/i],
    ["Country", /\b(country|nashville)\b/i],
    ["EDM", /\b(edm|house|techno|dubstep|phonk)\b/i],
    ["Gospel", /\b(gospel|worship|church)\b/i],
    ["Throwback", /\b(throwback|90s|80s|2000s|old school|classic)\b/i],
  ],
  fights: [
    ["Boxing", /\b(boxing|boxer|jab|uppercut)\b/i],
    ["MMA", /\b(mma|ufc|bellator|pfl|octagon)\b/i],
    ["Street", /\b(street|hood|parking lot|caught on camera)\b/i],
    ["Wrestling", /\b(wrestl|wwe|takedown|suplex)\b/i],
    ["Kickboxing", /\b(kickbox|muay thai|k-?1)\b/i],
    ["Knockout", /\b(ko|knockout|knocked out|lights out|sleep)\b/i],
    ["Sports brawl", /\b(nba|nfl|nhl|mlb|brawl|benches clear)\b/i],
    ["Self-defense", /\b(self ?defen[cs]e)\b/i],
    ["Sparring", /\b(spar|sparring)\b/i],
  ],
  dances: [
    ["Trend", /\b(trend|challenge|viral)\b/i],
    ["Hip-hop", /\b(hip ?hop|krump|popping|locking)\b/i],
    ["Afro", /\b(afro|amapiano|azonto)\b/i],
    ["Shuffle", /\b(shuffle|cutting shapes)\b/i],
    ["Couples", /\b(couple|partner|duo)\b/i],
    ["Group", /\b(group|crew|squad|team)\b/i],
    ["Choreo", /\b(choreo|choreography)\b/i],
    ["Freestyle", /\b(freestyle)\b/i],
    ["Line dance", /\b(line dance|wobble|cha cha slide|electric slide)\b/i],
    ["Kids", /\b(kid|kids|toddler|baby)\b/i],
  ],
  motion: [
    ["Surfing", /\b(surf|wave|barrel)\b/i],
    ["Basketball", /\b(basketball|hoops|dunk|nba|crossover|ankle)\b/i],
    ["Football", /\b(football|nfl|touchdown|soccer|goal)\b/i],
    ["Skate", /\b(skate|skateboard|kickflip)\b/i],
    ["Snow", /\b(snowboard|ski|skiing)\b/i],
    ["Bikes / BMX", /\b(bmx|bike|mtb|wheelie|dirt ?bike)\b/i],
    ["Parkour", /\b(parkour|freerun)\b/i],
    ["Rap performance", /\b(rap|cypher|freestyle|verse|bars|concert)\b/i],
    ["Gym", /\b(gym|lift|deadlift|bench|workout|pr)\b/i],
    ["Extreme", /\b(extreme|cliff|base jump|wingsuit|stunt)\b/i],
    ["Cars", /\b(car|drift|race|racing|burnout)\b/i],
  ],
};

/** A keyword guess at a clip's tags, for when no AI is set up. */
export function guessTags(text: string, tab: TabId, isSong = false): ClipTags {
  const moods = MOOD_WORDS.filter(([, re]) => re.test(text)).map(([m]) => m).slice(0, 2);
  const categories = CATEGORY_WORDS[tab].filter(([, re]) => re.test(text)).map(([c]) => c);
  if (tab === "audio" && isSong && !categories.includes("Song")) categories.unshift("Song");
  return { moods, categories: categories.slice(0, 3) };
}
