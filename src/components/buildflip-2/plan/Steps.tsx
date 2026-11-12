"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Scissors, Search, TriangleAlert, Wrench, X } from "lucide-react";
import { Badge, Card, Empty, fieldClass } from "../ui";
import { fmtHours } from "@/lib/buildflip-2/calc";
import type { BuildStep, Project } from "@/lib/buildflip-2/types";
import { cn, ease } from "@/lib/buildflip-2/ui";

/**
 * Feature 2 — the step-by-step build plan.
 *
 * Ordered steps with the tools, the time, the cut list with measurements and
 * the safety notes that matter for THIS build. Readable on a phone propped on a
 * bench: big tap targets, one step open at a time, a progress rail that fills
 * as steps are checked off, and a search that finds a step by its technique or
 * its tool.
 */

export default function Steps({
  project,
  onToggle,
  readOnly,
}: {
  project: Project;
  onToggle?: (stepId: string, done: boolean) => void;
  readOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(project.steps[0]?.id ?? null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return project.steps;
    return project.steps.filter((s) =>
      [s.title, s.body, ...s.tools, ...(s.safety ?? []), ...(s.cutList ?? []).map((c) => `${c.part} ${c.dimensions} ${c.material}`)]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [project.steps, query]);

  const doneCount = project.steps.filter((s) => s.done).length;
  const remainingMinutes = project.steps
    .filter((s) => !s.done)
    .reduce((sum, s) => sum + s.minutes, 0);

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------- progress */}
      <Card className="p-4">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-[var(--ink)]">
            {doneCount === 0
              ? `${project.steps.length} steps`
              : `${doneCount} of ${project.steps.length} done`}
          </h3>
          <motion.span
            key={remainingMinutes}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            className="num text-[12px] text-[var(--ink-2)]"
          >
            {remainingMinutes > 0
              ? `${fmtHours(remainingMinutes / 60)} of work left`
              : "All done — log your receipts"}
          </motion.span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
          <motion.div
            className="h-full rounded-full bg-[var(--profit)]"
            animate={{
              width: `${project.steps.length ? (doneCount / project.steps.length) * 100 : 0}%`,
            }}
            transition={{ duration: 0.5, ease }}
          />
        </div>

        {project.tools.length > 0 && (
          <div className="mt-3.5 border-t border-[var(--line-soft)] pt-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">
              <Wrench aria-hidden className="h-3 w-3" />
              Tools you need
            </div>
            <div className="swipe-row sm:flex-wrap sm:overflow-visible sm:px-0 sm:mx-0">
              {project.tools.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------- safety */}
      {project.safety.length > 0 && (
        <Card className="border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--warn)_7%,transparent)] p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <TriangleAlert aria-hidden className="h-4 w-4 text-[var(--warn)]" />
            <h3 className="text-[13px] font-semibold text-[var(--ink)]">
              Read this before you start
            </h3>
          </div>
          <ul className="space-y-1.5">
            {project.safety.map((s) => (
              <li key={s} className="text-[12.5px] leading-relaxed text-[var(--ink-2)]">
                · {s}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* -------------------------------------------------------- search */}
      {project.steps.length > 4 && (
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-4)]"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a step, a tool or a measurement"
            aria-label="Search the build steps"
            className={cn(fieldClass, "pl-9 pr-9")}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-[var(--ink-4)] hover:text-[var(--ink)]"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* --------------------------------------------------------- steps */}
      {filtered.length === 0 ? (
        <Empty
          icon={<Search aria-hidden className="h-6 w-6" />}
          title="No step mentions that"
          body={`Nothing in this plan matches “${query}”. Try a tool name, a material, or clear the search to see all ${project.steps.length} steps.`}
        />
      ) : (
        <ol className="space-y-2">
          {filtered.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              open={open === step.id}
              onOpen={() => setOpen(open === step.id ? null : step.id)}
              onToggle={onToggle}
              readOnly={readOnly}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function StepRow({
  step,
  open,
  onOpen,
  onToggle,
  readOnly,
}: {
  step: BuildStep;
  open: boolean;
  onOpen: () => void;
  onToggle?: (stepId: string, done: boolean) => void;
  readOnly?: boolean;
}) {
  const panelId = `step-panel-${step.id}`;
  return (
    <li>
      <Card className={cn("overflow-hidden transition-colors", step.done && "opacity-70")}>
        <div className="flex items-stretch">
          {!readOnly && onToggle && (
            <button
              type="button"
              onClick={() => onToggle(step.id, !step.done)}
              aria-pressed={step.done}
              aria-label={`${step.done ? "Un-check" : "Check off"} step ${step.index + 1}: ${step.title}`}
              className={cn(
                "grid w-12 shrink-0 place-items-center border-r border-[var(--line-soft)] transition-colors",
                step.done
                  ? "bg-[var(--profit-soft)] text-[var(--profit)]"
                  : "text-[var(--ink-4)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-2)]",
              )}
            >
              <span
                className={cn(
                  "grid h-5 w-5 place-items-center rounded-full border",
                  step.done ? "border-[var(--profit)]" : "border-current",
                )}
              >
                {step.done ? (
                  <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
                ) : (
                  <span className="num text-[10px] font-semibold">{step.index + 1}</span>
                )}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpen}
            aria-expanded={open}
            aria-controls={panelId}
            className="flex min-h-[56px] flex-1 items-center gap-3 px-3.5 py-3 text-left"
          >
            <div className="min-w-0 flex-1">
              <h4
                className={cn(
                  "text-[13.5px] font-semibold leading-snug text-[var(--ink)]",
                  step.done && "line-through decoration-[var(--ink-4)]",
                )}
              >
                {readOnly && <span className="num mr-1.5 text-[var(--ink-4)]">{step.index + 1}.</span>}
                {step.title}
              </h4>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[var(--ink-4)]">
                <span className="num">{fmtHours(step.minutes / 60)}</span>
                {step.tools.length > 0 && <span className="truncate">{step.tools.join(" · ")}</span>}
                {step.cutList && step.cutList.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                    <Scissors aria-hidden className="h-2.5 w-2.5" />
                    cut list
                  </span>
                )}
              </div>
            </div>
            <ChevronDown
              aria-hidden
              className={cn(
                "h-4 w-4 shrink-0 text-[var(--ink-4)] transition-transform duration-300",
                open && "rotate-180",
              )}
            />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={panelId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease }}
              className="overflow-hidden border-t border-[var(--line-soft)]"
            >
              <div className="space-y-3.5 px-4 py-3.5">
                <p className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">{step.body}</p>

                {step.cutList && step.cutList.length > 0 && (
                  <div className="overflow-hidden rounded-[10px] border border-[var(--line)]">
                    <div className="flex items-center gap-1.5 bg-[var(--surface-2)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">
                      <Scissors aria-hidden className="h-3 w-3" />
                      Cut list
                    </div>
                    <table className="w-full text-[12px]">
                      <caption className="sr-only">
                        Cut list for step {step.index + 1}: {step.title}
                      </caption>
                      <thead>
                        <tr className="border-y border-[var(--line-soft)] text-left text-[10.5px] uppercase tracking-[0.06em] text-[var(--ink-4)]">
                          <th scope="col" className="px-3 py-1.5 font-medium">Part</th>
                          <th scope="col" className="px-3 py-1.5 font-medium">Qty</th>
                          <th scope="col" className="px-3 py-1.5 font-medium">Finished size</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--line-soft)]">
                        {step.cutList.map((c) => (
                          <tr key={c.id}>
                            <td className="px-3 py-2 align-top">
                              <span className="font-medium text-[var(--ink)]">{c.part}</span>
                              <span className="mt-0.5 block text-[10.5px] text-[var(--ink-4)]">
                                {c.material}
                              </span>
                            </td>
                            <td className="num px-3 py-2 align-top text-[var(--ink)]">{c.qty}</td>
                            <td className="px-3 py-2 align-top">
                              <span className="num text-[var(--ink)]">{c.dimensions}</span>
                              {c.notes && (
                                <span className="mt-0.5 block text-[10.5px] leading-relaxed text-[var(--ink-3)]">
                                  {c.notes}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {step.safety && step.safety.length > 0 && (
                  <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--warn)_7%,transparent)] px-3 py-2.5">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--warn)]">
                      <TriangleAlert aria-hidden className="h-3 w-3" />
                      Careful here
                    </div>
                    <ul className="space-y-1">
                      {step.safety.map((s) => (
                        <li key={s} className="text-[12px] leading-relaxed text-[var(--ink-2)]">
                          · {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {step.tools.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-[var(--ink-4)]">Tools:</span>
                    {step.tools.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </li>
  );
}
