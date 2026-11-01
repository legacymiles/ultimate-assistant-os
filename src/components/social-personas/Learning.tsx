"use client";

import { useEffect, useMemo, useState } from "react";

import { Icon } from "../icons";
import { leverEffects, scorePosts, scoreSeries, type ScoredPost } from "@/lib/social-personas/learn";
import {
  TIER_NAME,
  type Lesson,
  type LeverEffect,
  type LeverTier,
  type Persona,
} from "@/lib/social-personas/types";
import { Btn } from "./bits";
import { BrainTab } from "./tabs";
import type { TabProps } from "./Workspace";

/**
 * What the agent believes, and how sure it is.
 *
 * The bar this is built against is Statsig's experiment Results view, and the
 * one quality being matched is this: no claim appears without an effect size, a
 * confidence interval and a sample size next to it, so a reader can see what
 * won AND how much to trust it. "The AI learned something" is exactly what this
 * screen exists not to say.
 *
 * Polarity is carried by POSITION against the zero line, not by colour: the
 * house palette reserves green, amber and red for machine state, and a lever
 * beating its page average is data, not a state. Position says it anyway.
 */
export function LearningTab(props: TabProps & { onRederive: () => void }) {
  const { persona, onRederive } = props;
  const head = persona.lessonLog[0] ?? null;
  const prev = persona.lessonLog[1] ?? null;

  const { scored, maturing } = useMemo(
    () => scorePosts(persona.posts, persona.nickname, persona.learn),
    [persona.posts, persona.nickname, persona.learn],
  );
  const effects = useMemo(() => leverEffects(scored, persona.nickname), [scored, persona.nickname]);
  const series = useMemo(() => scoreSeries(persona), [persona]);
  const byId = useMemo(() => new Map(scored.map((s) => [s.post.id, s])), [scored]);

  const [openLesson, setOpenLesson] = useState<string | null>(null);

  const dataLessons = (head?.lessons ?? []).filter((l) => l.source === "data");
  const priors = (head?.lessons ?? []).filter((l) => l.source === "prior");
  const believed = dataLessons.filter((l) => l.tier === "proven" || l.tier === "emerging");
  const losers = dataLessons.filter((l) => l.tier === "proven-loser");

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* --- what this is, and when it last ran ------------------------------ */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] border border-line bg-panel px-3 py-2">
        <span className="font-mono text-[11px] text-ink">
          lesson set v{head?.version ?? 0}
        </span>
        <span className="font-mono text-[11px] text-ink-faint">
          {head ? new Date(head.generatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never run"}
        </span>
        <span className="font-mono text-[11px] text-ink-faint">
          {scored.length}/{persona.posts.length} scored
        </span>
        {maturing.length > 0 && (
          <span
            className="font-mono text-[11px] text-[var(--color-state-waiting)]"
            title="Too recent, or too few people have seen it, to score yet"
          >
            {maturing.length} maturing
          </span>
        )}
        <span className="ml-auto">
          <Btn onClick={onRederive} title="Score the posts again and rewrite the rules">
            <Icon.Refresh width={12} height={12} /> Re-read engagement
          </Btn>
        </span>
      </div>

      {head?.note && <p className="px-0.5 text-[13px] leading-relaxed text-ink-muted">{head.note}</p>}

      {scored.length < 3 ? (
        <ColdStart maturing={maturing.length} priors={priors} />
      ) : (
        <>
          {/* --- is it actually getting better? ------------------------------ */}
          <Section
            title="Weekly median post score"
            hint="Each post against this page's own normal, per person reached. Zero is average for this page. Views are not in this number."
          >
            <ScoreChart series={series} />
          </Section>

          {/* --- the diff: the self-improvement, made visible ---------------- */}
          {head && prev && <Changes head={head} prev={prev} persona={persona} />}

          {/* --- what it believes -------------------------------------------- */}
          <Section title="What it believes" hint="Every claim carries its sample size and a 90% confidence interval. Click one to see the posts behind it.">
            {believed.length === 0 && losers.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-ink-muted">
                Nothing clears the confidence bar yet — every lever&rsquo;s interval still crosses zero. More posts will settle it.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {[...believed, ...losers].map((l) => (
                  <LessonRow
                    key={l.id}
                    lesson={l}
                    open={openLesson === l.id}
                    onToggle={() => setOpenLesson(openLesson === l.id ? null : l.id)}
                    evidence={l.evidencePostIds.map((id) => byId.get(id)).filter((x): x is ScoredPost => Boolean(x))}
                  />
                ))}
              </ul>
            )}
          </Section>

          {/* --- the leaderboard --------------------------------------------- */}
          <Section
            title="Every lever, ranked"
            hint="Ranked by the bottom of the interval, not the average — which is what stops one lucky post being crowned."
          >
            <LeverTable effects={effects} />
          </Section>
        </>
      )}

      {/* The written summary sits under the numbers, not beside them: it is the
          qualitative read of the same account, and putting it on its own tab
          invited treating it as a second, competing source of truth. */}
      <details className="rounded-[10px] border border-line bg-panel">
        <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-ink">
          Written summary
          <span className="ml-1.5 font-mono text-[11px] font-normal text-ink-faint">the same account, in prose</span>
        </summary>
        <div className="border-t border-line-soft p-3">
          <BrainTab {...props} />
        </div>
      </details>
    </div>
  );
}

