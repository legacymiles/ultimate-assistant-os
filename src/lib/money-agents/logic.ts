// ---------------------------------------------------------------------------
// Money Agent Studio — every rule that does not need a browser or a server.
//
// Pure on purpose: the moment finder, the money maths and the PC briefs are
// the parts that decide whether the owner gets paid, so they are the parts
// with tests (logic.test.ts) rather than parts that live inside a component.
// ---------------------------------------------------------------------------

import type { Draft, DraftMedia, Persona } from "@/lib/social-personas/types";
import type {
  Agent,
  AgentKind,
  Board,
  FoundCampaign,
  Item,
  ItemStage,
  Moment,
  Payout,
  Script,
  VideoIdea,
} from "./types";

export const QUEUE_FOLDER = "app:money-agent-studio";
/** In Queue refuses a request longer than this (MAX_TEXT in new-jarvis/requests). */
export const MAX_BRIEF = 4000;

export const EMPTY_BOARD: Board = { version: 1, agents: [], items: [], payouts: [] };

// ----- ids & time ----------------------------------------------------------

export function newId(prefix: string, rand: () => number = Math.random): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
  return `${prefix}-${s}`;
}

/** "1:02:03", "62:03", "1:02", "75", "75.5" → seconds. Null when it isn't a time. */
export function parseTimestamp(raw: string): number | null {
  const s = raw.trim().replace(/^\[|\]$/g, "");
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:[.,](\d+))?$/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((p): p is string => p !== undefined).map(Number);
  const frac = m[4] ? Number(`0.${m[4]}`) : 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2] + frac;
  return parts[0] * 60 + parts[1] + frac;
}

