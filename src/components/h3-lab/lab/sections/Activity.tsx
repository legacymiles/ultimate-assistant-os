"use client";

// Agent Activity — the log every step writes as it does the work (nothing is
// synthesized for display), plus the controls, today's budget, the think-job
// queue and what the agent will do next.

import { useMemo, useState } from "react";
import { Pause, Play, Search, Square, StepForward } from "lucide-react";
import type { ActivityEntry, LabState } from "@/lib/h3-lab/model";
import { nextStep } from "@/lib/h3-lab/agent";
import type { SectionId, SectionProps } from "../sections";
import { Chip, Empty, Panel, SectionHead, StatusChip, ago, when } from "../ui";

const PAGE = 150;

function refTarget(ref: ActivityEntry["ref"]): { section: SectionId; focus?: string; label: string } | null {
  if (!ref) return null;
  switch (ref.type) {
    case "experiment":
      return { section: "lab", focus: ref.id, label: "experiment" };
    case "generation":
      return { section: "compare", focus: ref.id, label: "render" };
    case "change":
      return { section: "evolution", focus: ref.id, label: "change" };
    case "blueprint":
      return { section: "reverse", focus: ref.id, label: "blueprint" };
    case "production":
      return { section: "productions", focus: ref.id, label: "production" };
    case "repo":
      return { section: "repos", label: "repository" };
    default:
      return null;
  }
}

function detached(state: LabState): LabState {
  return { ...state, counters: { ...state.counters } };
}

