"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Badge, Button, Card, Empty, ErrorNote, Skeleton } from "./ui";
import { fmtMoney, fmtPct } from "@/lib/buildflip-2/calc";
import { ago, cn, shortDate } from "@/lib/buildflip-2/ui";
import type { LogEntry } from "@/lib/buildflip-2/log";
import type { Capabilities } from "@/lib/buildflip-2/flags";

/**
 * The owner dashboard. Signups, the aha funnel, revenue, estimate accuracy
 * across every build, and the logged errors — so problems are found here before
 * a customer reports them.
 *
 * The data route is locked to the owner's email on the server (S3); this is
 * just the view.
 */

interface Stats {
  funnel: {
    signups: number;
    accounts: number;
    ahaUsers: number;
    returning: number;
    leads: number;
  };
  plans: {
    total: number;
    last7: number;
    last30: number;
    withReceipts: number;
    sold: number;
    shared: number;
  };
  revenue: {
    payers: number;
    mrr: number;
    conversion: number;
    trialing: number;
    simulated: number;
  };
  accuracy: { samples: number; medianErrorPct: number | null; within15: number };
  buildTypes: { type: string; builds: number; receipts: number }[];
  recent: {
    id: string;
    title: string;
    buildType: string;
    stage: string;
    createdAt: string;
    soldComps: number;
    demo: boolean;
  }[];
  errors: LogEntry[];
  capabilities: Capabilities;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/buildflip-2/admin/stats", { cache: "no-store" });
      if (!res.ok) {
        setError(
          res.status === 404
            ? "This page is for the owner only."
            : "Couldn't load the numbers just now.",
        );
        setStats(null);
        return;
      }
      setStats((await res.json()) as Stats);
      setError(null);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (loading && !stats) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-[var(--radius-card)]" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-[var(--radius-card)]" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="mx-auto max-w-lg px-4 py-14 sm:px-6">
        <ErrorNote onRetry={() => void load()}>{error}</ErrorNote>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(1.5rem,4.5vw,2rem)] font-semibold tracking-[-0.035em]">
            Owner dashboard
          </h1>
          <p className="mt-1 text-[13.5px] text-[var(--ink-2)]">
            Refreshes itself every minute.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void load()}
          loading={loading}
          icon={<RefreshCw aria-hidden className="h-3.5 w-3.5" />}
        >
          Refresh now
        </Button>
      </div>

      {/* ----------------------------------------------------------- funnel */}
      <section aria-label="Funnel">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-3)]">
          Visit → signup → aha → return
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Signups" value={stats.funnel.signups || stats.funnel.accounts} />
          <Tile label="Accounts" value={stats.funnel.accounts} />
          <Tile
            label="Reached a verdict"
            value={stats.funnel.ahaUsers}
            foot="the aha action"
            tone="profit"
          />
          <Tile label="Came back" value={stats.funnel.returning} />
          <Tile label="On the list" value={stats.funnel.leads} />
        </div>
      </section>

      {/* ---------------------------------------------------------- revenue */}
      <section aria-label="Revenue">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-3)]">
          Money
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Paying" value={stats.revenue.payers} tone="profit" />
          <Tile label="MRR" value={fmtMoney(stats.revenue.mrr, { cents: false })} tone="profit" />
          <Tile label="Conversion" value={fmtPct(stats.revenue.conversion)} />
          <Tile
            label="On trial"
            value={stats.revenue.trialing}
            foot={
              stats.revenue.simulated > 0
                ? `${stats.revenue.simulated} simulated (no Stripe key)`
                : undefined
            }
          />
        </div>
        {!stats.capabilities.payments && (
          <p className="mt-2 rounded-[var(--radius-ctl)] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
            <strong className="font-semibold text-[var(--ink)]">
              Stripe isn&apos;t connected.
            </strong>{" "}
            Upgrades are simulated and nobody has been charged. Setting{" "}
            <code className="font-mono text-[11.5px]">STRIPE_SECRET_KEY</code> and{" "}
            <code className="font-mono text-[11.5px]">STRIPE_PRICE_MONTHLY</code> switches
            real payments on — that is the only step left.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------ plans */}
      <section aria-label="Plans">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-3)]">
          Plans
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Tile label="All time" value={stats.plans.total} />
          <Tile label="Last 7 days" value={stats.plans.last7} />
          <Tile label="Last 30" value={stats.plans.last30} />
          <Tile label="With receipts" value={stats.plans.withReceipts} tone="profit" />
          <Tile label="Sold" value={stats.plans.sold} />
          <Tile label="Shared" value={stats.plans.shared} />
        </div>
      </section>

      {/* -------------------------------------------------------- accuracy */}
      <Card className="p-4">
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--ink)]">
          How close the estimates land
        </h2>
        <p className="mb-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
          The success criterion: material estimates within 15% of the real receipts across 10
          finished builds.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Tile label="Builds measured" value={stats.accuracy.samples} />
          <Tile
            label="Median error"
            value={
              stats.accuracy.medianErrorPct == null
                ? "—"
                : `±${fmtPct(stats.accuracy.medianErrorPct)}`
            }
            tone={
              stats.accuracy.medianErrorPct != null && stats.accuracy.medianErrorPct <= 0.15
                ? "profit"
                : stats.accuracy.medianErrorPct == null
                  ? "neutral"
                  : "loss"
            }
          />
          <Tile
            label="Within 15%"
            value={`${stats.accuracy.within15}/${stats.accuracy.samples}`}
          />
        </div>
        {stats.accuracy.samples < 10 && (
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--ink-4)]">
            {10 - stats.accuracy.samples} more finished build
            {10 - stats.accuracy.samples === 1 ? "" : "s"} with receipts needed before that
            criterion can be honestly reported.
          </p>
        )}
      </Card>

      {/* ----------------------------------------------------- build types */}
      {stats.buildTypes.length > 0 && (
        <Card>
          <header className="border-b border-[var(--line-soft)] px-4 py-2.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-3)]">
              Build types · receipts are what calibrate them
            </h2>
          </header>
          <ul className="divide-y divide-[var(--line-soft)]">
            {stats.buildTypes.map((t) => (
              <li key={t.type} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="font-mono text-[12.5px] text-[var(--ink)]">{t.type}</span>
                <span className="flex items-center gap-2 text-[11.5px] text-[var(--ink-3)]">
                  <span className="num">{t.builds} plans</span>
                  <Badge tone={t.receipts >= 3 ? "profit" : "neutral"}>
                    {t.receipts >= 3 ? `calibrating · ${t.receipts}` : `${t.receipts} receipts`}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------------------------------------------------------- recent */}
      {stats.recent.length > 0 && (
        <Card>
          <header className="border-b border-[var(--line-soft)] px-4 py-2.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-3)]">
              Recent plans
            </h2>
          </header>
          <ul className="divide-y divide-[var(--line-soft)]">
            {stats.recent.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]">
                  {p.title}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--ink-4)]">
                  <Badge>{p.stage}</Badge>
                  <span className="num">{p.soldComps} comps</span>
                  {p.demo && <Badge tone="accent">demo</Badge>}
                  <span>{ago(p.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------------------------------------------------------- errors */}
      <Card>
        <header className="flex items-center gap-2 border-b border-[var(--line-soft)] px-4 py-2.5">
          <AlertTriangle
            aria-hidden
            className={cn(
              "h-3.5 w-3.5",
              stats.errors.length > 0 ? "text-[var(--loss)]" : "text-[var(--ink-4)]",
            )}
          />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-3)]">
            Logged errors · {stats.errors.length}
          </h2>
        </header>
        {stats.errors.length === 0 ? (
          <Empty
            title="No errors logged"
            body="Every browser crash, failed promise and server failure lands here. An empty list is the goal."
            className="border-0 py-8"
          />
        ) : (
          <ul className="divide-y divide-[var(--line-soft)]">
            {stats.errors.map((e, i) => (
              <li key={`${e.at}-${i}`} className="px-4 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] font-medium text-[var(--loss)]">
                    {e.event}
                  </span>
                  <span className="num text-[10.5px] text-[var(--ink-4)]">
                    {shortDate(e.at)} · {ago(e.at)}
                  </span>
                </div>
                {e.message && (
                  <p className="mt-0.5 break-words font-mono text-[11.5px] leading-relaxed text-[var(--ink-2)]">
                    {e.message}
                  </p>
                )}
                {e.url && (
                  <p className="mt-0.5 truncate text-[10.5px] text-[var(--ink-4)]">{e.url}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-center text-[11.5px] text-[var(--ink-4)]">
        <Link href="/apps/buildflip-2/board" className="underline-offset-2 hover:underline">
          Back to the board
        </Link>
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  foot,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  foot?: string;
  tone?: "neutral" | "profit" | "loss";
}) {
  return (
    <Card className="p-3">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-3)]">
        {label}
      </div>
      <div
        className={cn(
          "num mt-1 text-[1.375rem] font-semibold leading-none",
          tone === "profit" && "text-[var(--profit)]",
          tone === "loss" && "text-[var(--loss)]",
          tone === "neutral" && "text-[var(--ink)]",
        )}
      >
        {value}
      </div>
      {foot && (
        <div className="mt-1 text-[10.5px] leading-snug text-[var(--ink-4)]">{foot}</div>
      )}
    </Card>
  );
}
