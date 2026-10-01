"use client";

// ---------------------------------------------------------------------------
// Toolbox › Router — which model answers what, and what it has cost.
//
// The rules on this page are not typed in. They are the same objects the router
// runs on (src/lib/ai/router.ts, TIER_RULES), so the page cannot claim a rule
// the code does not follow — the drift that makes a settings screen worse than
// no settings screen.
//
// Read-only on purpose, with one switch. The owner asked to SEE the routing and
// ask for changes, and every rule here is a decision about money and quality
// that deserves a conversation, not a dropdown nobody remembers setting. The one
// control is the router itself: off restores the old single-default behaviour.
//
// Four regions, in the order the questions get asked: what is it doing right now,
// what are the rules, what has today cost, and what were the last calls.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons";
import { TIER_RULES, type Modality, type RouterModel } from "@/lib/ai/router";
// The same short name the error messages use, so a model reads identically
// whether it is being listed here or named in a failure.
import { shortModel } from "@/lib/ai/trouble";
import { localDay, money, type SpendCall, type SpendFeed } from "@/lib/jarvis/updates";

interface Report extends SpendFeed {
  countedEver: number;
  note: string;
}

interface Settings {
  model: string | null;
  router: boolean;
  fallbackModels: string[];
}

/** What a model reads, as one compact machine-voice string. */
function readsLine(model: RouterModel): string {
  const order: Modality[] = ["text", "image", "audio", "video", "file"];
  return order
    .filter((m) => model.reads.includes(m))
    .map((m) => m[0].toUpperCase())
    .join(" ");
}

function priceLine(model: RouterModel): string {
  if (!model.price) return "routed";
  const [inP, outP] = model.price;
  if (inP === 0 && outP === 0) return "free";
  return `${inP} / ${outP}`;
}

const label = "text-[10px] font-medium uppercase tracking-wide text-ink-faint";
const cell = "py-2 pr-3 align-top";

/** A label above a value, sharing one baseline across the strip. */
function Fact({ name, children, tone = "" }: { name: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <div className={label}>{name}</div>
      <div className={`mt-0.5 truncate font-mono text-[13px] tabular-nums ${tone || "text-ink"}`}>{children}</div>
    </div>
  );
}

