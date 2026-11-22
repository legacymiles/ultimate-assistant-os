// ---------------------------------------------------------------------------
// Usage: the KPI row, the hourly chart, the breakdowns and the call log.
//
// The chart's job is magnitude-over-time split by how a request was served, so
// it is a stacked bar per hour with two series — cached and live — and a
// separate failure mark. Two series means a legend is always present, and both
// are directly labelled in it; failures are a reserved status red carrying an
// icon and the word "failed", never colour alone.
//
// Cached is accent-cyan-2 (#00a5b8) and live is brand indigo (#6366f1):
// validated against this panel's own surface for the lightness band, chroma,
// contrast and CVD separation (worst adjacent pair ΔE 16.6 deutan / 11.2
// tritan, both above the 8 target).
// ---------------------------------------------------------------------------

"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { UsageSummary } from "@/lib/search/store";
import { Chip, Empty, Panel, Stat, STATE, ago, ms } from "./shared";

const HOURS = [6, 24, 72, 168] as const;

export function UsagePanel({
  usage,
  hours,
  onHours,
}: {
  usage: UsageSummary | null;
  hours: number;
  onHours: (hours: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Traffic"
        hint={usage ? `${usage.total} calls in the last ${usage.windowHours}h` : "Loading…"}
        actions={
          <div className="flex items-center gap-0.5 rounded-md border border-line p-0.5">
            {HOURS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onHours(option)}
                className={`rounded-[4px] px-2 py-[2px] text-[10.5px] font-medium tracking-wide transition max-sm:min-h-[32px] max-sm:px-3 ${
                  hours === option ? "bg-brand-2 text-white" : "text-ink-muted hover:text-ink"
                }`}
              >
                {option}h
              </button>
            ))}
          </div>
        }
      >
        {usage ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5">
              <Stat label="Calls" value={usage.total} sub={`${usage.failed} failed`} />
              <Stat
                label="From cache"
                value={`${Math.round(usage.cacheHitRate * 100)}`}
                unit="%"
                tone={usage.cacheHitRate >= 0.3 ? "good" : "muted"}
                sub={`${usage.cacheHits} of ${usage.total}`}
              />
              <Stat label="Median" value={ms(usage.medianMs)} sub="live calls only" />
              <Stat label="p95" value={ms(usage.p95Ms)} sub="live calls only" />
              <Stat
                label="Fell back"
                value={usage.degraded}
                tone={usage.degraded > 0 ? "warn" : "good"}
                sub={usage.degraded > 0 ? "a provider was skipped" : "first choice every time"}
              />
            </div>
            <HourlyChart series={usage.series} />
          </>
        ) : (
          <Empty>Loading usage…</Empty>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-3">
        <Breakdown
          title="By app"
          hint="Pass `app` on every call and this column tells you who is spending the quota"
          rows={usage?.byApp.map((row) => ({ label: row.app, value: row.count })) ?? []}
        />
        <Breakdown
          title="By provider"
          rows={
            usage?.byProvider.map((row) => ({
              label: row.provider,
              value: row.count,
              note: row.failed > 0 ? `${row.failed} failed` : undefined,
            })) ?? []
          }
        />
        <Breakdown
          title="By caller"
          rows={
            usage?.byCaller.map((row) => ({
              label: row.label,
              value: row.count,
              note: row.kind === "key" ? "key" : "session",
            })) ?? []
          }
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Most asked" hint="Repeats here are what the cache is for">
          {usage && usage.topQueries.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {usage.topQueries.map((row) => (
                <li key={row.query} className="flex items-baseline gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-muted">
                    {row.query}
                  </span>
                  <span className="font-mono text-[11.5px] tabular-nums text-ink-faint">×{row.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing yet. Run a search in the test bench below.</Empty>
          )}
        </Panel>

        <Panel title="Recent calls" hint="Newest first">
          {usage && usage.recent.length > 0 ? (
            <div className="max-h-[320px] overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 bg-panel-2">
                  <tr className="text-[10.5px] font-medium uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-1.5 font-medium">Query</th>
                    <th className="px-2 py-1.5 font-medium">Served</th>
                    <th className="px-2 py-1.5 text-right font-medium">Took</th>
                    <th className="px-3 py-1.5 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {usage.recent.map((row, index) => (
                    <tr key={`${row.at}-${index}`} className="align-top">
                      <td className="max-w-[1px] px-3 py-1.5">
                        <p className="truncate font-mono text-[11.5px] text-ink">{row.query}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[10.5px] text-ink-faint">
                          <Chip>{row.kind}</Chip>
                          {row.app ? <span className="truncate">{row.app}</span> : null}
                          {row.error ? (
                            <span className="truncate text-[#f87171]" title={row.error}>
                              {row.error}
                            </span>
                          ) : null}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-[11.5px]">
                        {row.ok ? (
                          <span className="inline-flex items-center gap-1">
                            <span
                              aria-hidden
                              className="inline-block h-[7px] w-[7px] rounded-full"
                              style={{ background: row.cached ? STATE.cached : STATE.live }}
                            />
                            <span className="text-ink-muted">{row.cached ? "cache" : row.provider}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#f87171]">
                            <AlertTriangle size={10} aria-hidden /> failed
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[11.5px] tabular-nums text-ink-faint">
                        {ms(row.ms)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right text-[11.5px] text-ink-faint">
                        {ago(row.at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No calls in this window.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * Stacked bars, one per hour.
 *
 * A 2px surface gap sits between the two segments so the boundary reads
 * without an outline, the top of each bar is rounded 4px, and the hover layer
 * is a per-bar tooltip rather than a value printed on every column.
 */
function HourlyChart({ series }: { series: UsageSummary["series"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, ...series.map((point) => point.total)), [series]);
  const hasTraffic = series.some((point) => point.total > 0);

  return (
    <figure className="m-0 px-3 pb-3 pt-1">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
          Calls per hour
        </span>
        <span className="flex items-center gap-1 text-[11.5px] text-ink-muted">
          <span aria-hidden className="inline-block h-2 w-2 rounded-[2px]" style={{ background: STATE.live }} />
          live
        </span>
        <span className="flex items-center gap-1 text-[11.5px] text-ink-muted">
          <span aria-hidden className="inline-block h-2 w-2 rounded-[2px]" style={{ background: STATE.cached }} />
          cache
        </span>
        <span className="flex items-center gap-1 text-[11.5px] text-ink-muted">
          <AlertTriangle size={10} aria-hidden style={{ color: STATE.failedInk }} />
          failed
        </span>
      </figcaption>

      {hasTraffic ? (
        <div
          className="relative flex h-[112px] items-end gap-[2px]"
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`Calls per hour over the last ${series.length} hours. Peak ${max} in an hour.`}
        >
          {series.map((point, index) => {
            const cached = point.cached;
            const live = Math.max(0, point.total - point.cached);
            const scale = (value: number) => (value / max) * 100;
            return (
              <div
                key={point.hour}
                className="group relative flex h-full flex-1 cursor-default flex-col justify-end"
                onMouseEnter={() => setHover(index)}
              >
                {point.failed > 0 ? (
                  <AlertTriangle
                    size={9}
                    aria-hidden
                    className="mx-auto mb-[2px] shrink-0"
                    style={{ color: STATE.failedInk }}
                  />
                ) : null}
                {live > 0 ? (
                  <div
                    className="w-full rounded-t-[4px]"
                    style={{ height: `${scale(live)}%`, background: STATE.live, minHeight: 2 }}
                  />
                ) : null}
                {cached > 0 ? (
                  <div
                    className="w-full"
                    style={{
                      height: `${scale(cached)}%`,
                      background: STATE.cached,
                      minHeight: 2,
                      // The 2px surface gap that separates the stacked segments.
                      marginTop: live > 0 ? 2 : 0,
                      borderRadius: live > 0 ? 0 : "4px 4px 0 0",
                    }}
                  />
                ) : null}
                {point.total === 0 ? (
                  <div className="h-[1px] w-full" style={{ background: "var(--color-line)" }} />
                ) : null}

                {hover === index ? (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-elevated px-2 py-1.5 text-[11.5px]">
                    <p className="font-mono tabular-nums text-ink">
                      {new Date(point.hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="text-ink-muted">
                      {point.total} call{point.total === 1 ? "" : "s"} · {point.cached} cached
                      {point.failed > 0 ? ` · ${point.failed} failed` : ""}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="flex h-[112px] items-center justify-center border-y border-line-soft text-[12px] text-ink-faint">
          No calls in this window yet.
        </p>
      )}

      <div className="mt-1.5 flex items-center justify-between font-mono text-[10.5px] tabular-nums text-ink-faint">
        <span>
          {series.length > 0
            ? new Date(series[0].hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : ""}
        </span>
        <span>peak {max}/h</span>
        <span>now</span>
      </div>
    </figure>
  );
}

function Breakdown({
  title,
  hint,
  rows,
}: {
  title: string;
  hint?: string;
  rows: { label: string; value: number; note?: string }[];
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <Panel title={title} hint={hint}>
      {rows.length > 0 ? (
        <ul className="divide-y divide-line-soft">
          {rows.slice(0, 8).map((row) => (
            <li key={row.label} className="px-3 py-1.5">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">{row.label}</span>
                {row.note ? <Chip>{row.note}</Chip> : null}
                <span className="font-mono text-[11.5px] tabular-nums text-ink">{row.value}</span>
              </div>
              {/* A magnitude bar, single hue — no legend needed for one series. */}
              <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-line-soft">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(row.value / max) * 100}%`, background: STATE.live }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing in this window.</Empty>
      )}
    </Panel>
  );
}
