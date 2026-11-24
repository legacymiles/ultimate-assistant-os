"use client";

// Experiment Lab — the research bench. Left: every experiment as a dense
// ledger. Right: the open experiment's dossier and its paired results. Below:
// the Live compiler (the standout: flip a knob, the prompt diff re-renders
// instantly) and the scenarios every experiment renders.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight, Copy, FlaskConical, Pencil, Play, Plus, RotateCcw, Save, Archive, Trash2 } from "lucide-react";
import type { SectionProps } from "../sections";
import { Chip, Delta, Empty, Panel, ScoreBar, SectionHead, StatusChip, diffWords } from "../ui";
import type { Dimension, Experiment, LabState, Scenario, ShotSpec, Strategy } from "@/lib/h3-lab/model";
import { DIMENSIONS, DIMENSION_LABEL } from "@/lib/h3-lab/model";
import { currentVersion, strategyFor } from "@/lib/h3-lab/guide";
import { compileSpec, experimentPairs, experimentProgress } from "@/lib/h3-lab/state";
import { lint, lintSummary } from "@/lib/h3-lab/lint";
import { framesFor } from "@/lib/h3-lab/wangp";
import { techniqueLabel } from "@/lib/h3-lab/strategy";
import { genreName } from "@/lib/h3-lab/genres";
import { overallScore } from "@/lib/h3-lab/score";
import { KnobBoard } from "../research/KnobBoard";
import { ShotSpecEditor, blankSpec } from "../research/ShotSpecEditor";
import { ResearchStyles } from "../research/ResearchStyles";
import { fmtMinutes, renderEstimate, rendersLeftToday } from "../research/helpers";

type Filter = "active" | "drafts" | "concluded" | "archived";

const FILTERS: { id: Filter; label: string; match: (e: Experiment) => boolean }[] = [
  { id: "active", label: "Active", match: (e) => e.status === "queued" || e.status === "running" || e.status === "evaluating" },
  { id: "drafts", label: "Drafts", match: (e) => e.status === "draft" },
  { id: "concluded", label: "Concluded", match: (e) => e.status === "concluded" },
  { id: "archived", label: "Archived", match: (e) => e.status === "archived" },
];

type ExpFields = Pick<Experiment, "name" | "hypothesis" | "intendedImprovement" | "overrides" | "instructions" | "targets" | "scenarioIds">;

function overrideChips(o: Partial<Strategy>) {
  const entries = Object.entries(o).filter(([, v]) => v);
  if (!entries.length) return <span className="muted">none — renders the master strategy</span>;
  return (
    <span className="rs-pill-list">
      {entries.map(([k, v]) => (
        <Chip key={k} tone="cyan">{techniqueLabel(`${k}=${v}`)}</Chip>
      ))}
    </span>
  );
}

function testSpec(state: LabState, sc: Scenario): ShotSpec {
  return { ...sc.spec, durationSec: Math.max(4, Math.min(15, sc.spec.durationSec || state.agent.testSeconds)) };
}

