"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  Hammer,
  Plus,
  Search,
  SlidersHorizontal,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { useApp, write } from "./AppState";
import { useToast } from "./Providers";
import Composer, { type ComposerSubmit } from "./Composer";
import GenerationTheatre from "./GenerationTheatre";
import Paywall from "./Paywall";
import ProjectCard from "./ProjectCard";
import WorkbenchCanvas from "./WorkbenchCanvas";
import { useGenerate } from "./useGenerate";
import { Badge, Button, Card, Empty, ErrorNote, Sheet, Skeleton, fieldClass } from "./ui";
import { STAGES, type Project, type ProjectStage } from "@/lib/buildflip-2/types";
import { computeVerdict, fmtMoney, fmtPct, profitPerHourSort } from "@/lib/buildflip-2/calc";
import { cn, ease } from "@/lib/buildflip-2/ui";

/**
 * THE BOARD — the main surface.
 *
 * Columns the plans move between: Idea ▸ Priced ▸ Shopping ▸ Building ▸ Sold.
 * Drag between columns on a laptop; on a phone the columns are a sideways-
 * swipeable rail and each card has a stage picker, so everything you can do on
 * a computer you can do just as easily on a phone (U9).
 */

type SortKey = "newest" | "profit" | "hourly" | "cost";

