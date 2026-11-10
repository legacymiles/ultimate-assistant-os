"use client";

// ---------------------------------------------------------------------------
// The 24/7 agents tab.
//
// The bar is GitHub Actions' run view, because the problem is the same: the
// work is happening on a machine you are not looking at, and the screen has
// to answer three things at a glance — where is it, what did it do, what is
// it waiting on. Everything here serves one of those three.
//
// The row is deliberately dense and tabular rather than a card: the owner
// reads these in a column, and a grid of rounded boxes would fit four where
// a table fits twelve. Motion is used once, on the progress bar, because that
// is the only thing on screen that changes while they watch.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import {
  ALL_NEEDS,
  NEED_LABEL,
  progressOf,
  statusLine,
  type Agent,
  type AgentNeed,
  type AgentStatus,
} from "@/lib/new-jarvis/agents/agents";
import type { UseAgents } from "@/lib/new-jarvis/agents/useAgents";

/** The pip colour per state. Amber means "a human is in the way", never "busy". */
const PIP: Record<AgentStatus, string> = {
  waiting: "bg-ink-faint",
  running: "bg-brand-2",
  blocked: "bg-amber-400",
  paused: "bg-ink-faint/40",
  done: "bg-emerald-400",
};

const STATE_WORD: Record<AgentStatus, string> = {
  waiting: "Waiting",
  running: "Running",
  blocked: "Needs you",
  paused: "Paused",
  done: "Done",
};

