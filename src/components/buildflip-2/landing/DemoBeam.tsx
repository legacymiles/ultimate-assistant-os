"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import MarginBeam from "../MarginBeam";
import SourceChip from "../SourceChip";
import { Badge, Card } from "../ui";
import { estimateResale, fmtMoney, materialsTotal } from "@/lib/buildflip-2/calc";
import { DEMO_PLANS } from "@/lib/buildflip-2/ai/demo-catalog";
import type { Comp, Material, Provenance } from "@/lib/buildflip-2/types";
import { cn } from "@/lib/buildflip-2/ui";

/**
 * The hero's toy, playable before anyone signs up.
 *
 * Three real demo builds; pick one and drag the Margin Beam. The point of the
 * product lands in about four seconds: the picture frame is a decent job, the
 * hot tub boat looks spectacular and pays less per hour than the frame, and you
 * can only see that because the beam puts your hours next to your margin.
 */

const CHECKED = "2026-11-08T12:00:00.000Z";

function provenance(source: string, url: string | null, demo = true): Provenance {
  return {
    source: `${source}`,
    url,
    checkedAt: CHECKED,
    confidence: "medium",
    note: "A real plan from the demo catalog, so you can try the tool without signing up. Your own plans are priced from live listings.",
    demo,
  };
}

const PLANS = ["picture-frame", "fireplace", "hot-tub-boat"] as const;

export default function DemoBeam() {
  const [which, setWhich] = useState<(typeof PLANS)[number]>("picture-frame");

  const plan = useMemo(() => DEMO_PLANS.find((p) => p.key === which)!, [which]);

  const materials = useMemo<Material[]>(
    () =>
      plan.spec.materials.map((m, i) => {
        const price = plan.prices.find(
          (p) => p.name.toLowerCase() === m.name.toLowerCase(),
        );
        const unitPrice = price?.unitPrice ?? 0;
        return {
          id: `d${i}`,
          name: m.name,
          spec: m.spec,
          category: m.category,
          aisle: m.aisle,
          quantity: m.quantity,
          baseQuantity: m.quantity,
          unit: m.unit,
          unitPrice,
          lineTotal: Math.round(m.quantity * unitPrice * 100) / 100,
          provenance: provenance(price?.retailer ?? "No price", price?.url ?? null),
          scaling: m.scaling,
          driver: m.driver,
        };
      }),
    [plan],
  );

  const comps = useMemo<Comp[]>(
    () =>
      plan.comps.map((c, i) => ({
        id: `c${i}`,
        title: c.title,
        price: c.price,
        sold: c.sold,
        soldAt: c.soldAt,
        marketplace: c.marketplace,
        url: c.url,
        condition: c.condition,
        provenance: provenance(`${c.marketplace}${c.sold ? " (sold)" : " (asking)"}`, c.url),
      })),
    [plan],
  );

  const resale = useMemo(() => estimateResale(comps, CHECKED, "Demo catalog", true), [comps]);
  const cost = materialsTotal(materials);
  const hours = plan.spec.estimatedHours;
  const [asking, setAsking] = useState<number | null>(null);

  const profit = (asking ?? resale.mid) - cost;
  const rate = hours > 0 ? profit / hours : profit;

  return (
    <Card className="overflow-hidden">
      {/* ------------------------------------------------------- picker */}
      <div
        role="tablist"
        aria-label="Try a demo build"
        className="swipe-row border-b border-[var(--line-soft)] bg-[var(--surface-2)] sm:gap-0"
      >
        {PLANS.map((key) => {
          const p = DEMO_PLANS.find((x) => x.key === key)!;
          const active = which === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => {
                setWhich(key);
                setAsking(null);
              }}
              className={cn(
                "relative min-h-12 whitespace-nowrap px-4 text-[13px] font-medium transition-colors",
                active ? "text-[var(--ink)]" : "text-[var(--ink-3)] hover:text-[var(--ink)]",
              )}
            >
              {p.spec.title.replace(/\s*\(.*\)$/, "")}
              {active && (
                <motion.span
                  layoutId="demo-tab"
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--accent)]"
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
              {plan.spec.title}
            </h3>
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-[var(--ink-3)]">
              {plan.spec.summary}
            </p>
          </div>
          <Badge tone="accent">demo catalog</Badge>
        </div>

        <MarginBeam
          cost={cost}
          compLow={resale.low}
          compMid={resale.mid}
          compHigh={resale.high}
          comps={comps}
          hours={hours}
          hourlyTarget={25}
          value={asking}
          onChange={setAsking}
        />

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--line-soft)] pt-3.5 sm:grid-cols-4">
          <Mini
            label="Materials"
            value={fmtMoney(cost, { cents: false })}
            foot={`${materials.length} items`}
            provenance={materials[0]?.provenance}
          />
          <Mini
            label="Sold comps"
            value={String(resale.soldCount)}
            foot="completed sales"
            provenance={resale.provenance}
          />
          <Mini label="Hours" value={`${hours}h`} foot={`${plan.spec.steps.length} steps`} />
          <Mini
            label="Per hour"
            value={`${fmtMoney(rate, { cents: false })}/hr`}
            foot={rate >= 25 ? "clears $25/hr" : "under $25/hr"}
            tone={rate >= 25 ? "profit" : "loss"}
          />
        </div>

        <p className="mt-3.5 text-[11.5px] leading-relaxed text-[var(--ink-4)]">
          Drag the notch. The hot tub boat makes the most profit and the worst hourly rate —
          that is the exact mistake this app exists to stop. Your own plans are priced from
          live listings, not this catalog.
        </p>
      </div>
    </Card>
  );
}

function Mini({
  label,
  value,
  foot,
  tone = "neutral",
  provenance,
}: {
  label: string;
  value: string;
  foot: string;
  tone?: "neutral" | "profit" | "loss";
  provenance?: Provenance;
}) {
  const inner = (
    <span
      className={cn(
        "num text-[1rem] font-semibold leading-tight",
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
      <div className="text-[10px] font-medium uppercase tracking-[0.09em] text-[var(--ink-3)]">
        {label}
      </div>
      <div className="mt-0.5">
        {provenance ? <SourceChip provenance={provenance}>{inner}</SourceChip> : inner}
      </div>
      <div className="truncate text-[10px] text-[var(--ink-4)]">{foot}</div>
    </div>
  );
}