export default function ExperimentLab({ lab, go, focus }: SectionProps) {
  const state = lab.state;
  const v = currentVersion(state.guide);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, state.experiments.filter(f.match).length])) as Record<Filter, number>, [state.experiments]);
  const [filter, setFilter] = useState<Filter>(() => (FILTERS.find((f) => state.experiments.some(f.match))?.id ?? "drafts"));
  const [selId, setSelId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [liveScenario, setLiveScenario] = useState<string | null>(state.scenarios[0]?.id ?? null);
  const [scEdit, setScEdit] = useState<{ id?: string; title: string; spec: ShotSpec } | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const scRef = useRef<HTMLDivElement>(null);

  // Focus: an experiment id, or "genre:<id>" from Genre Research.
  useEffect(() => {
    if (!focus) return;
    if (focus.startsWith("genre:")) {
      const genre = focus.slice(6);
      const sc = state.scenarios.find((s) => s.spec.genre === genre);
      if (sc) {
        setLiveScenario(sc.id);
        window.setTimeout(() => liveRef.current?.scrollIntoView({ block: "start" }), 60);
      } else {
        setScEdit({ title: "", spec: blankSpec(genre) });
        window.setTimeout(() => scRef.current?.scrollIntoView({ block: "start" }), 60);
      }
      return;
    }
    const e = state.experiments.find((x) => x.id === focus);
    if (e) {
      setSelId(e.id);
      setCreating(false);
      const f = FILTERS.find((x) => x.match(e));
      if (f) setFilter(f.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const rows = state.experiments.filter(FILTERS.find((f) => f.id === filter)!.match);
  const selected = state.experiments.find((e) => e.id === selId) ?? null;

  const create = async (fields: ExpFields) => {
    const res = await lab.act({ action: "experiment.create", experiment: fields }, "Experiment created");
    if (res?.id) {
      setSelId(res.id);
      setCreating(false);
      setFilter("drafts");
    }
    return res;
  };

  return (
    <div className="grid rs-root" style={{ gap: 16 }}>
      <ResearchStyles />
      <SectionHead
        eyebrow="Research · Experiment Lab"
        title="Experiment Lab"
        lede="An experiment is a set of technique settings layered on the master guide for each genre, rendered in pairs against the master with the same scenario and seed. Results are credited to techniques, never to a whole experiment."
        actions={
          <button type="button" className="btn primary" onClick={() => { setCreating(true); setSelId(null); }}>
            <Plus size={14} /> New experiment
          </button>
        }
      />

      <div className="rs-split-wide">
        <Panel
          title="Experiments"
          meta={`${state.experiments.length} total`}
          actions={
            <div className="rs-tabs" role="group" aria-label="Filter experiments">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label} <span className="mono">{counts[f.id]}</span>
                </button>
              ))}
            </div>
          }
          bodyClass="tbl-wrap"
        >
          {rows.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th className="hide-sm">Targets</th>
                  <th className="hide-sm">By</th>
                  <th className="hide-sm">Base</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const p = experimentProgress(state, e.id);
                  return (
                    <tr key={e.id} className="clickable" aria-selected={e.id === selId} onClick={() => { setSelId(e.id); setCreating(false); }}>
                      <td className="serif" style={{ fontSize: 17, color: "var(--cyan)" }}>{e.code}</td>
                      <td>{e.name}</td>
                      <td><StatusChip status={e.status} /></td>
                      <td className="mono" style={{ whiteSpace: "nowrap" }}>
                        {p.total ? (
                          <>
                            {p.done}/{p.total} <span className="muted">done</span> · {p.judged} <span className="muted">judged</span>
                            {p.failed ? <> · <span style={{ color: "var(--bad)" }}>{p.failed} failed</span></> : null}
                          </>
                        ) : (
                          <span className="muted">not queued</span>
                        )}
                      </td>
                      <td className="hide-sm">
                        <span className="rs-pill-list">{e.targets.map((t) => <Chip key={t}>{t}</Chip>)}</span>
                      </td>
                      <td className="hide-sm"><Chip tone={e.createdBy === "agent" ? "cyan" : e.createdBy === "owner" ? "amber" : undefined}>{e.createdBy}</Chip></td>
                      <td className="hide-sm mono">v{e.baseVersion}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="panel-body">
              <Empty title={`No ${FILTERS.find((f) => f.id === filter)!.label.toLowerCase()} experiments.`}>
                {filter === "active" ? "Queue a draft's renders and it moves here while the PC renders it." : filter === "drafts" ? "Start one from the Live compiler below, or with New experiment." : filter === "concluded" ? "An experiment concludes once its paired renders are judged." : "Archived experiments land here."}
              </Empty>
            </div>
          )}
        </Panel>

        <div className="rs-sticky">
          {creating ? (
            <ExperimentForm state={state} title="New experiment" onCancel={() => setCreating(false)} onSubmit={create} />
          ) : selected ? (
            <Dossier key={selected.id} exp={selected} lab={lab} go={go} onDuplicate={create} />
          ) : (
            <Panel title="Dossier">
              <Empty title="Pick an experiment to open its dossier.">
                Its hypothesis, technique settings, scenarios and paired results show here.
              </Empty>
            </Panel>
          )}
        </div>
      </div>

      <div ref={liveRef}>
        <LiveCompiler
          state={state}
          lab={lab}
          scenarioId={liveScenario}
          onScenario={setLiveScenario}
          selected={selected}
          onCreate={create}
          onNewScenario={() => {
            setScEdit({ title: "", spec: blankSpec() });
            window.setTimeout(() => scRef.current?.scrollIntoView({ block: "start" }), 60);
          }}
        />
      </div>

      <div ref={scRef}>
        <Scenarios state={state} lab={lab} edit={scEdit} setEdit={setScEdit} onCompile={(id) => { setLiveScenario(id); liveRef.current?.scrollIntoView({ block: "start" }); }} />
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>
        Guide v{v.version} is the master. Approved techniques move into it from{" "}
        <button type="button" className="btn ghost sm" onClick={() => go("evolution")}>Prompt Evolution <ArrowUpRight size={12} /></button>
      </span>
    </div>
  );
}