function ago(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function Agents({ agents }: { agents: UseAgents }) {
  const { list, live, loaded, error, busy } = agents;
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Starts at 0 so the server and the first client paint agree; the effect
  // corrects it immediately. Every ISO date parses above 0, so a held lease
  // still reads as held on that first frame.
  const [clock, setClock] = useState(0);
  useEffect(() => {
    setClock(Date.now());
    const t = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-panel px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink">24/7 agents</h2>
        <span className="font-mono text-[12px] font-semibold text-ink" data-num>
          {live}
        </span>
        <span className="text-[11px] text-ink-faint">still going</span>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
          className="ml-auto inline-flex min-h-[32px] items-center gap-1.5 rounded border border-line px-2 text-[11px] font-medium text-ink transition-colors hover:bg-line/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-2"
        >
          <Icon.Plus width={11} height={11} aria-hidden />
          New agent
        </button>
      </div>

      {error ? (
        <p role="status" className="shrink-0 border-b border-line bg-amber-500/10 px-3 py-2 text-[12px] text-ink">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {adding ? <NewAgent agents={agents} onDone={() => setAdding(false)} /> : null}

        {!loaded ? (
          <p className="px-3 py-6 text-[12px] text-ink-faint">Looking for your agents…</p>
        ) : list.length === 0 && !adding ? (
          <Empty onStart={() => setAdding(true)} />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((a) => (
              <Row
                key={a.id}
                agent={a}
                now={clock}
                open={open === a.id}
                busy={busy}
                onToggle={() => setOpen((o) => (o === a.id ? null : a.id))}
                agents={agents}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({
  agent,
  now,
  open,
  busy,
  onToggle,
  agents,
}: {
  agent: Agent;
  now: number;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  agents: UseAgents;
}) {
  const p = progressOf(agent);
  const panelId = `agent-${agent.id}`;

  const onRemove = useCallback(async () => {
    // Irreversible, so it is confirmed rather than undone (S7, D6).
    const ok = window.confirm(
      `Delete this agent?\n\n${agent.goal}\n\nIt stops for good and its log goes with it. This can't be undone.`,
    );
    if (ok) await agents.remove(agent.id);
  }, [agent.goal, agent.id, agents]);

  return (
    <li>
      <div className="flex items-start gap-2 px-3 py-2">
        <span
          className={`mt-[6px] size-2 shrink-0 rounded-full ${PIP[agent.status]} ${
            agent.status === "running" ? "animate-pulse motion-reduce:animate-none" : ""
          }`}
          aria-hidden
        />

        {/* One column on a phone, two on a wide screen: the goal reads on the
            left and every row's metadata lines up down the right, instead of
            trailing off into half a screen of nothing. */}
        <div className="min-w-0 flex-1 lg:flex lg:items-start lg:gap-6">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-2 lg:min-w-0 lg:flex-1"
          >
            {/* Two lines, not an ellipsis: on a phone the goal IS the row, and
                a truncated one says nothing about what the agent is (U9). */}
            <span className="block line-clamp-2 text-[13px] font-medium text-ink">{agent.goal}</span>
            <span className="mt-0.5 block max-w-[72ch] text-[11px] text-ink-faint">{statusLine(agent, now)}</span>
          </button>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 lg:mt-0 lg:w-[22rem] lg:shrink-0 lg:justify-end">
            <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
              {STATE_WORD[agent.status]}
            </span>
            {agent.steps.length > 0 ? (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-1 w-16 overflow-hidden rounded-full bg-line"
                  role="progressbar"
                  aria-valuenow={p.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${p.done} of ${p.total} steps done`}
                >
                  <span
                    className="block h-full rounded-full bg-brand-2 transition-[width] duration-500 motion-reduce:transition-none"
                    style={{ width: `${p.pct}%` }}
                  />
                </span>
                <span className="font-mono text-[10px] text-ink-faint" data-num>
                  {p.done}/{p.total}
                </span>
              </span>
            ) : null}
            {agent.needs.map((n) => (
              <span key={n} className="rounded border border-line px-1 py-px text-[10px] text-ink-faint">
                {NEED_LABEL[n]}
              </span>
            ))}
            <span className="font-mono text-[10px] text-ink-faint">{ago(agent.updatedAt, now || Date.now())}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {agent.status !== "done" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => (agent.status === "paused" ? agents.resume(agent.id) : agents.pause(agent.id))}
              aria-label={agent.status === "paused" ? `Start ${agent.goal} again` : `Pause ${agent.goal}`}
              className="inline-flex size-8 items-center justify-center rounded text-ink-faint transition-colors hover:bg-line/40 hover:text-ink disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-2"
            >
              {agent.status === "paused" ? (
                <Icon.Play width={12} height={12} aria-hidden />
              ) : (
                <Icon.Pause width={12} height={12} aria-hidden />
              )}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            aria-label={`Delete ${agent.goal}`}
            className="inline-flex size-8 items-center justify-center rounded text-ink-faint transition-colors hover:bg-line/40 hover:text-ink disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-2"
          >
            <Icon.Trash width={12} height={12} aria-hidden />
          </button>
        </div>
      </div>

      {open ? <Detail agent={agent} id={panelId} now={now} /> : null}
    </li>
  );
}

function Detail({ agent, id, now }: { agent: Agent; id: string; now: number }) {
  return (
    <div id={id} className="border-t border-line bg-panel/60 px-3 py-2.5">
      {/* The handoff note is the point of the whole feature, so it leads. */}
      {agent.handoff ? (
        <div className="mb-3 max-w-[76ch] rounded border border-brand-2/30 bg-brand-2/5 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-2">
            Where it got to — left by {agent.handoff.by}
          </p>
          <p className="mt-1 max-w-[72ch] whitespace-pre-wrap text-[12px] leading-snug text-ink">{agent.handoff.text}</p>
          <p className="mt-1 font-mono text-[10px] text-ink-faint">{ago(agent.handoff.at, now || Date.now())}</p>
        </div>
      ) : null}

      {agent.blockedWhy ? (
        <p className="mb-3 max-w-[72ch] rounded border border-amber-400/30 bg-amber-400/5 p-2 text-[12px] text-ink">
          {agent.blockedWhy}
        </p>
      ) : null}

      {agent.steps.length ? (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Steps</p>
          <ol className="mt-1 space-y-1">
            {agent.steps.map((s) => (
              <li key={s.id} className="flex items-start gap-1.5 text-[12px]">
                <span className={`mt-[3px] shrink-0 ${s.done ? "text-emerald-400" : "text-ink-faint/50"}`} aria-hidden>
                  {s.done ? <Icon.Check width={11} height={11} /> : <Icon.Square width={11} height={11} />}
                </span>
                {/* The note sits OUTSIDE the struck span: `no-underline` does
                    not cancel `line-through`, so nesting it struck the result
                    out too, which read as "this did not happen". */}
                <span className="min-w-0">
                  <span className={s.done ? "text-ink-faint line-through" : "text-ink"}>{s.text}</span>
                  {s.done && s.note ? <span className="ml-1 text-ink-faint"> — {s.note}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {agent.log.length ? (
        <>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Log</p>
          <ul className="mt-1 space-y-0.5">
            {[...agent.log].reverse().slice(0, 12).map((l, i) => (
              <li key={`${l.at}-${i}`} className="flex gap-2 text-[11px] leading-snug">
                <span className="shrink-0 font-mono text-ink-faint">{ago(l.at, now || Date.now())}</span>
                <span className="shrink-0 font-mono text-ink-faint">{l.by}</span>
                <span className="min-w-0 text-ink">{l.text}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/**
 * The empty state.
 *
 * A 24/7 agent is not a familiar idea, so this explains the bargain rather
 * than just saying "nothing here" (U4, O6): file a goal from anywhere, and
 * the machine that can do it picks it up when it wakes.
 */
function Empty({ onStart }: { onStart: () => void }) {
  return (
    <div className="px-4 py-8">
      <Icon.Bot width={20} height={20} className="text-brand-2" aria-hidden />
      <h3 className="mt-2 text-[13px] font-semibold text-ink">Nothing running yet</h3>
      <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-ink-faint">
        A 24/7 agent is a goal that needs one of your machines — Flux on Pinokio, a Blender render, an Unreal build.
        File it from anywhere, including your phone with the laptop shut. The next machine that can actually run it
        picks it up on its own, does what it can, and leaves a note saying where it got to — so the one after that
        carries on instead of starting again.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 rounded border border-line px-2.5 text-[12px] font-medium text-ink transition-colors hover:bg-line/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-2"
      >
        <Icon.Plus width={12} height={12} aria-hidden />
        File the first one
      </button>
    </div>
  );
}

function NewAgent({ agents, onDone }: { agents: UseAgents; onDone: () => void }) {
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState("");
  const [needs, setNeeds] = useState<AgentNeed[]>([]);
  const stepList = useMemo(
    () => steps.split("\n").map((s) => s.replace(/^\s*[-*\d.]+\s*/, "").trim()).filter(Boolean),
    [steps],
  );

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!goal.trim()) return;
      const ok = await agents.create({ goal: goal.trim(), needs, steps: stepList });
      if (ok) {
        setGoal("");
        setSteps("");
        setNeeds([]);
        onDone();
      }
    },
    [agents, goal, needs, onDone, stepList],
  );

  return (
    <form onSubmit={submit} className="border-b border-line bg-panel/60 px-3 py-3">
      <label htmlFor="agent-goal" className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        What should it get done?
      </label>
      <textarea
        id="agent-goal"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        rows={2}
        autoFocus
        placeholder="Draw the five hero images for Cook Connect with Flux"
        /* 16px so an iPhone never zooms the page on focus (U9). */
        className="mt-1 w-full resize-y rounded border border-line bg-bg px-2 py-1.5 text-[16px] text-ink placeholder:text-ink-faint/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-2 sm:text-[13px]"
      />

      <fieldset className="mt-2">
        <legend className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
          What does it need? (leave blank for any machine)
        </legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {ALL_NEEDS.map((n) => {
            const on = needs.includes(n);
            return (
              <label
                key={n}
                className={`inline-flex min-h-[32px] cursor-pointer items-center gap-1.5 rounded border px-2 text-[11px] transition-colors ${
                  on ? "border-brand-2 bg-brand-2/10 text-ink" : "border-line text-ink-faint hover:bg-line/30"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setNeeds((v) => (on ? v.filter((x) => x !== n) : [...v, n]))}
                  className="size-3 accent-current"
                />
                {NEED_LABEL[n]}
              </label>
            );
          })}
        </div>
      </fieldset>

      <label htmlFor="agent-steps" className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        Steps, one per line (optional)
      </label>
      <textarea
        id="agent-steps"
        value={steps}
        onChange={(e) => setSteps(e.target.value)}
        rows={3}
        placeholder={"Draw the hero at 1024x1024\nDraw four tiles with the same seed\nPut them in the app"}
        className="mt-1 w-full resize-y rounded border border-line bg-bg px-2 py-1.5 text-[16px] text-ink placeholder:text-ink-faint/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-2 sm:text-[13px]"
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={!goal.trim() || agents.busy}
          className="inline-flex min-h-[36px] items-center rounded bg-brand-2 px-3 text-[12px] font-semibold text-black transition-opacity disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-2"
        >
          {agents.busy ? "Filing…" : "File it"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex min-h-[36px] items-center rounded px-2 text-[12px] text-ink-faint transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-2"
        >
          Cancel
        </button>
        {stepList.length ? (
          <span className="font-mono text-[10px] text-ink-faint" data-num>
            {stepList.length} step{stepList.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
    </form>
  );
}
