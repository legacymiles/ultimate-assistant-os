// ---------------------------------------------------------------------------
// Dance of the Day — server-side discovery, verification and catch-up.
//
// Two discovery paths, one gate:
//
//   AI path       OPENROUTER_API_KEY + a web-search model. Names the dance
//                 properly and says why it is trending.
//   keyless path  a rotating YouTube trend query. Always available, derives a
//                 provisional name from the video title.
//
// The keyless path is the floor, not a stub — autopilot works with no key at
// all. Whichever path runs, every candidate goes through `resolveVideo`, the
// same gate the seed passed. The model never supplies a video, only a name to
// search for, so a hallucinated dance dies at the gate instead of entering the
// vault.
//
// Server-only.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";

import { uid } from "../utils";
import { dailyFilePath, ensureDataDir } from "./dataDir";
import { isKnownName } from "./names";
import { danceQuery, resolveVideo, searchYouTube, verifyVideo } from "./resolve";
import type { Dance, DailyFile, DailyPick } from "./types";

/** How far back a catch-up will fill. Returning after a month costs 5, not 30. */
const MAX_CATCHUP_DAYS = 5;
/** Opening the app ten times in an afternoon must fire one search, not ten. */
const DEBOUNCE_MS = 60 * 60 * 1000;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBack(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// --- the file ---------------------------------------------------------------

export async function readDaily(): Promise<DailyFile> {
  try {
    const raw = await fs.readFile(dailyFilePath(), "utf8");
    const parsed = JSON.parse(raw) as DailyFile;
    return { picks: Array.isArray(parsed.picks) ? parsed.picks : [], lastRunAt: parsed.lastRunAt };
  } catch {
    // Missing or corrupt file is simply "no history yet".
    return { picks: [] };
  }
}

async function writeDaily(file: DailyFile): Promise<boolean> {
  if (!(await ensureDataDir())) return false;
  try {
    await fs.writeFile(dailyFilePath(), JSON.stringify(file, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

// --- discovery: the AI path -------------------------------------------------

interface Candidate {
  name: string;
  song?: string;
  artist?: string;
  why?: string;
  /** True when the name came from a video title rather than a source. */
  provisional?: boolean;
}

const TREND_QUERIES = [
  "new tiktok dance trend this week",
  "viral tiktok dance challenge trending now",
  "tiktok dance trend",
];

async function aiCandidates(exclude: string[]): Promise<Candidate[]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return [];

  const prompt = [
    "Name TikTok dances that broke out in the LAST FEW WEEKS.",
    "Use web search — your training data is months out of date and will be wrong.",
    "",
    // Without this the model returns Renegade, Apple and Espresso every single
    // day: the famous dances dominate any search for "viral tiktok dance", and
    // a vault seeded with the classics then rejects all of them as duplicates.
    "Hard requirements:",
    "- NEW dances only. Do not name a dance that has been famous for over a year.",
    "- Not a classic, not a throwback, not a 'best of all time' entry.",
    "- Prefer dances from the past 30 days, even small ones.",
    "",
    "Already in the collection, do NOT repeat these or anything close to them:",
    exclude.slice(0, 300).join(", ") || "(none)",
    "",
    'Reply with ONLY a JSON array of up to 5 objects: [{"name":"","song":"","artist":"","why":""}]',
    '"name" is what people call the dance. "why" is one short sentence on why it is blowing up.',
    "No markdown fence, no commentary.",
  ].join("\n");

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
        "X-Title": "Dance Vault",
      },
      // `:online` is OpenRouter's web-search plugin suffix. Without it the
      // model answers from training data, which cannot know today's trend —
      // the entire point of this call.
      body: JSON.stringify({
        model: process.env.DANCES_MODEL ?? "perplexity/sonar",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 700,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as Candidate[];
    return Array.isArray(parsed) ? parsed.filter((c) => c?.name).slice(0, 3) : [];
  } catch {
    // A dead key, a rate limit, a malformed reply — all mean "fall through to
    // the keyless path", never "fail the day".
    return [];
  }
}

// --- discovery: the keyless path -------------------------------------------

/**
 * Strip the noise a trend video's title is padded with, so a provisional name
 * reads like a dance name instead of an SEO string.
 */
function nameFromTitle(title: string): string {
  let s = title
    .replace(/#[\wÀ-ɏ]+/g, " ")
    .replace(/\b(tiktok|tik tok|dance|challenge|trend|trending|viral|shorts?|tutorial|compilation|official|video|dc|new)\b/gi, " ")
    .replace(/[|·•\-–—_~]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (s.length > 42) s = s.slice(0, 42).replace(/\s\S*$/, "");
  return s || title.slice(0, 42);
}

async function keylessCandidates(exclude: string[], seed: number): Promise<Candidate[]> {
  const query = TREND_QUERIES[seed % TREND_QUERIES.length];
  const ids = await searchYouTube(query, 10);
  const out: Candidate[] = [];
  for (const id of ids.slice(0, 4)) {
    const video = await verifyVideo(id);
    if (!video?.sourceTitle) continue;
    const name = nameFromTitle(video.sourceTitle);
    if (!name || isKnownName(name, exclude)) continue;
    out.push({ name, why: `Surfacing in "${query}".`, provisional: true });
  }
  return out;
}

// --- one day ---------------------------------------------------------------

/**
 * Pick one day's dance. Returns a recorded outcome either way: a day with no
 * playable candidate is written as `none` so it is never retried, which is
 * what stops a bad day from burning a search on every app open forever.
 */
async function pickForDate(
  date: string,
  exclude: string[],
  usedRefs: Set<string>,
  seed: number
): Promise<DailyPick> {
  // The exclusion list in the prompt is advice, and a model is free to ignore
  // it — observed doing exactly that, returning three dances already in the
  // seed. Enforce it here instead of trusting the reply, or the vault fills
  // with duplicates of dances it already has.
  const rejectedAsKnown: string[] = [];
  const unknownOnly = (list: Candidate[]) =>
    list.filter((c) => {
      if (isKnownName(c.name, exclude)) {
        rejectedAsKnown.push(c.name);
        return false;
      }
      return true;
    });

  const fromAi = process.env.OPENROUTER_API_KEY ? true : false;
  let candidates = unknownOnly(await aiCandidates(exclude));

  // A well-seeded vault already holds every famous dance, so the AI path can
  // legitimately come back with nothing new. That is not a reason to give up on
  // the day — the keyless trend search looks at a different slice of the
  // internet and routinely finds something the model did not name.
  if (!candidates.length) candidates = unknownOnly(await keylessCandidates(exclude, seed));

  for (const c of candidates) {
    const video = await resolveVideo(danceQuery(c.name), { exclude: usedRefs });
    if (!video) continue;
    usedRefs.add(video.ref);
    const at = new Date().toISOString();
    const dance: Dance = {
      id: uid("dance"),
      name: c.name,
      aka: [],
      song: c.song,
      artist: c.artist,
      tags: ["daily", `trend-${date.slice(0, 4)}`],
      video,
      source: "daily",
      dailyDate: date,
      nameProvisional: c.provisional,
      why: c.why,
      addedAt: at,
      updatedAt: at,
    };
    return { date, status: "ok", dance };
  }

  return {
    date,
    status: "none",
    reason: candidates.length
      ? "Found candidates, but none had a playable video."
      : rejectedAsKnown.length
        ? `Everything trending today is already in the vault (${rejectedAsKnown
            .slice(0, 3)
            .join(", ")}).`
        : fromAi
          ? "Search returned no new dances."
          : "No trending dance found that isn't already in the vault.",
  };
}

// --- catch-up ---------------------------------------------------------------

export interface CatchUpResult {
  file: DailyFile;
  /** False when the filesystem is read-only — the UI says so rather than lying. */
  persisted: boolean;
  aiAvailable: boolean;
}

/**
 * Fill in every missing day up to today, newest first, capped.
 *
 * Runs on app open. The debounce means repeated opens within the hour do no
 * work at all; the cap means a month away costs one catch-up, not thirty.
 */
export async function catchUp(knownNames: string[]): Promise<CatchUpResult> {
  const file = await readDaily();
  const aiAvailable = !!process.env.OPENROUTER_API_KEY;
  const have = new Set(file.picks.map((p) => p.date));

  // A first run has no history, and "no history" is not the same as "five days
  // missed" — backfilling a vault's opening day with a week of invented
  // history would be both wasteful and a lie. Day one picks exactly one dance.
  const wanted: string[] = [];
  if (!file.picks.length) {
    wanted.push(today());
  } else {
    for (let i = 0; i < MAX_CATCHUP_DAYS; i++) {
      const date = daysBack(i);
      if (!have.has(date)) wanted.push(date);
    }
  }

  if (!wanted.length) return { file, persisted: true, aiAvailable };

  // Only the debounce stands between "opened the app twice" and two searches.
  // It is checked after the missing-day scan so a fully caught-up vault never
  // even reads the clock.
  const last = file.lastRunAt ? Date.parse(file.lastRunAt) : 0;
  if (Date.now() - last < DEBOUNCE_MS) return { file, persisted: true, aiAvailable };

  const exclude = [...knownNames, ...file.picks.map((p) => p.dance?.name).filter(Boolean)] as string[];
  const usedRefs = new Set(
    file.picks.map((p) => p.dance?.video?.ref).filter(Boolean) as string[]
  );

  let seed = 0;
  for (const date of wanted) {
    const pick = await pickForDate(date, exclude, usedRefs, seed++);
    file.picks.push(pick);
    if (pick.dance) exclude.push(pick.dance.name);
  }
  file.picks.sort((a, b) => b.date.localeCompare(a.date));
  file.lastRunAt = new Date().toISOString();

  const persisted = await writeDaily(file);
  return { file, persisted, aiAvailable };
}
