"use client";

// Settings — every agent setting as a real control. Each group saves its own
// fields with agent.settings; mode goes through agent.control like everywhere
// else. Defaults are shown next to each field.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, Pause, Play, Plus, RotateCcw, Square, X } from "lucide-react";
import type { AgentSettings } from "@/lib/h3-lab/model";
import { DEFAULT_AGENT } from "@/lib/h3-lab/state";
import type { SectionProps } from "../sections";
import { Chip, Panel, SectionHead } from "../ui";

type Key = Exclude<keyof AgentSettings, "mode">;

const MODEL_SUGGESTIONS = ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5", "google/gemini-3.8-flash"];

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function Settings({ lab }: SectionProps) {
  const s = lab.state;
  const [draft, setDraft] = useState<AgentSettings>(s.agent);
  const synced = useRef<AgentSettings>(s.agent);
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [newPriority, setNewPriority] = useState("");

  // Take server changes for every field the owner has not edited locally.
  useEffect(() => {
    const prev = synced.current;
    setDraft((d) => {
      const next = { ...d };
      for (const k of Object.keys(s.agent) as (keyof AgentSettings)[]) {
        if (same(d[k], prev[k])) (next as Record<string, unknown>)[k] = s.agent[k];
      }
      return next;
    });
    synced.current = s.agent;
  }, [s.agent]);

  const set = <K extends Key>(k: K, v: AgentSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = (keys: Key[]) => keys.filter((k) => !same(draft[k], s.agent[k]));

  async function save(group: string, keys: Key[]) {
    const changed = dirty(keys);
    if (!changed.length) return;
    const patch: Partial<AgentSettings> = {};
    for (const k of changed) (patch as Record<string, unknown>)[k] = draft[k];
    const res = await lab.act({ action: "agent.settings", patch }, `Save ${group}`);
    if (res) setSavedAt((m) => ({ ...m, [group]: Date.now() }));
  }

  async function resetAll() {
    const { mode: _mode, ...rest } = DEFAULT_AGENT;
    void _mode;
    const res = await lab.act({ action: "agent.settings", patch: rest }, "Reset settings to defaults");
    if (res) {
      setDraft({ ...res.state.agent });
      synced.current = res.state.agent;
      setConfirmReset(false);
      setSavedAt({ all: Date.now() });
    }
  }

  const mode = s.agent.mode;
  const busy = !!lab.busy;

  /** Props for one saving group — a plain object, so the group component keeps its identity across renders. */
  const g = (id: string, keys: Key[]) => {
    const d = dirty(keys);
    return {
      keys,
      dirtyCount: d.length,
      recentlySaved: !!savedAt[id] && Date.now() - savedAt[id] < 4000,
      busy,
      onSave: () => void save(id, keys),
      onDiscard: () =>
        setDraft((x) => {
          const n = { ...x };
          for (const k of d) (n as Record<string, unknown>)[k] = s.agent[k];
          return n;
        }),
    };
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <style>{`.h3l .st-choice:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }`}</style>
      <SectionHead
        eyebrow="Settings"
        title="How the agent works"
        lede="Each group saves on its own. Defaults are shown beside every field."
        actions={
          confirmReset ? (
            <span className="row" style={{ gap: 6 }}>
              <span className="dim">Reset every setting except run mode to its default?</span>
              <button type="button" className="btn danger sm" disabled={busy} onClick={() => void resetAll()}><RotateCcw size={13} /> Reset</button>
              <button type="button" className="btn ghost sm" onClick={() => setConfirmReset(false)}>Cancel</button>
            </span>
          ) : (
            <button type="button" className="btn sm" onClick={() => setConfirmReset(true)}><RotateCcw size={13} /> Reset to defaults</button>
          )
        }
      />

      <Panel title="Run mode" meta={`default: ${DEFAULT_AGENT.mode}`}>
        <div className="row" style={{ gap: 6 }}>
          <span className={`lamp ${mode === "running" ? "on pulse" : mode === "paused" ? "amber" : "bad"}`} />
          <b style={{ textTransform: "capitalize", marginRight: 8 }}>{mode}</b>
          <button type="button" className={`btn sm ${mode === "running" ? "primary" : ""}`} aria-pressed={mode === "running"} disabled={busy || mode === "running"} onClick={() => void lab.act({ action: "agent.control", mode: "running" }, mode === "paused" ? "Resume agent" : "Start agent")}>
            <Play size={13} /> {mode === "paused" ? "Resume" : mode === "stopped" ? "Start" : "Running"}
          </button>
          <button type="button" className="btn sm" aria-pressed={mode === "paused"} disabled={busy || mode === "paused"} onClick={() => void lab.act({ action: "agent.control", mode: "paused" }, "Pause agent")}>
            <Pause size={13} /> Paused
          </button>
          <button type="button" className="btn sm danger" aria-pressed={mode === "stopped"} disabled={busy || mode === "stopped"} onClick={() => void lab.act({ action: "agent.control", mode: "stopped" }, "Stop agent")}>
            <Square size={12} /> Stopped
          </button>
        </div>
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 12 }}>
          Running: the agent takes steps on its own. Paused: it finishes nothing new but keeps its place. Stopped: it does nothing until started again. Every step checks this first.
        </p>
      </Panel>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <Group title="Promotion and the evidence bar" {...g("promotion", ["promotion", "minPairs", "minLowerBound"])}>
          <div role="radiogroup" aria-label="Promotion" className="grid" style={{ gap: 8 }}>
            <Choice
              checked={draft.promotion === "manual"}
              onPick={() => set("promotion", "manual")}
              title="Manual"
              isDefault={DEFAULT_AGENT.promotion === "manual"}
              body="Every guide change waits for your approval in Prompt Evolution."
            />
            <Choice
              checked={draft.promotion === "auto"}
              onPick={() => set("promotion", "auto")}
              title="Auto"
              isDefault={DEFAULT_AGENT.promotion === "auto"}
              body="A change is approved by itself when its evidence clears the bar below. It still lands in the history with its evidence, and you can roll it back."
            />
          </div>
          <NumberField label="Minimum paired comparisons" hint="Judged master/experiment pairs a technique needs before it can be promoted." value={draft.minPairs} min={1} max={50} step={1} def={DEFAULT_AGENT.minPairs} onChange={(v) => set("minPairs", v)} />
          <NumberField label="Minimum lower bound" hint="The 90% interval's lower end (score points, 0–10 scale) must be above this." value={draft.minLowerBound} min={-2} max={5} step={0.1} def={DEFAULT_AGENT.minLowerBound} onChange={(v) => set("minLowerBound", v)} />
        </Group>

        <Group title="Daily budgets" {...g("budgets", ["rendersPerDay", "aiCallsPerDay", "maxConcurrentExperiments"])}>
          <NumberField label="Renders per day" hint={`Each 5 s turbo clip takes ~5.7 min on the RTX 3050, so ${draft.rendersPerDay} renders ≈ ${((draft.rendersPerDay * 5.7) / 60).toFixed(1)} h of GPU.`} value={draft.rendersPerDay} min={0} max={500} step={1} def={DEFAULT_AGENT.rendersPerDay} onChange={(v) => set("rendersPerDay", v)} />
          <NumberField label="AI calls per day" hint="Judging, designing and research calls on the hub's AI." value={draft.aiCallsPerDay} min={0} max={2000} step={1} def={DEFAULT_AGENT.aiCallsPerDay} onChange={(v) => set("aiCallsPerDay", v)} />
          <NumberField label="Experiments at once" hint="How many experiments may be queued, running or evaluating together." value={draft.maxConcurrentExperiments} min={1} max={10} step={1} def={DEFAULT_AGENT.maxConcurrentExperiments} onChange={(v) => set("maxConcurrentExperiments", v)} />
        </Group>

        <Group title="Brain" {...g("brain", ["brain", "model"])}>
          <div role="radiogroup" aria-label="Brain" className="grid" style={{ gap: 8 }}>
            <Choice
              checked={draft.brain === "hub-ai"}
              onPick={() => set("brain", "hub-ai")}
              title="Hub AI"
              isDefault={DEFAULT_AGENT.brain === "hub-ai"}
              body={<>The hub&apos;s AI through OpenRouter / the gateway. Works with the PC off; costs per call. {lab.meta && !lab.meta.aiConfigured ? <Chip tone="bad">no key on this deploy</Chip> : null}</>}
            />
            <Choice
              checked={draft.brain === "claude-code"}
              onPick={() => set("brain", "claude-code")}
              title="Claude Code on the PC"
              isDefault={DEFAULT_AGENT.brain === "claude-code"}
              body={<>Your Claude Code subscription, run by the worker. No per-call cost; reasoning waits while the PC is off. {s.worker.lastSeen && !s.worker.claude ? <Chip tone="bad">worker has no claude CLI</Chip> : null}</>}
            />
          </div>
          <label className="field">
            <span>Model (hub AI, vision-capable)</span>
            <input className="in mono" list="h3l-model-suggestions" value={draft.model} onChange={(e) => set("model", e.target.value)} spellCheck={false} />
            <datalist id="h3l-model-suggestions">
              {MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
            </datalist>
            <small className="muted">Default <span className="mono">{DEFAULT_AGENT.model}</span>. Used only when the brain is the hub&apos;s AI.</small>
          </label>
        </Group>

        <Group
          title="Test renders"
          {...g("renders", ["quality", "testSeconds"])}
          note={draft.quality === "hi" ? <div className="notice">Hi quality has not been measured on this PC yet. Expect each render to take several times longer than turbo and fewer renders per day.</div> : null}
        >
          <div role="radiogroup" aria-label="Quality" className="grid" style={{ gap: 8 }}>
            <Choice checked={draft.quality === "turbo"} onPick={() => set("quality", "turbo")} title="Turbo" isDefault={DEFAULT_AGENT.quality === "turbo"} body="4-step, 832×480. Measured ~5.7 min per 5 s clip on the RTX 3050." />
            <Choice checked={draft.quality === "hi"} onPick={() => set("quality", "hi")} title="Hi" isDefault={DEFAULT_AGENT.quality === "hi"} body="20-step, two-phase upscale. Not yet timed on this PC." />
          </div>
          <NumberField label="Seconds per test render" hint="4–15 s. Longer clips test more motion but cost proportionally more GPU time." value={draft.testSeconds} min={4} max={15} step={1} def={DEFAULT_AGENT.testSeconds} onChange={(v) => set("testSeconds", v)} />
        </Group>
      </div>

      <Group title="Priorities" {...g("priorities", ["priorities"])}>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          What the agent works on first when it designs experiments, in order. Default: {DEFAULT_AGENT.priorities.join(", ")}.
        </p>
        {draft.priorities.length ? (
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
            {draft.priorities.map((p, i) => (
              <li key={i} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <span className="mono muted" style={{ width: 18, textAlign: "right" }}>{i + 1}</span>
                <input className="in" value={p} aria-label={`Priority ${i + 1}`} onChange={(e) => set("priorities", draft.priorities.map((x, j) => (j === i ? e.target.value : x)))} />
                <button type="button" className="btn ghost sm" aria-label="Move up" disabled={i === 0} onClick={() => { const n = [...draft.priorities]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set("priorities", n); }}><ArrowUp size={13} /></button>
                <button type="button" className="btn ghost sm" aria-label="Move down" disabled={i === draft.priorities.length - 1} onClick={() => { const n = [...draft.priorities]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; set("priorities", n); }}><ArrowDown size={13} /></button>
                <button type="button" className="btn ghost sm" aria-label="Remove" onClick={() => set("priorities", draft.priorities.filter((_, j) => j !== i))}><X size={13} /></button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="dim" style={{ margin: 0 }}>No priorities — the agent works on the weakest measured dimensions instead.</p>
        )}
        <form
          className="row"
          style={{ flexWrap: "nowrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            const v = newPriority.trim();
            if (!v) return;
            set("priorities", [...draft.priorities, v]);
            setNewPriority("");
          }}
        >
          <input className="in" placeholder="Add a priority, e.g. dialogue lip-sync" value={newPriority} onChange={(e) => setNewPriority(e.target.value)} aria-label="New priority" />
          <button type="submit" className="btn sm" disabled={!newPriority.trim()}><Plus size={13} /> Add</button>
        </form>
      </Group>
    </div>
  );
}

function Choice({ checked, onPick, title, body, isDefault }: { checked: boolean; onPick: () => void; title: string; body: ReactNode; isDefault: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onPick}
      className="st-choice"
      style={{
        all: "unset",
        boxSizing: "border-box",
        cursor: "pointer",
        display: "grid",
        gap: 3,
        padding: "9px 11px",
        borderRadius: 5,
        border: `1px solid ${checked ? "var(--amber-line)" : "var(--line-2)"}`,
        background: checked ? "var(--amber-dim)" : "var(--bg-grain)",
      }}
    >
      <span className="row" style={{ gap: 8 }}>
        <span aria-hidden style={{ width: 12, height: 12, borderRadius: 99, border: `2px solid ${checked ? "var(--amber)" : "var(--ink-4)"}`, background: checked ? "var(--amber)" : "transparent", boxShadow: checked ? "inset 0 0 0 2px var(--panel)" : undefined }} />
        <b>{title}</b>
        {isDefault ? <span className="muted mono" style={{ fontSize: 10.5 }}>default</span> : null}
      </span>
      <span className="dim" style={{ fontSize: 12.5, paddingLeft: 20 }}>{body}</span>
    </button>
  );
}

function NumberField({ label, hint, value, min, max, step, def, onChange }: { label: string; hint: string; value: number; min: number; max: number; step: number; def: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  // Follow outside changes (server sync, reset) without fighting what is being typed ("0." stays "0.").
  useEffect(() => {
    setText((t) => (Number(t) === value && t.trim() !== "" ? t : String(value)));
  }, [value]);
  const round = (n: number) => (step < 1 ? Math.round(n * 10) / 10 : Math.round(n));
  return (
    <label className="field">
      <span>{label}</span>
      <span className="row" style={{ flexWrap: "nowrap" }}>
        <input
          className="in mono"
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={text}
          style={{ width: 110 }}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            // Commit only values already in range; out-of-range input is clamped on blur.
            if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(round(n));
          }}
          onBlur={() => {
            const n = Number(text);
            const next = text.trim() === "" || !Number.isFinite(n) ? value : Math.min(max, Math.max(min, round(n)));
            onChange(next);
            setText(String(next));
          }}
        />
        <span className="muted mono" style={{ fontSize: 11 }}>default {def}</span>
      </span>
      <small className="muted">{hint}</small>
    </label>
  );
}

function Group({ title, dirtyCount, recentlySaved, busy, onSave, onDiscard, children, note }: { title: string; keys: Key[]; dirtyCount: number; recentlySaved: boolean; busy: boolean; onSave: () => void; onDiscard: () => void; children: ReactNode; note?: ReactNode }) {
  return (
    <Panel
      title={title}
      meta={dirtyCount ? `${dirtyCount} unsaved` : recentlySaved ? "saved just now" : "in use"}
      actions={
        dirtyCount ? (
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn ghost sm" onClick={onDiscard}>Discard</button>
            <button type="button" className="btn primary sm" disabled={busy} onClick={onSave}>
              <Check size={13} /> Save
            </button>
          </span>
        ) : (
          <Chip tone="good">saved</Chip>
        )
      }
    >
      <div className="grid" style={{ gap: 14 }}>{children}</div>
      {note ? <div style={{ marginTop: 12 }}>{note}</div> : null}
    </Panel>
  );
}