/** Seconds → "1:02:03" or "2:03". */
export function formatTime(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function localDay(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ----- the board -----------------------------------------------------------

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const strs = (v: unknown, max = 50) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);

/** Whatever was stored, as a board that cannot crash a screen. */
export function normalizeBoard(raw: unknown): Board {
  const b = (raw ?? {}) as Partial<Board>;
  const now = new Date(0).toISOString();
  const agents: Agent[] = Array.isArray(b.agents)
    ? b.agents
        .filter((a): a is Agent => Boolean(a && typeof a.id === "string"))
        .map((a) => ({
          ...newAgent(isKind(a.kind) ? a.kind : "clipper", {}, () => 0, a.createdAt || now),
          ...a,
          kind: isKind(a.kind) ? a.kind : "clipper",
          status: a.status === "paused" ? "paused" : "active",
          accountIds: strs(a.accountIds),
          sources: strs(a.sources, 200),
          ratePer1k: Math.max(0, num(a.ratePer1k)),
          minSeconds: clamp(num(a.minSeconds, 20), 5, 600),
          maxSeconds: clamp(num(a.maxSeconds, 60), 5, 3600),
          perWeek: clamp(num(a.perWeek, 3), 0, 70),
          campaign: a.campaign
            ? {
                url: str(a.campaign.url, 500),
                brand: str(a.campaign.brand, 120),
                budget: Math.max(0, num(a.campaign.budget)),
                minViews: Math.max(0, num(a.campaign.minViews)),
                platforms: strs(a.campaign.platforms, 8),
                contentUrls: strs(a.campaign.contentUrls, 100),
                endsOn: str(a.campaign.endsOn, 10),
              }
            : null,
        }))
    : [];
  const items: Item[] = Array.isArray(b.items)
    ? b.items
        .filter((i): i is Item => Boolean(i && typeof i.id === "string" && typeof i.agentId === "string"))
        .map((i) => ({
          ...i,
          kind: i.kind === "video" ? "video" : "clip",
          stage: isStage(i.stage) ? i.stage : "idea",
          hashtags: strs(i.hashtags, 30),
          caption: str(i.caption, 4000),
          hook: str(i.hook, 400),
          title: str(i.title, 300),
          why: str(i.why, 600),
          sourceUrl: str(i.sourceUrl, 600),
          start: typeof i.start === "number" ? i.start : null,
          end: typeof i.end === "number" ? i.end : null,
          score: typeof i.score === "number" ? i.score : null,
          script: i.script ? normalizeScript(i.script) : null,
          requestId: typeof i.requestId === "string" ? i.requestId : null,
          personaId: typeof i.personaId === "string" ? i.personaId : null,
          draftId: typeof i.draftId === "string" ? i.draftId : null,
          manualViews: typeof i.manualViews === "number" ? i.manualViews : null,
        }))
    : [];
  const payouts: Payout[] = Array.isArray(b.payouts)
    ? b.payouts
        .filter((p): p is Payout => Boolean(p && typeof p.id === "string" && Number.isFinite(p.amount)))
        .map((p) => ({ ...p, note: str(p.note, 300), date: str(p.date, 10) || localDay(new Date(p.createdAt || 0)) }))
    : [];
  return { version: 1, agents, items, payouts };
}

const KINDS: AgentKind[] = ["clipper", "faceless", "campaign"];
const isKind = (k: unknown): k is AgentKind => KINDS.includes(k as AgentKind);
const STAGE_IDS: ItemStage[] = ["idea", "script", "rendering", "ready", "approved", "posted", "rejected"];
const isStage = (s: unknown): s is ItemStage => STAGE_IDS.includes(s as ItemStage);

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function newAgent(
  kind: AgentKind,
  over: Partial<Agent> = {},
  rand: () => number = Math.random,
  at: string = new Date().toISOString(),
): Agent {
  const base: Agent = {
    id: newId("ag", rand),
    kind,
    name: kind === "clipper" ? "Clipper" : kind === "faceless" ? "Faceless channel" : "Campaign clipper",
    status: "active",
    personaId: null,
    accountIds: [],
    niche: "",
    voice: "",
    aspect: kind === "faceless" ? "9:16" : "9:16",
    minSeconds: kind === "faceless" ? 30 : 20,
    maxSeconds: kind === "faceless" ? 60 : 60,
    perWeek: kind === "faceless" ? 5 : 7,
    sources: [],
    ratePer1k: 0,
    campaign:
      kind === "campaign"
        ? { url: "", brand: "", budget: 0, minViews: 0, platforms: ["tiktok", "instagram", "youtube"], contentUrls: [], endsOn: "" }
        : null,
    rules: "",
    createdAt: at,
    updatedAt: at,
  };
  return { ...base, ...over, kind };
}

export function upsertAgent(b: Board, a: Agent): Board {
  const next = { ...a, updatedAt: new Date().toISOString() };
  const i = b.agents.findIndex((x) => x.id === a.id);
  return { ...b, agents: i >= 0 ? b.agents.map((x) => (x.id === a.id ? next : x)) : [next, ...b.agents] };
}

/** An agent and everything it made. Payouts go too: they were its money. */
export function removeAgent(b: Board, id: string): Board {
  return {
    ...b,
    agents: b.agents.filter((a) => a.id !== id),
    items: b.items.filter((i) => i.agentId !== id),
    payouts: b.payouts.filter((p) => p.agentId !== id),
  };
}

export function newItem(agentId: string, over: Partial<Item>, rand: () => number = Math.random): Item {
  const at = new Date().toISOString();
  return {
    id: newId("it", rand),
    agentId,
    kind: "clip",
    stage: "idea",
    title: "",
    hook: "",
    caption: "",
    hashtags: [],
    sourceUrl: "",
    start: null,
    end: null,
    score: null,
    why: "",
    script: null,
    requestId: null,
    personaId: null,
    draftId: null,
    manualViews: null,
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

/**
 * Add items, newest first, never twice.
 *
 * The owner's checklist rule: no duplicates. A clip is the same clip when it is
 * the same source and starts within three seconds of one already kept; a video
 * is the same video when it has the same title for the same agent.
 */
export function addItems(b: Board, items: Item[]): { board: Board; added: Item[]; skipped: number } {
  const kept: Item[] = [];
  let skipped = 0;
  for (const it of items) {
    const pool = [...kept, ...b.items];
    if (pool.some((x) => sameItem(x, it))) {
      skipped++;
      continue;
    }
    kept.push(it);
  }
  return { board: { ...b, items: [...kept, ...b.items] }, added: kept, skipped };
}

export function sameItem(a: Item, b: Item): boolean {
  if (a.agentId !== b.agentId || a.kind !== b.kind) return false;
  if (a.kind === "clip") {
    return (
      sourceKey(a.sourceUrl) === sourceKey(b.sourceUrl) &&
      a.start !== null &&
      b.start !== null &&
      Math.abs(a.start - b.start) < 3
    );
  }
  return a.title.trim().toLowerCase() === b.title.trim().toLowerCase();
}

/** The same video however the link was copied (youtu.be, ?si=, www, trailing slash). */
export function sourceKey(url: string): string {
  const s = url.trim();
  const yt = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/);
  if (yt) return `yt:${yt[1]}`;
  try {
    const u = new URL(s);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

export function updateItem(b: Board, id: string, patch: Partial<Item>): Board {
  const at = new Date().toISOString();
  return { ...b, items: b.items.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: at } : i)) };
}

export function removeItem(b: Board, id: string): Board {
  return { ...b, items: b.items.filter((i) => i.id !== id) };
}

export function addPayout(b: Board, p: Payout): Board {
  return { ...b, payouts: [p, ...b.payouts].sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0)) };
}

