"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { GitCompareArrows, Lock, Trophy } from "lucide-react";
import { useApp } from "./AppState";
import Paywall from "./Paywall";
import { Badge, Button, Card, Empty, Skeleton } from "./ui";
import {
  computeVerdict,
  fmtHours,
  fmtMoney,
  fmtPct,
  fmtRate,
  profitPerHourSort,
} from "@/lib/buildflip-2/calc";
import type { Project } from "@/lib/buildflip-2/types";
import { cn, ease } from "@/lib/buildflip-2/ui";

/**
 * Feature 9 — my projects, side by side.
 *
 * Ranks every plan by profit per hour, which is the only honest way to compare
 * two builds, then puts two of them head to head. A big margin on a hundred
 * hours loses to a small margin on an afternoon, and this is where that becomes
 * obvious.
 */

export default function Compare() {
  const { projects, loading, account } = useApp();
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const [paywall, setPaywall] = useState(false);

  const usable = useMemo(
    () => projects.filter((p) => !p.generating && !p.error && p.resale),
    [projects],
  );

  const ranked = useMemo(
    () => [...usable].sort((x, y) => profitPerHourSort(y) - profitPerHourSort(x)),
    [usable],
  );

  useEffect(() => {
    if (!a && ranked[0]) setA(ranked[0].id);
    if (!b && ranked[1]) setB(ranked[1].id);
  }, [ranked, a, b]);

  const isPro = account?.plan === "pro";
  const left = usable.find((p) => p.id === a) ?? null;
  const right = usable.find((p) => p.id === b) ?? null;

  if (loading && projects.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-[var(--radius-card)]" />
        <Skeleton className="h-64 rounded-[var(--radius-card)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <div className="mb-5">
        <h1 className="text-[clamp(1.5rem,4.5vw,2rem)] font-semibold tracking-[-0.035em]">
          Side by side
        </h1>
        <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-[var(--ink-2)]">
          Ranked by profit per hour — the number that decides which idea is actually worth
          your weekend.
        </p>
      </div>

      {usable.length === 0 ? (
        <Empty
          icon={<GitCompareArrows aria-hidden className="h-7 w-7" />}
          title="Nothing to compare yet"
          body="Once you have two priced plans, this ranks them by profit per hour and puts them head to head. Make a plan first."
          action={
            <Link href="/apps/buildflip-2/board">
              <Button variant="primary">Go to the board</Button>
            </Link>
          }
          className="py-14"
        />
      ) : (
        <div className="space-y-5">
          {/* --------------------------------------------------- the ranking */}
          <Card>
            <header className="flex items-center gap-2 border-b border-[var(--line-soft)] px-4 py-3">
              <Trophy aria-hidden className="h-4 w-4 text-[var(--accent)]" />
              <h2 className="text-[13px] font-semibold text-[var(--ink)]">
                Every plan by profit per hour
              </h2>
            </header>
            <ol>
              {ranked.map((p, i) => {
                const v = computeVerdict(p);
                const rate = v.hourlyRate;
                const topRate = computeVerdict(ranked[0]!).hourlyRate ?? 0;
                const pct =
                  rate != null && topRate > 0 ? Math.max(0, (rate / topRate) * 100) : 0;
                return (
                  <li
                    key={p.id}
                    className="border-b border-[var(--line-soft)] last:border-0"
                  >
                    <Link
                      href={`/apps/buildflip-2/plan/${p.id}`}
                      className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <span className="num w-5 shrink-0 text-[12px] font-semibold text-[var(--ink-4)]">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-[var(--ink)]">
                          {p.title}
                        </span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <motion.span
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, pct)}%` }}
                            transition={{ duration: 0.6, ease, delay: i * 0.04 }}
                            className={cn(
                              "block h-full rounded-full",
                              rate == null
                                ? "bg-[var(--ink-4)]"
                                : rate >= p.hourlyTarget
                                  ? "bg-[var(--profit)]"
                                  : rate > 0
                                    ? "bg-[var(--warn)]"
                                    : "bg-[var(--loss)]",
                            )}
                          />
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className={cn(
                            "num block text-[13.5px] font-semibold",
                            rate == null
                              ? "text-[var(--ink-4)]"
                              : rate >= p.hourlyTarget
                                ? "text-[var(--profit)]"
                                : rate > 0
                                  ? "text-[var(--ink)]"
                                  : "text-[var(--loss)]",
                          )}
                        >
                          {fmtRate(rate, "hours not set")}
                        </span>
                        <span className="num block text-[10.5px] text-[var(--ink-4)]">
                          {fmtMoney(v.profit, { cents: false })} · {fmtHours(v.hours)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Card>

          {/* ------------------------------------------------- head to head */}
          {usable.length >= 2 && (
            <Card className="p-4">
              {!isPro ? (
                <div className="flex items-start gap-3">
                  <Lock aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-semibold text-[var(--ink)]">
                      Head-to-head comparison
                    </h2>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--ink-2)]">
                      Put two builds next to each other, line by line, and see exactly which
                      numbers differ. The ranking above is free and always will be.
                    </p>
                    <Button
                      variant="primary"
                      className="mt-3.5"
                      onClick={() => setPaywall(true)}
                    >
                      Unlock compare
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="mb-3 text-[13px] font-semibold text-[var(--ink)]">
                    Head to head
                  </h2>
                  <div className="mb-4 grid gap-2 sm:grid-cols-2">
                    <Picker label="First build" value={a} onChange={setA} options={usable} />
                    <Picker label="Second build" value={b} onChange={setB} options={usable} />
                  </div>
                  {left && right && left.id !== right.id ? (
                    <Head left={left} right={right} />
                  ) : (
                    <p className="rounded-[var(--radius-ctl)] border border-dashed border-[var(--line)] px-3.5 py-4 text-[13px] text-[var(--ink-3)]">
                      Pick two different builds to see them side by side.
                    </p>
                  )}
                </>
              )}
            </Card>
          )}
        </div>
      )}

      <Paywall
        open={paywall}
        moment="compare"
        onClose={() => setPaywall(false)}
        returnTo="/apps/buildflip-2/compare"
      />
    </div>
  );
}

function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Project[];
}) {
  const id = `cmp-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-[var(--ink-2)]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] px-3 text-[13.5px] text-[var(--ink)]"
      >
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
    </div>
  );
}

function Head({ left, right }: { left: Project; right: Project }) {
  const lv = computeVerdict(left);
  const rv = computeVerdict(right);
  const lRate = lv.hourlyRate;
  const rRate = rv.hourlyRate;
  const winner =
    lRate == null || rRate == null || lRate === rRate
      ? null
      : lRate > rRate
        ? "left"
        : "right";

  const rows: {
    label: string;
    l: string;
    r: string;
    better?: "left" | "right" | null;
  }[] = [
    {
      label: "Profit per hour",
      l: fmtRate(lRate, "hours not set"),
      r: fmtRate(rRate, "hours not set"),
      better: winner,
    },
    {
      label: "Profit",
      l: fmtMoney(lv.profit, { cents: false }),
      r: fmtMoney(rv.profit, { cents: false }),
      better: lv.profit === rv.profit ? null : lv.profit > rv.profit ? "left" : "right",
    },
    {
      label: "Materials",
      l: fmtMoney(lv.actualCost, { cents: false }),
      r: fmtMoney(rv.actualCost, { cents: false }),
      better:
        lv.actualCost === rv.actualCost ? null : lv.actualCost < rv.actualCost ? "left" : "right",
    },
    {
      label: "Sells for",
      l: fmtMoney(lv.salePrice, { cents: false }),
      r: fmtMoney(rv.salePrice, { cents: false }),
      better: lv.salePrice === rv.salePrice ? null : lv.salePrice > rv.salePrice ? "left" : "right",
    },
    {
      label: "Margin",
      l: fmtPct(lv.margin),
      r: fmtPct(rv.margin),
      better: lv.margin === rv.margin ? null : lv.margin > rv.margin ? "left" : "right",
    },
    {
      label: "Hours of work",
      l: fmtHours(lv.hours),
      r: fmtHours(rv.hours),
      better: lv.hours === rv.hours ? null : lv.hours < rv.hours ? "left" : "right",
    },
    {
      label: "Sold comps behind it",
      l: String(left.resale?.soldCount ?? 0),
      r: String(right.resale?.soldCount ?? 0),
      better:
        (left.resale?.soldCount ?? 0) === (right.resale?.soldCount ?? 0)
          ? null
          : (left.resale?.soldCount ?? 0) > (right.resale?.soldCount ?? 0)
            ? "left"
            : "right",
    },
    { label: "The call", l: lv.headline, r: rv.headline },
  ];

  return (
    <div>
      {winner && (
        <p className="mb-3 rounded-[var(--radius-ctl)] border border-[color-mix(in_srgb,var(--profit)_35%,transparent)] bg-[var(--profit-soft)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--ink)]">
          <strong className="font-semibold">
            {winner === "left" ? left.title : right.title}
          </strong>{" "}
          pays better per hour —{" "}
          <span className="num">
            {fmtMoney(Math.abs((lRate ?? 0) - (rRate ?? 0)), { cents: false })}/hr more
          </span>
          .
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-[13px]">
          <caption className="sr-only">
            {left.title} compared with {right.title}
          </caption>
          <thead>
            <tr className="border-b border-[var(--line)] text-left">
              <th scope="col" className="w-36 py-2 pr-3 text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--ink-4)]">
                &nbsp;
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold text-[var(--ink)]">
                {left.title}
              </th>
              <th scope="col" className="py-2 font-semibold text-[var(--ink)]">
                {right.title}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line-soft)]">
            {rows.map((row) => (
              <tr key={row.label}>
                <th
                  scope="row"
                  className="py-2.5 pr-3 text-left text-[11.5px] font-medium text-[var(--ink-3)]"
                >
                  {row.label}
                </th>
                <td
                  className={cn(
                    "num py-2.5 pr-3",
                    row.better === "left"
                      ? "font-semibold text-[var(--profit)]"
                      : "text-[var(--ink-2)]",
                  )}
                >
                  {row.l}
                  {row.better === "left" && (
                    <Badge tone="profit" className="ml-1.5 align-middle">
                      better
                    </Badge>
                  )}
                </td>
                <td
                  className={cn(
                    "num py-2.5",
                    row.better === "right"
                      ? "font-semibold text-[var(--profit)]"
                      : "text-[var(--ink-2)]",
                  )}
                >
                  {row.r}
                  {row.better === "right" && (
                    <Badge tone="profit" className="ml-1.5 align-middle">
                      better
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
