"use client";

// Experiment Comparisons — technique leaderboard (ranked by the lower bound of
// the 90% interval), the pair viewer (master vs experiment, frame for frame,
// dimension by dimension) and the old skill-films ledger kept intact below.

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight, Film, Save } from "lucide-react";
import type { SectionProps } from "../sections";
import { Chip, Delta, Empty, Panel, ScoreBar, ScoreSource, SectionHead, StatusChip, clipUrl, diffWords, useFrames, when } from "../ui";
import type { Dimension, Generation, LabState } from "@/lib/h3-lab/model";
import { DIMENSIONS, DIMENSION_LABEL } from "@/lib/h3-lab/model";
import { allStats } from "@/lib/h3-lab/state";
import { discoveries, overallScore, pairsOf, type Pair, type TechniqueStat } from "@/lib/h3-lab/score";
import { knobDef, parseTechnique, techniqueLabel } from "@/lib/h3-lab/strategy";
import { genreName } from "@/lib/h3-lab/genres";
import { ISSUE_LABEL } from "@/lib/h3-lab/inspect";
import { H3Lab } from "@/components/h3-lab/H3Lab";
import { ResearchStyles } from "../research/ResearchStyles";
import { generationTitle } from "../research/helpers";

export default function Comparisons({ lab, go, focus }: SectionProps) {
  const state = lab.state;
  const pairs = useMemo(() => pairsOf(state.generations), [state.generations]);
  const [sel, setSel] = useState<string | null>(null);
  const [ledger, setLedger] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus) setSel(focus);
  }, [focus]);

  const open = (key: string) => {
    setSel(key);
    window.setTimeout(() => viewerRef.current?.scrollIntoView({ block: "start" }), 40);
  };

  // Resolve the selection: a pairKey, or a generation id (→ its pair when it has one).
  const target = useMemo((): { pair: Pair } | { single: Generation } | null => {
    if (!sel) return null;
    const p = pairs.find((x) => x.pairKey === sel);
    if (p) return { pair: p };
    const g = state.generations.find((x) => x.id === sel);
    if (!g) {
      // A pair key whose renders are not both scored yet: show what exists.
      const any = state.generations.filter((x) => x.pairKey === sel);
      const exp = any.find((x) => x.arm === "experiment") ?? any[0];
      return exp ? { single: exp } : null;
    }
    const gp = pairs.find((x) => x.pairKey === g.pairKey);
    return gp ? { pair: gp } : { single: g };
  }, [sel, pairs, state.generations]);

  const singles = useMemo(
    () => state.generations.filter((g) => g.status === "done" && !pairs.some((p) => p.pairKey === g.pairKey)).slice(-60).reverse(),
    [state.generations, pairs],
  );

  return (
    <div className="grid rs-root" style={{ gap: 16 }}>
      <ResearchStyles />
      <SectionHead
        eyebrow="Research · Experiment Comparisons"
        title="Experiment Comparisons"
        lede="Every result here is a paired comparison: the master and an experiment rendered from the same scenario with the same seed. The leaderboard credits each difference to the technique that caused it."
      />

      <Leaderboard state={state} onOpen={open} />

      <div ref={viewerRef}>
        <Panel
          title="Pair viewer"
          meta={`${pairs.length} scored pair${pairs.length === 1 ? "" : "s"}`}
          actions={
            <div className="row" style={{ gap: 6 }}>
              <select className="in" style={{ width: "auto", minWidth: 200 }} value={target && "pair" in target ? target.pair.pairKey : ""} onChange={(e) => e.target.value && setSel(e.target.value)} aria-label="Pick a pair">
                <option value="">{pairs.length ? "Pick a pair…" : "No scored pairs yet"}</option>
                {pairs.map((p) => {
                  const e = state.experiments.find((x) => x.id === p.experimentId);
                  return (
                    <option key={p.pairKey} value={p.pairKey}>
                      {e?.code ?? "?"} · {generationTitle(state, p.experiment)} · {genreName(p.genre)}
                    </option>
                  );
                })}
              </select>
              {singles.length ? (
                <select className="in" style={{ width: "auto", minWidth: 160 }} value={target && "single" in target ? target.single.id : ""} onChange={(e) => e.target.value && setSel(e.target.value)} aria-label="Pick a single render">
                  <option value="">Single render…</option>
                  {singles.map((g) => (
                    <option key={g.id} value={g.id}>{generationTitle(state, g)} · {when(g.finishedAt)}</option>
                  ))}
                </select>
              ) : null}
            </div>
          }
        >
          {!target ? (
            <Empty title={pairs.length || singles.length ? "Pick a pair or a render to open it." : "Nothing rendered and scored yet."}>
              {pairs.length || singles.length
                ? "Master on the left in amber, experiment on the right in cyan — frames aligned so frame N sits above frame N."
                : (
                  <>
                    Pairs appear once an experiment's master and experiment renders are both done and scored.{" "}
                    <button type="button" className="btn sm" onClick={() => go("lab")}>Open Experiment Lab</button>
                  </>
                )}
            </Empty>
          ) : "pair" in target ? (
            <PairView key={target.pair.pairKey} pair={target.pair} lab={lab} go={go} />
          ) : (
            <SingleView key={target.single.id} g={target.single} lab={lab} go={go} />
          )}
        </Panel>
      </div>

      <Panel
        title={<span className="row" style={{ gap: 8 }}><Film size={14} /> Skill films ledger (before the lab)</span>}
        meta="the original method-by-method ledger, kept as it was"
        actions={
          <button type="button" className="btn sm" aria-expanded={ledger} onClick={() => setLedger((o) => !o)}>
            {ledger ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {ledger ? "Close" : "Open"}
          </button>
        }
        bodyClass=""
      >
        {ledger ? (
          <div className="ledger-host">
            <H3Lab />
          </div>
        ) : (
          <p className="muted" style={{ margin: 0, padding: "10px 14px" }}>
            Skill × brief runs rendered before the lab existed, with their verdicts and defect tags.
          </p>
        )}
      </Panel>
    </div>
  );
}

