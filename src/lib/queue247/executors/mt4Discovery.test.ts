import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/search/client", () => ({
  searchWeb: vi.fn(async () => ({
    query: "q",
    kind: "web",
    answer: null,
    results: [
      { url: "https://blog.example.com/free-ea", title: "Free EA download", description: "Grab it" },
      { url: "https://blog.example.com/nothing", title: "Forex news", description: "" },
    ],
  })),
}));
vi.mock("../server/ai", () => ({ aiReady: () => false, askJson: vi.fn() }));

import type { Finding, Task, TaskStep } from "../types";
import type { NewFinding, StepContext } from "./types";
import { BACKTEST_NOT_RUN, mt4DiscoveryExecutor, type Mt4State } from "./mt4Discovery";

const CLEAN_EA = `#property copyright "Example Labs"
#property version   "1.30"
#property strict
input double RiskPercent  = 1.0;
input int    StopLoss     = 300;
input int    TakeProfit   = 600;
input int    MaxSpread    = 30;
input int    Slippage     = 3;
input double MaxDrawdownPct = 20.0;
input int    MagicNumber  = 20240101;
datetime lastBarTime = 0;
double LotsFor(double sl) { double lots = AccountBalance() * RiskPercent / 100.0 / (sl * MarketInfo(Symbol(), MODE_TICKVALUE)); return NormalizeDouble(lots, 2); }
void OnTick()
{
   if (Time[0] == lastBarTime) return;
   lastBarTime = Time[0];
   if (MarketInfo(Symbol(), MODE_SPREAD) > MaxSpread) return;
   if (AccountEquity() < AccountBalance() * (1.0 - MaxDrawdownPct / 100.0)) return;
   double fast = iMA(NULL, 0, 20, 0, MODE_EMA, PRICE_CLOSE, 1);
   double slow = iMA(NULL, 0, 50, 0, MODE_EMA, PRICE_CLOSE, 1);
   if (OrdersTotal() < 1 && fast > slow) {
      int t = OrderSend(Symbol(), OP_BUY, LotsFor(StopLoss), Ask, Slippage, Ask - StopLoss * Point, Ask + TakeProfit * Point, "ma", MagicNumber, 0, clrGreen);
      if (t < 0) Print(GetLastError());
   }
}
`;

const MARTI_EA = `#property version "2.0"
extern double Lots = 0.01;
extern double LotExponent = 2.0;
extern int PipStep = 20;
int start() {
  if (OrdersTotal() == 0) { OrderSend(Symbol(), OP_BUY, Lots, Ask, 3, 0, 0, "", 1, 0, Blue); return(0); }
  OrderSelect(OrdersTotal() - 1, SELECT_BY_POS, MODE_TRADES);
  if (OrderProfit() < 0 && Ask < OrderOpenPrice() - PipStep * Point)
    OrderSend(Symbol(), OP_BUY, OrderLots() * LotExponent, Ask, 3, 0, 0, "", 1, 0, Blue);
  return(0);
}
`;

const REPO_SEARCH = {
  items: [
    { full_name: "pipdev/ea-pack", html_url: "https://github.com/pipdev/ea-pack", owner: { login: "pipdev" }, description: "Two EAs", pushed_at: "2026-11-21T10:00:00Z", default_branch: "main", stargazers_count: 3 },
  ],
};
const TREE = {
  tree: [
    { path: "Experts/MACross.mq4", type: "blob", size: 2000 },
    { path: "Experts/Doubler.mq4", type: "blob", size: 900 },
    { path: "Experts/Doubler.ex4", type: "blob", size: 9000 },
  ],
};
const TG_HTML = `<div class="tgme_widget_message js-widget_message" data-post="eachannel/50">
  <a class="tgme_widget_message_document_wrap" href="https://t.me/eachannel/50"><div class="tgme_widget_message_document_title accent_color" dir="auto">MegaProfit.ex4</div></a>
  <div class="tgme_widget_message_text js-message_text" dir="auto">MegaProfit EA for MT4<br/>300% per month, no loss!</div>
  <time datetime="2026-11-23T08:00:00+00:00" class="time">08:00</time>
</div>
<div class="tgme_widget_message js-widget_message" data-post="eachannel/51">
  <div class="tgme_widget_message_text js-message_text" dir="auto">Same MA EA re-uploaded: <a href="https://mirror.example.net/MACross_copy.mq4">MACross_copy.mq4</a></div>
  <time datetime="2026-11-23T09:00:00+00:00" class="time">09:00</time>
</div>`;
const BLOG = `<title>Free EA download</title><p>EA for MT4</p><a href="https://github.com/pipdev/ea-pack">source</a><a href="/files/Thing.ex4">binary</a>`;

