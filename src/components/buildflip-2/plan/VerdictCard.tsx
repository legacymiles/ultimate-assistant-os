"use client";

import { CheckCircle2, CircleSlash, Clock, HelpCircle, Receipt, type LucideIcon } from "lucide-react";
import MarginBeam from "../MarginBeam";
import SourceChip from "../SourceChip";
import { Badge, Card } from "../ui";
import { computeVerdict, fmtHours, fmtMoney, fmtPct, fmtRate } from "@/lib/buildflip-2/calc";
import type { Project } from "@/lib/buildflip-2/types";
import { cn } from "@/lib/buildflip-2/ui";

/**
 * Feature 5 — THE ROI VERDICT.
 *
 * One card: total cost, expected sale price, profit, margin, hours, real hourly
 * rate, and a clear build-or-skip call with the one or two numbers that drove
 * it. The Margin Beam lives inside it, so the verdict is not a static figure —
 * you can push on it and watch it change.
 */

const CALL = {
  build: {
    label: "Build it",
    tone: "profit" as const,
    icon: CheckCircle2,
    ring: "border-[color-mix(in_srgb,var(--profit)_45%,transparent)] bg-[linear-gradient(180deg,var(--profit-soft),transparent_55%)]",
  },
  maybe: {
    label: "Marginal",
    tone: "warn" as const,
    icon: HelpCircle,
    ring: "border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--warn)_10%,transparent),transparent_55%)]",
  },
  skip: {
    label: "Skip it",
    tone: "loss" as const,
    icon: CircleSlash,
    ring: "border-[color-mix(in_srgb,var(--loss)_40%,transparent)] bg-[linear-gradient(180deg,var(--loss-soft),transparent_55%)]",
  },
};

export default function VerdictCard({
  project,
  onAskingPrice,
  readOnly,
  hourlyTarget,
}: {
  project: Project;
  onAskingPrice?: (value: number | null) => void;
  readOnly?: boolean;
  /** The account's current target, so changing it re-judges this plan. */
  hourlyTarget?: number | null;
}) {
  const v = computeVerdict(project, hourlyTarget);
  const target = hourlyTarget ?? project.hourlyTarget;
  const call = CALL[v.call];
  const Icon = call.icon;
  const resale = project.resale;

  return (
    <Card className={cn("overflow-hidden border", call.ring)}>
      <div className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Icon
              aria-hidden
              className={cn(
                "mt-0.5 h-5 w-5 shrink-0",
                v.call === "build"
                  ? "text-[var(--profit)]"
                  : v.call === "maybe"
                    ? "text-[var(--warn)]"
                    : "text-[var(--loss)]",
              )}
            />
            <div className="min-w-0">
              <h2 className="text-[clamp(1.0625rem,3.5vw,1.25rem)] font-semibold tracking-[-0.025em] text-[var(--ink)]">
                {v.headline}
              </h2>
              <ul className="mt-1.5 space-y-0.5">
                {v.drivers.map((d) => (
                  <li key={d} className="text-[12.5px] leading-relaxed text-[var(--ink-2)]">
                    · {d}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Badge tone={call.tone}>{call.label}</Badge>
            <Badge
              tone={
                v.confidence === "high"
                  ? "profit"
                  : v.confidence === "low"
                    ? "warn"
                    : "neutral"
              }
            >
              {v.confidence === "high"
                ? "Confident"
                : v.confidence === "medium"
                  ? "Fairly sure"
                  : "Uncertain"}
            </Badge>
          </div>
        </div>

        {/* THE TOY */}
        {resale ? (
          <MarginBeam
            cost={v.actualCost}
            compLow={resale.low}
            compMid={resale.mid}
            compHigh={resale.high}
            comps={resale.comps}
            hours={v.hours}
            hourlyTarget={target}
            value={project.askingPrice}
            onChange={onAskingPrice}
            readOnly={readOnly || !onAskingPrice}
          />
        ) : (
          <p className="rounded-[var(--radius-ctl)] border border-dashed border-[var(--line)] px-3.5 py-4 text-[13px] leading-relaxed text-[var(--ink-3)]">
            We haven&apos;t found a resale market for this yet, so there is no profit number
            to show. The materials list below is still fully priced.
          </p>
        )}

        {/* the numbers, laid out flat */}
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-[var(--line-soft)] pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Figure
            label={v.costBasis === "actual" ? "Actually spent" : "Materials"}
            value={fmtMoney(v.actualCost, { cents: false })}
            foot={
              v.costBasis === "actual"
                ? "from your receipts"
                : v.costBasis === "mixed"
                  ? "receipts + estimate"
                  : "estimated"
            }
            icon={v.costBasis !== "estimate" ? Receipt : undefined}
          />
          <Figure
            label="Sells for"
            value={fmtMoney(v.salePrice, { cents: false })}
            foot={
              v.salePriceBasis === "asking"
                ? "your asking price"
                : resale
                  ? `${resale.soldCount} sold comp${resale.soldCount === 1 ? "" : "s"}`
                  : "no market"
            }
            provenance={resale?.provenance}
          />
          <Figure
            label="Profit"
            value={fmtMoney(v.profit, { cents: false })}
            tone={v.profit > 0 ? "profit" : "loss"}
            foot={v.profit > 0 ? "before your time" : "you lose this"}
          />
          <Figure label="Margin" value={fmtPct(v.margin)} foot="of the sale price" />
          <Figure
            label="Hours"
            value={fmtHours(v.hours)}
            foot="across every step"
            icon={Clock}
          />
          <Figure
            label="Your hourly"
            value={fmtRate(v.hourlyRate)}
            tone={
              v.profit > 0 &&
              v.hourlyRate != null &&
              v.hourlyRate >= (hourlyTarget ?? project.hourlyTarget)
                ? "profit"
                : "neutral"
            }
            foot={`you want ${fmtMoney(target, { cents: false })}/hr`}
          />
        </dl>

        {resale?.thin && resale.thinReason && (
          <p className="mt-4 rounded-[var(--radius-ctl)] border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--warn)_9%,transparent)] px-3.5 py-3 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
            <strong className="font-semibold text-[var(--warn)]">Thin market.</strong>{" "}
            {resale.thinReason}
          </p>
        )}
      </div>
    </Card>
  );
}

function Figure({
  label,
  value,
  foot,
  tone = "neutral",
  icon: Icon,
  provenance,
}: {
  label: string;
  value: string;
  foot?: string;
  tone?: "neutral" | "profit" | "loss";
  // See the note on PlanView's TABS: a bare ElementType has `never` props
  // under the hub's @types/react.
  icon?: LucideIcon;
  provenance?: Project["resale"] extends infer R
    ? R extends { provenance: infer P }
      ? P
      : never
    : never;
}) {
  const body = (
    <span
      className={cn(
        "num text-[1.0625rem] font-semibold leading-tight",
        tone === "profit" && "text-[var(--profit)]",
        tone === "loss" && "text-[var(--loss)]",
        tone === "neutral" && "text-[var(--ink)]",
      )}
    >
      {value}
    </span>
  );

  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--ink-3)]">
        {Icon && <Icon aria-hidden className="h-3 w-3" />}
        {label}
      </dt>
      <dd className="mt-0.5">
        {provenance ? <SourceChip provenance={provenance}>{body}</SourceChip> : body}
        {foot && (
          <span className="mt-0.5 block truncate text-[10.5px] text-[var(--ink-4)]">
            {foot}
          </span>
        )}
      </dd>
    </div>
  );
}