// --- pieces ------------------------------------------------------------------

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      {hint && <p className="mb-2 mt-0.5 text-[12px] leading-relaxed text-ink-muted">{hint}</p>}
      <div className="overflow-hidden rounded-[10px] border border-line bg-panel">{children}</div>
    </section>
  );
}

function ColdStart({ maturing, priors }: { maturing: number; priors: Lesson[] }) {
  return (
    <div className="rounded-[10px] border border-line bg-panel px-4 py-6">
      <p className="text-[13px] font-semibold text-ink">It needs three scored posts before it will claim anything.</p>
      <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-ink-muted">
        A post is scored once it has had two days and has actually been seen by a few hundred people.
        {maturing > 0 ? ` ${maturing} ${maturing === 1 ? "post is" : "posts are"} still maturing.` : " Connect the Page and sync, or add stats by hand."}{" "}
        Until then the agent runs on the format library&rsquo;s assumptions, and those are marked as assumptions:
      </p>
      {priors.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line-soft pt-3">
          {priors.map((l) => (
            <li key={l.id} className="flex gap-2 text-[12px] leading-relaxed">
              <span className="mt-[3px] shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">assumed</span>
              <span className="text-ink-muted">{l.statement}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TIER_STYLE: Record<LeverTier, string> = {
  proven: "text-ink",
  emerging: "text-ink-muted",
  "proven-loser": "text-ink-muted",
  unproven: "text-ink-faint",
  prior: "text-ink-faint",
};

function LessonRow({
  lesson,
  open,
  onToggle,
  evidence,
}: {
  lesson: Lesson;
  open: boolean;
  onToggle: () => void;
  evidence: ScoredPost[];
}) {
  return (
    <li>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={
          "flex w-full items-start gap-2 px-3 py-2.5 text-left transition hover:bg-panel-2 "
          + (open ? "bg-panel-2" : "")
        }
      >
        <span
          className="mt-[3px] w-[76px] shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-ink-faint"
          title={`${lesson.n} posts behind this claim`}
        >
          {TIER_NAME[lesson.tier]}
        </span>
        <span className={"min-w-0 flex-1 text-[13px] leading-relaxed " + TIER_STYLE[lesson.tier]}>
          {lesson.statement}
          {lesson.tier === "proven-loser" && (
            <span className="ml-1 font-mono text-[11px] text-ink-faint">— the agent stops pitching this</span>
          )}
        </span>
        <Icon.Chevron
          width={12}
          height={12}
          className={"mt-1 shrink-0 text-ink-faint transition-transform duration-[160ms] " + (open ? "rotate-90" : "")}
          style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
        />
      </button>
      {open && (
        <div className="border-t border-line-soft bg-canvas px-3 py-2">
          <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">
            the posts behind it
          </p>
          {evidence.length === 0 ? (
            <p className="text-[12px] text-ink-muted">Those posts are no longer on file.</p>
          ) : (
            <ul className="space-y-1">
              {evidence.map((s) => (
                <li key={s.post.id} className="flex items-baseline gap-2 text-[12px]">
                  <span className="w-11 shrink-0 text-right font-mono text-[11px] text-ink">
                    {s.score >= 0 ? "+" : "−"}
                    {Math.abs(s.score).toFixed(2)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-muted" title={s.post.caption}>
                    {s.post.caption || s.post.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">
                    {s.rate !== null ? `${(s.rate * 100).toFixed(1)}%` : "no reach data"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function Changes({ head, prev, persona }: { head: Persona["lessonLog"][number]; prev: Persona["lessonLog"][number]; persona: Persona }) {
  const byId = new Map(head.lessons.map((l) => [l.id, l]));
  const prevById = new Map(prev.lessons.map((l) => [l.id, l]));
  const rows: { kind: string; text: string }[] = [];
  for (const id of head.diff.learned) {
    const l = byId.get(id);
    if (l) rows.push({ kind: "learned", text: l.statement });
  }
  for (const id of head.diff.changedMind) {
    const l = byId.get(id);
    if (l) rows.push({ kind: "changed its mind", text: l.statement });
  }
  for (const id of head.diff.promoted) {
    const l = byId.get(id);
    if (l) rows.push({ kind: "promoted", text: l.statement });
  }
  for (const id of head.diff.retired) {
    const l = prevById.get(id);
    if (l) rows.push({ kind: "retired", text: l.statement });
  }
  if (!rows.length) return null;

  return (
    <Section title={`What changed in v${head.version}`} hint={`Against v${prev.version}. Old sets are never edited — this is the difference between them.`}>
      <ul className="divide-y divide-line-soft">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-2 px-3 py-2">
            <span className="mt-[3px] w-[92px] shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">
              {r.kind}
            </span>
            <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-muted">{r.text}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-line-soft px-3 py-2 font-mono text-[10.5px] text-ink-faint">
        {persona.lessonLog.length} sets on file · the agent reads v{head.version} before it writes anything
      </p>
    </Section>
  );
}

// --- the leaderboard ---------------------------------------------------------

/**
 * One row per lever: the point estimate as a dot, the 90% interval as a bar,
 * on a track with zero in the middle. An interval that crosses the centre line
 * is a lever we cannot call yet, and you can see that at a glance without
 * reading a single number — which is the whole reason the interval is drawn
 * rather than only printed.
 */
function LeverTable({ effects }: { effects: LeverEffect[] }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? effects : effects.slice(0, 10);
  const span = Math.max(0.6, ...effects.map((e) => Math.max(Math.abs(e.ciLo), Math.abs(e.ciHi))));

  if (!effects.length) {
    return <p className="px-3 py-6 text-center text-[13px] text-ink-muted">No levers to compare yet.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="bg-panel-2 text-left">
              <Th className="w-[34%]">Lever</Th>
              <Th className="w-10 text-right">n</Th>
              <Th className="w-[26%] text-right">Effect · 90% CI</Th>
              <Th>Against this page&rsquo;s average</Th>
              <Th className="w-20">Verdict</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.key} className="border-t border-line-soft align-middle">
                <td className="px-3 py-1.5 text-[12px] text-ink">{e.label}</td>
                <td className="px-2 py-1.5 text-right font-mono text-[11px] text-ink-muted">{e.n}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[11px] text-ink">
                  {signed(e.effect)}
                  <span className="text-ink-faint">
                    {" "}
                    [{signed(e.ciLo)}, {signed(e.ciHi)}]
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  <IntervalBar lo={e.ciLo} hi={e.ciHi} point={e.effect} span={span} label={e.label} />
                </td>
                <td className="px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">
                  {TIER_NAME[e.tier]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {effects.length > 10 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full border-t border-line-soft px-3 py-2 text-left font-mono text-[10.5px] text-ink-faint transition hover:text-ink"
        >
          {showAll ? "show the top 10 only" : `show all ${effects.length} levers`}
        </button>
      )}
    </div>
  );
}

function signed(x: number): string {
  return `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(0)}%`;
}

function IntervalBar({ lo, hi, point, span, label }: { lo: number; hi: number; point: number; span: number; label: string }) {
  const W = 132;
  const H = 16;
  const x = (v: number) => ((Math.max(-span, Math.min(span, v)) + span) / (2 * span)) * W;
  const crossesZero = lo < 0 && hi > 0;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${label}: effect ${signed(point)}, interval ${signed(lo)} to ${signed(hi)}${crossesZero ? ", crosses zero" : ""}`}
      className="block"
    >
      {/* the track, and zero */}
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="var(--color-line-soft)" strokeWidth={1} />
      <line x1={x(0)} y1={2} x2={x(0)} y2={H - 2} stroke="var(--color-line)" strokeWidth={1} />
      {/* the interval */}
      <rect
        x={Math.min(x(lo), x(hi))}
        y={H / 2 - 2}
        width={Math.max(2, Math.abs(x(hi) - x(lo)))}
        height={4}
        rx={2}
        fill={crossesZero ? "var(--color-ink-faint)" : "var(--color-ink-muted)"}
        opacity={crossesZero ? 0.5 : 0.8}
      />
      {/* the point estimate */}
      <circle cx={x(point)} cy={H / 2} r={3.5} fill={crossesZero ? "var(--color-ink-faint)" : "var(--color-ink)"} />
    </svg>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={"px-3 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-wide text-ink-muted " + className}>
      {children}
    </th>
  );
}

// --- the chart ---------------------------------------------------------------

/**
 * Weekly median score. One series, so no legend — the title names it.
 *
 * Zero is drawn as a real baseline rather than implied, because this scale is
 * centred: a point below the line is a week the page did worse than its own
 * normal, and without the line that reads as "a smaller number" instead.
 */
function ScoreChart({ series }: { series: { week: string; medianScore: number; posts: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (series.length < 2) {
    return (
      <p className="px-3 py-6 text-center text-[13px] text-ink-muted">
        One week of scored posts so far. The trend needs a second week before it means anything.
      </p>
    );
  }

  // A 640x150 box squeezed into a 340px phone column is 80px tall, which
  // leaves the axis labels unreadable and the trend — the whole point of the
  // chart — hard to judge. A narrower, taller box at phone width renders the
  // same type and strokes larger against the available pixels.
  const narrow = useNarrow();
  const W = narrow ? 360 : 640;
  const H = narrow ? 190 : 150;
  const pad = { t: 12, r: 12, b: 26, l: narrow ? 34 : 30 };
  const extent = Math.max(0.8, ...series.map((p) => Math.abs(p.medianScore))) * 1.15;
  const x = (i: number) => pad.l + (i / (series.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((extent - v) / (2 * extent)) * (H - pad.t - pad.b);

  const path = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.medianScore).toFixed(1)}`).join(" ");
  const active = hover === null ? null : series[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        style={{ aspectRatio: `${W} / ${H}` }}
        role="img"
        aria-label={`Weekly median post score across ${series.length} weeks, from ${series[0].medianScore.toFixed(2)} to ${series[series.length - 1].medianScore.toFixed(2)}`}
        onMouseLeave={() => setHover(null)}
      >
        {/* y guides, recessive */}
        {[extent / 2, -extent / 2].map((v) => (
          <line key={v} x1={pad.l} y1={y(v)} x2={W - pad.r} y2={y(v)} stroke="var(--color-line-soft)" strokeWidth={1} />
        ))}
        {/* zero, the only emphasised rule on the plot */}
        <line x1={pad.l} y1={y(0)} x2={W - pad.r} y2={y(0)} stroke="var(--color-line)" strokeWidth={1} />
        <text x={pad.l - 5} y={y(0) + 3} textAnchor="end" className="fill-[var(--color-ink-faint)] font-mono text-[9.5px]">
          0
        </text>
        <text x={pad.l - 5} y={y(extent / 2) + 3} textAnchor="end" className="fill-[var(--color-ink-faint)] font-mono text-[9.5px]">
          +{(extent / 2).toFixed(1)}
        </text>
        <text x={pad.l - 5} y={y(-extent / 2) + 3} textAnchor="end" className="fill-[var(--color-ink-faint)] font-mono text-[9.5px]">
          −{(extent / 2).toFixed(1)}
        </text>

        <path d={path} fill="none" stroke="var(--color-brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {series.map((p, i) => (
          <g key={p.week}>
            <circle
              cx={x(i)}
              cy={y(p.medianScore)}
              r={hover === i ? 5 : 3.5}
              fill="var(--color-brand)"
              stroke="var(--color-panel)"
              strokeWidth={2}
            />
            {/* hit target, bigger than the mark */}
            <rect
              x={x(i) - 16}
              y={pad.t}
              width={32}
              height={H - pad.t - pad.b}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              tabIndex={0}
              role="button"
              aria-label={`Week of ${p.week}: median score ${p.medianScore.toFixed(2)} across ${p.posts} posts`}
            />
          </g>
        ))}

        {/* first and last week only — a label on every point is noise */}
        <text x={pad.l} y={H - 7} className="fill-[var(--color-ink-faint)] font-mono text-[9.5px]">
          {shortWeek(series[0].week)}
        </text>
        <text x={W - pad.r} y={H - 7} textAnchor="end" className="fill-[var(--color-ink-faint)] font-mono text-[9.5px]">
          {shortWeek(series[series.length - 1].week)}
        </text>
      </svg>

      {active && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-line bg-elevated px-2 py-1 font-mono text-[11px] text-ink">
          w/c {shortWeek(active.week)} · {active.medianScore >= 0 ? "+" : "−"}
          {Math.abs(active.medianScore).toFixed(2)} · {active.posts} {active.posts === 1 ? "post" : "posts"}
        </div>
      )}
    </div>
  );
}

/** True on a phone-width column. Re-evaluated on resize and rotation. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

function shortWeek(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
