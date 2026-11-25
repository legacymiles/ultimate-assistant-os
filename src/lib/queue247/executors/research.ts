// ---------------------------------------------------------------------------
// Research agent — finds what is new about a topic, reads it, and keeps only
// what it has not reported before.
//
// One round:  plan queries → search (web / news / GitHub) → drop everything
// already known (findings memory, by URL) → read the best new pages →
// write one note per source + a round digest.
//
// Run once it answers a question; run recurring or continuous it becomes a
// standing watch ("research new video generation techniques every day") that
// only ever tells the owner about things it has not told them before.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type { StepResult } from "../engine";
import { markStep } from "../engine";
import type { Executor, StepContext } from "./types";
import { aiReady, askJson } from "../server/ai";
import { readPage, searchNews, searchWeb } from "@/lib/search/client";

type Source = "web" | "news" | "github";

interface Hit {
  url: string;
  title: string;
  snippet: string;
  source: Source;
  meta?: Record<string, unknown>;
}

interface ResearchState {
  phase?: "plan" | "search" | "read" | "digest";
  round?: number;
  queries?: string[];
  qi?: number;
  hits?: Hit[];
  ri?: number;
  notes?: { key: string; title: string; score: number }[];
  pastQueries?: string[];
}

export function urlKey(url: string): string {
  const norm = url.trim().replace(/#.*$/, "").replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "").toLowerCase();
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

function topicOf(ctx: StepContext): string {
  const c = ctx.task.config;
  return String(c.topic || ctx.task.instruction || ctx.task.title).slice(0, 400);
}

function sourcesOf(ctx: StepContext): Source[] {
  const raw = ctx.task.config.sources;
  const list = Array.isArray(raw) ? raw.map(String) : ["web", "news"];
  const ok = list.filter((s): s is Source => s === "web" || s === "news" || s === "github");
  return ok.length ? ok : ["web"];
}

/** Queries without a model: the topic itself plus a couple of "what's new" phrasings. */
export function fallbackQueries(topic: string, round: number): string[] {
  const base = topic.replace(/^(find|research|look for|search for)\s+/i, "").trim();
  const year = new Date().getFullYear();
  const variants = [base, `${base} new ${year}`, `${base} latest release`, `${base} open source github`, `${base} tutorial technique`];
  // Rotate so a standing watch does not run the identical three searches forever.
  const start = round % variants.length;
  return [...variants.slice(start), ...variants.slice(0, start)].slice(0, 3);
}

async function planQueries(ctx: StepContext, st: ResearchState): Promise<string[]> {
  const topic = topicOf(ctx);
  const custom = Array.isArray(ctx.task.config.queries) ? (ctx.task.config.queries as unknown[]).map(String).filter(Boolean) : [];
  if (custom.length) return custom.slice(0, 6);
  if (!aiReady()) {
    await ctx.log("No AI key on this worker — searching with plain queries built from the topic.", undefined, "warn");
    return fallbackQueries(topic, st.round ?? 0);
  }
  const known = await ctx.recentFindings({ kind: "research-note", limit: 15 });
  const guidance = Array.isArray(ctx.state.guidance) ? (ctx.state.guidance as { text: string }[]).map((g) => g.text).join("\n") : "";
  try {
    const out = await askJson<{ queries?: string[] }>(
      "You plan web searches for a research agent. Return JSON {\"queries\": string[]} with 3-5 specific search queries " +
        "that find NEW, concrete material (releases, repos, papers, techniques, tools) about the topic. Avoid repeating past queries. " +
        "Prefer queries that surface primary sources.",
      [
        `Topic: ${topic}`,
        ctx.task.config.focus ? `Focus: ${String(ctx.task.config.focus)}` : "",
        guidance ? `Owner guidance:\n${guidance}` : "",
        st.pastQueries?.length ? `Past queries (do not repeat): ${st.pastQueries.slice(-12).join(" | ")}` : "",
        known.length ? `Already found (skip these): ${known.map((k) => k.title).join(" | ")}` : "",
      ].filter(Boolean).join("\n"),
      { meter: ctx.meter, maxTokens: 800 },
    );
    const q = (out.queries ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
    return q.length ? q : fallbackQueries(topic, st.round ?? 0);
  } catch (e) {
    await ctx.log(`Query planning failed (${(e as Error).message}); using plain queries.`, undefined, "warn");
    return fallbackQueries(topic, st.round ?? 0);
  }
}

async function githubSearch(q: string, signal: AbortSignal): Promise<Hit[]> {
  const token = process.env.JARVIS_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  const res = await fetch(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=10`,
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "jarvis-queue-247", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal },
  );
  if (!res.ok) throw new Error(`GitHub search ${res.status}`);
  const body = (await res.json()) as { items?: { html_url: string; full_name: string; description: string | null; stargazers_count: number; pushed_at: string; license?: { spdx_id?: string } | null; language?: string | null }[] };
  return (body.items ?? []).map((r) => ({
    url: r.html_url,
    title: r.full_name,
    snippet: r.description ?? "",
    source: "github" as const,
    meta: { stars: r.stargazers_count, pushedAt: r.pushed_at, license: r.license?.spdx_id ?? null, language: r.language ?? null },
  }));
}

async function runRound(ctx: StepContext): Promise<StepResult> {
  const st = ctx.state as ResearchState;
  st.phase ??= "plan";
  st.round ??= 0;
  const perRound = Math.max(2, Math.min(15, Number(ctx.task.config.maxPerRound) || 6));

  if (st.phase === "plan") {
    ctx.steps.splice(0, ctx.steps.length, ...initialSteps().map((label, i) => ({ id: `s${i + 1}`, label, state: "pending" as const })));
    st.queries = await planQueries(ctx, st);
    st.qi = 0;
    st.hits = [];
    st.ri = 0;
    st.notes = [];
    st.pastQueries = [...(st.pastQueries ?? []), ...st.queries].slice(-40);
    replaceSteps(ctx, "s1", "done", `${st.queries.length} searches planned`);
    await ctx.log(`Round ${st.round + 1}: planned ${st.queries.length} searches — ${st.queries.join(" · ")}`, undefined, "step");
    await ctx.progress(10, "Searching");
    st.phase = "search";
    return { outcome: "continue" };
  }

  if (st.phase === "search") {
    const queries = st.queries ?? [];
    const sources = sourcesOf(ctx);
    // A step searches one query on every source — bounded, and the log reads naturally.
    const q = queries[st.qi ?? 0];
    if (q !== undefined) {
      for (const src of sources) {
        if (ctx.signal.aborted) break;
        try {
          ctx.meter.searches += 1;
          const found: Hit[] =
            src === "github"
              ? await githubSearch(q, ctx.signal)
              : (await (src === "news" ? searchNews : searchWeb)(q, { app: "queue-247", limit: 8 })).results.map((r) => ({
                  url: r.url,
                  title: r.title,
                  snippet: r.description,
                  source: src,
                }));
          st.hits = [...(st.hits ?? []), ...found];
          await ctx.log(`${src} "${q}": ${found.length} results`);
        } catch (e) {
          await ctx.log(`${src} search for "${q}" failed: ${(e as Error).message}`, undefined, "warn");
        }
      }
      st.qi = (st.qi ?? 0) + 1;
      await ctx.progress(10 + Math.round(((st.qi ?? 0) / Math.max(1, queries.length)) * 35), `Searching (${st.qi}/${queries.length})`);
      if ((st.qi ?? 0) < queries.length) return { outcome: "continue" };
    }
    // Dedupe within the round and against everything already reported.
    const byKey = new Map<string, Hit>();
    for (const h of st.hits ?? []) if (h.url && !byKey.has(urlKey(h.url))) byKey.set(urlKey(h.url), h);
    const kind = (h: Hit) => (h.source === "github" ? "repo" : "research-note");
    const known = new Set<string>();
    for (const k of ["repo", "research-note"]) {
      const keys = [...byKey.entries()].filter(([, h]) => kind(h) === k).map(([key]) => key);
      for (const x of await ctx.knownKeys(k, keys)) known.add(x);
    }
    const fresh = [...byKey.entries()].filter(([k]) => !known.has(k)).map(([, h]) => h);
    await ctx.log(`${byKey.size} unique results, ${byKey.size - fresh.length} already known, ${fresh.length} new.`, undefined, "step");
    st.hits = fresh.slice(0, perRound);
    replaceSteps(ctx, "s2", "done", `${fresh.length} new of ${byKey.size}`);
    st.phase = "read";
    st.ri = 0;
    return { outcome: "continue" };
  }

  if (st.phase === "read") {
    const hits = st.hits ?? [];
    // Up to 3 pages a step.
    for (let n = 0; n < 3 && (st.ri ?? 0) < hits.length; n++) {
      if (ctx.signal.aborted) break;
      const h = hits[st.ri ?? 0];
      st.ri = (st.ri ?? 0) + 1;
      await noteFor(ctx, h, st);
    }
    await ctx.progress(45 + Math.round(((st.ri ?? 0) / Math.max(1, hits.length)) * 45), `Reading (${st.ri}/${hits.length})`);
    if ((st.ri ?? 0) < hits.length) return { outcome: "continue" };
    replaceSteps(ctx, "s3", "done", `${st.notes?.length ?? 0} notes written`);
    st.phase = "digest";
    return { outcome: "continue" };
  }

  // digest
  const notes = st.notes ?? [];
  const round = (st.round ?? 0) + 1;
  const top = [...notes].sort((a, b) => b.score - a.score).slice(0, 5);
  const summary = notes.length
    ? `Round ${round}: ${notes.length} new finding${notes.length === 1 ? "" : "s"} — top: ${top.map((t) => t.title).join("; ")}`
    : `Round ${round}: nothing new since last time.`;
  if (notes.length) {
    await ctx.finding({
      kind: "research-digest",
      key: `${ctx.task.id}:round${round}`,
      title: `${ctx.task.title} — round ${round}`,
      summary,
      data: { notes: top, topic: topicOf(ctx) },
      notable: top.some((t) => t.score >= 85),
    });
  }
  replaceSteps(ctx, "s4", "done", summary);
  await ctx.log(summary, undefined, "result");
  await ctx.progress(100, "Round finished");
  st.round = round;
  st.phase = "plan";
  st.hits = [];
  return { outcome: "done", summary };
}

async function noteFor(ctx: StepContext, h: Hit, st: ResearchState): Promise<void> {
  const kind = h.source === "github" ? "repo" : "research-note";
  let text = h.snippet;
  if (h.source !== "github") {
    const page = await readPage(h.url).catch(() => null);
    if (page && !page.error && page.text) text = page.text.slice(0, 6000);
  }
  let title = h.title;
  let summary = h.snippet || text.slice(0, 300);
  let score = h.source === "github" ? Math.min(90, 40 + Math.log10(1 + Number(h.meta?.stars ?? 0)) * 12) : 50;
  let why = "";
  if (aiReady()) {
    try {
      const out = await askJson<{ title?: string; summary?: string; relevance?: number; why?: string }>(
        "You are a research analyst. Given a source and the research topic, return JSON {title, summary (3-5 sentences of concrete facts: what it is, what is new, how to use it), relevance (0-100: how useful for the topic, 90+ only for genuinely new and directly applicable), why (one sentence)}. Never invent facts not in the text.",
        `Topic: ${topicOf(ctx)}\nSource: ${h.url}\nTitle: ${h.title}\n${h.meta ? `Meta: ${JSON.stringify(h.meta)}\n` : ""}Text:\n${text}`,
        { meter: ctx.meter, maxTokens: 700 },
      );
      title = String(out.title || title).slice(0, 200);
      summary = String(out.summary || summary).slice(0, 2000);
      score = Math.max(0, Math.min(100, Number(out.relevance) || score));
      why = String(out.why || "");
    } catch (e) {
      await ctx.log(`Could not summarise ${h.url}: ${(e as Error).message}`, undefined, "warn");
    }
  }
  const key = urlKey(h.url);
  const { isNew } = await ctx.finding({
    kind,
    key,
    title,
    summary,
    url: h.url,
    score: Math.round(score),
    data: { source: h.source, why, meta: h.meta ?? {}, topic: topicOf(ctx), round: (st.round ?? 0) + 1 },
    notable: score >= 85,
  });
  if (isNew) {
    st.notes = [...(st.notes ?? []), { key, title, score: Math.round(score) }];
    await ctx.log(`Noted: ${title} (${Math.round(score)})`, { url: h.url });
    if (score >= 85) await ctx.notify(`New find: ${title}`, summary.slice(0, 300), h.url);
  }
}

function replaceSteps(ctx: StepContext, id: string, state: "done" | "active", note: string) {
  const next = markStep(ctx.steps, id, state, note, ctx.now());
  ctx.steps.splice(0, ctx.steps.length, ...next);
}

function initialSteps(): string[] {
  return ["Plan searches", "Search sources", "Read new sources", "Write the round digest"];
}

export const researchExecutor: Executor = {
  id: "research",
  agent: "Research agent",
  describe:
    "Web/news/GitHub research on a topic: plans queries, reads new sources, writes notes, and never reports the same source twice. Use for 'find…', 'research…', 'find better open-source repositories for…', standing watches of a field.",
  configHelp: {
    topic: "What to research, in plain words.",
    sources: 'Any of "web", "news", "github". Default ["web","news"]; add "github" for repositories/open-source.',
    queries: "Optional exact search queries; otherwise planned each round.",
    focus: "Optional angle, e.g. 'self-hostable, MIT licensed'.",
    maxPerRound: "New sources to read per round, 2-15 (default 6).",
  },
  needs: ["web"],
  defaultKind: "once",
  concurrency: 3,
  initialSteps: () => initialSteps(),
  run: runRound,
};
