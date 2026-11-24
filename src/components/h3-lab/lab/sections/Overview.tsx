"use client";

// Overview — the dashboard. Everything here is computed from lab.state; when a
// panel has nothing to show yet it says what will fill it and how to start it.

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Pause, Play, Square, StepForward } from "lucide-react";
import type { ActivityEntry, Generation, LabState } from "@/lib/h3-lab/model";
import { DIMENSION_LABEL } from "@/lib/h3-lab/model";
import { currentVersion, strategyFor } from "@/lib/h3-lab/guide";
import { techniqueLabel, parseTechnique } from "@/lib/h3-lab/strategy";
import { genreName } from "@/lib/h3-lab/genres";
import { allStats } from "@/lib/h3-lab/state";
import { discoveries, weakestDimensions } from "@/lib/h3-lab/score";
import { nextStep } from "@/lib/h3-lab/agent";
import type { SectionId, SectionProps } from "../sections";
import { Chip, Empty, Panel, ScoreBar, SectionHead, StatusChip, ago, useFrames, when } from "../ui";

const ONLINE_MS = 90_000;

/** nextStep/rendersLeft roll the day counters in place — never let them touch React state. */
function detached(state: LabState): LabState {
  return { ...state, counters: { ...state.counters } };
}

function refTarget(ref: ActivityEntry["ref"]): { section: SectionId; focus?: string } | null {
  if (!ref) return null;
  switch (ref.type) {
    case "experiment":
      return { section: "lab", focus: ref.id };
    case "generation":
      return { section: "compare", focus: ref.id };
    case "change":
      return { section: "evolution", focus: ref.id };
    case "blueprint":
      return { section: "reverse", focus: ref.id };
    case "production":
      return { section: "productions", focus: ref.id };
    case "repo":
      return { section: "repos" };
    default:
      return null;
  }
}

