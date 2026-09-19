import "server-only";

// The two AI calls behind a city catalogue. Both go through aiFetch, so the
// owner's provider pick and fallbacks apply; both fail soft (empty result), so
// a build degrades to OpenStreetMap-only rather than failing.
import { DEFAULT_MODEL, aiConfigured, aiFetch } from "@/lib/ai/provider";
import type { SectionId } from "../sections";
import { RUBRIC, parseRatings, type Rating } from "./rubric";
import { parseDiscovery, type Candidate } from "./verify";

/** Web-search model: it must read today's web, not training data. */
const DISCOVERY_MODEL = process.env.FNO_DISCOVERY_MODEL ?? "perplexity/sonar";

const ASK: Record<SectionId, string> = {
  parks:
    "the best parks, trails, gorges, waterfalls, swimming holes, overlooks and outdoor spots — include parks with rock climbing or anything unusual",
  fun: "the most fun things to do: unusual activities, arcades, bars with games, go-karts, axe throwing, escape rooms, rooftop spots, live-music hangouts",
  gems:
    "hidden gems and genuinely unique places: cat cafes, speakeasies and secret bars, free-play arcades, themed restaurants, odd museums, quirky shops, places with a surprising twist",
  kids: "the best places to take kids: amusement parks, water parks, zoos, aquariums, children's museums, play centres, farms",
  food: "standout local restaurants, cafes, bakeries and food halls that locals love — independent places, not chains",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chat(model: string, system: string, user: string, maxTokens: number): Promise<string> {
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
  });
  // A city build fires a burst of rating calls; the provider answers 429 when
  // they land together (measured: 11 of 14 batches lost at 8-way parallel).
  // Back off and retry rather than silently falling back to estimated stars.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await aiFetch({ method: "POST", body, signal: AbortSignal.timeout(90_000) });
    if (res.status !== 429) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt + Math.random() * 1000);
  }
  if (!res || !res.ok) throw new Error(`AI returned ${res?.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

export function catalogAiAvailable(): boolean {
  return aiConfigured();
}

/** Up to 20 real places for one section, found on the live web. */
export async function discoverSection(
  section: SectionId,
  cityLabel: string,
  radiusMi: number,
): Promise<Candidate[]> {
  const prompt = [
    `List ${ASK[section]} in and within ${Math.round(radiusMi)} miles of ${cityLabel}.`,
    "Only places that exist and are open today. Use each place's real name exactly as it appears on",
    "its sign or map listing. Give the street address when you know it. Up to 20 places.",
    "Never invent a place; fewer real places is always better.",
    'Reply with JSON only: {"places":[{"name":"","address":"","why":"one short sentence"}]}',
  ].join("\n");
  try {
    const content = await chat(
      DISCOVERY_MODEL,
      "You find real local places and return strict JSON. You never fabricate a place.",
      prompt,
      2500,
    );
    return parseDiscovery(content, section, 20);
  } catch (err) {
    console.warn(`[fno catalog] discovery ${section} failed:`, (err as Error).message);
    return [];
  }
}

export interface RateItem {
  key: string;
  name: string;
  section: SectionId;
  kind?: string;
  hook?: string;
  why?: string;
  address?: string;
}

/** Section + 1–5 stars + reason (+ a hook line) for up to ~30 places. */
export async function rateBatch(items: RateItem[], cityLabel: string): Promise<Map<string, Rating>> {
  if (!items.length) return new Map();
  const lines = items.map((i) =>
    JSON.stringify({
      key: i.key,
      name: i.name,
      guess_section: i.section,
      kind: i.kind,
      known: [i.hook, i.why].filter(Boolean).join(" ") || undefined,
      address: i.address,
    }),
  );
  const prompt = [
    `Rate these places around ${cityLabel}. For each, give section, stars (1-5), a reason under`,
    "15 words, and a hook: one vivid sentence on what makes it worth going (only facts you are",
    "confident of; leave hook empty otherwise).",
    "",
    ...lines,
    "",
    'Reply with JSON only: {"ratings":[{"key":"","section":"","stars":0,"reason":"","hook":""}]}',
  ].join("\n");
  try {
    // Generous max_tokens: models with hidden reasoning spend budget before answering.
    const content = await chat(DEFAULT_MODEL, RUBRIC, prompt, 8000);
    const out = parseRatings(content, new Set(items.map((i) => i.key)));
    if (out.size < items.length) {
      console.warn(`[fno catalog] rating parsed ${out.size}/${items.length}`, content.slice(0, 200));
    }
    return out;
  } catch (err) {
    console.warn("[fno catalog] rating batch failed:", (err as Error).name, (err as Error).message);
    return new Map();
  }
}