// ----- leaderboard -----------------------------------------------------------------

function IntervalBar({ s, span }: { s: TechniqueStat; span: number }) {
  const W = 150;
  const H = 16;
  const x = (v: number) => ((v + span) / (2 * span)) * W;
  const tone = s.ciLo > 0 ? "var(--good)" : s.ciHi < 0 ? "var(--bad)" : "var(--ink-3)";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`90% interval ${s.ciLo.toFixed(2)} to ${s.ciHi.toFixed(2)}, effect ${s.effect.toFixed(2)}`}>
      <line x1={x(0)} x2={x(0)} y1={1} y2={H - 1} stroke="var(--ink-4)" strokeDasharray="2 2" />
      <line x1={x(s.ciLo)} x2={x(s.ciHi)} y1={H / 2} y2={H / 2} stroke={tone} strokeWidth={2} strokeLinecap="round" />
      <line x1={x(s.ciLo)} x2={x(s.ciLo)} y1={H / 2 - 4} y2={H / 2 + 4} stroke={tone} strokeWidth={1.5} />
      <line x1={x(s.ciHi)} x2={x(s.ciHi)} y1={H / 2 - 4} y2={H / 2 + 4} stroke={tone} strokeWidth={1.5} />
      <circle cx={x(s.effect)} cy={H / 2} r={3} fill={tone} />
    </svg>
  );
}