function makeTask(config: Record<string, unknown>): Task {
  const now = "2026-11-25T00:00:00Z";
  return {
    id: "t1", user_id: "u1", title: "Find MT4 bots", description: "", instruction: "find new mt4 bots", app: "", executor: "mt4-discovery",
    agent: "MT4 Bot Discovery", kind: "continuous", status: "running", priority: 3, progress: 0, current_step: "", steps: [], config, state: {},
    schedule: { everyMinutes: 60 }, next_run_at: null, last_run_at: null, last_activity_at: null, attempts: 0, max_attempts: 5, parent_id: null,
    depends_on: [], needs: ["web"], locked_by: null, lock_until: null, success_count: 0, failure_count: 0, last_error: null, result_summary: null,
    question: null, created_by: "you", created_at: now, updated_at: now,
  };
}

function makeCtx(config: Record<string, unknown>) {
  const findings = new Map<string, Finding>();
  const logs: { message: string; level?: string }[] = [];
  const notes: { title: string; body: string; link?: string }[] = [];
  const state: Record<string, unknown> = {};
  const steps: TaskStep[] = [];
  const ctx: StepContext = {
    task: makeTask(config),
    state,
    steps,
    signal: new AbortController().signal,
    now: () => new Date("2026-11-25T12:00:00Z"),
    log: async (message, _data, level) => void logs.push({ message, level }),
    progress: async () => undefined,
    finding: async (f: NewFinding) => {
      const k = `${f.kind}|${f.key}`;
      const isNew = !findings.has(k);
      const at = "2026-11-25T12:00:00Z";
      findings.set(k, {
        id: `f${findings.size + 1}`, task_id: "t1", user_id: "u1", app: "", kind: f.kind, key: f.key, title: f.title, summary: f.summary,
        url: f.url ?? null, score: f.score ?? null, data: f.data ?? {}, notable: !!f.notable, created_at: at, updated_at: at,
      });
      return { id: k, isNew };
    },
    knownKeys: async (kind, keys) => new Set(keys.filter((k) => findings.has(`${kind}|${k}`))),
    spawn: async () => "child",
    notify: async (title, body, link) => void notes.push({ title, body, link }),
    recentFindings: async ({ kind }) => [...findings.values()].filter((f) => !kind || f.kind === kind),
    meter: { aiCalls: 0, searches: 0 },
  };
  return { ctx, findings, logs, notes, state: state as Mt4State, steps };
}

async function runRound(ctx: StepContext, maxSteps = 40) {
  for (let i = 0; i < maxSteps; i++) {
    const r = await mt4DiscoveryExecutor.run(ctx);
    if (r.outcome !== "continue") return { result: r, steps: i + 1 };
  }
  throw new Error("round never finished");
}

let fetched: string[] = [];

