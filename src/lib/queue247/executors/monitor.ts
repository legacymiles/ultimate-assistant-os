// ---------------------------------------------------------------------------
// Monitor — watches endpoints and reports problems, only on CHANGE.
//
// Each round checks every target (status, latency, optional expected text),
// compares with the last round kept in state, and raises an alert finding +
// notification when something goes down, gets slow or comes back. A target
// that has been down for six rounds is not re-announced six times.
// ---------------------------------------------------------------------------

import type { StepResult } from "../engine";
import type { Executor, StepContext } from "./types";

export interface CheckResult {
  url: string;
  ok: boolean;
  status: number | null;
  ms: number;
  error?: string;
}

interface MonitorState {
  last?: Record<string, { ok: boolean; since: string; slow?: boolean }>;
  rounds?: number;
}

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

export function extractUrls(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;]+$/, "")))].slice(0, 30);
}

export function targetsOf(config: Record<string, unknown>, answers: unknown): string[] {
  const fromConfig = Array.isArray(config.urls) ? config.urls.map(String) : [];
  const fromAnswers = Array.isArray(answers) ? (answers as { a: string }[]).flatMap((x) => extractUrls(String(x.a ?? ""))) : [];
  return [...new Set([...fromConfig, ...fromAnswers])].filter((u) => /^https?:\/\//i.test(u)).slice(0, 30);
}

/** What changed between two rounds, as plain alerts. */
export function diffRound(
  prev: MonitorState["last"],
  now: CheckResult[],
  slowMs: number,
): { url: string; kind: "down" | "up" | "slow"; text: string }[] {
  const out: { url: string; kind: "down" | "up" | "slow"; text: string }[] = [];
  for (const r of now) {
    const before = prev?.[r.url];
    const slow = r.ok && r.ms > slowMs;
    if (!r.ok && (!before || before.ok)) out.push({ url: r.url, kind: "down", text: `${r.url} is DOWN — ${r.error ?? `HTTP ${r.status}`}` });
    else if (r.ok && before && !before.ok) out.push({ url: r.url, kind: "up", text: `${r.url} is back up (HTTP ${r.status}, ${r.ms} ms)` });
    else if (slow && !before?.slow) out.push({ url: r.url, kind: "slow", text: `${r.url} is slow: ${r.ms} ms` });
  }
  return out;
}

async function check(url: string, expect: { status?: number; contains?: string; strictAuth?: boolean }, signal: AbortSignal): Promise<CheckResult> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "jarvis-queue-247-monitor" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    const ms = Date.now() - started;
    // A server answering "sign-in required" (401/403) is up — it is just
    // protected (SearXNG behind its bearer token). strictAuth: true counts it down.
    const protectedOk = !expect.strictAuth && (res.status === 401 || res.status === 403);
    let ok = expect.status ? res.status === expect.status : res.ok || protectedOk;
    let error: string | undefined;
    if (ok && expect.contains) {
      const body = await res.text();
      if (!body.includes(expect.contains)) {
        ok = false;
        error = `page no longer contains "${expect.contains}"`;
      }
    }
    return { url, ok, status: res.status, ms, ...(error ? { error } : !ok ? { error: `HTTP ${res.status}` } : {}) };
  } catch (e) {
    return { url, ok: false, status: null, ms: Date.now() - started, error: (e as Error).name === "TimeoutError" ? "timed out after 20 s" : (e as Error).message };
  }
}

async function run(ctx: StepContext): Promise<StepResult> {
  const st = ctx.state as MonitorState;
  const targets = targetsOf(ctx.task.config, ctx.state.answers);
  if (!targets.length) {
    return {
      outcome: "needs_input",
      question: "Which addresses should I watch? Paste the URLs (health endpoints, dashboards, APIs) — one per line.",
    };
  }
  const slowMs = Math.max(500, Number(ctx.task.config.slowMs) || 5000);
  const expect = {
    status: Number(ctx.task.config.expectStatus) || undefined,
    contains: typeof ctx.task.config.contains === "string" ? ctx.task.config.contains : undefined,
    strictAuth: ctx.task.config.strictAuth === true,
  };
  await ctx.progress(10, `Checking ${targets.length} target${targets.length === 1 ? "" : "s"}`);
  const results: CheckResult[] = [];
  for (const [i, url] of targets.entries()) {
    if (ctx.signal.aborted) break;
    const r = await check(url, expect, ctx.signal);
    results.push(r);
    await ctx.log(`${r.ok ? "OK" : "FAIL"} ${url} — ${r.status ?? "no answer"} in ${r.ms} ms${r.error ? ` (${r.error})` : ""}`, { ...r }, r.ok ? "info" : "warn");
    await ctx.progress(10 + Math.round(((i + 1) / targets.length) * 80), `Checked ${i + 1}/${targets.length}`);
  }
  const alerts = diffRound(st.last, results, slowMs);
  const nowIso = ctx.now().toISOString();
  const last: NonNullable<MonitorState["last"]> = {};
  for (const r of results) {
    const before = st.last?.[r.url];
    last[r.url] = { ok: r.ok, since: before && before.ok === r.ok ? before.since : nowIso, slow: r.ok && r.ms > slowMs };
  }
  st.last = last;
  st.rounds = (st.rounds ?? 0) + 1;
  for (const a of alerts) {
    await ctx.finding({
      kind: "alert",
      key: `${ctx.task.id}:${a.url}:${a.kind}:${nowIso}`,
      title: a.text,
      summary: `${ctx.task.title}: ${a.text}`,
      url: a.url,
      data: { kind: a.kind, round: st.rounds },
      notable: a.kind !== "up",
    });
    await ctx.notify(a.kind === "up" ? "Recovered" : "Problem detected", a.text, a.url);
  }
  const down = results.filter((r) => !r.ok).length;
  const summary = down
    ? `${down} of ${results.length} failing: ${results.filter((r) => !r.ok).map((r) => r.url).join(", ")}`
    : `All ${results.length} healthy (slowest ${Math.max(...results.map((r) => r.ms))} ms).`;
  await ctx.log(summary, undefined, "result");
  return { outcome: "done", summary };
}

export const monitorExecutor: Executor = {
  id: "monitor",
  agent: "Monitor",
  describe:
    "Watches URLs/health endpoints on a schedule and alerts only when something goes down, gets slow or recovers. Use for 'monitor X and report problems'. Asks for the URLs when none are known.",
  configHelp: {
    urls: "Addresses to check (array of http(s) URLs).",
    expectStatus: "Exact HTTP status expected (default: any 2xx).",
    contains: "Text the page must contain.",
    slowMs: "Latency that counts as slow (default 5000).",
    strictAuth: "true = a 401/403 (sign-in required) counts as down. Default: protected endpoints count as up.",
  },
  needs: ["web"],
  defaultKind: "continuous",
  concurrency: 4,
  initialSteps: () => ["Check every target", "Compare with last round", "Alert on changes"],
  run,
};
