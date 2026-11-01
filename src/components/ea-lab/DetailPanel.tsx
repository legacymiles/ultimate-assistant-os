"use client";

// ---------------------------------------------------------------------------
// The record for one EA.
//
// The order of this panel is an argument: the verdict, then the reasons behind
// it, then what the open book actually did, and only then the familiar
// backtest numbers. Profit factor is last on purpose -- it is the figure that
// sells an EA and the figure that says least about whether it survives.
// ---------------------------------------------------------------------------

import type { EaView } from "@/lib/ea-lab/client";
import { qualityTier, TIER_LABEL } from "@/lib/ea-lab/rating";

export function DetailPanel({ view, busy, onTest }: {
  view: EaView | null;
  busy: boolean;
  onTest: (eaId: string, sample: "in-sample" | "out-of-sample") => void;
}) {
  if (!view) {
    return (
      <div className="px-4 py-6">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Select an EA to see its record — how it sizes, what it held open, and whether anything
          measured about it can be trusted.
        </p>
      </div>
    );
  }

  const { ea, runs, rating, classification } = view;
  const run = runs[0];

  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      <header>
        <h2 className="text-[14px] font-semibold leading-tight text-ink">{ea.name}</h2>
        <p className="mt-0.5 font-mono text-[11.5px] text-ink-faint">
          {ea.platform.toUpperCase()} · {ea.file}
        </p>
      </header>

      {/* --- verdict --------------------------------------------------- */}
      <section>
        <Label>Verdict</Label>
        {rating.score === null ? (
          <>
            <p className="mt-1 text-[13px] leading-relaxed text-amber-400">Not rated</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{rating.blocked}</p>
          </>
        ) : (
          <>
            <p className={`mt-1 font-mono text-[30px] font-semibold leading-none tabular-nums ${
              rating.score >= 60 ? "text-green-400" : rating.score >= 35 ? "text-amber-400" : "text-red-400"
            }`}>
              {rating.score}
              <span className="ml-1 text-[12px] font-normal text-ink-faint">/ 100</span>
            </p>
            <ul className="mt-2 space-y-1.5">
              {rating.reasons.map((r, i) => (
                <li key={i} className="text-[13px] leading-relaxed text-ink-muted">{r}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* --- what it is -------------------------------------------------- */}
      {classification && (
        <section>
          <Label>Filed as</Label>
          <p className="mt-1 text-[13px] leading-relaxed text-ink">
            {classification.strategy.replace("-", " ")}
            <span className="ml-1.5 font-mono text-[11.5px] text-ink-faint">
              {Math.round(classification.confidence * 100)}% confident
            </span>
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{classification.why}</p>
        </section>
      )}

      {/* --- the open book ---------------------------------------------- */}
      {run && (
        <section>
          <Label>Exposure</Label>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
            <Stat label="Base lot" value={String(run.exposure.baseLot)} />
            <Stat label="Largest" value={`${run.exposure.maxLotMultiple}x`} />
            <Stat label="Gross peak" value={`${run.exposure.maxGrossLots}`} />
            <Stat
              label="Naked peak"
              value={`${run.exposure.maxNakedLots}`}
              tone={run.exposure.maxNakedLots > run.exposure.baseLot * 10 ? "bad"
                : run.exposure.maxNakedLots > run.exposure.baseLot * 3 ? "warn" : undefined}
            />
          </dl>
          <ul className="mt-2 space-y-1.5">
            {run.exposure.findings.map((f, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-ink-muted">{f}</li>
            ))}
          </ul>
        </section>
      )}

      {/* --- runs -------------------------------------------------------- */}
      <section>
        <Label>Runs</Label>
        {runs.length === 0 ? (
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            Never tested. Run the out-of-sample test first — it is the only one the rating uses.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-line-soft">
            {runs.map((r) => {
              const tier = qualityTier(r.modelQuality);
              return (
                <li key={r.id} className="py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[11.5px] text-ink">
                      {r.symbol} {r.timeframe}
                    </span>
                    <span className={`font-mono text-[11.5px] ${
                      r.sample === "out-of-sample" ? "text-brand" : "text-ink-faint"
                    }`}>
                      {r.sample}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11.5px] tabular-nums text-ink-muted">
                    <span className={r.metrics.netProfit >= 0 ? "text-green-400" : "text-red-400"}>
                      {r.metrics.netProfit >= 0 ? "+" : ""}{r.metrics.netProfit.toFixed(0)}
                    </span>
                    <span>PF {r.metrics.profitFactor}</span>
                    <span>DD {r.metrics.maxDrawdownPct?.toFixed(1)}%</span>
                    <span>{r.metrics.trades} trades</span>
                  </div>
                  <div className={`mt-0.5 font-mono text-[11.5px] ${
                    tier === 0 ? "text-red-400" : tier === 1 ? "text-amber-400" : "text-ink-faint"
                  }`}>
                    {TIER_LABEL[tier]}
                    {"percent" in r.modelQuality ? ` · ${r.modelQuality.percent}%` : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* --- act --------------------------------------------------------- */}
      <section className="flex flex-col gap-1.5">
        <Label>Test</Label>
        <div className="flex gap-1.5">
          <button
            onClick={() => onTest(ea.id, "out-of-sample")}
            disabled={busy || !ea.testable}
            className="flex-1 rounded-md bg-brand-2 px-3 py-1.5 text-[12px] text-white transition hover:bg-[color-mix(in_oklab,var(--color-brand-2)_82%,black)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Out-of-sample
          </button>
          <button
            onClick={() => onTest(ea.id, "in-sample")}
            disabled={busy || !ea.testable}
            className="flex-1 rounded-md px-3 py-1.5 text-[12px] text-ink-muted ring-1 ring-inset ring-line transition hover:bg-elevated hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            In-sample
          </button>
        </div>
        {!ea.testable && (
          <p className="text-[13px] leading-relaxed text-amber-400">
            This is source, not a compiled EA. Open it in MetaEditor and compile it before testing.
          </p>
        )}
      </section>
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10.5px] font-medium uppercase tracking-wide text-ink-muted">{children}</div>
);

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={`font-mono text-[11.5px] tabular-nums ${
        tone === "bad" ? "text-red-400" : tone === "warn" ? "text-amber-400" : "text-ink"
      }`}>
        {value}
      </dd>
    </div>
  );
}