beforeEach(() => {
  fetched = [];
  vi.stubEnv("JARVIS_GITHUB_TOKEN", "");
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    fetched.push(url);
    const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (url.startsWith("https://api.github.com/search/repositories")) return Response.json(REPO_SEARCH, { headers: { "x-ratelimit-remaining": "8" } });
    if (url === "https://api.github.com/repos/pipdev/ea-pack") return Response.json(REPO_SEARCH.items[0]);
    if (url.startsWith("https://api.github.com/repos/pipdev/ea-pack/git/trees/")) return Response.json(TREE);
    if (url.endsWith("/Experts/MACross.mq4") || url === "https://mirror.example.net/MACross_copy.mq4") return new Response(CLEAN_EA);
    if (url.endsWith("/Experts/Doubler.mq4")) return new Response(MARTI_EA);
    if (url === "https://t.me/s/eachannel") return html(TG_HTML);
    if (url === "https://blog.example.com/free-ea") return html(BLOG);
    if (url === "https://blog.example.com/nothing") return html("<title>news</title>");
    return new Response("not found", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("mt4DiscoveryExecutor", () => {
  it("declares itself as a continuous, single-concurrency web worker with the phases as steps", () => {
    expect(mt4DiscoveryExecutor).toMatchObject({ id: "mt4-discovery", agent: "MT4 Bot Discovery", defaultKind: "continuous", concurrency: 1, needs: ["web"] });
    expect(mt4DiscoveryExecutor.initialSteps!({})).toContain("Isolated backtest (needs MT4 tester runner)");
  });

  it("runs a full round: discover → analyze → rank → report, with de-duplication and safety", async () => {
    const { ctx, findings, logs, notes, state, steps } = makeCtx({ telegramChannels: ["eachannel"] });
    const { result } = await runRound(ctx);

    expect(result.outcome).toBe("done");
    expect(result.outcome === "done" && result.summary).toMatch(/^Round 1: checked 3 sources, \d+ new candidates, 2 analyzed, 1 notable/);

    const bots = [...findings.values()];
    const fpBots = bots.filter((f) => f.key.startsWith("fp:"));
    const compiled = bots.filter((f) => f.key.startsWith("src:"));
    expect(fpBots).toHaveLength(2);
    // The Telegram mirror of MACross has the same fingerprint → merged, not duplicated.
    const ma = fpBots.find((f) => f.title.startsWith("MACross"))!;
    expect(ma.notable).toBe(true);
    expect((ma.data.sources as { file: string }[]).map((s) => s.file)).toEqual([
      "https://raw.githubusercontent.com/pipdev/ea-pack/main/Experts/MACross.mq4",
      "https://mirror.example.net/MACross_copy.mq4",
    ]);
    expect(ma.data.backtest).toEqual(BACKTEST_NOT_RUN);
    expect((ma.data.versions as { version: string }[]).map((v) => v.version)).toEqual(["1.30"]);
    expect((ma.data.analysis as { fingerprint: string }).fingerprint).toBe(ma.key.slice(3));

    const doubler = fpBots.find((f) => f.title.startsWith("Doubler"))!;
    expect(doubler.notable).toBe(false);
    expect(doubler.data.strategy).toEqual(expect.arrayContaining(["martingale", "grid"]));
    expect(doubler.score!).toBeLessThanOrEqual(40);

    // Compiled files are recorded, never fetched.
    expect(compiled.map((f) => f.key).sort()).toEqual([
      "src:https://blog.example.com/files/Thing.ex4",
      "src:https://t.me/eachannel/50#MegaProfit.ex4",
    ]);
    expect(fetched.some((u) => /\.ex4($|\?)/i.test(u))).toBe(false);
    const mega = compiled.find((f) => f.key.includes("MegaProfit"))!;
    expect(mega.data.claims).toEqual([{ text: "300% per month, no loss!", status: "unverified", from: "https://t.me/eachannel/50" }]);
    expect(mega.score).toBe(0);
    expect(mega.notable).toBe(false);

    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/MACross/);
    expect(steps.find((s) => s.id === "s3")).toMatchObject({ state: "skipped", note: BACKTEST_NOT_RUN.why });
    expect(steps.filter((s) => s.state === "done").map((s) => s.id)).toEqual(["s1", "s2", "s4", "s5"]);
    expect(state.cursors?.telegram?.eachannel).toBe(51);
    expect(state.cursors?.githubPushed).toBe("2026-11-21T10:00:00Z");
    expect(state.round).toBe(1);
    expect(state.phase).toBe("discover");
    expect(logs.some((l) => /code search skipped/.test(l.message))).toBe(true);
  });

  it("a second round reports nothing new and re-analyses nothing", async () => {
    const { ctx, findings, notes } = makeCtx({ telegramChannels: ["eachannel"] });
    await runRound(ctx);
    const before = findings.size;
    const raws = fetched.filter((u) => u.endsWith(".mq4")).length;
    fetched = [];
    const { result } = await runRound(ctx);
    expect(result.outcome === "done" && result.summary).toMatch(/^Round 2: .* 0 analyzed, 0 notable/);
    expect(findings.size).toBe(before);
    expect(notes).toHaveLength(1);
    // GitHub files of an unchanged push are not downloaded again; Telegram posts are behind the cursor.
    expect(fetched.filter((u) => u.endsWith(".mq4")).length).toBeLessThan(raws);
    expect(fetched.some((u) => u.includes("mirror.example.net"))).toBe(false);
  });

  it("skips Telegram and says so when no channels are configured", async () => {
    const { ctx, logs } = makeCtx({ sources: ["telegram"] });
    const { result } = await runRound(ctx);
    expect(logs.some((l) => /No telegramChannels configured — Telegram skipped/.test(l.message))).toBe(true);
    expect(result.outcome === "done" && result.summary).toMatch(/^Round 1: checked 0 sources, 0 new candidates, 0 analyzed/);
    expect(fetched.some((u) => u.includes("t.me"))).toBe(false);
  });

  it("stops GitHub at the rate limit and skips it until the reset", async () => {
    vi.stubGlobal("fetch", async (input: string) => {
      fetched.push(String(input));
      return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Date.parse("2026-11-25T13:00:00Z") / 1000) } });
    });
    const { ctx, state, logs } = makeCtx({ sources: ["github"] });
    await runRound(ctx);
    expect(state.githubRetryAfter).toBe("2026-11-25T13:00:00.000Z");
    fetched = [];
    await runRound(ctx);
    expect(fetched).toEqual([]);
    expect(logs.some((l) => /GitHub skipped this round — rate-limited/.test(l.message))).toBe(true);
  });

  it("keeps each step bounded to at most 5 files", async () => {
    const { ctx, state } = makeCtx({ telegramChannels: ["eachannel"], filesPerStep: 2 });
    for (let i = 0; i < 3; i++) await mt4DiscoveryExecutor.run(ctx);
    expect(state.phase).toBe("analyze");
    const queued = state.queue!.length;
    await mt4DiscoveryExecutor.run(ctx);
    expect(queued - state.queue!.length).toBeLessThanOrEqual(2);
  });
});