export default function Overview({ lab, go }: SectionProps) {
  const s = lab.state;
  const cur = currentVersion(s.guide);
  const curChange = s.guide.changes.find((c) => c.id === cur.changeId);
  const nowIso = new Date().toISOString();

  const next = useMemo(() => nextStep(detached(s), new Date().toISOString()), [s]);

  const online = !!s.worker.lastSeen && Date.now() - Date.parse(s.worker.lastSeen) < ONLINE_MS;
  const h3State = !online ? "offline" : s.worker.wangp;

  const active = s.experiments.filter((e) => ["queued", "running", "evaluating"].includes(e.status)).length;
  const concluded = s.experiments.filter((e) => e.status === "concluded").length;
  const pendingEval = s.generations.filter((g) => g.status === "done" && !g.judgedAt).length;
  const pendingChanges = s.guide.changes.filter((c) => c.status === "pending");

  const found = useMemo(() => {
    const { byGenre } = allStats(s);
    const v = currentVersion(s.guide);
    const out: { genre: string; technique: string; effect: number; ciLo: number; ciHi: number; n: number; inGuide: boolean; confidence: string }[] = [];
    for (const [genre, stats] of byGenre) {
      for (const d of discoveries(stats, s.agent.minPairs, s.agent.minLowerBound)) {
        const t = parseTechnique(d.technique);
        const inGuide = !!t && strategyFor(v, genre)[t.knob] === t.value;
        out.push({ genre, technique: d.technique, effect: d.effect, ciLo: d.ciLo, ciHi: d.ciHi, n: d.n, inGuide, confidence: d.confidence });
      }
    }
    return out.sort((a, b) => b.ciLo - a.ciLo).slice(0, 8);
  }, [s]);

  const approved = s.guide.changes
    .filter((c) => c.status === "approved" && c.kind !== "seed")
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt))
    .slice(0, 5);

  const recent = s.generations
    .filter((g) => g.status === "done")
    .sort((a, b) => (b.finishedAt ?? b.queuedAt).localeCompare(a.finishedAt ?? a.queuedAt))
    .slice(0, 8);

  const weakest = useMemo(() => weakestDimensions(s.generations).slice(0, 3), [s.generations]);
  const activity = [...s.activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

  const today = nowIso.slice(0, 10);
  const rendersToday = s.counters.day === today ? s.counters.renders : 0;
  const aiToday = s.counters.day === today ? s.counters.aiCalls : 0;

  const mode = s.agent.mode;
  const busy = !!lab.busy;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <SectionHead
        eyebrow="H3 Prompt Lab · Overview"
        title="The guide, the agent and the evidence"
        lede="One Master Prompt Guide for MiniMax H3. Experiments test single techniques against it on the PC's WanGP; only evidence that clears the bar changes the guide."
      />

      <GuideFilmstrip s={s} go={go} pendingCount={pendingChanges.length} />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <Panel title="Master guide" actions={<button type="button" className="btn sm" onClick={() => go("guide")}>Open guide <ArrowRight size={13} /></button>}>
          <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
            <span className="serif" style={{ fontSize: 46, lineHeight: 1, color: "var(--amber)" }}>v{cur.version}</span>
            <span className="mono muted" style={{ fontSize: 11.5 }}>{when(cur.createdAt)}</span>
          </div>
          <p className="dim" style={{ margin: "10px 0 0" }}>{cur.summary}</p>
          {curChange && curChange.title !== cur.summary ? <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>{curChange.title}</p> : null}
          <div className="row" style={{ marginTop: 10 }}>
            {s.guide.publishedVersion === cur.version ? (
              <Chip tone="good">published to h3-prompt {ago(s.guide.publishedAt)}</Chip>
            ) : (
              <button type="button" className="btn sm ghost" onClick={() => go("skill")}>
                <Chip tone="warn">{s.guide.publishedVersion ? `skill has v${s.guide.publishedVersion}` : "not published yet"}</Chip>
              </button>
            )}
            {pendingChanges.length ? (
              <button type="button" className="btn sm ghost" onClick={() => go("evolution")}>
                <Chip tone="amber">{pendingChanges.length} pending change{pendingChanges.length === 1 ? "" : "s"}</Chip>
              </button>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Agent"
          meta={`${rendersToday}/${s.agent.rendersPerDay} renders · ${aiToday}/${s.agent.aiCallsPerDay} AI today`}
        >
          <div className="row" style={{ marginBottom: 10 }}>
            <span className={`lamp ${mode === "running" ? "on pulse" : mode === "paused" ? "amber" : "bad"}`} />
            <b style={{ textTransform: "capitalize" }}>{mode}</b>
            <span className="muted">· promotion {s.agent.promotion} · brain {s.agent.brain}</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {mode !== "running" ? (
              <button type="button" className="btn primary sm" disabled={busy} onClick={() => void lab.act({ action: "agent.control", mode: "running" }, "Start agent")}>
                <Play size={13} /> Start
              </button>
            ) : (
              <button type="button" className="btn sm" disabled={busy} onClick={() => void lab.act({ action: "agent.control", mode: "paused" }, "Pause agent")}>
                <Pause size={13} /> Pause
              </button>
            )}
            {mode !== "stopped" ? (
              <button type="button" className="btn danger sm" disabled={busy} onClick={() => void lab.act({ action: "agent.control", mode: "stopped" }, "Stop agent")}>
                <Square size={12} /> Stop
              </button>
            ) : null}
            <button type="button" className="btn exp sm" disabled={busy} onClick={() => void lab.act({ action: "agent.tick" }, "Run one step")}>
              <StepForward size={13} /> Run one step now
            </button>
          </div>
          <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <span className="eyebrow">Next step</span>
            <div className="row" style={{ marginTop: 4, gap: 8 }}>
              <Chip tone={next.kind === "idle" ? undefined : "cyan"}>{next.kind}</Chip>
              <span className="dim">{next.reason}</span>
            </div>
          </div>
        </Panel>

        <Panel title="H3 connection" actions={<button type="button" className="btn sm" onClick={() => go("connection")}>Diagnostics <ArrowRight size={13} /></button>}>
          <div className="row">
            <span className={`lamp ${h3State === "ready" ? "on" : h3State === "busy" ? "amber pulse" : "bad"}`} />
            <b>{h3State === "offline" ? "Worker offline" : `WanGP ${h3State}`}</b>
            <span className="muted mono" style={{ fontSize: 11.5 }}>seen {ago(s.worker.lastSeen)}</span>
          </div>
          <p className="dim" style={{ margin: "8px 0 0" }}>
            {!s.worker.lastSeen
              ? "No worker has checked in yet. Pair the PC worker on the Connection page; renders wait in the queue until it does."
              : !online
                ? "The PC worker has not checked in for over 90 seconds. Queued renders wait and resume when it returns."
                : s.worker.wangpDetail || `${s.worker.machine} · worker ${s.worker.version}`}
          </p>
          <div className="row mono" style={{ marginTop: 8, fontSize: 11.5 }}>
            <span className="muted">queue</span> {s.generations.filter((g) => g.status === "queued").length}
            <span className="muted">· rendering</span> {s.generations.filter((g) => g.status === "rendering" || g.status === "claimed").length}
          </div>
        </Panel>
      </div>

      <div className="panel" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <Counter label="Active experiments" value={active} hint="queued, running or evaluating" onClick={() => go("lab")} />
        <Counter label="Completed experiments" value={concluded} hint="concluded" onClick={() => go("lab")} />
        <Counter label="Pending evaluations" value={pendingEval} hint="finished renders not yet judged" onClick={() => go("compare")} />
        <Counter label="Pending guide changes" value={pendingChanges.length} hint="waiting for your decision" tone={pendingChanges.length ? "amber" : undefined} onClick={() => go("evolution")} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        <Panel title="Recently discovered techniques" meta={`bar: n ≥ ${s.agent.minPairs}, lower bound > ${s.agent.minLowerBound}`} bodyClass="tbl-wrap">
          {found.length ? (
            <table className="tbl">
              <thead>
                <tr><th>Technique</th><th>Genre</th><th>Effect</th><th>90% interval</th><th>n</th><th /></tr>
              </thead>
              <tbody>
                {found.map((d) => (
                  <tr key={`${d.genre}|${d.technique}`} className="clickable" onClick={() => go("compare")}>
                    <td>{techniqueLabel(d.technique)}</td>
                    <td className="dim">{genreName(d.genre)}</td>
                    <td className="mono" style={{ color: "var(--good)" }}>+{d.effect.toFixed(2)}</td>
                    <td className="mono dim">{d.ciLo.toFixed(2)} … {d.ciHi.toFixed(2)}</td>
                    <td className="mono">{d.n}</td>
                    <td>{d.inGuide ? <Chip tone="amber">in guide</Chip> : <Chip tone="cyan">{d.confidence}</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="panel-body">
              <Empty title="No technique has cleared the bar yet">
                A technique appears here once at least {s.agent.minPairs} judged master/experiment pairs show its 90% interval above +{s.agent.minLowerBound}.{" "}
                {mode !== "running" ? (
                  <button type="button" className="btn sm exp" style={{ marginTop: 8 }} onClick={() => void lab.act({ action: "agent.control", mode: "running" }, "Start agent")}>
                    <Play size={12} /> Start the agent
                  </button>
                ) : (
                  <span className="muted">The agent is running; results land as pairs are judged.</span>
                )}
              </Empty>
            </div>
          )}
        </Panel>

        <Panel title="Recently approved improvements" actions={<button type="button" className="btn sm ghost" onClick={() => go("evolution")}>History <ArrowRight size={13} /></button>} bodyClass="tbl-wrap">
          {approved.length ? (
            <table className="tbl">
              <thead>
                <tr><th>Version</th><th>Change</th><th>Kind</th><th>Decided</th></tr>
              </thead>
              <tbody>
                {approved.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => go("evolution", c.id)}>
                    <td><span className="serif" style={{ fontSize: 17, color: "var(--amber)" }}>v{c.version ?? "?"}</span></td>
                    <td>{c.title}</td>
                    <td><Chip>{c.kind}</Chip></td>
                    <td className="mono muted">{when(c.decidedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="panel-body">
              <Empty title="Only the seed guide so far">
                Approved changes appear here. The agent proposes one when a technique clears the evidence bar{s.agent.promotion === "manual" ? "; you approve it in Prompt Evolution." : " and promotes it automatically."}
              </Empty>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Recent generated videos" meta={recent.length ? `last ${recent.length} finished` : undefined} actions={<button type="button" className="btn sm ghost" onClick={() => go("compare")}>Comparisons <ArrowRight size={13} /></button>}>
        {recent.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {recent.map((g) => (
              <VideoTile key={g.id} g={g} onOpen={() => go("compare", g.id)} />
            ))}
          </div>
        ) : (
          <Empty title="No finished renders yet">
            Clips appear here when the PC worker finishes a render. {s.generations.filter((g) => g.status === "queued").length
              ? `${s.generations.filter((g) => g.status === "queued").length} render(s) are queued and waiting for the worker.`
              : "The agent queues paired renders when it runs an experiment."}{" "}
            {mode !== "running" ? (
              <button type="button" className="btn sm exp" style={{ marginTop: 8 }} onClick={() => void lab.act({ action: "agent.control", mode: "running" }, "Start agent")}>
                <Play size={12} /> Start the agent
              </button>
            ) : null}
          </Empty>
        )}
      </Panel>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        <Panel title="Current optimization priorities" actions={<button type="button" className="btn sm ghost" onClick={() => go("settings")}>Edit</button>}>
          <span className="eyebrow">Your priorities</span>
          {s.agent.priorities.length ? (
            <ol style={{ margin: "6px 0 14px", paddingLeft: 18 }}>
              {s.agent.priorities.map((p) => <li key={p} style={{ margin: "3px 0" }}>{p}</li>)}
            </ol>
          ) : (
            <p className="muted" style={{ margin: "6px 0 14px" }}>None set. Add them in Settings and the agent designs experiments toward them first.</p>
          )}
          <span className="eyebrow">Weakest dimensions (master renders)</span>
          {weakest.length ? (
            <table className="tbl" style={{ marginTop: 4 }}>
              <tbody>
                {weakest.map((w) => (
                  <tr key={w.dimension}>
                    <td>{DIMENSION_LABEL[w.dimension]}</td>
                    <td><ScoreBar value={w.mean} /></td>
                    <td className="mono muted">n={w.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted" style={{ margin: "6px 0 0" }}>No scored master renders yet, so there is no measured weakness to rank. It fills in once the first renders are judged.</p>
          )}
        </Panel>

        <Panel title="Live activity" actions={<button type="button" className="btn sm ghost" onClick={() => go("activity")}>All activity <ArrowRight size={13} /></button>} bodyClass="tbl-wrap">
          {activity.length ? (
            <table className="tbl">
              <tbody>
                {activity.map((a) => {
                  const t = refTarget(a.ref);
                  return (
                    <tr key={a.id} className={t ? "clickable" : undefined} onClick={t ? () => go(t.section, t.focus) : undefined}>
                      <td className="mono muted" style={{ whiteSpace: "nowrap" }}>{ago(a.at)}</td>
                      <td><Chip tone={a.actor === "agent" ? "cyan" : a.actor === "owner" ? "amber" : undefined}>{a.actor}</Chip></td>
                      <td>{a.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="panel-body">
              <Empty title="The agent has not done anything yet">
                Every step the agent, the worker or you take is logged here as it happens.
              </Empty>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Counter({ label, value, hint, tone, onClick }: { label: string; value: number; hint: string; tone?: "amber"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ov-counter"
      style={{ all: "unset", cursor: "pointer", padding: "14px 16px", borderRight: "1px solid var(--line)", display: "grid", gap: 3 }}
    >
      <span className="eyebrow">{label}</span>
      <span className="mono" style={{ fontSize: 28, lineHeight: 1.1, color: tone === "amber" && value ? "var(--amber)" : "var(--ink)" }}>{value}</span>
      <span className="muted" style={{ fontSize: 11.5 }}>{hint}</span>
    </button>
  );
}

function VideoTile({ g, onOpen }: { g: Generation; onOpen: () => void }) {
  const frames = useFrames(g.id, g.frameCount);
  const first = frames[0];
  return (
    <button type="button" onClick={onOpen} className="ov-tile" style={{ all: "unset", cursor: "pointer", display: "grid", gap: 6 }}>
      {first ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={first} alt={`First frame of a ${genreName(g.genre)} render`} className="thumb" />
      ) : (
        <span
          className="thumb"
          style={{ display: "grid", placeItems: "center", padding: 8, textAlign: "center", fontSize: 11, color: "var(--ink-3)", background: "linear-gradient(135deg, var(--panel-2), var(--bg-grain))" }}
        >
          {genreName(g.genre)}
        </span>
      )}
      <span className="row" style={{ gap: 6, justifyContent: "space-between", flexWrap: "nowrap" }}>
        <Chip tone={g.arm === "master" ? "amber" : "cyan"}>{g.arm} v{g.guideVersion}</Chip>
        {g.judgedAt ? <ScoreBar value={g.overall} width={48} /> : <StatusChip status="unjudged" />}
      </span>
      <span className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {genreName(g.genre)} · {ago(g.finishedAt)}
      </span>
    </button>
  );
}

// ----- the standout: the guide as a strip of film -------------------------------------------

function GuideFilmstrip({ s, go, pendingCount }: { s: LabState; go: SectionProps["go"]; pendingCount: number }) {
  const reduce = useReducedMotion();
  const versions = [...s.guide.versions].sort((a, b) => a.version - b.version);
  const titleOf = (changeId: string) => s.guide.changes.find((c) => c.id === changeId)?.title;

  return (
    <section className="panel ov-strip" data-standout="guide-filmstrip" aria-label="Master guide versions">
      <style>{FILMSTRIP_CSS}</style>
      <div className="panel-head">
        <h2>Guide film-strip</h2>
        <span className="muted mono" style={{ fontSize: 11 }}>{versions.length} version{versions.length === 1 ? "" : "s"} · every frame is an approved change</span>
      </div>
      <div className="fs-reel">
        {versions.map((v, i) => {
          const isCur = v.version === s.guide.current;
          return (
            <motion.button
              key={v.version}
              type="button"
              className={`fs-frame${isCur ? " is-current" : ""}`}
              onClick={() => go("evolution", v.changeId)}
              aria-current={isCur ? "true" : undefined}
              title={titleOf(v.changeId) ?? v.summary}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: reduce ? 0 : Math.min(i, 10) * 0.04, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <span className="fs-holes" aria-hidden />
              <span className="fs-cell">
                <span className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "nowrap" }}>
                  <span className="serif fs-num">v{v.version}</span>
                  {isCur ? <span className="fs-live mono">CURRENT</span> : null}
                </span>
                <span className="mono fs-date">{when(v.createdAt)}</span>
                <span className="fs-title">{titleOf(v.changeId) ?? v.summary}</span>
              </span>
              <span className="fs-holes" aria-hidden />
            </motion.button>
          );
        })}
        <div className="fs-frame fs-next">
          <span className="fs-holes" aria-hidden />
          <span className="fs-cell">
            <span className="serif fs-num" style={{ color: "var(--ink-4)" }}>v{Math.max(...versions.map((v) => v.version)) + 1}</span>
            <span className="fs-title muted">
              Next version: when evidence clears the bar
              {pendingCount ? ` · ${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting for you` : ""}
            </span>
          </span>
          <span className="fs-holes" aria-hidden />
        </div>
      </div>
    </section>
  );
}

const FILMSTRIP_CSS = `
.h3l .ov-strip .fs-reel { display: flex; gap: 0; overflow-x: auto; padding: 14px; scroll-snap-type: x proximity; }
.h3l .ov-strip .fs-frame {
  all: unset; box-sizing: border-box; flex: none; width: 196px; display: grid; grid-template-rows: 14px 1fr 14px;
  background: #07080a; border-left: 1px solid #000; cursor: pointer; scroll-snap-align: start;
}
.h3l .ov-strip .fs-frame:first-child { border-radius: 4px 0 0 4px; }
.h3l .ov-strip .fs-holes {
  display: block;
  background: repeating-linear-gradient(90deg, transparent 0 9px, rgba(232,230,225,0.16) 9px 17px, transparent 17px 24px);
  background-size: 24px 6px; background-repeat: repeat-x; background-position: 4px center;
}
.h3l .ov-strip .fs-cell {
  display: grid; gap: 4px; align-content: start; margin: 0 7px; padding: 10px 11px; min-height: 104px;
  background: linear-gradient(160deg, var(--panel-2), var(--bg-grain)); border: 1px solid var(--line);
  border-radius: 2px; transition: border-color 160ms var(--ease), box-shadow 160ms var(--ease);
}
.h3l .ov-strip .fs-frame:hover .fs-cell { border-color: var(--line-2); }
.h3l .ov-strip .fs-frame:focus-visible { outline: 2px solid var(--amber); outline-offset: -2px; }
.h3l .ov-strip .fs-num { font-size: 30px; line-height: 1; color: var(--ink-2); }
.h3l .ov-strip .fs-date { font-size: 10.5px; color: var(--ink-3); }
.h3l .ov-strip .fs-title { font-size: 12px; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.h3l .ov-strip .fs-live { font-size: 9.5px; letter-spacing: 0.14em; color: var(--amber); }
.h3l .ov-strip .is-current .fs-cell {
  border-color: var(--amber-line);
  background: linear-gradient(160deg, rgba(242,169,59,0.16), rgba(242,169,59,0.03) 70%), var(--panel-2);
  box-shadow: 0 0 0 1px var(--amber-line), 0 0 26px rgba(242,169,59,0.18);
}
.h3l .ov-strip .is-current .fs-num { color: var(--amber); }
.h3l .ov-strip .is-current .fs-holes {
  background-image: repeating-linear-gradient(90deg, transparent 0 9px, rgba(242,169,59,0.55) 9px 17px, transparent 17px 24px);
}
.h3l .ov-strip .fs-next { cursor: default; border-radius: 0 4px 4px 0; }
.h3l .ov-strip .fs-next .fs-cell { background: transparent; border: 1px dashed var(--line-2); }
.h3l .ov-counter:last-child { border-right: 0 !important; }
.h3l .ov-counter:hover { background: var(--panel-2); }
.h3l .ov-counter:focus-visible, .h3l .ov-tile:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
.h3l .ov-tile:hover .thumb { border-color: var(--line-2); }
`;
