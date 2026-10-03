"use client";

// ---------------------------------------------------------------------------
// One idea, open: the sheet, and everything that changes it.
//
// OpenIdea owns the three things that talk to a route — generate, price for
// real, and the agent's accepted edit — and the distinction that matters:
//
//   patchCurrent  replaces the current plan in place. Ticking a step off,
//                 typing a price, writing a note. Not a new version, because
//                 the plan did not change, your progress through it did.
//   pushVersion   appends a new version. An accepted edit, a verify pass, a
//                 regeneration. v1 stays readable forever.
//
// PlanSheet below is pure presentation over one plan.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { currentPlan, pushPlan } from "@/lib/bible/store";
import { fmtMoney, progress, timeline, totals, verifiedShare } from "@/lib/bible/totals";
import { mergeVerified, type Finding } from "@/lib/bible/verify";
import type { HomeBase, Idea, Plan, Step } from "@/lib/bible/types";
import { Agent } from "./Agent";
import { Beyond } from "./Beyond";
import { StepRow } from "./StepRow";

type Busy = "plan" | "verify" | null;

export function OpenIdea({
  idea,
  homeBase,
  onIdea,
  onBack,
  onDelete,
}: {
  idea: Idea;
  homeBase: HomeBase | null;
  onIdea: (idea: Idea) => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  /** Which version is on screen. Null means the current one. */
  const [viewing, setViewing] = useState<number | null>(null);
  /** A chat question the sheet asked to be pre-filled (an open question). */
  const [prefill, setPrefill] = useState("");

  const plan = currentPlan(idea);
  const shown = viewing === null ? plan : idea.plans.find((p) => p.version === viewing) ?? plan;
  const readOnly = shown !== plan;

  const patchCurrent = useCallback(
    (next: Plan) => {
      const plans = idea.plans.slice();
      if (!plans.length) return;
      plans[plans.length - 1] = next;
      onIdea({ ...idea, plans });
    },
    [idea, onIdea],
  );

  const pushVersion = useCallback(
    (next: Plan) => {
      onIdea(pushPlan(idea, next));
      setViewing(null);
    },
    [idea, onIdea],
  );

  const generate = useCallback(async () => {
    setBusy("plan");
    setError("");
    try {
      const res = await fetch("/api/bible/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: idea.brief, homeBase }),
      });
      const json = await res.json();
      if (!res.ok || !json?.plan) {
        setError(json?.error ?? "That did not come back. Try again.");
        return;
      }
      // A regeneration is a new version, not a replacement: the old plan may
      // have been half-built, and silently discarding it would lose the ticks.
      const next: Plan = idea.plans.length
        ? { ...json.plan, version: plan ? plan.version + 1 : 1 }
        : json.plan;
      onIdea(pushPlan(idea, next));
      setViewing(null);
    } catch {
      setError("The connection dropped. Nothing was changed — try again.");
    } finally {
      setBusy(null);
    }
  }, [idea, homeBase, onIdea, plan]);

  // A brand-new idea arrives with no plan and should not need a second click.
  const kicked = useRef(false);
  useEffect(() => {
    if (kicked.current || idea.plans.length) return;
    kicked.current = true;
    void generate();
  }, [idea.plans.length, generate]);

  const verify = useCallback(async () => {
    if (!plan) return;
    setBusy("verify");
    setError("");
    try {
      const res = await fetch("/api/bible/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, homeBase }),
      });
      const json = await res.json();
      if (!res.ok || !Array.isArray(json?.findings)) {
        setError(json?.error ?? "The price check came back with nothing. The estimates stand.");
        return;
      }
      const merged = mergeVerified(plan, json.findings as Finding[]);
      pushVersion({ ...merged, version: plan.version + 1, createdAt: new Date().toISOString() });
    } catch {
      setError("The price check took too long. The estimates stand.");
    } finally {
      setBusy(null);
    }
  }, [plan, homeBase, pushVersion]);

  return (
    <>
      <header className="bible-vault-head">
        <div>
          <h1>{idea.title}</h1>
          <p>{idea.oneLiner || idea.brief.what}</p>
        </div>
        <div className="bible-vault-tools">
          <button
            type="button"
            className="bb"
            data-tone="ghost"
            onClick={() => onIdea({ ...idea, pinned: !idea.pinned })}
          >
            {idea.pinned ? "★ Pinned" : "☆ Pin"}
          </button>
          <button type="button" className="bb" data-tone="danger" onClick={onDelete}>
            Delete
          </button>
          <button type="button" className="bb" onClick={onBack}>
            All ideas
          </button>
        </div>
      </header>

      {error && (
        <div className="bible-notice" role="status">
          <span>{error}</span>
          <button
            type="button"
            className="bb"
            onClick={() => (plan ? void verify() : void generate())}
          >
            Try again
          </button>
        </div>
      )}

      {busy === "plan" && (
        <div className="bible-notice" data-kind="busy" role="status">
          <span className="bible-working" aria-hidden="true" />
          <span>
            Writing the plan — phases, materials, costs and suppliers. Up to a minute; the sheet appears
            when it is whole rather than half-drawn.
          </span>
        </div>
      )}

      {!shown ? (
        busy !== "plan" && (
          <div className="bible-form">
            <h2>No plan yet</h2>
            <p>The brief is saved. Write the plan when you want it.</p>
            <button type="button" className="bb" data-tone="go" onClick={() => void generate()}>
              Write the plan
            </button>
          </div>
        )
      ) : (
        <div className="bible-open">
          <PlanSheet
            plan={shown}
            idea={idea}
            homeBase={homeBase}
            readOnly={readOnly}
            busy={busy}
            versions={idea.plans.map((p) => p.version)}
            onPickVersion={(v) => setViewing(v)}
            onVerify={() => void verify()}
            onRegenerate={() => void generate()}
            onPatch={patchCurrent}
            onAsk={setPrefill}
          />
          <Agent
            idea={idea}
            plan={plan!}
            homeBase={homeBase}
            prefill={prefill}
            onPrefillUsed={() => setPrefill("")}
            onIdea={onIdea}
            onAccept={pushVersion}
          />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The sheet.
// ---------------------------------------------------------------------------

function PlanSheet({
  plan,
  idea,
  homeBase,
  readOnly,
  busy,
  versions,
  onPickVersion,
  onVerify,
  onRegenerate,
  onPatch,
  onAsk,
}: {
  plan: Plan;
  idea: Idea;
  homeBase: HomeBase | null;
  readOnly: boolean;
  busy: Busy;
  versions: number[];
  onPickVersion: (v: number | null) => void;
  onVerify: () => void;
  onRegenerate: () => void;
  onPatch: (plan: Plan) => void;
  onAsk: (question: string) => void;
}) {
  const sum = totals(plan);
  const done = progress(plan);
  const time = timeline(plan);
  const checked = verifiedShare(plan);
  const rolled = useRoll(sum.cost?.low ?? null);

  const setStep = (next: Step) => {
    onPatch({
      ...plan,
      phases: plan.phases.map((phase) => ({
        ...phase,
        steps: phase.steps.map((s) => (s.id === next.id ? next : s)),
      })),
    });
  };

  // Numbered continuously across the whole plan: it is one document, not four
  // lists that each restart at 1.
  let n = 0;

  return (
    <article className="bible-sheet">
      <div className="bible-pin-head">
        <div className="bible-total">
          <span className="bible-total-k">Total to build</span>
          <span
            className="bible-total-v"
            data-range={!!sum.cost && sum.cost.low !== sum.cost.high}
            data-rolling={rolled.rolling}
          >
            {sum.mixed ? "two currencies" : fmtMoney(sum.cost)}
          </span>
        </div>

        <div className="bible-stat">
          <span className="bible-total-k">Done</span>
          <b>{done.done}/{done.total}</b>
        </div>

        <div className="bible-stat">
          <span className="bible-total-k">Time</span>
          <b>{time.days ? `${time.days}d` : "—"}{time.hours ? ` · ${time.hours}h hands-on` : ""}</b>
        </div>

        <div className="bible-stat">
          <span className="bible-total-k">Checked</span>
          <b>{sum.costedSteps ? `${Math.round(checked * 100)}%` : "—"}</b>
        </div>

        <div className="bible-pin-head-right">
          {versions.length > 1 && (
            <select
              className="bible-ver"
              value={plan.version}
              aria-label="Plan version"
              onChange={(e) => {
                const v = Number(e.target.value);
                onPickVersion(v === versions[versions.length - 1] ? null : v);
              }}
            >
              {versions.map((v) => <option key={v} value={v}>v{v}</option>)}
            </select>
          )}
          <button
            type="button"
            className="bb"
            data-tone="go"
            disabled={busy !== null || readOnly}
            onClick={onVerify}
          >
            {busy === "verify" ? "Pricing…" : "Price this for real"}
          </button>
        </div>
      </div>

      {sum.uncostedSteps > 0 && !sum.mixed && (
        <div className="bible-older">
          {sum.uncostedSteps} step{sum.uncostedSteps === 1 ? "" : "s"} carry no cost, so the total is for
          the {sum.costedSteps} that do.
        </div>
      )}

      {sum.mixed && (
        <div className="bible-older">
          Two currencies on this sheet, so nothing is totalled — converting them here would be a guess
          dressed as a figure. Put them in one currency and the total comes back.
        </div>
      )}

      {readOnly && (
        <div className="bible-older">
          Viewing v{plan.version}. It is read-only — the current plan is v{versions[versions.length - 1]}.{" "}
          <button type="button" className="bb" onClick={() => onPickVersion(null)}>
            Back to current
          </button>
        </div>
      )}

      {busy === "verify" && (
        <div className="bible-notice" data-kind="busy" role="status">
          <span className="bible-working" aria-hidden="true" />
          <span>
            Reading real prices{homeBase ? ` near ${homeBase.city}` : " from suppliers that ship"} — up to
            three minutes. Anything it cannot find with a source keeps saying ESTIMATE.
          </span>
        </div>
      )}

      <div className="bible-sheet-body">
        {plan.summary && <p className="bible-summary">{plan.summary}</p>}

        {!!plan.assumptions.length && (
          <div className="bible-block">
            <h3>Assumed</h3>
            <ul>{plan.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
        )}

        {!!plan.openQuestions.length && !readOnly && (
          <div className="bible-block">
            <h3>It needs to know</h3>
            {plan.openQuestions.map((q, i) => (
              <button key={i} type="button" className="bible-q" onClick={() => onAsk(q)}>
                {q}
              </button>
            ))}
          </div>
        )}

        {plan.phases.map((phase) => {
          const live = phase.steps.filter((s) => !s.skipped);
          const phaseDone = live.filter((s) => s.done).length;
          return (
            <section key={phase.id} className="bible-phase">
              <div className="bible-phase-head">
                <h2>{phase.title}</h2>
                {phase.goal && <span className="bible-phase-goal">{phase.goal}</span>}
                <span className="bible-phase-meta">
                  {phaseDone}/{live.length}
                  {phase.days ? ` · ${phase.days}d` : ""}
                </span>
              </div>
              {phase.steps.map((step) => {
                n += 1;
                return (
                  <StepRow
                    key={step.id}
                    step={step}
                    index={n}
                    readOnly={readOnly}
                    onChange={setStep}
                  />
                );
              })}
            </section>
          );
        })}

        {plan.unit && (
          <div className="bible-unit">
            <div>
              <span>First one costs</span>
              <b>{fmtMoney(plan.unit.cost)}</b>
            </div>
            {plan.unit.sellsFor && (
              <div>
                <span>Sells for</span>
                <b>{fmtMoney(plan.unit.sellsFor)}</b>
              </div>
            )}
            {plan.unit.note && <p>{plan.unit.note}</p>}
          </div>
        )}

        {!readOnly && (
          <Beyond
            plan={plan}
            homeBase={homeBase}
            onPatch={onPatch}
          />
        )}

        {!readOnly && (
          <div style={{ marginTop: 22 }}>
            <button type="button" className="bb" disabled={busy !== null} onClick={onRegenerate}>
              Rewrite the whole plan from the brief
            </button>
            <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "6px 0 0" }}>
              Keeps this version. Edit the brief first if what you are building has changed — it was:{" "}
              {idea.brief.what}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * The till roll.
 *
 * When the total changes — a step ticked off, an edit accepted — the number
 * counts to its new value over 320ms rather than cutting, because the point of
 * the strike-through is that you watch the money move as you cross something
 * out. Reduced motion gets the new number immediately.
 *
 * It returns only `rolling`; the figure itself stays exact, because an
 * intermediate frame of a cost is not a cost and must never be the thing the
 * owner reads.
 */
function useRoll(target: number | null): { rolling: boolean } {
  const [rolling, setRolling] = useState(false);
  const previous = useRef(target);

  useEffect(() => {
    if (previous.current === target) return;
    previous.current = target;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setRolling(true);
    const timer = window.setTimeout(() => setRolling(false), 320);
    return () => window.clearTimeout(timer);
  }, [target]);

  return { rolling };
}