export default function Activity({ lab, go }: SectionProps) {
  const s = lab.state;
  const [actor, setActor] = useState<"all" | ActivityEntry["actor"]>("all");
  const [kind, setKind] = useState<"all" | ActivityEntry["kind"]>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [lastStep, setLastStep] = useState<{ did: string; kind: string; at: string } | null>(null);

  const next = useMemo(() => nextStep(detached(s), new Date().toISOString()), [s]);
  const today = new Date().toISOString().slice(0, 10);
  const rendersToday = s.counters.day === today ? s.counters.renders : 0;
  const aiToday = s.counters.day === today ? s.counters.aiCalls : 0;

  const all = useMemo(() => [...s.activity].sort((a, b) => b.at.localeCompare(a.at)), [s.activity]);
  const kinds = useMemo(() => [...new Set(all.map((a) => a.kind))].sort(), [all]);
  const actors = useMemo(() => [...new Set(all.map((a) => a.actor))].sort(), [all]);
  const q = query.trim().toLowerCase();
  const filtered = all.filter((a) => (actor === "all" || a.actor === actor) && (kind === "all" || a.kind === kind) && (!q || a.text.toLowerCase().includes(q)));
  const think = [...s.think].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const mode = s.agent.mode;
  const busy = !!lab.busy;
  const control = (m: LabState["agent"]["mode"], label: string) => void lab.act({ action: "agent.control", mode: m }, label);

  async function runStep() {
    const res = await lab.act({ action: "agent.tick" }, "Run one step");
    if (res?.step) setLastStep({ did: res.step.did, kind: res.step.kind, at: new Date().toISOString() });
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <SectionHead
        eyebrow="Autonomous agent"
        title="Agent activity"
        lede="Every line below was written by the step that did the work — the agent, the PC worker, or you. Nothing is filled in for show."
        actions={
          <>
            {mode === "stopped" ? (
              <button type="button" className="btn primary sm" disabled={busy} onClick={() => control("running", "Start agent")}><Play size={13} /> Start</button>
            ) : mode === "paused" ? (
              <button type="button" className="btn primary sm" disabled={busy} onClick={() => control("running", "Resume agent")}><Play size={13} /> Resume</button>
            ) : (
              <button type="button" className="btn sm" disabled={busy} onClick={() => control("paused", "Pause agent")}><Pause size={13} /> Pause</button>
            )}
            {mode !== "stopped" ? (
              <button type="button" className="btn danger sm" disabled={busy} onClick={() => control("stopped", "Stop agent")}><Square size={12} /> Stop</button>
            ) : null}
            <button type="button" className="btn exp sm" disabled={busy} onClick={() => void runStep()}><StepForward size={13} /> Run one step now</button>
          </>
        }
      />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <Panel title="State">
          <div className="row" style={{ marginBottom: 8 }}>
            <span className={`lamp ${mode === "running" ? "on pulse" : mode === "paused" ? "amber" : "bad"}`} />
            <b style={{ textTransform: "capitalize" }}>{mode}</b>
            <span className="muted">· brain {s.agent.brain}{s.agent.brain === "hub-ai" ? ` (${s.agent.model})` : ""}</span>
          </div>
          <span className="eyebrow">Next step</span>
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <Chip tone={next.kind === "idle" ? undefined : "cyan"}>{next.kind}</Chip>
            <span className="dim">{next.reason}</span>
          </div>
          {lastStep ? (
            <div className="notice cyan" style={{ marginTop: 10 }}>
              <span className="mono muted" style={{ fontSize: 11 }}>{lastStep.kind} · {ago(lastStep.at)}</span>
              <div>{lastStep.did}</div>
            </div>
          ) : null}
        </Panel>

        <Panel title="Today's budget" meta={s.counters.day === today ? today : `${today} · no work yet today`}>
          <Budget label="Renders" used={rendersToday} cap={s.agent.rendersPerDay} />
          <Budget label="AI calls" used={aiToday} cap={s.agent.aiCallsPerDay} />
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
            Research last ran {ago(s.lastResearchAt)}. Budgets reset at midnight UTC; change them in Settings.
          </p>
        </Panel>

        <Panel title="Think jobs" meta="reasoning handed to Claude Code on the PC" bodyClass="tbl-wrap">
          {think.length ? (
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              <table className="tbl">
                <thead><tr><th>Step</th><th>State</th><th>Queued</th><th>Error</th></tr></thead>
                <tbody>
                  {think.map((t) => (
                    <tr key={t.id}>
                      <td><Chip>{t.step}</Chip></td>
                      <td><StatusChip status={t.state} /></td>
                      <td className="mono muted" style={{ whiteSpace: "nowrap" }}>{when(t.createdAt)}</td>
                      <td style={{ color: t.error ? "var(--bad)" : undefined, fontSize: 12 }}>{t.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted panel-body" style={{ margin: 0 }}>
              {s.agent.brain === "claude-code"
                ? "No think jobs yet. With brain = Claude Code, reasoning steps queue here and the PC worker answers them."
                : "None — the agent's brain is the hub's AI, so reasoning runs on the server and never queues here."}
            </p>
          )}
        </Panel>
      </div>

      <Panel
        title="Feed"
        meta={`${filtered.length} of ${all.length}`}
        actions={
          <span className="row" style={{ gap: 6 }}>
            <select className="in" style={{ width: "auto", minHeight: 26, padding: "2px 6px" }} aria-label="Filter by actor" value={actor} onChange={(e) => setActor(e.target.value as typeof actor)}>
              <option value="all">All actors</option>
              {actors.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className="in" style={{ width: "auto", minHeight: 26, padding: "2px 6px" }} aria-label="Filter by kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">All kinds</option>
              {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
              <Search size={13} className="muted" aria-hidden />
              <input className="in" style={{ minHeight: 26, padding: "2px 8px", width: 170 }} placeholder="Search text" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search activity" />
            </span>
          </span>
        }
        bodyClass="tbl-wrap"
      >
        {!all.length ? (
          <div className="panel-body">
            <Empty title="The agent has not done anything yet">
              Start it and each step — designing an experiment, queueing renders, judging clips, proposing a guide change — is logged here as it happens.
              {mode !== "running" ? (
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="btn primary sm" disabled={busy} onClick={() => control("running", "Start agent")}><Play size={13} /> Start the agent</button>
                </div>
              ) : null}
            </Empty>
          </div>
        ) : !filtered.length ? (
          <p className="muted panel-body" style={{ margin: 0 }}>Nothing matches these filters.</p>
        ) : (
          <>
            <table className="tbl">
              <thead><tr><th>When</th><th>Actor</th><th>Kind</th><th>What happened</th><th>Ref</th></tr></thead>
              <tbody>
                {filtered.slice(0, limit).map((a) => {
                  const t = refTarget(a.ref);
                  return (
                    <tr key={a.id}>
                      <td className="mono muted" style={{ whiteSpace: "nowrap" }} title={a.at}>{when(a.at)}</td>
                      <td><Chip tone={a.actor === "agent" ? "cyan" : a.actor === "owner" ? "amber" : undefined}>{a.actor}</Chip></td>
                      <td><Chip tone={a.kind === "error" ? "bad" : a.kind === "approve" || a.kind === "publish" ? "good" : undefined}>{a.kind}</Chip></td>
                      <td style={{ minWidth: 260, color: a.kind === "error" ? "var(--bad)" : undefined }}>{a.text}</td>
                      <td>
                        {t ? (
                          <button type="button" className="btn sm ghost" onClick={() => go(t.section, t.focus)}>
                            {t.label} →
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > limit ? (
              <div className="panel-body">
                <button type="button" className="btn sm" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</button>
              </div>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );
}

function Budget({ label, used, cap }: { label: string; used: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 100;
  const color = pct >= 100 ? "var(--bad)" : pct >= 80 ? "var(--warn)" : "var(--amber)";
  return (
    <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="dim">{label}</span>
        <span className="mono">{used} <span className="muted">/ {cap}</span></span>
      </div>
      <span className="bar" style={{ width: "100%" }}><i style={{ width: `${pct}%`, background: color }} /></span>
    </div>
  );
}