// ----- dossier ---------------------------------------------------------------------------

function Dossier({ exp, lab, go, onDuplicate }: { exp: Experiment; lab: SectionProps["lab"]; go: SectionProps["go"]; onDuplicate: (f: ExpFields) => Promise<unknown> }) {
  const state = lab.state;
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [qerr, setQerr] = useState<string | null>(null);
  const pairs = useMemo(() => experimentPairs(state, exp.id), [state, exp.id]);
  const progress = experimentProgress(state, exp.id);

  const scenarios = exp.scenarioIds.map((id) => state.scenarios.find((s) => s.id === id)).filter((s): s is Scenario => Boolean(s));
  const estimate = useMemo(() => {
    let minutes = 0;
    let known = true;
    let basis = "";
    for (const sc of scenarios) {
      const e = renderEstimate(state, testSpec(state, sc));
      basis = e.basis;
      if (e.minutes === null) known = false;
      else minutes += e.minutes * 2;
    }
    return { minutes: known ? Math.round(minutes * 10) / 10 : null, basis };
  }, [scenarios, state]);
  const left = rendersLeftToday(state);
  const renders = scenarios.length * 2;

  const toggleScenario = (id: string) => {
    const next = exp.scenarioIds.includes(id) ? exp.scenarioIds.filter((x) => x !== id) : [...exp.scenarioIds, id];
    void lab.act({ action: "experiment.update", id: exp.id, patch: { scenarioIds: next } }, "Scenarios updated");
  };

  if (editing) {
    return (
      <ExperimentForm
        state={state}
        title={`Edit ${exp.code} · ${exp.name}`}
        initial={exp}
        onCancel={() => setEditing(false)}
        onSubmit={async (f) => {
          const r = await lab.act({ action: "experiment.update", id: exp.id, patch: f }, "Experiment saved");
          if (r) setEditing(false);
          return r;
        }}
      />
    );
  }

  return (
    <Panel
      className="rs-arm exp"
      title={
        <span className="row" style={{ gap: 8 }}>
          <span className="serif" style={{ fontSize: 22, color: "var(--cyan)" }}>{exp.code}</span>
          <span className="serif" style={{ fontSize: 20 }}>{exp.name}</span>
        </span>
      }
      meta={`v${exp.version} · base guide v${exp.baseVersion}`}
      actions={<StatusChip status={exp.status} />}
    >
      <div className="grid" style={{ gap: 14 }}>
        <dl className="rs-kv" style={{ margin: 0 }}>
          <dt>Hypothesis</dt>
          <dd style={{ color: "var(--ink)" }}>{exp.hypothesis || <span className="muted">not written</span>}</dd>
          <dt>Improves</dt>
          <dd>{exp.intendedImprovement || <span className="muted">not written</span>}</dd>
          <dt>Targets</dt>
          <dd><span className="rs-pill-list">{exp.targets.length ? exp.targets.map((t) => <Chip key={t}>{DIMENSION_LABEL[t]}</Chip>) : <span className="muted">none</span>}</span></dd>
          <dt>Techniques</dt>
          <dd>{overrideChips(exp.overrides)}</dd>
          {exp.instructions ? (<><dt>Instructions</dt><dd className="mono" style={{ fontSize: 11.5 }}>{exp.instructions}</dd></>) : null}
          <dt>By</dt>
          <dd><Chip tone={exp.createdBy === "agent" ? "cyan" : exp.createdBy === "owner" ? "amber" : undefined}>{exp.createdBy}</Chip></dd>
        </dl>

        <div>
          <span className="eyebrow">Scenarios rendered</span>
          <div className="rs-pill-list" style={{ marginTop: 6 }}>
            {state.scenarios.map((s) => (
              <label className="rs-check" key={s.id} title={genreName(s.spec.genre)}>
                <input type="checkbox" checked={exp.scenarioIds.includes(s.id)} onChange={() => toggleScenario(s.id)} />
                {s.title}
              </label>
            ))}
          </div>
        </div>

        <div className="notice cyan" style={{ display: "grid", gap: 8 }}>
          <div>
            <b>{scenarios.length} scenario{scenarios.length === 1 ? "" : "s"} × 2 renders</b> (master + experiment, same seed) = up to{" "}
            <span className="mono">{renders}</span> renders · <span className="mono">{left}</span> of {state.agent.rendersPerDay} left today
            {renders > left ? <span style={{ color: "var(--warn)" }}> — the rest wait for tomorrow's budget</span> : null}.
            <br />
            <span className="dim">
              ≈ <span className="mono">{fmtMinutes(estimate.minutes)}</span> of GPU time at {state.agent.quality} ({estimate.basis}). A master already rendered at this guide version is reused, not re-rendered.
            </span>
          </div>
          <div className="row">
            {exp.status !== "archived" ? (
              <button
                type="button"
                className="btn exp"
                onClick={() => {
                  if (!scenarios.length) {
                    setQerr("Tick at least one scenario above — an experiment with no scenario has nothing to render.");
                    return;
                  }
                  setQerr(null);
                  void lab.act({ action: "experiment.queue", id: exp.id }, `Queued ${exp.code}`);
                }}
              >
                <Play size={13} /> Queue renders
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void onDuplicate({
                  name: `${exp.name} (copy)`,
                  hypothesis: exp.hypothesis,
                  intendedImprovement: exp.intendedImprovement,
                  overrides: { ...exp.overrides },
                  instructions: exp.instructions,
                  targets: [...exp.targets],
                  scenarioIds: [...exp.scenarioIds],
                })
              }
            >
              <Copy size={13} /> Duplicate as new
            </button>
            {exp.status !== "archived" ? (
              <button type="button" className="btn ghost" onClick={() => void lab.act({ action: "experiment.archive", id: exp.id }, `Archived ${exp.code}`)}>
                <Archive size={13} /> Archive
              </button>
            ) : null}
          </div>
          {qerr ? <div className="notice bad">{qerr}</div> : null}
        </div>

        {exp.status === "concluded" || exp.conclusion ? (
          <div className="grid" style={{ gap: 8 }}>
            <span className="eyebrow">Conclusion</span>
            {exp.conclusion ? <p style={{ margin: 0 }}>{exp.conclusion}</p> : null}
            <div className="rs-split" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
              <div>
                <span className="eyebrow" style={{ color: "var(--good)" }}>Strengths</span>
                <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>{exp.strengths.length ? exp.strengths.map((s) => <li key={s} className="mono" style={{ fontSize: 11.5 }}>{s}</li>) : <li className="muted">none above +0.5</li>}</ul>
              </div>
              <div>
                <span className="eyebrow" style={{ color: "var(--bad)" }}>Weaknesses</span>
                <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>{exp.weaknesses.length ? exp.weaknesses.map((s) => <li key={s} className="mono" style={{ fontSize: 11.5 }}>{s}</li>) : <li className="muted">none below −0.5</li>}</ul>
              </div>
            </div>
          </div>
        ) : null}

        <div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="eyebrow">Paired results</span>
            <span className="muted mono" style={{ fontSize: 11 }}>{progress.done}/{progress.total} renders done · {progress.judged} judged</span>
          </div>
          {pairs.length ? (
            <div className="tbl-wrap" style={{ marginTop: 6 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th />
                    <th>Scenario</th>
                    <th>Master</th>
                    <th>{exp.code}</th>
                    <th>Δ overall</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p) => {
                    const a = overallScore(p.master.scores ?? {}, p.genre);
                    const b = overallScore(p.experiment.scores ?? {}, p.genre);
                    const sc = state.scenarios.find((s) => s.id === p.experiment.scenarioId);
                    const isOpen = open === p.pairKey;
                    return (
                      <Fragment key={p.pairKey}>
                        <tr className="clickable" onClick={() => setOpen(isOpen ? null : p.pairKey)}>
                          <td>{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
                          <td>{sc?.title ?? genreName(p.genre)}</td>
                          <td><ScoreBar value={a} width={56} /></td>
                          <td><ScoreBar value={b} width={56} /></td>
                          <td><Delta value={a !== null && b !== null ? b - a : null} digits={2} /></td>
                          <td>
                            <button type="button" className="btn sm" onClick={(ev) => { ev.stopPropagation(); go("compare", p.pairKey); }}>
                              Compare <ArrowUpRight size={12} />
                            </button>
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr>
                            <td />
                            <td colSpan={5}>
                              <table className="tbl" style={{ fontSize: 12 }}>
                                <tbody>
                                  {DIMENSIONS.map((d) => {
                                    const ma = p.master.scores?.[d];
                                    const mb = p.experiment.scores?.[d];
                                    if (!ma && !mb) return null;
                                    return (
                                      <tr key={d} title={[ma ? `master: ${ma.evidence}` : "", mb ? `${exp.code}: ${mb.evidence}` : ""].filter(Boolean).join("\n")}>
                                        <td className="dim">{DIMENSION_LABEL[d]}</td>
                                        <td className="mono">{ma ? ma.value.toFixed(1) : "—"}</td>
                                        <td className="mono">{mb ? mb.value.toFixed(1) : "—"}</td>
                                        <td><Delta value={ma && mb ? mb.value - ma.value : null} /></td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ margin: "6px 0 0" }}>
              {progress.total ? "No pair has both renders finished and scored yet." : "Nothing rendered yet — Queue renders starts the paired test."}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ----- new / edit form -------------------------------------------------------------------

function ExperimentForm({ state, title, initial, onCancel, onSubmit }: { state: LabState; title: string; initial?: Experiment; onCancel: () => void; onSubmit: (f: ExpFields) => Promise<unknown> }) {
  const v = currentVersion(state.guide);
  const [f, setF] = useState<ExpFields>(() => ({
    name: initial?.name ?? "",
    hypothesis: initial?.hypothesis ?? "",
    intendedImprovement: initial?.intendedImprovement ?? "",
    overrides: { ...(initial?.overrides ?? {}) },
    instructions: initial?.instructions ?? "",
    targets: [...(initial?.targets ?? [])],
    scenarioIds: [...(initial?.scenarioIds ?? [])],
  }));
  const [err, setErr] = useState<string | null>(null);
  const firstGenre = state.scenarios.find((s) => f.scenarioIds.includes(s.id))?.spec.genre;
  const master = firstGenre ? strategyFor(v, firstGenre) : v.strategy;
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  const submit = () => {
    if (!f.name.trim()) return setErr("Give the experiment a name.");
    if (!f.hypothesis.trim()) return setErr("Write the hypothesis — what you expect to change, and why.");
    setErr(null);
    void onSubmit({ ...f, name: f.name.trim(), hypothesis: f.hypothesis.trim() });
  };

  return (
    <Panel title={title} className="rs-arm exp" actions={<button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>}>
      <div className="grid" style={{ gap: 12 }}>
        <label className="field"><span>Name</span><input className="in" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Hypothesis</span><textarea className="in" value={f.hypothesis} onChange={(e) => setF({ ...f, hypothesis: e.target.value })} placeholder="In fight scenes, choreography beats improve action accuracy because…" /></label>
        <label className="field"><span>Intended improvement</span><input className="in" value={f.intendedImprovement} onChange={(e) => setF({ ...f, intendedImprovement: e.target.value })} /></label>
        <div className="field">
          <span className="eyebrow">Targets</span>
          <div className="rs-pill-list">
            {DIMENSIONS.map((d) => (
              <label className="rs-check" key={d}>
                <input type="checkbox" checked={f.targets.includes(d)} onChange={() => setF({ ...f, targets: toggle<Dimension>(f.targets, d) })} />
                {DIMENSION_LABEL[d]}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="eyebrow">Scenarios</span>
          <div className="rs-pill-list">
            {state.scenarios.map((s) => (
              <label className="rs-check" key={s.id} title={genreName(s.spec.genre)}>
                <input type="checkbox" checked={f.scenarioIds.includes(s.id)} onChange={() => setF({ ...f, scenarioIds: toggle(f.scenarioIds, s.id) })} />
                {s.title}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="eyebrow">Technique settings · master shown {firstGenre ? `for ${genreName(firstGenre)}` : `as the guide's base`} (amber dot)</span>
          <KnobBoard id={`form-${initial?.id ?? "new"}`} master={master} overrides={f.overrides} onChange={(o) => setF({ ...f, overrides: o })} />
        </div>
        <label className="field"><span>Extra instructions (appended to the closing block)</span><textarea className="in" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></label>
        {err ? <div className="notice bad">{err}</div> : null}
        <div className="row">
          <button type="button" className="btn primary" onClick={submit}><Save size={13} /> {initial ? "Save changes" : "Create experiment"}</button>
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </Panel>
  );
}

// ----- live compiler (the standout) ------------------------------------------------------

function LiveCompiler({
  state,
  lab,
  scenarioId,
  onScenario,
  selected,
  onCreate,
  onNewScenario,
}: {
  state: LabState;
  lab: SectionProps["lab"];
  scenarioId: string | null;
  onScenario: (id: string) => void;
  selected: Experiment | null;
  onCreate: (f: ExpFields) => Promise<unknown>;
  onNewScenario: () => void;
}) {
  const v = currentVersion(state.guide);
  const [overrides, setOverrides] = useState<Partial<Strategy>>({});
  const [instructions, setInstructions] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const sc = state.scenarios.find((s) => s.id === scenarioId) ?? null;
  const spec = sc?.spec ?? null;

  const out = useMemo(() => {
    if (!spec) return null;
    const master = strategyFor(v, spec.genre);
    const trial = strategyFor(v, spec.genre, overrides);
    const mc = compileSpec(state, spec, master);
    const ec = compileSpec(state, spec, trial, instructions);
    return { master, mc, ec, diff: diffWords(mc.prompt, ec.prompt), findings: lint(spec, ec), changed: mc.prompt !== ec.prompt };
  }, [spec, overrides, instructions, state, v]);

  const est = spec ? renderEstimate(state, spec) : null;
  const techniques = Object.entries(overrides).map(([k, val]) => techniqueLabel(`${k}=${val}`));

  const save = async () => {
    if (!sc) return;
    if (!Object.keys(overrides).length && !instructions.trim()) return setErr("Change at least one knob or add an instruction — otherwise the experiment is the master.");
    if (!hypothesis.trim()) return setErr("Write the hypothesis first: what should this change improve, and why.");
    setErr(null);
    const res = await onCreate({
      name: name.trim() || `${genreName(sc.spec.genre)}: ${techniques.join(" + ") || "extra instruction"}`,
      hypothesis: hypothesis.trim(),
      intendedImprovement: "",
      overrides,
      instructions: instructions.trim(),
      targets: [],
      scenarioIds: [sc.id],
    });
    if (res) {
      setHypothesis("");
      setName("");
    }
  };

  const sum = out ? lintSummary(out.findings) : null;

  return (
    <section className="panel" data-standout="live-compiler" style={{ borderColor: "var(--cyan-line)" }}>
      <div className="panel-head">
        <FlaskConical size={15} style={{ color: "var(--cyan)" }} />
        <h2>Live compiler</h2>
        <span className="muted" style={{ fontSize: 11.5 }}>Flip a knob — the experiment prompt re-compiles and the diff against the master updates as you click.</span>
        <span className="grow" />
        <select className="in" style={{ width: "auto", minWidth: 220 }} value={scenarioId ?? ""} onChange={(e) => onScenario(e.target.value)} aria-label="Scenario">
          {!state.scenarios.length ? <option value="">No scenarios</option> : null}
          {state.scenarios.map((s) => (
            <option key={s.id} value={s.id}>{s.title} · {genreName(s.spec.genre)}</option>
          ))}
        </select>
      </div>
      <div className="panel-body">
        {!spec || !out ? (
          <Empty title="No scenario to compile.">
            The compiler needs a scene to write.{" "}
            <button type="button" className="btn sm" onClick={onNewScenario}><Plus size={12} /> New scenario</button>
          </Empty>
        ) : (
          <div className="grid" style={{ gap: 14 }}>
            <div className="rs-split" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 520px), 1fr))" }}>
              <div>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                  <span className="eyebrow">Switchboard · {genreName(spec.genre)} master marked <i className="master-dot" style={{ display: "inline-block", width: 6, height: 6, borderRadius: 9, background: "var(--amber)" }} /></span>
                  <div className="row" style={{ gap: 6 }}>
                    {selected && Object.keys(selected.overrides).length ? (
                      <button type="button" className="btn sm" onClick={() => { setOverrides({ ...selected.overrides }); setInstructions(selected.instructions); }}>
                        Load {selected.code}
                      </button>
                    ) : null}
                    <button type="button" className="btn sm ghost" onClick={() => { setOverrides({}); setInstructions(""); setErr(null); }}>
                      <RotateCcw size={12} /> Reset to master
                    </button>
                  </div>
                </div>
                <KnobBoard id="live" master={out.master} overrides={overrides} onChange={setOverrides} />
                <label className="field" style={{ marginTop: 10 }}>
                  <span>Extra instruction (experiment only)</span>
                  <input className="in" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Appended to the closing block" />
                </label>
              </div>

              <div className="grid" style={{ gap: 10, alignContent: "start" }}>
                <div className="rs-live-stats mono">
                  <span>mode <b>{out.ec.mode}</b></span>
                  <span>frames <b>{framesFor(spec.durationSec)}</b> @24</span>
                  <span>master <b>{out.mc.chars}</b> ch / <b>{out.mc.words}</b> w</span>
                  <span style={{ color: "var(--cyan)" }}>experiment <b style={{ color: "var(--cyan)" }}>{out.ec.chars}</b> ch / <b style={{ color: "var(--cyan)" }}>{out.ec.words}</b> w</span>
                  <span>Δ <b>{out.ec.chars - out.mc.chars >= 0 ? "+" : ""}{out.ec.chars - out.mc.chars}</b> ch</span>
                </div>
                <div className="rs-lint" aria-live="polite">
                  {out.findings.length ? (
                    out.findings.map((x) => (
                      <div key={x.code + x.message}>
                        <Chip tone={x.level === "error" ? "bad" : x.level === "warn" ? "warn" : undefined}>{x.level}</Chip>
                        <span className="dim">{x.message}</span>
                      </div>
                    ))
                  ) : (
                    <span className="muted">Pre-render checks: clean.</span>
                  )}
                  {sum && (sum.errors || sum.warnings) ? <span className="muted mono" style={{ fontSize: 11 }}>{sum.errors} error{sum.errors === 1 ? "" : "s"} · {sum.warnings} warning{sum.warnings === 1 ? "" : "s"}</span> : null}
                </div>
                <label className="field"><span>Name (optional)</span><input className="in" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${genreName(spec.genre)}: ${techniques.join(" + ") || "…"}`} /></label>
                <label className="field"><span>Hypothesis</span><textarea className="in" style={{ minHeight: 56 }} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="What this change should improve, and why" /></label>
                {err ? <div className="notice bad">{err}</div> : null}
                <div className="row">
                  <button type="button" className="btn exp" onClick={() => void save()}><Save size={13} /> Save as new experiment</button>
                  <button type="button" className="btn" onClick={() => void lab.act({ action: "render.single", spec, strategy: overrides }, "Test render queued")}>
                    <Play size={13} /> Render once
                  </button>
                </div>
                {instructions.trim() ? <span style={{ fontSize: 11.5, color: "var(--warn)" }}>Render once sends the knob settings only; the extra instruction renders once it is saved as an experiment and queued.</span> : null}
                {est ? <span className="muted" style={{ fontSize: 11.5 }}>One render ≈ <span className="mono">{fmtMinutes(est.minutes)}</span> ({est.basis}).</span> : null}
              </div>
            </div>

            <div className="rs-split" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))" }}>
              <div>
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="lamp amber" />
                  <span className="eyebrow" style={{ color: "var(--amber)" }}>Master · guide v{v.version}</span>
                </div>
                <pre className="prompt" style={{ borderTop: "2px solid var(--amber)" }}>{out.mc.prompt}</pre>
              </div>
              <div>
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="lamp" style={{ background: "var(--cyan)" }} />
                  <span className="eyebrow" style={{ color: "var(--cyan)" }}>Experiment {out.changed ? "· added in cyan, removed struck" : "· identical to master"}</span>
                </div>
                <pre className="prompt" style={{ borderTop: "2px solid var(--cyan)" }} dangerouslySetInnerHTML={{ __html: out.diff }} />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ----- scenarios --------------------------------------------------------------------------

function Scenarios({
  state,
  lab,
  edit,
  setEdit,
  onCompile,
}: {
  state: LabState;
  lab: SectionProps["lab"];
  edit: { id?: string; title: string; spec: ShotSpec } | null;
  setEdit: (e: { id?: string; title: string; spec: ShotSpec } | null) => void;
  onCompile: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const usedBy = (id: string) => state.experiments.filter((e) => e.scenarioIds.includes(id)).map((e) => e.code);

  const save = async () => {
    if (!edit) return;
    const title = edit.title.trim() || edit.spec.title.trim();
    if (!title) return setErr("Give the scenario a title.");
    if (!edit.spec.action.trim()) return setErr("Write the action — a scenario where nothing changes renders as a still photograph.");
    setErr(null);
    const r = await lab.act({ action: "scenario.save", scenario: { id: edit.id, title, spec: { ...edit.spec, title: edit.spec.title || title } } }, "Scenario saved");
    if (r) setEdit(null);
  };

  return (
    <div className="grid" style={{ gap: 14 }}>
      <Panel
        title="Scenarios"
        meta={`${state.scenarios.length} · the controlled scenes every experiment renders`}
        actions={<button type="button" className="btn sm" onClick={() => setEdit({ title: "", spec: blankSpec() })}><Plus size={12} /> New scenario</button>}
        bodyClass="tbl-wrap"
      >
        {state.scenarios.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Genre</th>
                <th className="hide-sm">Length</th>
                <th className="hide-sm">Camera</th>
                <th className="hide-sm">Cast</th>
                <th className="hide-sm">Used by</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.scenarios.map((s) => (
                <tr key={s.id}>
                  <td>{s.title}</td>
                  <td className="dim">{genreName(s.spec.genre)}</td>
                  <td className="hide-sm mono">{s.spec.durationSec}s</td>
                  <td className="hide-sm mono" style={{ fontSize: 11.5 }}>{s.spec.camera.move} · {s.spec.camera.amount} · {s.spec.camera.speed}</td>
                  <td className="hide-sm dim">{s.spec.characterIds.map((id) => state.characters.find((c) => c.id === id)?.name ?? id).join(", ") || "—"}</td>
                  <td className="hide-sm"><span className="rs-pill-list">{usedBy(s.id).map((c) => <Chip key={c} tone="cyan">{c}</Chip>)}</span></td>
                  <td><Chip tone={s.source === "agent" ? "cyan" : undefined}>{s.source}</Chip></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn ghost sm" onClick={() => onCompile(s.id)} title="Open in the Live compiler"><FlaskConical size={12} /></button>
                    <button type="button" className="btn ghost sm" onClick={() => setEdit({ id: s.id, title: s.title, spec: { ...s.spec, camera: { ...s.spec.camera }, beats: [...s.spec.beats], dialogue: s.spec.dialogue.map((d) => ({ ...d })), characterIds: [...s.spec.characterIds], intentionalChanges: [...s.spec.intentionalChanges] } })} aria-label={`Edit ${s.title}`}><Pencil size={12} /></button>
                    {confirm === s.id ? (
                      <>
                        <button type="button" className="btn danger sm" onClick={() => { setConfirm(null); void lab.act({ action: "scenario.delete", id: s.id }, "Scenario deleted"); }}>Delete</button>
                        <button type="button" className="btn ghost sm" onClick={() => setConfirm(null)}>Keep</button>
                      </>
                    ) : (
                      <button type="button" className="btn ghost sm" onClick={() => setConfirm(s.id)} aria-label={`Delete ${s.title}`}><Trash2 size={12} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="panel-body">
            <Empty title="No scenarios yet.">A scenario is the fixed scene both arms render. Create one with New scenario.</Empty>
          </div>
        )}
      </Panel>

      {edit ? (
        <Panel
          title={edit.id ? `Edit scenario · ${edit.title}` : "New scenario"}
          actions={<button type="button" className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button>}
        >
          <div className="grid" style={{ gap: 12 }}>
            <label className="field">
              <span>Scenario title (how the lab lists it)</span>
              <input className="in" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Garage: the first exchange" />
            </label>
            <ShotSpecEditor value={edit.spec} onChange={(spec) => setEdit({ ...edit, spec })} characters={state.characters} environments={state.environments} />
            {err ? <div className="notice bad">{err}</div> : null}
            <div className="row">
              <button type="button" className="btn primary" onClick={() => void save()}><Save size={13} /> Save scenario</button>
              <button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