export function RouterTab() {
  const [report, setReport] = useState<Report | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    fetch("/api/ai/spend", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Report>) : Promise.reject(new Error(`The ledger answered ${r.status}.`))))
      .then((r) => {
        setReport(r);
        setError("");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "The ledger could not be read."));
    fetch("/api/ai/status", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ settings: Settings }>) : null))
      .then((s) => setSettings(s?.settings ?? null))
      .catch(() => setSettings(null));
  }, []);

  useEffect(load, [load]);

  const setRouter = async (on: boolean) => {
    setSaving(true);
    // Optimistic, then corrected by what the server actually stored: this switch
    // changes where every call in the hub goes, so the page must end up showing
    // the saved value rather than the clicked one.
    setSettings((s) => (s ? { ...s, router: on } : s));
    try {
      const res = await fetch("/api/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ router: on }),
      });
      const body = (await res.json()) as { settings?: Settings; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Could not save (${res.status}).`);
      if (body.settings) setSettings(body.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the router switch.");
      load();
    } finally {
      setSaving(false);
    }
  };

  const calls = report?.recent ?? [];
  const today = localDay(new Date().toISOString());
  const todays = calls.filter((c) => localDay(c.at) === today);
  const spentToday = todays.reduce((sum, c) => sum + c.cost, 0);
  const freeToday = todays.filter((c) => c.cost === 0 && !c.failed).length;
  const failedToday = todays.filter((c) => c.failed).length;
  const loaded = report !== null;
  // Which rungs are actually refusing, derived from the calls themselves rather
  // than from a cooldown map this route cannot see. Newest reason wins.
  const benched = new Map<string, { why: string; times: number }>();
  for (const call of report?.recent ?? []) {
    for (const s of call.skipped ?? []) {
      const seen = benched.get(s.model);
      benched.set(s.model, { why: s.why, times: (seen?.times ?? 0) + 1 });
    }
  }
  const left = report?.account?.remaining;
  const dry = left !== undefined && left <= 0;
  const low = left !== undefined && left > 0 && left <= 2;

  // Today, by model. A day's shape is "which models did I actually use", and that
  // is a two-column question, so it is a table and not a chart.
  const byModel = new Map<string, { calls: number; cost: number; failed: number }>();
  for (const c of todays) {
    const row = byModel.get(c.model) ?? { calls: 0, cost: 0, failed: 0 };
    row.calls += 1;
    row.cost += c.cost;
    if (c.failed) row.failed += 1;
    byModel.set(c.model, row);
  }
  const models = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost || b[1].calls - a[1].calls);

  const shown = showAll ? [...calls].reverse() : [...calls].reverse().slice(0, 12);
  // The owner's pick overrules the routing, so the page has to say so where the
  // rules are, not bury it in a switch.
  const overruled = Boolean(settings?.model);
  const routing = Boolean(settings?.router) && !overruled;

  return (
    <div className="p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">Router</h2>
        <span className="text-[11px] text-ink-faint">
          Which model answers a call, decided by what the call carries.
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Refresh width={11} height={11} />
            Refresh
          </button>
          <div className="inline-flex rounded-lg border border-line p-0.5" role="group" aria-label="Smart routing">
            {([["Routing on", true], ["One model", false]] as const).map(([text, on]) => (
              <button
                key={text}
                type="button"
                disabled={saving || settings === null}
                onClick={() => void setRouter(on)}
                aria-pressed={settings !== null && settings.router === on}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
                  settings !== null && settings.router === on ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink"
                }`}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-2 text-[11px] text-red-400" role="status">
          {error}
        </p>
      )}

      {/* What it is doing right now. A divided strip rather than a row of tiles:
          these four facts are read together, so they share one container.

          Every value waits for the ledger. A strip of confident zeros on a page
          about money is the same lie as "routing is off" below — it says nothing
          was spent when what is true is that nothing has been read yet. */}
      <div className="mb-3 grid grid-cols-2 divide-line-soft rounded-xl border border-line bg-panel sm:grid-cols-4 sm:divide-x">
        <Fact name="Spent today" tone={!loaded ? "text-ink-faint" : spentToday > 0 ? "text-ink" : "text-ink-muted"}>
          {loaded ? money(spentToday) : "—"}
        </Fact>
        <Fact name="Calls today" tone="text-ink-muted">
          {loaded ? (
            <>
              {todays.length}
              <span className="text-ink-faint"> · {freeToday} free</span>
              {failedToday > 0 && <span className="text-ink-faint"> · {failedToday} failed</span>}
            </>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Fact>
        <Fact
          name="OpenRouter left"
          tone={dry ? "text-red-400" : low ? "text-amber-300" : left === undefined ? "text-ink-faint" : "text-ink-muted"}
        >
          {!loaded ? "—" : left === undefined ? "not reported" : money(left)}
        </Fact>
        <Fact name="Counted here, ever" tone="text-ink-muted">
          {loaded ? money(report?.countedEver ?? 0) : "—"}
        </Fact>
      </div>

      {/* The Reason-Not-A-Colour rule: an amber number on its own sends the owner
          looking. The sentence sends them to the fix. */}
      {(dry || low) && (
        <p
          className={`mb-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
            dry ? "border-red-500/30 bg-red-500/[0.06] text-red-300" : "border-amber-400/30 bg-amber-500/[0.06] text-amber-200"
          }`}
          role="status"
        >
          {dry ? (
            <>
              OpenRouter credit has run out, so every paid rung below will refuse. The two free rungs still answer, which
              is most of the hub&apos;s work — top up at{" "}
              <a className="underline decoration-dotted hover:text-ink" href="https://openrouter.ai/credits" target="_blank" rel="noreferrer">
                openrouter.ai/credits
              </a>{" "}
              to get the rest back.
            </>
          ) : (
            <>Only {money(left ?? 0)} of OpenRouter credit left. The paid rungs stop when it reaches zero.</>
          )}
        </p>
      )}

      {/* --- the rules ---------------------------------------------------- */}
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">The ladder</h3>
        <span className="text-[10.5px] text-ink-faint">
          Asked in this order. The first rung that can read the call takes it.
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full min-w-[680px] border-collapse text-left">
          <thead>
            <tr className={`border-b border-line ${label}`}>
              <th className="py-1.5 pl-3 pr-2 font-medium">#</th>
              <th className="py-1.5 pr-3 font-medium">When</th>
              <th className="py-1.5 pr-3 font-medium">Model</th>
              <th className="py-1.5 pr-3 font-medium">Reads</th>
              <th className="py-1.5 pr-3 font-medium">JSON</th>
              <th className="py-1.5 pr-3 font-medium">$/M in / out</th>
              <th className="py-1.5 pr-3 font-medium">Today</th>
            </tr>
          </thead>
          <tbody>
            {TIER_RULES.map((rule, i) => {
              const used = byModel.get(rule.model.id);
              return (
                <tr key={rule.tier} className="border-b border-line-soft last:border-0 align-top">
                  <td className="py-2 pl-3 pr-2 font-mono text-[11px] tabular-nums text-ink-faint">{i + 1}</td>
                  <td className={`${cell} text-xs text-ink`}>
                    {rule.when}
                    <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-faint">{rule.model.why}</span>
                  </td>
                  <td className={cell}>
                    <span className="font-mono text-[11.5px] text-ink">{shortModel(rule.model.id)}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-ink-faint">
                      {rule.model.context.toLocaleString()} ctx
                    </span>
                    {/* A rung that is refusing is skipped silently by the router.
                        Saying so here is the difference between "free is cheap"
                        and "free is not answering today". */}
                    {benched.get(rule.model.id) && (
                      <span className="mt-1 block text-[10px] leading-snug text-amber-300/90">
                        Refused {benched.get(rule.model.id)!.times}&times; — {benched.get(rule.model.id)!.why}
                      </span>
                    )}
                  </td>
                  <td className={`${cell} font-mono text-[11px] tracking-wider text-ink-muted`}>{readsLine(rule.model)}</td>
                  <td className={cell}>
                    {rule.model.json ? (
                      <span className="font-mono text-[11px] text-ink-muted">yes</span>
                    ) : (
                      <span className="font-mono text-[11px] text-ink-faint" title="No response_format support, so strict-JSON calls skip this rung">
                        no
                      </span>
                    )}
                  </td>
                  <td className={`${cell} font-mono text-[11px] tabular-nums ${rule.model.price && rule.model.price[0] === 0 ? "text-emerald-300/90" : "text-ink-muted"}`}>
                    {priceLine(rule.model)}
                  </td>
                  <td className={`${cell} font-mono text-[11px] tabular-nums`}>
                    {used ? (
                      <>
                        <span className="text-ink">{used.calls}</span>
                        <span className="text-ink-faint"> · {money(used.cost)}</span>
                      </>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mb-4 mt-2 text-[10.5px] leading-relaxed text-ink-faint">
        {settings === null ? (
          // Unknown is not "off". Asserting either state before the settings have
          // been read tells the owner something false about their own hub for as
          // long as the fetch takes.
          <>Reading which model these calls are going to&hellip;</>
        ) : overruled ? (
          <>
            <span className="text-amber-300/90">The ladder is not in use.</span> A model is picked by hand on the hub&apos;s
            front page — <code className="font-mono text-ink-muted">{settings?.model}</code> — and a pick overrules the
            routing for every app. Clear it there to hand the decision back.
          </>
        ) : routing ? (
          <>
            Two rules outrank the rungs above. A modality the rung cannot read moves the call to the cheapest model that
            can, so a hard question arriving with a video does not go to the reasoning model. And strict JSON skips both
            free rungs entirely, because neither offers a JSON mode — that is why so much of the hub lands on DeepSeek.
          </>
        ) : (
          <>
            Routing is off, so every general call goes to one cheap default and its fallbacks instead. The ladder above is
            what it would be doing.
          </>
        )}{" "}
        Verify the table against OpenRouter with{" "}
        <code className="font-mono text-ink-muted">npm run check:router</code>.
      </p>

      {/* --- today, by model ---------------------------------------------- */}
      {models.length > 0 && (
        <>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Today, by model</h3>
          <div className="mb-4 overflow-hidden rounded-xl border border-line bg-panel">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className={`border-b border-line ${label}`}>
                  <th className="py-1.5 pl-3 pr-3 font-medium">Model</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Calls</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Failed</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {models.map(([id, row]) => (
                  <tr key={id} className="border-b border-line-soft last:border-0">
                    <td className="py-1.5 pl-3 pr-3 font-mono text-[11.5px] text-ink">{shortModel(id)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums text-ink-muted">{row.calls}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums">
                      {row.failed > 0 ? <span className="text-red-400/90">{row.failed}</span> : <span className="text-ink-faint">—</span>}
                    </td>
                    <td className={`py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums ${row.cost > 0 ? "text-ink" : "text-ink-faint"}`}>
                      {money(row.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* --- the calls themselves ----------------------------------------- */}
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Recent calls</h3>
        {calls.length > 12 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[10.5px] text-ink-faint transition-colors hover:text-ink"
          >
            {showAll ? "Show the last 12" : `Show all ${calls.length}`}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className={`border-b border-line ${label}`}>
              <th className="py-1.5 pl-3 pr-3 font-medium">When</th>
              <th className="py-1.5 pr-3 font-medium">Model</th>
              <th className="py-1.5 pr-3 font-medium">Rung</th>
              <th className="py-1.5 pr-3 font-medium">Asked by</th>
              <th className="py-1.5 pr-3 text-right font-medium">Tokens in / out</th>
              <th className="py-1.5 pr-3 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <CallRow key={`${c.at}-${c.model}`} call={c} />
            ))}
            {calls.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-xs text-ink-muted">
                  {error
                    ? "The ledger could not be read, so nothing is counted here yet."
                    : "No AI calls counted yet. Every call the hub makes lands here with what it cost."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
        {report?.note ??
          "Counted from the calls this hub makes."}{" "}
        A cost marked <span className="text-ink-muted">est.</span> was priced from the catalogue because the provider
        reported none.
      </p>
    </div>
  );
}

function CallRow({ call }: { call: SpendCall }) {
  const when = new Date(call.at);
  const time = Number.isNaN(when.getTime())
    ? "—"
    : when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = Number.isNaN(when.getTime()) ? "" : localDay(call.at) === localDay(new Date().toISOString()) ? "" : `${when.getDate()}/${when.getMonth() + 1} `;

  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="whitespace-nowrap py-1.5 pl-3 pr-3 font-mono text-[11px] tabular-nums text-ink-faint">
        {day}
        {time}
      </td>
      <td className="py-1.5 pr-3 font-mono text-[11.5px]">
        <span className={call.premium ? "text-amber-200" : "text-ink-muted"}>{shortModel(call.model)}</span>
      </td>
      <td className="py-1.5 pr-3 font-mono text-[10.5px] text-ink-faint">{call.tier ?? "picked"}</td>
      <td className="py-1.5 pr-3 text-[11px] text-ink-faint">{call.app ?? "—"}</td>
      <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums text-ink-faint">
        {call.failed ? (
          <span className="text-red-400/90">failed</span>
        ) : call.promptTokens || call.completionTokens ? (
          <>
            {(call.promptTokens ?? 0).toLocaleString()}
            <span className="text-ink-faint/60"> / </span>
            {(call.completionTokens ?? 0).toLocaleString()}
          </>
        ) : (
          "—"
        )}
      </td>
      <td className={`whitespace-nowrap py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums ${call.cost > 0 ? "text-ink" : "text-ink-faint"}`}>
        {money(call.cost)}
        {call.estimated && <span className="text-ink-faint"> est.</span>}
      </td>
    </tr>
  );
}
