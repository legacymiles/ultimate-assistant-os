"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { AlertTriangle, Clock, FlaskConical, Loader2, Share2 } from "lucide-react";
import { computeVerdict, estimateAccuracy, fmtHours, fmtMoney, fmtPct, fmtRate } from "@/lib/buildflip-2/calc";
import type { Project } from "@/lib/buildflip-2/types";
import { ago, cn, ease } from "@/lib/buildflip-2/ui";
import { Badge } from "./ui";

/**
 * A plan on the board. Carries its own miniature Margin Beam, so a column of
 * cards reads as a column of verdicts rather than a column of titles.
 */

const CALL_TONE = {
  build: { label: "Build it", tone: "profit" as const },
  maybe: { label: "Marginal", tone: "warn" as const },
  skip: { label: "Skip it", tone: "loss" as const },
};

export default function ProjectCard({
  project,
  onDragStart,
  dragging,
  compact,
}: {
  project: Project;
  onDragStart?: (e: React.DragEvent) => void;
  dragging?: boolean;
  compact?: boolean;
}) {
  if (project.generating) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--accent-line)] bg-[var(--surface)] p-3.5">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--ink)]">
          <Loader2 aria-hidden className="h-3.5 w-3.5 spin text-[var(--accent)]" />
          <span className="truncate">{project.title}</span>
        </div>
        <p className="mt-1.5 text-[11.5px] text-[var(--ink-3)]">
          Still building this plan. It keeps going even if you close the tab.
        </p>
        <div className="mt-2.5 space-y-1.5">
          <div className="skel h-2 w-full" />
          <div className="skel h-2 w-3/4" />
        </div>
      </div>
    );
  }

  if (project.error) {
    return (
      <Link
        href={`/apps/buildflip-2/plan/${project.id}`}
        className="block rounded-[var(--radius-card)] border border-[color-mix(in_srgb,var(--loss)_35%,transparent)] bg-[var(--loss-soft)] p-3.5 transition hover:border-[var(--loss)]"
      >
        <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--ink)]">
          <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--loss)]" />
          <span className="truncate">{project.title}</span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-[var(--ink-2)]">
          {project.error}
        </p>
        <span className="mt-2 inline-block text-[11.5px] font-semibold text-[var(--accent)]">
          Open and try again →
        </span>
      </Link>
    );
  }

  const verdict = computeVerdict(project);
  const call = CALL_TONE[verdict.call];
  const acc = estimateAccuracy(project);
  const demo = project.resale?.provenance.demo || project.materials[0]?.provenance.demo;

  // The mini beam: where the sale price sits between cost and the top comp.
  const top = Math.max(verdict.salePrice, project.resale?.high ?? 0, verdict.actualCost * 1.5, 1);
  const costPct = (verdict.actualCost / top) * 100;
  const salePct = (verdict.salePrice / top) * 100;

  return (
    // The native HTML5 drag source has to be a plain element — motion.div owns
    // its own onDragStart for gesture dragging, which is a different thing.
    <div draggable={Boolean(onDragStart)} onDragStart={onDragStart}>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: dragging ? 0.45 : 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
        className={cn(
          "group rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)] transition-all",
          onDragStart && "sm:cursor-grab sm:active:cursor-grabbing",
          "hover:border-[var(--accent-line)] hover:shadow-[var(--shadow-pop)]",
        )}
      >
        <Link href={`/apps/buildflip-2/plan/${project.id}`} className="block p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-[var(--ink)]">
            {project.title}
          </h3>
          <Badge tone={call.tone} className="shrink-0">
            {call.label}
          </Badge>
        </div>

        {!compact && project.summary && (
          <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-[var(--ink-3)]">
            {project.summary}
          </p>
        )}

        {/* mini margin beam */}
        <div className="relative mt-3 h-[5px] overflow-hidden rounded-full bg-[var(--surface-3)]">
          <span
            className="absolute inset-y-0 left-0 bg-[var(--loss-soft)]"
            style={{ width: `${Math.min(100, costPct)}%` }}
          />
          <span
            className={cn(
              "absolute inset-y-0",
              verdict.profit >= 0 ? "bg-[var(--profit)]" : "bg-[var(--loss)]",
            )}
            style={{
              left: `${Math.min(costPct, salePct)}%`,
              width: `${Math.min(100, Math.abs(salePct - costPct))}%`,
            }}
          />
          <span
            className="absolute inset-y-[-2px] w-[2px] bg-[var(--accent)]"
            style={{ left: `${Math.min(99, salePct)}%` }}
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
          <span className="num text-[var(--ink-3)]">
            {fmtMoney(verdict.actualCost, { cents: false })} in
          </span>
          <span
            className={cn(
              "num font-semibold",
              verdict.profit >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]",
            )}
          >
            {fmtMoney(verdict.profit, { cents: false })} profit
          </span>
          <span className="num text-[var(--ink-3)]">
            {fmtRate(verdict.hourlyRate, "hours not set")}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-[var(--line-soft)] pt-2.5 text-[10.5px] text-[var(--ink-4)]">
          <span className="inline-flex items-center gap-1">
            <Clock aria-hidden className="h-3 w-3" />
            {fmtHours(project.estimatedHours)}
          </span>
          {project.resale?.thin && (
            <span className="text-[var(--warn)]">thin market</span>
          )}
          {acc && (
            <span className={acc.within15 ? "text-[var(--profit)]" : "text-[var(--warn)]"}>
              actual {acc.delta >= 0 ? "+" : ""}
              {fmtPct(acc.deltaPct)}
            </span>
          )}
          {project.share?.enabled && (
            <span className="inline-flex items-center gap-1">
              <Share2 aria-hidden className="h-3 w-3" />
              shared
            </span>
          )}
          {demo && (
            <span className="inline-flex items-center gap-1 text-[var(--accent)]">
              <FlaskConical aria-hidden className="h-3 w-3" />
              demo
            </span>
          )}
          <span className="ml-auto">{ago(project.createdAt)}</span>
        </div>
        </Link>
      </motion.div>
    </div>
  );
}
