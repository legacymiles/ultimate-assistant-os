"use client";

import { ArrowUpRight, Info, TrendingUp } from "lucide-react";
import SourceChip from "../SourceChip";
import { Badge, Card, Empty } from "../ui";
import { fmtMoney } from "@/lib/buildflip-2/calc";
import type { ResaleEstimate } from "@/lib/buildflip-2/types";
import { cn, hostOf, shortDate } from "@/lib/buildflip-2/ui";

/**
 * Feature 4 — resale value from sold listings.
 *
 * Completed sales are the evidence; asking prices are shown separately, drawn
 * differently, and labelled as not counted. Where the market is thin it says so
 * in plain words rather than producing a confident number from two data points.
 */

export default function Comps({ resale }: { resale: ResaleEstimate | null }) {
  if (!resale) {
    return (
      <Empty
        icon={<TrendingUp aria-hidden className="h-6 w-6" />}
        title="Resale hasn't been checked yet"
        body="Once this plan finishes building, we search completed sales for comparable finished pieces and show every one we find."
      />
    );
  }

  const sold = resale.comps
    .filter((c) => c.sold)
    .sort((a, b) => (b.soldAt ?? "").localeCompare(a.soldAt ?? ""));
  const asking = resale.comps.filter((c) => !c.sold).sort((a, b) => a.price - b.price);

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--ink)]">
              What finished ones sold for
            </h3>
            <p className="mt-0.5 text-[11.5px] text-[var(--ink-4)]">
              {resale.soldCount > 0
                ? `${resale.soldCount} completed sale${resale.soldCount === 1 ? "" : "s"}, checked ${shortDate(resale.provenance.checkedAt)}`
                : "No completed sales found"}
            </p>
          </div>
          <Badge
            tone={
              resale.confidence === "high"
                ? "profit"
                : resale.confidence === "low"
                  ? "warn"
                  : "neutral"
            }
          >
            {resale.confidence === "high"
              ? "Solid market"
              : resale.confidence === "medium"
                ? "Fair read"
                : "Thin market"}
          </Badge>
        </div>

        {resale.soldCount > 0 ? (
          <div className="grid grid-cols-3 gap-3 rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] p-3.5">
            <Band label="Low end" value={resale.low} foot="20th percentile" />
            <Band label="Typical" value={resale.mid} foot="the midpoint" emphasis />
            <Band label="Top end" value={resale.high} foot="80th percentile" />
          </div>
        ) : (
          <p className="rounded-[var(--radius-ctl)] border border-dashed border-[color-mix(in_srgb,var(--warn)_40%,transparent)] px-3.5 py-3 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
            {resale.thinReason}
          </p>
        )}

        {resale.thin && resale.soldCount > 0 && resale.thinReason && (
          <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-relaxed text-[var(--warn)]">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{resale.thinReason}</span>
          </p>
        )}
      </Card>

      {sold.length > 0 && (
        <Card>
          <header className="border-b border-[var(--line-soft)] px-4 py-2.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-3)]">
              The sales behind that range
            </h4>
          </header>
          <ul className="divide-y divide-[var(--line-soft)]">
            {sold.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-snug text-[var(--ink)]">
                    {c.title}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[var(--ink-4)]">
                    <span>{c.marketplace}</span>
                    {c.soldAt && <span className="num">sold {shortDate(c.soldAt)}</span>}
                    {c.condition && <span>{c.condition}</span>}
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-0.5 underline-offset-2 hover:text-[var(--accent)] hover:underline"
                      >
                        {hostOf(c.url)}
                        <ArrowUpRight aria-hidden className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </div>
                <SourceChip
                  provenance={c.provenance}
                  align="end"
                  className="num shrink-0 text-[13.5px] font-semibold text-[var(--profit)]"
                >
                  {fmtMoney(c.price, { cents: false })}
                </SourceChip>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {asking.length > 0 && (
        <Card className="border-dashed">
          <header className="border-b border-dashed border-[var(--line-soft)] px-4 py-2.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-3)]">
              Asking prices — shown, never counted
            </h4>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--ink-4)]">
              What someone wants for a thing is not what it sells for. These are here so you
              can see the gap, not so you can price off them.
            </p>
          </header>
          <ul className="divide-y divide-dashed divide-[var(--line-soft)]">
            {asking.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-2.5 opacity-75">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] leading-snug text-[var(--ink-2)]">{c.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11px] text-[var(--ink-4)]">
                    <span>{c.marketplace}</span>
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-0.5 underline-offset-2 hover:text-[var(--accent)] hover:underline"
                      >
                        {hostOf(c.url)}
                        <ArrowUpRight aria-hidden className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </div>
                <span className="num shrink-0 text-[13px] text-[var(--ink-3)] line-through decoration-[var(--ink-4)]">
                  {fmtMoney(c.price, { cents: false })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Band({
  label,
  value,
  foot,
  emphasis,
}: {
  label: string;
  value: number;
  foot: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-3)]">
        {label}
      </div>
      <div
        className={cn(
          "num mt-0.5 font-semibold leading-tight",
          emphasis ? "text-[1.25rem] text-[var(--ink)]" : "text-[1rem] text-[var(--ink-2)]",
        )}
      >
        {fmtMoney(value, { cents: false })}
      </div>
      <div className="truncate text-[10px] text-[var(--ink-4)]">{foot}</div>
    </div>
  );
}
