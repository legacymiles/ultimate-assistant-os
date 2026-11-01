"use client";

// ---------------------------------------------------------------------------
// EA Lab — the bench where an Expert Advisor stops being a claim.
//
// Three columns: what to look at, the wall of EAs, and the full record. The
// table is the product. Every column here exists because it changes a decision
// about whether to run something on real money, and the two that do most of
// that work are the ones no MetaTrader report prints: NAKED (peak unhedged
// exposure) and the quality badge that says whether any of it can be believed.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadAll, health, scan, queueTest, BRIDGE } from "@/lib/ea-lab/client";
import type { EaView, Health } from "@/lib/ea-lab/client";
import { qualityTier, TIER_LABEL } from "@/lib/ea-lab/rating";
import type { StrategyClass } from "@/lib/ea-lab/types";
import { DetailPanel } from "./DetailPanel";

const STRATEGY_LABEL: Record<StrategyClass, string> = {
  trend: "Trend",
  "mean-reversion": "Mean reversion",
  grid: "Grid",
  martingale: "Martingale",
  "hedge-recovery": "Hedge recovery",
  scalper: "Scalper",
  news: "News",
  arbitrage: "Arbitrage",
  "manual-tool": "Panel / tool",
  unknown: "Unfiled",
};

type SortKey = "score" | "name" | "dd" | "naked" | "trades" | "risk";

export function EaLab() {
  const [views, setViews] = useState<EaView[] | null>(null);
  const [hp, setHp] = useState<Health | null>(null);
  const [down, setDown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<StrategyClass | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("score");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const h = await health(signal);
      setHp(h);
      setDown(false);
      setViews(await loadAll(signal));
    } catch {
      setDown(true);
      setViews([]);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    refresh(ac.signal);
    // The runner tests in the background, so the table would otherwise go stale
    // the moment something is dropped in the inbox.
    const t = setInterval(() => refresh(ac.signal), 15_000);
    return () => { ac.abort(); clearInterval(t); };
  }, [refresh]);

  const counts = useMemo(() => {
    const c = new Map<StrategyClass | "all", number>();
    c.set("all", views?.length ?? 0);
    for (const v of views ?? []) {
      const k = v.classification?.strategy ?? "unknown";
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    return c;
  }, [views]);

  const rows = useMemo(() => {
    let r = views ?? [];
    if (filter !== "all") r = r.filter((v) => (v.classification?.strategy ?? "unknown") === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      r = r.filter((v) => v.ea.name.toLowerCase().includes(q));
    }
    const best = (v: EaView) => v.runs[0];
    return [...r].sort((a, b) => {
      switch (sort) {
        case "name": return a.ea.name.localeCompare(b.ea.name);
        case "dd": return (best(b)?.metrics.maxDrawdownPct ?? -1) - (best(a)?.metrics.maxDrawdownPct ?? -1);
        case "naked": return (best(b)?.exposure.maxNakedLots ?? -1) - (best(a)?.exposure.maxNakedLots ?? -1);
        case "trades": return (best(b)?.metrics.trades ?? -1) - (best(a)?.metrics.trades ?? -1);
        case "risk": return (best(b)?.exposure.riskScore ?? -1) - (best(a)?.exposure.riskScore ?? -1);
        default:
          if (a.rating.score === null && b.rating.score === null) return a.ea.name.localeCompare(b.ea.name);
          if (a.rating.score === null) return 1;
          if (b.rating.score === null) return -1;
          return b.rating.score - a.rating.score;
      }
    });
  }, [views, filter, query, sort]);

  const current = rows.find((v) => v.ea.id === selected) ?? null;

  const runScan = async () => {
    setBusy(true);
    try { await scan(); await refresh(); } catch { setDown(true); } finally { setBusy(false); }
  };

  const testEa = async (eaId: string, sample: "in-sample" | "out-of-sample") => {
    setBusy(true);
    const now = Date.now();
    const year = 365 * 86_400_000;
    // The split that makes the rating mean anything: the older two thirds to
    // fit on, the newest third held back and never used for tuning.
    const range = sample === "in-sample"
      ? { from: now - year, to: now - year / 3 }
      : { from: now - year / 3, to: now };
    try {
      await queueTest({ eaId, sample, model: "every-tick", symbol: "XAUUSD", timeframe: "H1", ...range });
      await refresh();
    } catch { setDown(true); } finally { setBusy(false); }
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-canvas text-ink">
      <Header hp={hp} down={down} busy={busy} onScan={runScan} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          counts={counts}
          filter={filter}
          onFilter={setFilter}
          inbox={hp?.inbox}
          waiting={hp?.waiting ?? 0}
        />

        <main className="flex min-w-0 flex-1 flex-col border-x border-line">
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name"
              className="min-w-0 flex-1 rounded-sm bg-canvas px-2 py-1 font-mono text-[11.5px] text-ink outline-none ring-1 ring-inset ring-line placeholder:text-ink-faint focus:ring-brand"
            />
            <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-ink-faint">
              {rows.length}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {down ? <BridgeDown /> : views === null ? <Skeleton /> : rows.length === 0 ? (
              <Empty inbox={hp?.inbox} hasAny={(views?.length ?? 0) > 0} />
            ) : (
              <Table rows={rows} selected={selected} onSelect={setSelected} sort={sort} onSort={setSort} />
            )}
          </div>
        </main>

        <aside className="hidden w-[380px] shrink-0 overflow-auto bg-panel lg:block">
          <DetailPanel view={current} busy={busy} onTest={testEa} />
        </aside>
      </div>
    </div>
  );
}

