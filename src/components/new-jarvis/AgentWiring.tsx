"use client";

// ---------------------------------------------------------------------------
// How a 24/7 agent is wired: what powers it, what it may change, where its
// results go, what happens to its code, and how often it runs.
//
// One component for filing a new agent and for changing an existing one, so
// the two can never offer different choices. Dense on purpose — it sits inside
// a row of the agents table, not on a page of its own.
// ---------------------------------------------------------------------------

import { useId } from "react";

import { Icon } from "../icons";
import { PoweredBy } from "./PoweredBy";
import {
  ALL_REPEATS,
  REPEAT_LABEL,
  type Agent,
  type AgentRepeat,
  type ShipMode,
} from "@/lib/new-jarvis/agents/agents";
import type { PickRoute, RouteState } from "@/lib/new-jarvis/harness/models";

export interface AppRef {
  slug: string;
  name: string;
}

export interface Wiring {
  pick: string;
  edits: string[];
  sendsTo: string[];
  ship: ShipMode;
  repeat: AgentRepeat;
}

/** "app:ea-world" → "EA World"; "a-7k2m9x" → the agent's goal, shortened. */
export function targetName(t: string, apps: AppRef[], agents: Agent[]): string {
  if (t === "inbox") return "Inbox";
  if (t.startsWith("app:")) return apps.find((a) => a.slug === t.slice(4))?.name ?? t.slice(4);
  const a = agents.find((x) => x.id === t);
  return a ? `Agent: ${a.goal.slice(0, 40)}${a.goal.length > 40 ? "…" : ""}` : t;
}

export function appName(slug: string, apps: AppRef[]): string {
  return apps.find((a) => a.slug === slug)?.name ?? slug;
}

const fieldLabel = "text-[10px] font-semibold uppercase tracking-wide text-ink-faint";

/** Selected things as removable chips, plus a native picker to add one. */
function ChipPicker({
  label,
  hint,
  chosen,
  name,
  groups,
  onChange,
}: {
  label: string;
  hint: string;
  chosen: string[];
  name: (v: string) => string;
  groups: { title: string; items: { value: string; label: string }[] }[];
  onChange: (next: string[]) => void;
}) {
  const id = useId();
  const left = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !chosen.includes(i.value)) }))
    .filter((g) => g.items.length);
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {chosen.map((v) => (
          <span
            key={v}
            className="inline-flex min-h-[28px] items-center gap-1 rounded border border-brand-2/40 bg-brand-2/10 pl-2 text-[11px] text-ink"
          >
            {name(v)}
            <button
              type="button"
              onClick={() => onChange(chosen.filter((x) => x !== v))}
              aria-label={`Remove ${name(v)}`}
              className="inline-flex size-7 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-2"
            >
              <Icon.Close width={10} height={10} aria-hidden />
            </button>
          </span>
        ))}
        {left.length ? (
          <select
            id={id}
            value=""
            onChange={(e) => {
              if (e.target.value) onChange([...chosen, e.target.value]);
            }}
            className="min-h-[28px] max-w-[220px] rounded border border-dashed border-line bg-bg px-1.5 text-[16px] text-ink-faint transition-colors hover:border-ink-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-2 sm:text-[11px]"
          >
            <option value="">{chosen.length ? "Add another…" : "Choose…"}</option>
            {left.map((g) => (
              <optgroup key={g.title} label={g.title}>
                {g.items.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : null}
      </div>
      <p className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">{hint}</p>
    </div>
  );
}

export function AgentWiring({
  value,
  onChange,
  apps,
  agents,
  self,
  routes,
}: {
  value: Wiring;
  onChange: (next: Wiring) => void;
  apps: AppRef[];
  /** Every agent, so results can be handed to another one. */
  agents: Agent[];
  /** This agent's id when editing, so it cannot be wired to itself. */
  self?: string;
  routes: Record<PickRoute, RouteState | null>;
}) {
  const set = (patch: Partial<Wiring>) => onChange({ ...value, ...patch });
  const pickId = useId();
  const repeatId = useId();
  const appItems = apps.map((a) => ({ value: a.slug, label: a.name }));
  const others = agents.filter((a) => a.id !== self && a.status !== "done");

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor={pickId} className={fieldLabel}>
          Powered by
        </label>
        <div className="mt-1">
          <PoweredBy id={pickId} value={value.pick} onChange={(pick) => set({ pick })} routes={routes} />
        </div>
      </div>

      <ChipPicker
        label="Sends results to"
        hint="An app gets them as a request in its In Queue folder. Another agent is woken up with them."
        chosen={value.sendsTo}
        name={(v) => targetName(v, apps, agents)}
        groups={[
          { title: "Apps", items: apps.map((a) => ({ value: `app:${a.slug}`, label: a.name })) },
          {
            title: "Other 24/7 agents",
            items: others.map((a) => ({ value: a.id, label: `${a.goal.slice(0, 60)}${a.goal.length > 60 ? "…" : ""}` })),
          },
          { title: "Anywhere", items: [{ value: "inbox", label: "Inbox" }] },
        ]}
        onChange={(sendsTo) => set({ sendsTo })}
      />

      <ChipPicker
        label="Edits these apps"
        hint={
          value.edits.length
            ? "Runs through your Jarvis harness, in a worktree of its own. Your checkout is never touched."
            : "Leave empty for research and writing. Pick an app to let it change that app's code."
        }
        chosen={value.edits}
        name={(v) => appName(v, apps)}
        groups={[{ title: "Apps", items: appItems }]}
        onChange={(edits) => set({ edits })}
      />

      {value.edits.length ? (
        <fieldset className="sm:col-span-2">
          <legend className={fieldLabel}>When it changes code</legend>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {(
              [
                ["review", "Wait for me", "Leaves it on a branch. You review the diff in the harness and land it."],
                ["auto", "Ship it live", "Lands the branch and pushes it, so the change goes live on its own."],
              ] as const
            ).map(([mode, title, why]) => {
              const on = value.ship === mode;
              return (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 transition-colors ${
                    on
                      ? mode === "auto"
                        ? "border-amber-400/60 bg-amber-400/10"
                        : "border-brand-2 bg-brand-2/10"
                      : "border-line hover:bg-line/30"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${pickId}-ship`}
                    checked={on}
                    onChange={() => set({ ship: mode })}
                    className="mt-0.5 accent-current"
                  />
                  <span>
                    <span className="block text-[12px] font-medium text-ink">{title}</span>
                    <span className="block text-[10.5px] leading-snug text-ink-faint">{why}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <div>
        <label htmlFor={repeatId} className={fieldLabel}>
          Runs
        </label>
        <select
          id={repeatId}
          value={value.repeat}
          onChange={(e) => set({ repeat: e.target.value as AgentRepeat })}
          className="mt-1 block min-h-[32px] w-full rounded border border-line bg-bg px-2 text-[16px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-2 sm:text-[12px]"
        >
          {ALL_REPEATS.map((r) => (
            <option key={r} value={r}>
              {r === "once" ? "Once, then it's done" : `${REPEAT_LABEL[r]}, for good`}
            </option>
          ))}
        </select>
        <p className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">
          {value.repeat === "once"
            ? "Finishes when the goal is met."
            : "After each round it rests, then starts again from what the last round found."}
        </p>
      </div>
    </div>
  );
}
