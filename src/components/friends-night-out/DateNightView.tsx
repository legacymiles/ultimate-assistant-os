"use client";

import { useCallback, useEffect, useState } from "react";
import { generateDateNights } from "@/lib/friends-night-out/dateNight";
import type {
  Coords,
  DateNightPlan,
  FnoEvent,
  FnoPlace,
} from "@/lib/friends-night-out/types";
import { Chip } from "./chips";

// ---------------------------------------------------------------------------
// Date Night — whole evenings, not a list.
//
// The generator refuses more than it emits, and this view surfaces the refusal
// rather than hiding it. Three algorithmically-valid evenings built around a
// trampoline chain and a chain restaurant are worse than one good evening or an
// honest "nothing here clears the bar yet" — a generated plan is a
// recommendation in a way a search result is not.
// ---------------------------------------------------------------------------

export function DateNightView({
  origin,
  places,
  events,
  onSavePlan,
  savedPlanIds,
}: {
  origin: Coords | null;
  places: FnoPlace[];
  events: FnoEvent[];
  onSavePlan: (p: DateNightPlan) => void;
  savedPlanIds: Set<string>;
}) {
  const [plans, setPlans] = useState<DateNightPlan[]>([]);
  const [note, setNote] = useState<string | undefined>();
  const [seen, setSeen] = useState<Set<string>>(new Set());

  const roll = useCallback(
    (fresh: boolean) => {
      if (!origin) return;
      const exclude = fresh ? new Set<string>() : seen;
      const result = generateDateNights({ origin, places, events, excludeIds: exclude });
      setPlans(result.plans);
      setNote(result.note);
      setSeen((prev) => {
        const next = fresh ? new Set<string>() : new Set(prev);
        result.plans.forEach((p) => p.activity && next.add(p.activity.id));
        return next;
      });
    },
    [origin, places, events, seen],
  );

  // Compose once as soon as there is data, so the tab is never empty on arrival.
  useEffect(() => {
    if (origin && places.length && !plans.length) roll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, places.length]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => roll(false)}
          className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium"
          style={{
            background: "linear-gradient(100deg, rgba(236,72,153,0.20), rgba(56,189,248,0.20))",
            color: "#f0abfc",
            boxShadow: "0 0 0 1px rgba(236,72,153,0.25)",
          }}
        >
          ↻ Another three
        </button>
        <button
          type="button"
          onClick={() => roll(true)}
          className="rounded-lg border border-[#20242f] bg-[#101219] px-2.5 py-1.5 text-[12px] text-[#7c839a] hover:text-[#b6bdcd]"
        >
          start over
        </button>
      </div>

      {note ? (
        <p className="rounded-lg border border-[#242938] bg-[#0e1016] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#9aa3b5]">
          {note}
        </p>
      ) : null}

      {plans.map((plan) => (
        <article
          key={plan.id}
          className="overflow-hidden rounded-xl border border-[#20242f] bg-[#12141c]"
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1c2029] px-4 py-3">
            <h3 className="text-[16px] font-semibold text-[#e9ecf3]">{plan.title}</h3>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[#7c839a]">
                {plan.travelMi} mi round trip
              </span>
              <button
                type="button"
                onClick={() => onSavePlan(plan)}
                className="rounded-md px-2 py-1 text-[13px]"
                style={{ color: savedPlanIds.has(plan.id) ? "#fcd34d" : "#5b6478" }}
                aria-label="Save this evening"
              >
                {savedPlanIds.has(plan.id) ? "★" : "☆"}
              </button>
            </div>
          </header>

          <div className="divide-y divide-[#1a1e26]">
            {plan.activity ? (
              <Stop
                order="First"
                name={plan.activity.name}
                line={plan.activity.hook ?? plan.activity.description}
                meta={`${plan.activity.distanceMi?.toFixed(1)} mi · ${plan.activity.category}`}
                href={plan.activity.url}
              />
            ) : null}
            {plan.event ? (
              <Stop
                order="Then"
                name={plan.event.title}
                line={plan.event.description}
                meta={`${new Date(plan.event.startsAt).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })} · ${plan.event.venue.name}`}
                href={plan.event.url}
              />
            ) : null}
            {plan.food ? (
              <Stop
                order="After"
                name={plan.food.name}
                line={plan.food.hook ?? plan.food.description}
                meta={`${plan.food.distanceMi?.toFixed(1)} mi`}
                href={plan.food.url}
              />
            ) : null}
          </div>

          <footer className="flex flex-wrap items-center gap-2 border-t border-[#1c2029] px-4 py-2.5">
            <Chip tone="accent">{costLabel(plan)}</Chip>
            {plan.estimatedCost.hasUnknown ? (
              <span className="text-[11.5px] text-[#6b7385]">
                Some prices aren&apos;t published — treat this as a floor.
              </span>
            ) : null}
            {plan.food ? (
              <span className="text-[11.5px] text-[#6b7385]">
                Food estimated at $20–45 a head.
              </span>
            ) : null}
          </footer>
        </article>
      ))}

      {!plans.length && !note ? (
        <div className="rounded-xl border border-dashed border-[#242938] px-4 py-10 text-center">
          <p className="text-[13.5px] text-[#9aa3b5]">
            Nothing composed yet — load the Always On board first.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Stop({
  order,
  name,
  line,
  meta,
  href,
}: {
  order: string;
  name: string;
  line?: string;
  meta?: string;
  href?: string;
}) {
  return (
    <div className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 w-12 shrink-0 text-[11px] uppercase tracking-wide text-[#5b6478]">
        {order}
      </span>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-[#e9ecf3]">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer noopener" className="hover:underline">
              {name}
            </a>
          ) : (
            name
          )}
        </p>
        {line ? (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-[#8b93a5]">{line}</p>
        ) : null}
        {meta ? <p className="mt-1 text-[11.5px] text-[#6b7385]">{meta}</p> : null}
      </div>
    </div>
  );
}

function costLabel(plan: DateNightPlan): string {
  const { min, max, hasUnknown } = plan.estimatedCost;
  if (min === 0 && max === 0) return hasUnknown ? "Cost not published" : "Free";
  if (min === max) return `about $${min}`;
  return `$${min}–${max}${hasUnknown ? "+" : ""}`;
}