export function removePayout(b: Board, id: string): Board {
  return { ...b, payouts: b.payouts.filter((p) => p.id !== id) };
}

// ----- transcripts & moments --------------------------------------------

export interface Segment {
  start: number;
  text: string;
}

/**
 * A pasted transcript, as timed lines.
 *
 * Takes the shapes people actually paste: "[00:01:02] words", "1:02 words",
 * "1:02 - words", and YouTube's "Show transcript" copy, where a time sits on
 * its own line above the words. Lines with no time inherit the last one.
 */
export function parseTranscript(text: string): Segment[] {
  const out: Segment[] = [];
  let pending: number | null = null;
  let last = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const alone = parseTimestamp(line);
    if (alone !== null && /[:[]/.test(line)) {
      pending = alone;
      continue;
    }
    const m = line.match(/^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)\]?\s*[-–—:]?\s*(.+)$/);
    if (m) {
      const t = parseTimestamp(m[1]);
      if (t !== null) {
        last = t;
        out.push({ start: t, text: m[2].trim() });
        pending = null;
        continue;
      }
    }
    const start = pending ?? last;
    pending = null;
    last = start;
    out.push({ start, text: line });
  }
  return out;
}

/** Words that make people stop and share, weighted by how hard they hit. */
const HOOK_WORDS: [RegExp, number][] = [
  [/\b(never|nobody|no one|everyone|always)\b/gi, 3],
  [/\b(secret|truth|lie|lied|mistake|wrong|regret|scam|exposed?)\b/gi, 4],
  [/\b(crazy|insane|wild|unbelievable|shocking|terrifying|hilarious)\b/gi, 3],
  [/\b(million|billion|broke|rich|money|paid|fired|quit)\b/gi, 3],
  [/\b(here'?s (?:why|how|the thing)|the reason|the problem is|what nobody)\b/gi, 5],
  [/\b(i was|when i|my (?:dad|mom|wife|husband|boss|friend))\b/gi, 2],
  [/\[(?:laughter|laughs|applause)\]|\b(haha+|lmao)\b/gi, 4],
];

export function lineScore(text: string): number {
  let s = 0;
  for (const [re, w] of HOOK_WORDS) s += (text.match(re)?.length ?? 0) * w;
  s += (text.match(/\?/g)?.length ?? 0) * 2;
  s += (text.match(/\$\s?\d|\b\d+(?:[.,]\d+)?\s?(?:%|k|m|x)\b/gi)?.length ?? 0) * 3;
  s += (text.match(/!/g)?.length ?? 0) * 1;
  return s;
}

/**
 * The offline moment finder — used when no AI key is set or the AI step fails.
 *
 * Slides a window the length the agent wants across the transcript, scores it
 * by the lines inside (hook words, questions, numbers, laughter), gives a bonus
 * when it OPENS on a strong line (the first two seconds decide a short), then
 * keeps the best non-overlapping windows. Honest about what it is: a keyword
 * pass, so `why` says which signals it saw.
 */
export function findMoments(
  segments: Segment[],
  opts: { count: number; minSeconds: number; maxSeconds: number },
): Moment[] {
  if (!segments.length) return [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const target = Math.max(opts.minSeconds, Math.min(opts.maxSeconds, (opts.minSeconds + opts.maxSeconds) / 2));
  type Win = { start: number; end: number; raw: number; lines: Segment[] };
  const wins: Win[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i].start;
    const lines: Segment[] = [];
    let j = i;
    while (j < sorted.length && sorted[j].start < start + target) lines.push(sorted[j++]);
    const nextStart = j < sorted.length ? sorted[j].start : start + target;
    const end = Math.min(start + opts.maxSeconds, Math.max(start + opts.minSeconds, nextStart));
    const body = lines.reduce((s, l) => s + lineScore(l.text), 0);
    const opener = lineScore(sorted[i].text) * 1.5;
    wins.push({ start, end, raw: body + opener, lines });
  }
  wins.sort((a, b) => b.raw - a.raw || a.start - b.start);
  const picked: Win[] = [];
  for (const w of wins) {
    if (picked.length >= opts.count) break;
    if (picked.some((p) => w.start < p.end && p.start < w.end)) continue;
    picked.push(w);
  }
  const top = Math.max(1, ...picked.map((p) => p.raw));
  return picked.map((w) => {
    const quote = w.lines.map((l) => l.text).join(" ").replace(/\s+/g, " ").trim();
    const first = (w.lines[0]?.text ?? "").replace(/\[[^\]]*\]/g, "").trim();
    const signals = signalNames(quote);
    return {
      start: w.start,
      end: w.end,
      hook: trimWords(first, 12),
      title: trimWords(first, 8),
      why: signals.length ? `Strong signals: ${signals.join(", ")}.` : "A steady stretch with a clear opening line.",
      score: Math.round(35 + (w.raw / top) * 55),
      quote: quote.slice(0, 600),
    };
  });
}

function signalNames(text: string): string[] {
  const out: string[] = [];
  if (/\?/.test(text)) out.push("a question");
  if (/\$\s?\d|\b\d+(?:[.,]\d+)?\s?(?:%|k|m|x)\b/i.test(text)) out.push("hard numbers");
  if (/\b(secret|truth|lie|mistake|wrong|regret|exposed?)\b/i.test(text)) out.push("a reveal");
  if (/\b(never|nobody|always|everyone)\b/i.test(text)) out.push("a bold claim");
  if (/laugh|haha|lmao/i.test(text)) out.push("laughter");
  if (/\b(i was|when i|my (?:dad|mom|wife|husband|boss|friend))\b/i.test(text)) out.push("a story");
  return out;
}

function trimWords(s: string, n: number): string {
  const words = s.replace(/\s+/g, " ").trim().split(" ");
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : words.join(" ");
}

/** An AI reply, as moments that are safe to show and to cut. */
export function normalizeMoments(raw: unknown, opts: { maxSeconds: number; duration?: number }): Moment[] {
  const list = (raw as { moments?: unknown })?.moments ?? raw;
  if (!Array.isArray(list)) return [];
  const out: Moment[] = [];
  for (const m of list as Record<string, unknown>[]) {
    const start = typeof m?.start === "number" ? m.start : parseTimestamp(String(m?.start ?? ""));
    const endRaw = typeof m?.end === "number" ? m.end : parseTimestamp(String(m?.end ?? ""));
    if (start === null || endRaw === null || endRaw <= start) continue;
    const end = Math.min(endRaw, start + Math.max(opts.maxSeconds, 5) * 1.5, opts.duration ?? Infinity);
    if (end <= start) continue;
    out.push({
      start,
      end,
      hook: str(m.hook, 200),
      title: str(m.title, 140) || str(m.hook, 80),
      why: str(m.why, 300),
      score: clamp(Math.round(num(m.score, 60)), 0, 100),
      quote: str(m.quote, 600),
      caption: str(m.caption, 2200),
      hashtags: strs(m.hashtags, 12).map((h) => h.replace(/^#/, "").replace(/\s+/g, "").slice(0, 40)).filter(Boolean),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function normalizeScript(raw: unknown): Script {
  const r = ((raw as { script?: unknown })?.script ?? raw ?? {}) as Record<string, unknown>;
  const beats = strs(r.beats, 40).map((b) => b.slice(0, 600));
  const visuals = strs(r.visuals, 40).map((v) => v.slice(0, 400));
  return {
    hook: str(r.hook, 400),
    beats,
    cta: str(r.cta, 300),
    visuals: beats.map((_, i) => visuals[i] ?? ""),
    thumbnail: str(r.thumbnail, 60),
    description: str(r.description, 2000),
  };
}

export function normalizeIdeas(raw: unknown): VideoIdea[] {
  const list = (raw as { ideas?: unknown })?.ideas ?? raw;
  if (!Array.isArray(list)) return [];
  return (list as Record<string, unknown>[])
    .map((i) => ({ title: str(i?.title, 140), hook: str(i?.hook, 300), angle: str(i?.angle, 300), why: str(i?.why, 300) }))
    .filter((i) => i.title);
}

export function normalizeCampaigns(raw: unknown): FoundCampaign[] {
  const list = (raw as { campaigns?: unknown })?.campaigns ?? raw;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: FoundCampaign[] = [];
  for (const c of list as Record<string, unknown>[]) {
    const url = str(c?.url, 500);
    if (!/^https?:\/\//i.test(url)) continue;
    const key = sourceKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const rate = typeof c?.ratePer1k === "number" ? c.ratePer1k : Number(String(c?.ratePer1k ?? "").replace(/[^0-9.]/g, ""));
    out.push({
      name: str(c?.name, 140) || url,
      brand: str(c?.brand, 120),
      url,
      ratePer1k: Number.isFinite(rate) && rate > 0 && rate < 1000 ? rate : 0,
      platforms: strs(c?.platforms, 8).map((p) => p.toLowerCase()),
      notes: str(c?.notes, 400),
    });
  }
  return out;
}

/** Offline fallback ideas, so the Faceless panel is never empty without a key. */
export function starterIdeas(niche: string, count: number): VideoIdea[] {
  const topic = niche.trim() || "your niche";
  const shapes = [
    (t: string) => ({ title: `3 ${t} facts nobody tells you`, hook: `Nobody tells you this about ${t}.`, angle: "List of three, each with a twist" }),
    (t: string) => ({ title: `The biggest ${t} mistake`, hook: `Most people get ${t} wrong in one way.`, angle: "One mistake, why it happens, the fix" }),
    (t: string) => ({ title: `${t} in 60 seconds`, hook: `Here's ${t}, explained in one minute.`, angle: "Fast explainer with one surprising number" }),
    (t: string) => ({ title: `What happens if… (${t})`, hook: `What would happen if ${t} stopped tomorrow?`, angle: "Hypothetical chain of consequences" }),
    (t: string) => ({ title: `${t}: myth vs truth`, hook: `You've been lied to about ${t}.`, angle: "Three myths, three corrections" }),
    (t: string) => ({ title: `The history of ${t} in one minute`, hook: `${t} started somewhere strange.`, angle: "Timeline with one turning point" }),
  ];
  return shapes.slice(0, Math.max(1, Math.min(count, shapes.length))).map((f) => ({
    ...f(topic),
    why: "Offline idea from a proven faceless format — add an AI key for ideas built on your niche.",
  }));
}

// ----- the PC briefs -------------------------------------------------------

function shortBrief(s: string): string {
  return s.length <= MAX_BRIEF ? s : `${s.slice(0, MAX_BRIEF - 1)}…`;
}

/**
 * What Claude Code on the owner's PC reads to cut one clip.
 *
 * Written as instructions to an agent with the owner's skills: link-to-video
 * fetches the source, ffmpeg cuts and reframes, embedded-captions burns the
 * captions, and the finished file goes back through the queue so it shows up
 * in Approve by itself.
 */
export function clipBrief(agent: Agent, item: Item): string {
  const span = item.start !== null && item.end !== null ? `${formatTime(item.start)} → ${formatTime(item.end)}` : "the strongest 30-60 s";
  const lines = [
    `Money Agent Studio — cut one clip (item ${item.id}, agent "${agent.name}").`,
    `Source: ${item.sourceUrl}`,
    `Cut: ${span}. Keep whole sentences: move the in/out points up to 2 s so no word is clipped.`,
    `Format: ${agent.aspect} (${agent.aspect === "9:16" ? "1080x1920" : agent.aspect === "1:1" ? "1080x1080" : "1920x1080"}), reframe on whoever is speaking, H.264 MP4, loudness -14 LUFS.`,
    `Captions: burned in, word-by-word, big and centred in the lower third (embedded-captions skill).`,
    item.hook ? `Hook text on screen for the first 2 s: "${item.hook}"` : "",
    item.title ? `Working title: ${item.title}` : "",
    agent.rules.trim() ? `Rules to follow: ${agent.rules.trim()}` : "",
    agent.campaign ? campaignLine(agent) : "",
    `Skills: link-to-video (download), embedded-captions, ffmpeg.`,
    `When done: upload the MP4 with queue_video_link, then queue_complete with video: true. It lands in Money Agent Studio › Approve. Never post it anywhere.`,
  ];
  return shortBrief(lines.filter(Boolean).join("\n"));
}

export function videoBrief(agent: Agent, item: Item): string {
  const s = item.script;
  const script = s
    ? [
        `Hook (spoken + on screen): ${s.hook}`,
        ...s.beats.map((b, i) => `${i + 1}. ${b}${s.visuals[i] ? `  [on screen: ${s.visuals[i]}]` : ""}`),
        s.cta ? `End: ${s.cta}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : `Topic: ${item.title}. Hook: ${item.hook}`;
  const lines = [
    `Money Agent Studio — make one faceless video (item ${item.id}, channel "${agent.name}").`,
    `Niche: ${agent.niche || "general"}. Voice: ${agent.voice || "clear, confident, friendly narrator"}.`,
    `Format: ${agent.aspect}, ${agent.minSeconds}-${agent.maxSeconds} s, no faces on camera.`,
    `Script:\n${script}`,
    s?.thumbnail ? `Thumbnail text: ${s.thumbnail}` : "",
    agent.rules.trim() ? `Rules to follow: ${agent.rules.trim()}` : "",
    `Skills: faceless-explainer (HyperFrames) for the visuals, a TTS voice for the narration, embedded-captions for burned captions.`,
    `When done: upload the MP4 with queue_video_link, then queue_complete with video: true. It lands in Money Agent Studio › Approve. Never post it anywhere.`,
  ];
  return shortBrief(lines.filter(Boolean).join("\n"));
}

function campaignLine(agent: Agent): string {
  const c = agent.campaign!;
  const bits = [
    `Campaign: ${c.brand || agent.name}${c.url ? ` (${c.url})` : ""}`,
    agent.ratePer1k ? `pays $${agent.ratePer1k}/1K views` : "",
    c.platforms.length ? `for ${c.platforms.join(", ")}` : "",
    c.minViews ? `min ${c.minViews.toLocaleString("en-US")} views` : "",
  ];
  return `${bits.filter(Boolean).join(", ")}. Follow the campaign's rules exactly or it won't pay.`;
}

// ----- In Queue status ----------------------------------------------------

export interface QueueLike {
  requests: { id: string; status: "open" | "working"; notes?: { text: string }[] }[];
  finished: { id: string; result?: string; video?: unknown }[];
}

export type MakeState =
  | { state: "none" }
  | { state: "waiting" }
  | { state: "working"; note: string }
  | { state: "done"; hasVideo: true }
  | { state: "done-no-video"; note: string }
  | { state: "gone" };

/** Where the PC is with an item, read from In Queue. */
export function makeState(item: Item, q: QueueLike | null): MakeState {
  if (!item.requestId) return { state: "none" };
  if (!q) return { state: "waiting" };
  const open = q.requests.find((r) => r.id === item.requestId);
  if (open) {
    const note = open.notes?.length ? open.notes[open.notes.length - 1].text : "";
    return open.status === "working" ? { state: "working", note } : { state: "waiting" };
  }
  const done = q.finished.find((f) => f.id === item.requestId);
  if (done) return done.video ? { state: "done", hasVideo: true } : { state: "done-no-video", note: done.result ?? "" };
  return { state: "gone" };
}

/**
 * Items whose video has come back move to Approve by themselves.
 * Returns the ids that should move; the caller writes the change.
 */
export function arrivedFromPc(items: Item[], q: QueueLike | null): string[] {
  return items.filter((i) => i.stage === "rendering" && makeState(i, q).state === "done").map((i) => i.id);
}

/** Approved items Personas Studio has since posted — they move to Posted by themselves. */
export function wentLive(items: Item[], personas: Persona[]): string[] {
  return items.filter((i) => i.stage === "approved" && isLive(i, personas)).map((i) => i.id);
}

// ----- views & money --------------------------------------------------------

/** Views for an item: Personas Studio's synced number first, then the owner's own count. */
export function itemViews(item: Item, personas: Persona[]): number {
  if (item.personaId && item.draftId) {
    const persona = personas.find((p) => p.id === item.personaId);
    const posts = persona?.posts.filter((p) => p.draftId === item.draftId) ?? [];
    const synced = posts.reduce((s, p) => s + (p.stats?.views ?? 0), 0);
    if (synced > 0) return synced;
  }
  return item.manualViews ?? 0;
}

/** True when Personas Studio has seen this item go live. */
export function isLive(item: Item, personas: Persona[]): boolean {
  if (item.stage === "posted") return true;
  if (!item.personaId || !item.draftId) return false;
  const persona = personas.find((p) => p.id === item.personaId);
  return Boolean(persona?.posts.some((p) => p.draftId === item.draftId) || persona?.drafts.some((d) => d.id === item.draftId && d.stage === "posted"));
}

/** What an item has probably earned, from its views. Never stored — always recomputed. */
export function estimate(item: Item, agent: Agent, personas: Persona[]): number {
  if (!agent.ratePer1k) return 0;
  const views = itemViews(item, personas);
  if (agent.campaign?.minViews && views < agent.campaign.minViews) return 0;
  return (views / 1000) * agent.ratePer1k;
}

export interface AgentSummary {
  made: number;
  waiting: number;
  live: number;
  views: number;
  estimated: number;
  paid: number;
  /** Paid per live video — the number that says whether an agent is worth running. */
  perVideo: number;
}

export function summarize(agent: Agent, b: Board, personas: Persona[]): AgentSummary {
  const items = b.items.filter((i) => i.agentId === agent.id && i.stage !== "rejected");
  const live = items.filter((i) => isLive(i, personas));
  const views = items.reduce((s, i) => s + itemViews(i, personas), 0);
  let estimated = items.reduce((s, i) => s + estimate(i, agent, personas), 0);
  if (agent.campaign?.budget) estimated = Math.min(estimated, agent.campaign.budget);
  const paid = b.payouts.filter((p) => p.agentId === agent.id).reduce((s, p) => s + p.amount, 0);
  return {
    made: items.filter((i) => ["ready", "approved", "posted"].includes(i.stage)).length,
    waiting: items.filter((i) => i.stage === "ready").length,
    live: live.length,
    views,
    estimated,
    paid,
    perVideo: live.length ? paid / live.length : 0,
  };
}

export interface Totals {
  paidThisMonth: number;
  paidAllTime: number;
  estimated: number;
  views: number;
  waiting: number;
  stageCounts: Record<ItemStage, number>;
}

export function totals(b: Board, personas: Persona[], today: string = localDay()): Totals {
  const month = today.slice(0, 7);
  const stageCounts = Object.fromEntries(STAGE_IDS.map((s) => [s, 0])) as Record<ItemStage, number>;
  for (const i of b.items) stageCounts[i.stage]++;
  let estimated = 0;
  let views = 0;
  for (const a of b.agents) {
    const s = summarize(a, b, personas);
    estimated += s.estimated;
    views += s.views;
  }
  return {
    paidThisMonth: b.payouts.filter((p) => p.date.startsWith(month)).reduce((s, p) => s + p.amount, 0),
    paidAllTime: b.payouts.reduce((s, p) => s + p.amount, 0),
    estimated,
    views,
    waiting: stageCounts.ready,
    stageCounts,
  };
}

/** Money per day for the last `days` days, oldest first, for the chart. */
export function dailyPaid(payouts: Payout[], days: number, today: string = localDay()): { day: string; amount: number }[] {
  const end = new Date(`${today}T12:00:00`);
  const out: { day: string; amount: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const day = localDay(d);
    out.push({ day, amount: payouts.filter((p) => p.date === day).reduce((s, p) => s + p.amount, 0) });
  }
  return out;
}

export function money(n: number): string {
  const abs = Math.abs(n);
  const digits = abs > 0 && abs < 1000 && Math.round(abs * 100) % 100 !== 0 ? 2 : 0;
  return `${n < 0 ? "-" : ""}$${abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

// ----- the hand-off to Personas Studio --------------------------------------

/**
 * The Personas Studio draft an approved item becomes.
 *
 * Ready (or Scheduled when a time was picked) — Personas Studio's own calendar
 * and posting queue take it from there, through the accounts it already has
 * connected. This app never posts anything itself.
 */
export function draftFor(
  item: Item,
  agent: Agent,
  opts: { accountIds: string[]; scheduledAt: string | null; media: DraftMedia | null; draftId: string },
): Draft {
  const at = new Date().toISOString();
  const outline = item.script ? item.script.beats.slice(0, 12) : item.why ? [item.why] : [];
  return {
    id: opts.draftId,
    title: item.title || item.hook || "Money Agent clip",
    hook: item.hook,
    caption: item.caption,
    hashtags: item.hashtags,
    outline,
    notes: [
      `From Money Agent Studio — agent "${agent.name}".`,
      item.sourceUrl ? `Source: ${item.sourceUrl}${item.start !== null ? ` @ ${formatTime(item.start)}` : ""}` : "",
      agent.campaign?.url ? `Campaign: ${agent.campaign.url} — submit the posted link there to get paid.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    stage: opts.scheduledAt ? "scheduled" : "ready",
    accountIds: opts.accountIds,
    scheduledAt: opts.scheduledAt,
    media: opts.media,
    results: [],
    createdAt: at,
    updatedAt: at,
  };
}

/** Caption + hashtags for a clip when the AI did not write one. */
export function defaultCaption(item: Pick<Item, "hook" | "title">, agent: Agent): { caption: string; hashtags: string[] } {
  const base = item.hook || item.title || agent.niche;
  const words = (agent.niche || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);
  return { caption: base, hashtags: Array.from(new Set([...words, "fyp", "viral"])) };
}

/** Which Personas Studio accounts an agent can post to. */
export function accountsOf(personas: Persona[], personaId: string | null) {
  return personas.find((p) => p.id === personaId)?.accounts ?? [];
}

/** True when an agent has nowhere to post yet — the most common reason nothing happens. */
export function needsPersona(agent: Agent, personas: Persona[]): boolean {
  return !agent.personaId || !personas.some((p) => p.id === agent.personaId);
}