function Leaderboard({ state, onOpen }: { state: LabState; onOpen: (pairKey: string) => void }) {
  const stats = useMemo(() => allStats(state), [state]);
  const [genre, setGenre] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const rows = genre === "all" ? stats.overall : stats.byGenre.get(genre) ?? [];
  const found = new Set(discoveries(rows, state.agent.minPairs, state.agent.minLowerBound).map((d) => d.technique));
  const span = Math.max(1, ...rows.flatMap((r) => [Math.abs(r.ciLo), Math.abs(r.ciHi)])) * 1.05;
  const genres = [...stats.byGenre.keys()];

  return (
    <Panel
      title="Technique leaderboard"
      meta="genre-weighted overall score, judged pairs only"
      actions={
        <select className="in" style={{ width: "auto" }} value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre">
          <option value="all">All genres</option>
          {genres.map((g) => <option key={g} value={g}>{genreName(g)}</option>)}
        </select>
      }
      bodyClass="tbl-wrap"
    >
      <p className="muted" style={{ margin: 0, padding: "10px 14px 0", fontSize: 12 }}>
        Ranked by the lower bound of the 90% interval — one lucky render cannot top this table. A technique becomes a discovery at n ≥ {state.agent.minPairs} with the lower bound above {state.agent.minLowerBound}.
      </p>
      {rows.length ? (
        <table className="tbl" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Technique</th>
              <th className="hide-sm">Knob</th>
              <th className="hide-sm">Genre</th>
              <th>n</th>
              <th>Effect</th>
              <th>90% interval</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const t = parseTechnique(s.technique);
              const key = `${s.genre}|${s.technique}`;
              const isOpen = open === key;
              return (
                <Fragment key={key}>
                  <tr className="clickable" onClick={() => setOpen(isOpen ? null : key)}>
                    <td className="mono muted">{i + 1}</td>
                    <td>{techniqueLabel(s.technique).split(": ")[1] ?? s.technique}</td>
                    <td className="hide-sm dim">{t ? knobDef(t.knob).label : "—"}</td>
                    <td className="hide-sm dim">{s.genre === "all" ? "all" : genreName(s.genre)}</td>
                    <td className="mono">{s.n}</td>
                    <td><Delta value={s.effect} digits={2} /></td>
                    <td>
                      <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <IntervalBar s={s} span={span} />
                        <span className="mono muted hide-sm" style={{ fontSize: 11 }}>{s.ciLo.toFixed(2)}..{s.ciHi.toFixed(2)}</span>
                      </span>
                    </td>
                    <td>{found.has(s.technique) ? <Chip tone="good">discovery</Chip> : null}</td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td />
                      <td colSpan={7}>
                        <span className="eyebrow">Pairs credited ({s.pairKeys.length})</span>
                        <div className="rs-pill-list" style={{ marginTop: 6 }}>
                          {s.pairKeys.map((k) => {
                            const exp = state.experiments.find((e) => e.id === k.split(":")[0]);
                            const sc = state.scenarios.find((x) => x.id === k.split(":")[1]);
                            return (
                              <button key={k} type="button" className="btn sm" onClick={() => onOpen(k)}>
                                {exp?.code ?? "?"} · {sc?.title ?? "scenario"} <ArrowUpRight size={11} />
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="panel-body">
          <Empty title="No technique has paired, judged evidence yet.">
            The table fills once both renders of a pair are finished and judged. Each pair credits its delta to the knobs that differed.
          </Empty>
        </div>
      )}
    </Panel>
  );
}

// ----- pair view ------------------------------------------------------------------

function Video({ g }: { g: Generation }) {
  if (g.status !== "done") return <div className="rs-video" style={{ display: "grid", placeItems: "center" }}><StatusChip status={g.status} /></div>;
  if (g.clip && !g.clip.key && g.clip.localPath) {
    return (
      <div className="rs-video" style={{ display: "grid", placeItems: "center", padding: 12, textAlign: "center" }}>
        <span className="dim">Clip stored on the PC only<br /><span className="mono muted" style={{ fontSize: 10.5, wordBreak: "break-all" }}>{g.clip.localPath}</span></span>
      </div>
    );
  }
  return <video className="rs-video" src={clipUrl(g.id)} controls muted playsInline preload="metadata" />;
}

function ArmHead({ g, label, tone }: { g: Generation; label: string; tone: "amber" | "cyan" }) {
  const o = g.overall ?? (g.scores ? overallScore(g.scores, g.genre) : null);
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <span className="row" style={{ gap: 8 }}>
        <span className="eyebrow" style={{ color: `var(--${tone})` }}>{label}</span>
        <span className="mono muted" style={{ fontSize: 11 }}>v{g.guideVersion} · seed {g.seed}{g.renderSeconds ? ` · ${(g.renderSeconds / 60).toFixed(1)} min` : ""}</span>
      </span>
      <ScoreBar value={o} width={70} />
    </div>
  );
}

function FrameRows({ a, b, labelA = "Master", toneA = "var(--amber)" }: { a: Generation; b: Generation | null; labelA?: string; toneA?: string }) {
  const fa = useFrames(a.id, a.frameCount);
  const fb = useFrames(b?.id, b?.frameCount);
  const n = Math.max(fa.length, fb.length);
  if (!n) return <p className="muted" style={{ margin: 0 }}>No judging frames stored for {b ? "these renders" : "this render"}.</p>;
  const ta = a.metrics?.sampleTimes ?? [];
  const tb = b?.metrics?.sampleTimes ?? [];
  const cols = `64px repeat(${n}, 132px)`;
  const row = (label: string, tone: string, frames: string[], times: number[]) => (
    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6, alignItems: "center" }}>
      <span className="eyebrow" style={{ color: tone }}>{label}</span>
      {Array.from({ length: n }, (_, i) =>
        frames[i] ? (
          <div className="rs-frame" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={frames[i]} alt={`${label} frame ${i + 1}`} loading="lazy" />
            {times[i] !== undefined ? <span className="tc">{times[i].toFixed(1)}s</span> : null}
          </div>
        ) : (
          <span key={i} />
        ),
      )}
    </div>
  );
  return (
    <div style={{ overflowX: "auto", display: "grid", gap: 6, paddingBottom: 4 }}>
      {row(labelA, toneA, fa, ta)}
      {b ? row("Exp", "var(--cyan)", fb, tb) : null}
    </div>
  );
}

function Wipe({ a, b }: { a: Generation; b: Generation }) {
  const fa = useFrames(a.id, a.frameCount);
  const fb = useFrames(b.id, b.frameCount);
  const n = Math.min(fa.length, fb.length);
  const [idx, setIdx] = useState(0);
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  if (!n) return null;
  const i = Math.min(idx, n - 1);
  const fromEvent = (e: PointerEvent<HTMLDivElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setPos(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - step));
    else if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + step));
    else if (e.key === "Home") setPos(0);
    else if (e.key === "End") setPos(100);
    else return;
    e.preventDefault();
  };
  const t = a.metrics?.sampleTimes?.[i];
  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="eyebrow">Wipe · frame {i + 1} of {n}{t !== undefined ? ` · ${t.toFixed(1)}s` : ""}</span>
        <input type="range" min={0} max={n - 1} value={i} onChange={(e) => setIdx(Number(e.target.value))} aria-label="Frame to wipe" style={{ accentColor: "var(--amber)", width: 200 }} />
      </div>
      <div
        ref={box}
        className="rs-wipe"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromEvent(e);
        }}
        onPointerMove={(e) => dragging.current && fromEvent(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fb[i]} alt="Experiment frame" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fa[i]} alt="Master frame" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
        <span className="tag" style={{ left: 8, color: "var(--amber)" }}>Master</span>
        <span className="tag" style={{ right: 8, color: "var(--cyan)" }}>Experiment</span>
        <div
          className="handle"
          style={{ left: `${pos}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Wipe divider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          onKeyDown={onKey}
        />
      </div>
    </div>
  );
}

function Issues({ g }: { g: Generation }) {
  if (!g.issues) return <span className="muted">Not inspected.</span>;
  if (!g.issues.length) return <span className="muted">No continuity issues flagged.</span>;
  return (
    <div className="grid" style={{ gap: 6 }}>
      {g.issues.map((x, i) => (
        <div className="rs-issue" data-sev={x.severity} key={i}>
          <span className="row" style={{ gap: 6 }}>
            <b style={{ fontWeight: 500 }}>{ISSUE_LABEL[x.kind]}</b>
            <Chip tone={x.severity === "high" ? "bad" : x.severity === "medium" ? "warn" : undefined}>{x.severity}</Chip>
            <Chip tone={x.source === "vision" ? "cyan" : undefined}>{x.source}</Chip>
            {x.at !== null ? <span className="mono muted" style={{ fontSize: 11 }}>{x.at.toFixed(1)}s</span> : null}
          </span>
          <span className="dim" style={{ fontSize: 12 }}>{x.evidence}</span>
        </div>
      ))}
    </div>
  );
}

function RateBox({ g, lab }: { g: Generation; lab: SectionProps["lab"] }) {
  const [verdict, setVerdict] = useState<"good" | "mixed" | "bad" | null>(g.ownerVerdict ?? null);
  const [note, setNote] = useState(g.ownerNote ?? "");
  const [scores, setScores] = useState<Partial<Record<Dimension, string>>>(() => {
    const o: Partial<Record<Dimension, string>> = {};
    for (const d of DIMENSIONS) if (g.scores?.[d]?.source === "owner") o[d] = String(g.scores[d]!.value);
    return o;
  });
  const [more, setMore] = useState(false);
  const save = () => {
    const parsed: Partial<Record<Dimension, number>> = {};
    for (const [d, v] of Object.entries(scores)) {
      if (v === undefined || v.trim() === "") continue;
      const n = Number(v);
      if (Number.isFinite(n)) parsed[d as Dimension] = Math.max(0, Math.min(10, n));
    }
    void lab.act({ action: "generation.rate", id: g.id, verdict, note, scores: Object.keys(parsed).length ? parsed : undefined }, "Rating saved");
  };
  return (
    <div className="grid" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <span className="eyebrow">Your rating — overrides the judge</span>
      <div className="row" style={{ gap: 6 }}>
        {(["good", "mixed", "bad"] as const).map((v) => (
          <button key={v} type="button" className={`btn sm ${verdict === v ? (v === "good" ? "primary" : v === "bad" ? "danger" : "exp") : ""}`} aria-pressed={verdict === v} onClick={() => setVerdict(verdict === v ? null : v)}>
            {v}
          </button>
        ))}
      </div>
      <textarea className="in" style={{ minHeight: 48 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you saw" aria-label="Note" />
      <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setMore((m) => !m)} aria-expanded={more}>
        {more ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Score dimensions yourself (0–10)
      </button>
      {more ? (
        <div className="rs-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))" }}>
          {DIMENSIONS.map((d) => (
            <label className="field" key={d}>
              <span>{DIMENSION_LABEL[d]}</span>
              <input className="in mono" type="number" min={0} max={10} step={0.5} value={scores[d] ?? ""} onChange={(e) => setScores({ ...scores, [d]: e.target.value })} placeholder={g.scores?.[d] ? g.scores[d]!.value.toFixed(1) : "—"} />
            </label>
          ))}
        </div>
      ) : null}
      <button type="button" className="btn sm" style={{ justifySelf: "start" }} onClick={save}><Save size={12} /> Save rating</button>
    </div>
  );
}

function DimTable({ a, b }: { a: Generation; b: Generation | null }) {
  const dims = DIMENSIONS.filter((d) => a.scores?.[d] || b?.scores?.[d]);
  if (!dims.length) return <p className="muted" style={{ margin: 0 }}>Not scored yet.</p>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Dimension</th>
            <th>{b ? "Master" : "Score"}</th>
            {b ? <th>Experiment</th> : null}
            {b ? <th>Δ</th> : null}
            <th className="hide-sm">Source</th>
          </tr>
        </thead>
        <tbody>
          {dims.map((d) => {
            const sa = a.scores?.[d];
            const sb = b?.scores?.[d];
            return (
              <tr key={d}>
                <td className="dim">{DIMENSION_LABEL[d]}</td>
                <td title={sa?.evidence}><ScoreBar value={sa?.value} width={56} /></td>
                {b ? <td title={sb?.evidence}><ScoreBar value={sb?.value} width={56} /></td> : null}
                {b ? <td><Delta value={sa && sb ? sb.value - sa.value : null} /></td> : null}
                <td className="hide-sm"><span className="row" style={{ gap: 4 }}><ScoreSource s={sa} />{b ? <ScoreSource s={sb} /> : null}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PairView({ pair, lab, go }: { pair: Pair; lab: SectionProps["lab"]; go: SectionProps["go"] }) {
  const state = lab.state;
  const m = state.generations.find((g) => g.id === pair.master.id) ?? pair.master;
  const x = state.generations.find((g) => g.id === pair.experiment.id) ?? pair.experiment;
  const exp = state.experiments.find((e) => e.id === pair.experimentId);
  const diff = useMemo(() => diffWords(m.prompt, x.prompt), [m.prompt, x.prompt]);
  const a = overallScore(m.scores ?? {}, pair.genre);
  const b = overallScore(x.scores ?? {}, pair.genre);
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="row" style={{ gap: 8 }}>
          <span className="serif" style={{ fontSize: 22 }}>{generationTitle(state, x)}</span>
          <Chip>{genreName(pair.genre)}</Chip>
          {exp ? (
            <button type="button" className="btn sm exp" onClick={() => go("lab", exp.id)}>{exp.code} · {exp.name} <ArrowUpRight size={11} /></button>
          ) : null}
        </span>
        <span className="row" style={{ gap: 8 }}>
          <span className="muted">overall</span> <Delta value={a !== null && b !== null ? b - a : null} digits={2} />
        </span>
      </div>
      <div className="rs-pill-list">{pair.techniques.map((t) => <Chip key={t} tone="cyan">{techniqueLabel(t)}</Chip>)}</div>

      <div className="rs-split">
        <div className="grid rs-arm" style={{ gap: 8, paddingTop: 8 }}>
          <ArmHead g={m} label="Master" tone="amber" />
          <Video g={m} />
        </div>
        <div className="grid rs-arm exp" style={{ gap: 8, paddingTop: 8 }}>
          <ArmHead g={x} label="Experiment" tone="cyan" />
          <Video g={x} />
        </div>
      </div>

      <div className="grid" style={{ gap: 6 }}>
        <span className="eyebrow">Judging frames, aligned by sample</span>
        <FrameRows a={m} b={x} />
      </div>

      <Wipe a={m} b={x} />

      <DimTable a={m} b={x} />

      <div className="rs-split">
        <div className="grid" style={{ gap: 8 }}>
          <span className="eyebrow" style={{ color: "var(--amber)" }}>Master issues</span>
          <Issues g={m} />
          {m.judgeSummary ? <p className="dim" style={{ margin: 0, fontSize: 12 }}>Judge ({m.judgedBy}): {m.judgeSummary}</p> : null}
          <RateBox g={m} lab={lab} />
        </div>
        <div className="grid" style={{ gap: 8 }}>
          <span className="eyebrow" style={{ color: "var(--cyan)" }}>Experiment issues</span>
          <Issues g={x} />
          {x.judgeSummary ? <p className="dim" style={{ margin: 0, fontSize: 12 }}>Judge ({x.judgedBy}): {x.judgeSummary}</p> : null}
          <RateBox g={x} lab={lab} />
        </div>
      </div>

      <div className="rs-split">
        <div>
          <span className="eyebrow" style={{ color: "var(--amber)" }}>Master prompt</span>
          <pre className="prompt" style={{ marginTop: 6 }}>{m.prompt}</pre>
        </div>
        <div>
          <span className="eyebrow" style={{ color: "var(--cyan)" }}>Experiment prompt · diff against master</span>
          <pre className="prompt" style={{ marginTop: 6 }} dangerouslySetInnerHTML={{ __html: diff }} />
        </div>
      </div>
      {(m.issues?.length || x.issues?.length) ? (
        <button type="button" className="btn sm" style={{ justifySelf: "start" }} onClick={() => go("inspector", x.issues?.length ? x.id : m.id)}>Open in Continuity Inspector <ArrowUpRight size={11} /></button>
      ) : null}
    </div>
  );
}

function SingleView({ g, lab, go }: { g: Generation; lab: SectionProps["lab"]; go: SectionProps["go"] }) {
  const state = lab.state;
  const live = state.generations.find((x) => x.id === g.id) ?? g;
  const exp = live.experimentId ? state.experiments.find((e) => e.id === live.experimentId) : null;
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="row" style={{ gap: 8 }}>
          <span className="serif" style={{ fontSize: 22 }}>{generationTitle(state, live)}</span>
          <Chip>{genreName(live.genre)}</Chip>
          <Chip tone={live.arm === "experiment" ? "cyan" : "amber"}>{live.arm}</Chip>
          <StatusChip status={live.status} />
          {exp ? <button type="button" className="btn sm exp" onClick={() => go("lab", exp.id)}>{exp.code} <ArrowUpRight size={11} /></button> : null}
        </span>
        {live.productionId ? <button type="button" className="btn sm" onClick={() => go("productions", live.productionId)}>Production <ArrowUpRight size={11} /></button> : null}
      </div>
      <p className="muted" style={{ margin: 0 }}>A single render with no scored partner — no pair to compare against.</p>
      <div className="rs-split">
        <div className="grid rs-arm" style={{ gap: 8, paddingTop: 8, borderTopColor: live.arm === "experiment" ? "var(--cyan)" : "var(--amber)" }}>
          <ArmHead g={live} label={live.arm === "experiment" ? "Experiment" : "Master"} tone={live.arm === "experiment" ? "cyan" : "amber"} />
          <Video g={live} />
        </div>
        <div className="grid" style={{ gap: 8 }}>
          <DimTable a={live} b={null} />
          <Issues g={live} />
          {live.judgeSummary ? <p className="dim" style={{ margin: 0, fontSize: 12 }}>Judge ({live.judgedBy}): {live.judgeSummary}</p> : null}
          <RateBox g={live} lab={lab} />
        </div>
      </div>
      <FrameRows a={live} b={null} labelA={live.arm === "experiment" ? "Exp" : "Master"} toneA={live.arm === "experiment" ? "var(--cyan)" : "var(--amber)"} />
      <div>
        <span className="eyebrow">Prompt</span>
        <pre className="prompt" style={{ marginTop: 6 }}>{live.prompt}</pre>
      </div>
    </div>
  );
}