export default function Board() {
  const { projects, loading, error, refresh, signedIn, entitlement, accuracy, account, capabilities } =
    useApp();
  const { toast } = useToast();
  const gen = useGenerate();

  const [composerOpen, setComposerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [stageFilter, setStageFilter] = useState<ProjectStage | "all">("all");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ProjectStage | null>(null);
  const [paywall, setPaywall] = useState<{ moment: string; message: string } | null>(null);

  const theatreRef = useRef<HTMLDivElement | null>(null);

  // When the server says "paywall", show it at the moment it happened.
  useEffect(() => {
    if (gen.paywall) setPaywall(gen.paywall);
  }, [gen.paywall]);

  // When a plan lands, close the composer and scroll the new card into view.
  useEffect(() => {
    if (!gen.project) return;
    setComposerOpen(false);
    toast({
      tone: "success",
      message: gen.demo
        ? `“${gen.project.title}” is ready — priced from the demo catalog.`
        : `“${gen.project.title}” is ready.`,
    });
  }, [gen.project, gen.demo, toast]);

  const start = (input: ComposerSubmit) => {
    void gen.run(input);
    setTimeout(
      () => theatreRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
      120,
    );
  };

  /* ------------------------------------------------------- search + filter */

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = projects;
    if (q) {
      list = list.filter((p) =>
        [p.title, p.summary, p.prompt, p.buildType, ...p.materials.map((m) => m.name)]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    if (stageFilter !== "all") list = list.filter((p) => p.stage === stageFilter);

    const sorted = [...list];
    if (sort === "newest") {
      sorted.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    } else if (sort === "hourly") {
      sorted.sort((a, b) => profitPerHourSort(b) - profitPerHourSort(a));
    } else if (sort === "profit") {
      // Use the same verdict the cards display — a hand-rolled total here
      // included optional extras and ignored receipts, so the order
      // disagreed with the profit printed on the cards.
      sorted.sort((a, b) => computeVerdict(b).profit - computeVerdict(a).profit);
    } else {
      sorted.sort((a, b) => computeVerdict(a).actualCost - computeVerdict(b).actualCost);
    }
    return sorted;
  }, [projects, query, stageFilter, sort]);

  const byStage = useMemo(() => {
    const map = new Map<ProjectStage, Project[]>();
    for (const s of STAGES) map.set(s.id, []);
    for (const p of filtered) map.get(p.stage)?.push(p);
    return map;
  }, [filtered]);

  /* -------------------------------------------------------------- staging */

  const moveTo = async (project: Project, stage: ProjectStage) => {
    if (project.stage === stage) return;
    const res = await write<{ project: Project }>(`/api/buildflip-2/plan/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ stage }),
    });
    if (res.ok && res.data?.project) {
      // Optimism already happened visually via refresh; keep the cache honest.
      void refresh({ quiet: true });
    } else {
      toast({ tone: "error", message: res.error ?? "That didn't move. Try again." });
      void refresh({ quiet: true });
    }
  };

  const totals = useMemo(() => {
    const live = projects.filter((p) => !p.generating && !p.error);
    const verdicts = live.map((p) => computeVerdict(p));
    return {
      count: live.length,
      best: verdicts.length ? Math.max(...verdicts.map((v) => v.profit)) : 0,
      buildCalls: verdicts.filter((v) => v.call === "build").length,
    };
  }, [projects]);

  /* ----------------------------------------------------------------- view */

  if (!signedIn) return <SignInPrompt />;

  return (
    <div className="relative">
      <WorkbenchCanvas className="pointer-events-none absolute inset-x-0 top-0 h-[420px] w-full opacity-70" />

      <div className="relative mx-auto w-full max-w-[1480px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        {/* ------------------------------------------------------- header */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[clamp(1.5rem,4.5vw,2rem)] font-semibold tracking-[-0.035em]">
              Your board
            </h1>
            <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-[var(--ink-2)]">
              {totals.count === 0
                ? "Paste a build you've seen and find out what it costs and what it sells for."
                : `${totals.count} plan${totals.count === 1 ? "" : "s"}${
                    totals.buildCalls > 0
                      ? ` · ${totals.buildCalls} worth building`
                      : ""
                  }${totals.best > 0 ? ` · best is ${fmtMoney(totals.best, { cents: false })} profit` : ""}`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {accuracy && (
              <Link href="/apps/buildflip-2/settings" className="hidden sm:block">
                <Card className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Target aria-hidden className="h-3.5 w-3.5 text-[var(--accent)]" />
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ink-3)]">
                        Your accuracy
                      </div>
                      <div className="num text-[13px] font-semibold text-[var(--ink)]">
                        ±{fmtPct(accuracy.medianErrorPct)} over {accuracy.builds}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            )}
            <Button
              variant="primary"
              size="md"
              onClick={() => setComposerOpen(true)}
              icon={<Plus aria-hidden className="h-4 w-4" />}
            >
              New plan
            </Button>
          </div>
        </div>

        {/* --------------------------------------------- live generation */}
        <div ref={theatreRef}>
          <AnimatePresence>
            {(gen.running || gen.error) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.4, ease }}
                className="mb-5 overflow-hidden"
              >
                {gen.running ? (
                  <GenerationTheatre progress={gen.progress} elapsedMs={gen.elapsedMs} />
                ) : (
                  <ErrorNote onRetry={() => gen.retry()}>{gen.error}</ErrorNote>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ---------------------------------------------- free-plan notice
            Only with the money layer on. On this hub it is off: every plan is
            free, so there is no allowance to count down. */}
        {capabilities?.monetization && entitlement && account?.plan !== "pro" && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
            <p className="text-[13px] text-[var(--ink-2)]">
              {entitlement.plansRemaining > 0 ? (
                <>
                  <strong className="font-semibold text-[var(--ink)]">
                    One free plan, no card.
                  </strong>{" "}
                  Make it count — the whole product is in that one plan.
                </>
              ) : (
                <>
                  <strong className="font-semibold text-[var(--ink)]">
                    You&apos;ve used your free plan.
                  </strong>{" "}
                  Everything you made stays yours and readable, always.
                </>
              )}
            </p>
            <Link href="/apps/buildflip-2/pricing">
              <Button size="sm" variant={entitlement.plansRemaining > 0 ? "ghost" : "primary"}>
                {entitlement.plansRemaining > 0 ? "See Pro" : "Unlock unlimited"}
              </Button>
            </Link>
          </div>
        )}

        {/* --------------------------------------------- search + controls */}
        {projects.length > 2 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-4)]"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search plans and materials"
                aria-label="Search your plans"
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

            <Button
              size="md"
              variant="secondary"
              onClick={() => setFiltersOpen(true)}
              icon={<SlidersHorizontal aria-hidden className="h-4 w-4" />}
            >
              <span className="hidden min-[26rem]:inline">
                {sort === "newest"
                  ? "Newest"
                  : sort === "hourly"
                    ? "Best per hour"
                    : sort === "profit"
                      ? "Most profit"
                      : "Cheapest"}
              </span>
              {stageFilter !== "all" && (
                <Badge tone="accent">{STAGES.find((s) => s.id === stageFilter)?.label}</Badge>
              )}
            </Button>

            {projects.length > 1 && (
              <Link href="/apps/buildflip-2/compare" className="hidden sm:block">
                <Button
                  size="md"
                  variant="secondary"
                  icon={<TrendingUp aria-hidden className="h-4 w-4" />}
                >
                  Compare
                </Button>
              </Link>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4">
            <ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote>
          </div>
        )}

        {/* ---------------------------------------------------- the columns */}
        {loading && projects.length === 0 ? (
          <BoardSkeleton />
        ) : projects.length === 0 ? (
          <Empty
            icon={<Hammer aria-hidden className="h-7 w-7" />}
            title="Nothing on the board yet"
            body="Paste a link to a build you've seen — or just describe it — and BuildFlip comes back with the steps, the priced materials and a profit number. Your first plan is free."
            action={
              <Button
                variant="primary"
                onClick={() => setComposerOpen(true)}
                icon={<Plus aria-hidden className="h-4 w-4" />}
              >
                Make your first plan
              </Button>
            }
            className="py-16"
          />
        ) : filtered.length === 0 ? (
          <Empty
            icon={<Search aria-hidden className="h-7 w-7" />}
            title="Nothing matches that"
            body={`No plan matches ${query ? `“${query}”` : "those filters"}. Try a shorter search, or clear the filters to see all ${projects.length}.`}
            action={
              <Button
                onClick={() => {
                  setQuery("");
                  setStageFilter("all");
                }}
              >
                Clear search and filters
              </Button>
            }
          />
        ) : (
          <div className="swipe-row items-start sm:grid sm:grid-cols-2 sm:items-start sm:gap-3 sm:overflow-visible sm:px-0 sm:mx-0 lg:grid-cols-5">
            {/* items-start so an empty column collapses to its header rather
                than stretching to the height of the fullest one — on a phone
                that is the difference between seeing your plans and scrolling
                past empty space. */}
            {STAGES.map((stage) => {
              const items = byStage.get(stage.id) ?? [];
              const isTarget = dropTarget === stage.id;
              return (
                <section
                  key={stage.id}
                  aria-label={`${stage.label} — ${items.length} plan${items.length === 1 ? "" : "s"}`}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    setDropTarget(stage.id);
                  }}
                  onDragLeave={() => setDropTarget((t) => (t === stage.id ? null : t))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTarget(null);
                    const project = projects.find((p) => p.id === dragId);
                    setDragId(null);
                    if (project) void moveTo(project, stage.id);
                  }}
                  className={cn(
                    "w-[80vw] max-w-[320px] shrink-0 rounded-[var(--radius-card)] border p-2.5 transition-colors sm:w-auto sm:max-w-none",
                    isTarget
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--line-soft)] bg-[color-mix(in_srgb,var(--surface)_45%,transparent)]",
                  )}
                >
                  <header className="mb-2.5 flex items-center justify-between gap-2 px-1">
                    <div className="min-w-0">
                      <h2 className="text-[12px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-2)]">
                        {stage.label}
                      </h2>
                      <p className="truncate text-[10.5px] text-[var(--ink-4)]">{stage.hint}</p>
                    </div>
                    <span className="num shrink-0 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink-3)]">
                      {items.length}
                    </span>
                  </header>

                  <div className="space-y-2.5">
                    <AnimatePresence mode="popLayout">
                      {items.map((project) => (
                        <div key={project.id}>
                          <ProjectCard
                            project={project}
                            dragging={dragId === project.id}
                            onDragStart={() => setDragId(project.id)}
                          />
                          {/* The phone equivalent of dragging (U9). */}
                          <div className="mt-1.5 sm:hidden">
                            <label className="sr-only" htmlFor={`stage-${project.id}`}>
                              Move {project.title} to a different column
                            </label>
                            <select
                              id={`stage-${project.id}`}
                              value={project.stage}
                              onChange={(e) =>
                                void moveTo(project, e.target.value as ProjectStage)
                              }
                              className="min-h-9 w-full rounded-[8px] border border-[var(--line)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--ink-2)]"
                            >
                              {STAGES.map((s) => (
                                <option key={s.id} value={s.id}>
                                  Move to {s.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </AnimatePresence>

                    {items.length === 0 && (
                      <p className="rounded-[10px] border border-dashed border-[var(--line)] px-3 py-5 text-center text-[11.5px] leading-relaxed text-[var(--ink-4)]">
                        {stage.id === "idea"
                          ? "New plans land here while they build."
                          : `Drag a plan here when it's ${stage.label.toLowerCase()}.`}
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* -------------------------------------------------- phone new-plan */}
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        aria-label="New plan"
        className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_8px_28px_-6px_var(--accent)] transition active:scale-95 sm:hidden"
      >
        <Plus aria-hidden className="h-6 w-6" />
      </button>

      {/* ----------------------------------------------------------- sheets */}
      <Sheet
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="New plan"
        description="A link, a line about what you want, and any photos you have."
        wide
      >
        <Composer onSubmit={start} busy={gen.running} autoFocus />
      </Sheet>

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Sort and filter"
      >
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">
              Sort by
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["newest", "Newest first"],
                  ["hourly", "Best per hour"],
                  ["profit", "Most profit"],
                  ["cost", "Cheapest to build"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSort(key)}
                  aria-pressed={sort === key}
                  className={cn(
                    "min-h-11 rounded-[var(--radius-ctl)] border px-3 text-[13px] font-medium transition",
                    sort === key
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                      : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--accent-line)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">
              Show only
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStageFilter("all")}
                aria-pressed={stageFilter === "all"}
                className={cn(
                  "min-h-10 rounded-full border px-3.5 text-[13px] font-medium transition",
                  stageFilter === "all"
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                    : "border-[var(--line)] text-[var(--ink-2)]",
                )}
              >
                Everything
              </button>
              {STAGES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStageFilter(s.id)}
                  aria-pressed={stageFilter === s.id}
                  className={cn(
                    "min-h-10 rounded-full border px-3.5 text-[13px] font-medium transition",
                    stageFilter === s.id
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                      : "border-[var(--line)] text-[var(--ink-2)]",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Sheet>

      <Paywall
        open={Boolean(paywall)}
        moment={paywall?.moment ?? "secondPlan"}
        message={paywall?.message}
        onClose={() => {
          setPaywall(null);
          gen.dismiss();
        }}
        returnTo="/apps/buildflip-2/board"
      />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading your board"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      {[0, 1, 2, 3, 4].map((col) => (
        <div
          key={col}
          className="rounded-[var(--radius-card)] border border-[var(--line-soft)] p-2.5"
        >
          <Skeleton className="mb-3 h-3 w-20" />
          <div className="space-y-2.5">
            {Array.from({ length: col === 1 ? 2 : 1 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-[var(--radius-card)]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SignInPrompt() {
  return (
    <div className="relative">
      <WorkbenchCanvas className="pointer-events-none absolute inset-0 h-full w-full opacity-60" />
      <div className="relative mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
        <Hammer aria-hidden className="h-8 w-8 text-[var(--accent)]" />
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.035em]">
            Sign in to keep your plans
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-2)]">
            One tap, no password. Your plans then follow you between the workshop phone and
            the laptop, and only you can see them.
          </p>
        </div>
        <Link href="/login" className="w-full">
          <Button variant="primary" size="lg" className="w-full">
            Sign in
          </Button>
        </Link>
        <Link
          href="/apps/buildflip-2"
          className="text-[13px] text-[var(--ink-3)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
        >
          See how it works first
        </Link>
      </div>
    </div>
  );
}