// ----- header ---------------------------------------------------------------

function Header({ hp, down, busy, onScan }: {
  hp: Health | null; down: boolean; busy: boolean; onScan: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel-2 px-3 py-2">
      <h1 className="text-[14px] font-semibold leading-tight">EA Lab</h1>
      <span className="text-[12px] text-ink-muted">Expert Advisor testing bench</span>
      <div className="ml-auto flex items-center gap-3">
        {/* A dot never carries the meaning alone: every state says why, in words. */}
        <span className="flex items-center gap-1.5 font-mono text-[11.5px]">
          <span
            className={`h-[7px] w-[7px] rounded-full ${down ? "bg-red-500" : hp?.queue ? "bg-amber-500" : "bg-green-500"}`}
            aria-hidden
          />
          <span className={down ? "text-red-400" : "text-ink-muted"}>
            {down ? "runner not running" : hp?.queue ? `testing · ${hp.queue} queued` : "idle"}
          </span>
        </span>
        <button
          onClick={onScan}
          disabled={busy || down}
          className="rounded-md px-3 py-1.5 text-[12px] text-ink-muted transition hover:bg-elevated hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Scanning…" : "Scan inbox"}
        </button>
      </div>
    </header>
  );
}

// ----- left column ----------------------------------------------------------

function Sidebar({ counts, filter, onFilter, inbox, waiting }: {
  counts: Map<StrategyClass | "all", number>;
  filter: StrategyClass | "all";
  onFilter: (f: StrategyClass | "all") => void;
  inbox?: string;
  waiting: number;
}) {
  const order: (StrategyClass | "all")[] = [
    "all", "martingale", "hedge-recovery", "grid", "scalper",
    "trend", "mean-reversion", "arbitrage", "news", "manual-tool", "unknown",
  ];
  return (
    <nav className="hidden w-[210px] shrink-0 flex-col overflow-auto bg-panel md:flex">
      <div className="px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-muted">
        Strategy
      </div>
      <ul>
        {order.map((k) => {
          const n = counts.get(k) ?? 0;
          if (k !== "all" && n === 0) return null;
          const on = filter === k;
          return (
            <li key={k}>
              <button
                onClick={() => onFilter(k)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition ${
                  on ? "bg-elevated text-ink shadow-[inset_2px_0_0_0_var(--color-brand)]" : "text-ink-muted hover:bg-panel-2 hover:text-ink"
                }`}
              >
                <span className="truncate">{k === "all" ? "All EAs" : STRATEGY_LABEL[k]}</span>
                <span className="ml-2 shrink-0 font-mono text-[11.5px] tabular-nums text-ink-faint">{n}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto border-t border-line px-3 py-2">
        <div className="text-[10.5px] font-medium uppercase tracking-wide text-ink-muted">Drop folder</div>
        <p className="mt-1 break-all font-mono text-[11.5px] leading-relaxed text-ink-faint">
          {inbox ?? "C:\\EA-Lab\\inbox"}
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
          {waiting > 0
            ? `${waiting} file${waiting === 1 ? "" : "s"} waiting to be taken in.`
            : "Drop an .ex4 here and it is registered, installed and tested."}
        </p>
      </div>
    </nav>
  );
}

// ----- table ----------------------------------------------------------------

const COLS: { key: SortKey | null; label: string; className: string }[] = [
  { key: "name", label: "Expert Advisor", className: "min-w-0" },
  { key: null, label: "Strategy", className: "hidden w-28 lg:table-cell" },
  { key: "score", label: "Rating", className: "w-16 text-right" },
  { key: "dd", label: "Max DD", className: "hidden w-20 text-right sm:table-cell" },
  { key: "naked", label: "Naked", className: "w-20 text-right" },
  { key: "risk", label: "Risk", className: "hidden w-14 text-right sm:table-cell" },
  { key: "trades", label: "Trades", className: "hidden w-16 text-right md:table-cell" },
  { key: null, label: "Quality", className: "hidden w-24 xl:table-cell" },
];

function Table({ rows, selected, onSelect, sort, onSort }: {
  rows: EaView[]; selected: string | null; onSelect: (id: string) => void;
  sort: SortKey; onSort: (k: SortKey) => void;
}) {
  return (
    <table className="w-full table-fixed border-collapse text-[12px] md:min-w-[720px]">
      <thead className="sticky top-0 z-10 bg-panel-2">
        <tr className="border-b border-line">
          {COLS.map((c) => (
            <th
              key={c.label}
              className={`px-2 py-1.5 text-left text-[10.5px] font-medium uppercase tracking-wide text-ink-muted ${c.className}`}
            >
              {c.key ? (
                <button
                  onClick={() => onSort(c.key as SortKey)}
                  className={`transition hover:text-ink ${sort === c.key ? "text-brand" : ""}`}
                >
                  {c.label}
                </button>
              ) : c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((v) => {
          const run = v.runs[0];
          const on = v.ea.id === selected;
          const tier = run ? qualityTier(run.modelQuality) : -1;
          const naked = run?.exposure.maxNakedLots;
          const nakedMult = run && run.exposure.baseLot > 0
            ? run.exposure.maxNakedLots / run.exposure.baseLot : 0;
          return (
            <tr
              key={v.ea.id}
              onClick={() => onSelect(v.ea.id)}
              className={`cursor-pointer border-b border-line-soft transition ${
                on ? "bg-elevated shadow-[inset_2px_0_0_0_var(--color-brand)]" : "hover:bg-panel"
              }`}
            >
              <td className="min-w-0 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-ink">{v.ea.name}</span>
                  {!v.ea.testable && (
                    <span className="shrink-0 rounded bg-amber-500/15 px-1 font-mono text-[9.5px] uppercase text-amber-400">
                      src
                    </span>
                  )}
                </div>
              </td>
              <td className="hidden px-2 py-1.5 text-ink-muted lg:table-cell">
                <span className="truncate">
                  {v.classification ? STRATEGY_LABEL[v.classification.strategy] : "—"}
                </span>
              </td>
              <td className="px-2 py-1.5 text-right">
                {v.rating.score === null ? (
                  <span className="font-mono text-[11.5px] text-ink-faint">—</span>
                ) : (
                  <span className={`font-mono text-[11.5px] tabular-nums ${
                    v.rating.score >= 60 ? "text-green-400"
                      : v.rating.score >= 35 ? "text-amber-400" : "text-red-400"
                  }`}>
                    {v.rating.score}
                  </span>
                )}
              </td>
              <td className="hidden px-2 py-1.5 text-right font-mono text-[11.5px] tabular-nums text-ink-muted sm:table-cell">
                {run && Number.isFinite(run.metrics.maxDrawdownPct)
                  ? `${run.metrics.maxDrawdownPct.toFixed(1)}%` : "—"}
              </td>
              {/* The column no MetaTrader report prints. */}
              <td className="px-2 py-1.5 text-right font-mono text-[11.5px] tabular-nums">
                {naked === undefined ? (
                  <span className="text-ink-faint">—</span>
                ) : (
                  <span className={nakedMult > 10 ? "text-red-400" : nakedMult > 3 ? "text-amber-400" : "text-ink-muted"}>
                    {naked}
                  </span>
                )}
              </td>
              <td className="hidden px-2 py-1.5 text-right font-mono text-[11.5px] tabular-nums sm:table-cell">
                {run ? (
                  <span className={run.exposure.riskScore >= 70 ? "text-red-400"
                    : run.exposure.riskScore >= 40 ? "text-amber-400" : "text-ink-muted"}>
                    {run.exposure.riskScore}
                  </span>
                ) : <span className="text-ink-faint">—</span>}
              </td>
              <td className="hidden px-2 py-1.5 text-right font-mono text-[11.5px] tabular-nums text-ink-muted md:table-cell">
                {run?.metrics.trades ?? "—"}
              </td>
              <td className="hidden px-2 py-1.5 xl:table-cell">
                {tier < 0 ? (
                  <span className="font-mono text-[11.5px] text-ink-faint">not tested</span>
                ) : (
                  <span className={`font-mono text-[11.5px] ${tier === 0 ? "text-red-400" : tier === 1 ? "text-amber-400" : "text-ink-muted"}`}>
                    {TIER_LABEL[tier]}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ----- states ---------------------------------------------------------------

function Skeleton() {
  return (
    <div className="p-2">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="mb-1.5 h-6 animate-pulse rounded-sm bg-panel-2" style={{ opacity: 1 - i * 0.07 }} />
      ))}
    </div>
  );
}

function BridgeDown() {
  return (
    <div className="px-6 py-12">
      <p className="text-[13px] leading-relaxed text-ink">
        The EA Lab runner is not running on this PC.
      </p>
      <p className="mt-2 max-w-[65ch] text-[13px] leading-relaxed text-ink-muted">
        The hub cannot reach MetaTrader by itself — testing happens on your machine, through a
        local runner the page talks to on <span className="font-mono text-[11.5px]">{BRIDGE}</span>.
        Start it and this table fills itself in.
      </p>
      <pre className="mt-3 w-fit rounded-lg bg-canvas px-3 py-2 font-mono text-[11.5px] text-ink ring-1 ring-inset ring-line">
        node tools/ea-lab-runner/server.mjs
      </pre>
    </div>
  );
}

function Empty({ inbox, hasAny }: { inbox?: string; hasAny: boolean }) {
  return (
    <div className="px-6 py-12">
      <p className="text-[13px] leading-relaxed text-ink">
        {hasAny ? "Nothing matches that filter." : "No Expert Advisors yet."}
      </p>
      {!hasAny && (
        <p className="mt-2 max-w-[65ch] text-[13px] leading-relaxed text-ink-muted">
          Drop an <span className="font-mono text-[11.5px]">.ex4</span> or{" "}
          <span className="font-mono text-[11.5px]">.ex5</span> into{" "}
          <span className="font-mono text-[11.5px] text-ink">{inbox ?? "C:\\EA-Lab\\inbox"}</span>.
          It is registered, installed into the test rig and backtested without the terminal being
          touched by hand.
        </p>
      )}
    </div>
  );
}
