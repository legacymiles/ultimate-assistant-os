"use client";

// Continuity Inspector — every flagged render, its evidence and the frames
// that show it. Measured issues come from ffmpeg numbers; vision issues from
// the judge that was shown the frames. Intentional changes are never flagged.

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, RefreshCw, ScanSearch } from "lucide-react";
import type { SectionProps } from "../sections";
import { Chip, Empty, Panel, SectionHead, StatusChip, useFrames, when } from "../ui";
import type { ClipMetrics, Generation, InspectionIssue, IssueKind } from "@/lib/h3-lab/model";
import { issuesOf, previousGeneration, specOfGeneration } from "@/lib/h3-lab/state";
import { ISSUE_LABEL, sortIssues } from "@/lib/h3-lab/inspect";
import { genreName } from "@/lib/h3-lab/genres";
import { ResearchStyles } from "../research/ResearchStyles";
import { generationTitle } from "../research/helpers";

type Sev = InspectionIssue["severity"];

export default function Inspector({ lab, go, focus }: SectionProps) {
  const state = lab.state;
  const [kind, setKind] = useState<IssueKind | "all">("all");
  const [sev, setSev] = useState<Sev | "all">("all");
  const [source, setSource] = useState<"all" | "measured" | "vision">("all");
  const [genre, setGenre] = useState("all");
  const [prod, setProd] = useState("all");
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    if (focus) setSel(focus);
  }, [focus]);

  const inspected = state.generations.filter((g) => g.issues !== undefined);
  const all = useMemo(() => issuesOf(state), [state]);
  const filtered = all.filter(
    ({ generation: g, issue: i }) =>
      (kind === "all" || i.kind === kind) &&
      (sev === "all" || i.severity === sev) &&
      (source === "all" || i.source === source) &&
      (genre === "all" || g.genre === genre) &&
      (prod === "all" || (prod === "none" ? !g.productionId : g.productionId === prod)),
  );
  const rows = useMemo(() => {
    const m = new Map<string, { g: Generation; issues: InspectionIssue[] }>();
    for (const { generation, issue } of filtered) {
      const r = m.get(generation.id) ?? { g: generation, issues: [] };
      r.issues.push(issue);
      m.set(generation.id, r);
    }
    return [...m.values()].sort((a, b) => (b.g.finishedAt ?? b.g.queuedAt).localeCompare(a.g.finishedAt ?? a.g.queuedAt));
  }, [filtered]);

  const genres = [...new Set(all.map((x) => x.generation.genre))];
  const prods = [...new Set(all.map((x) => x.generation.productionId).filter((x): x is string => Boolean(x)))];
  const selected = state.generations.find((g) => g.id === sel) ?? rows[0]?.g ?? null;
  const kinds = [...new Set(all.map((x) => x.issue.kind))];

  return (
    <div className="grid rs-root" style={{ gap: 16 }}>
      <ResearchStyles />
      <SectionHead
        eyebrow="Research · Continuity Inspector"
        title="Continuity Inspector"
        lede="Each issue carries its evidence: measured ones come from ffmpeg numbers on the clip (cuts, frame similarity, freezes, exposure, camera motion); vision ones from the judge who was shown the frames and had to name the frame. Changes the shot spec marks as intentional — position, lighting, wardrobe, environment, props — are never flagged."
      />

      {!inspected.length ? (
        <Panel>
          <Empty title="No render has been inspected yet.">
            Inspection runs on every finished render — the PC worker measures the clip with ffmpeg, then the judge looks at its frames.{" "}
            <button type="button" className="btn sm" onClick={() => go("lab")}>Queue renders in Experiment Lab</button>
          </Empty>
        </Panel>
      ) : (
        <>
          <Panel
            title="Flagged renders"
            meta={`${all.length} issue${all.length === 1 ? "" : "s"} across ${inspected.length} inspected render${inspected.length === 1 ? "" : "s"}`}
            bodyClass="tbl-wrap"
          >
            <div className="row" style={{ padding: "10px 14px", gap: 8 }}>
              <select className="in" style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value as IssueKind | "all")} aria-label="Kind">
                <option value="all">All kinds</option>
                {kinds.map((k) => <option key={k} value={k}>{ISSUE_LABEL[k]}</option>)}
              </select>
              <select className="in" style={{ width: "auto" }} value={sev} onChange={(e) => setSev(e.target.value as Sev | "all")} aria-label="Severity">
                <option value="all">Any severity</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select className="in" style={{ width: "auto" }} value={source} onChange={(e) => setSource(e.target.value as "all" | "measured" | "vision")} aria-label="Source">
                <option value="all">Measured + vision</option>
                <option value="measured">Measured only</option>
                <option value="vision">Vision only</option>
              </select>
              <select className="in" style={{ width: "auto" }} value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre">
                <option value="all">All genres</option>
                {genres.map((g) => <option key={g} value={g}>{genreName(g)}</option>)}
              </select>
              <select className="in" style={{ width: "auto" }} value={prod} onChange={(e) => setProd(e.target.value)} aria-label="Production">
                <option value="all">Experiments + productions</option>
                <option value="none">Experiment renders only</option>
                {prods.map((p) => <option key={p} value={p}>{state.productions.find((x) => x.id === p)?.title ?? p}</option>)}
              </select>
            </div>
            {rows.length ? (
              <div className="rs-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Render</th>
                      <th className="hide-sm">Genre</th>
                      <th>Issues</th>
                      <th>Worst</th>
                      <th className="hide-sm">Finished</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ g, issues }) => {
                      const s = sortIssues(issues);
                      const c = (x: Sev) => issues.filter((i) => i.severity === x).length;
                      return (
                        <tr key={g.id} className="clickable" aria-selected={selected?.id === g.id} onClick={() => setSel(g.id)}>
                          <td>
                            {generationTitle(state, g)}{" "}
                            <Chip tone={g.arm === "experiment" ? "cyan" : "amber"}>{g.arm}</Chip>
                          </td>
                          <td className="hide-sm dim">{genreName(g.genre)}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {c("high") ? <Chip tone="bad">{c("high")} high</Chip> : null} {c("medium") ? <Chip tone="warn">{c("medium")} med</Chip> : null} {c("low") ? <Chip>{c("low")} low</Chip> : null}
                          </td>
                          <td className="dim">{ISSUE_LABEL[s[0].kind]}</td>
                          <td className="hide-sm mono muted">{when(g.finishedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="panel-body">
                <Empty title={all.length ? "No issue matches these filters." : `${inspected.length} render${inspected.length === 1 ? "" : "s"} inspected — none flagged.`}>
                  {all.length ? "Widen a filter above." : "Every inspected clip held continuity against its spec."}
                </Empty>
              </div>
            )}
          </Panel>

          {selected ? <Detail key={selected.id} g={selected} lab={lab} go={go} /> : null}
        </>
      )}
    </div>
  );
}

// ----- detail ---------------------------------------------------------------------------

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="muted">—</span>;
  const W = 220;
  const H = 40;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(8, hi - lo);
  const mid = (hi + lo) / 2;
  const y = (v: number) => H - 3 - ((v - (mid - span / 2)) / span) * (H - 6);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mean luma per sampled frame, ${lo.toFixed(0)} to ${hi.toFixed(0)}`}>
      <polyline points={pts} fill="none" stroke="var(--amber)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function MetricsBlock({ m, requested }: { m: ClipMetrics; requested: string | null }) {
  const mean = m.luma.length ? m.luma.reduce((s, v) => s + v, 0) / m.luma.length : null;
  const sd = mean !== null ? Math.sqrt(m.luma.reduce((s, v) => s + (v - mean) ** 2, 0) / m.luma.length) : null;
  return (
    <dl className="rs-kv" style={{ margin: 0 }}>
      <dt>Clip</dt>
      <dd className="mono">{m.durationSec.toFixed(2)}s · {m.width}×{m.height} · {m.fps} fps · {m.frames} frames</dd>
      <dt>Cuts</dt>
      <dd className="mono">{m.cuts.length ? m.cuts.map((c) => `${c.t.toFixed(1)}s (${c.score.toFixed(0)})`).join(", ") : "none"}</dd>
      <dt>SSIM min</dt>
      <dd className="mono">{m.ssimMin.toFixed(2)} @ {m.ssimMinAt.toFixed(1)}s <span className="muted">· mean adjacent {m.ssimAdjacent.toFixed(2)}</span></dd>
      <dt>First → last</dt>
      <dd className="mono">{m.ssimFirstLast.toFixed(2)} <span className="muted">SSIM — how much the shot changed overall</span></dd>
      <dt>Freezes</dt>
      <dd className="mono">{m.freezes.length ? m.freezes.map((f) => `${f.start.toFixed(1)}–${f.end.toFixed(1)}s`).join(", ") : "none"}</dd>
      <dt>Exposure</dt>
      <dd>
        <span className="row" style={{ gap: 10 }}>
          <Sparkline values={m.luma} />
          {mean !== null && sd !== null ? <span className="mono muted" style={{ fontSize: 11 }}>mean {mean.toFixed(0)}/255 · σ {sd.toFixed(1)}</span> : null}
        </span>
      </dd>
      <dt>Camera</dt>
      <dd className="mono">
        measured <b style={{ color: "var(--ink)" }}>{m.measuredMove}</b> · requested <b style={{ color: "var(--ink)" }}>{requested ?? "—"}</b>
        {m.motion ? <span className="muted"> · shift {m.motion.dx.toFixed(0)},{m.motion.dy.toFixed(0)} px · rot {m.motion.rot.toFixed(1)}° · zoom {m.motion.zoom.toFixed(1)}% · energy {m.motion.energy.toFixed(1)}</span> : null}
      </dd>
    </dl>
  );
}

function Detail({ g, lab, go }: { g: Generation; lab: SectionProps["lab"]; go: SectionProps["go"] }) {
  const state = lab.state;
  const spec = specOfGeneration(state, g);
  const prev = previousGeneration(state, g);
  const frames = useFrames(g.id, g.frameCount);
  const prevFrames = useFrames(prev?.id, prev?.frameCount);
  const issues = sortIssues(g.issues ?? []);
  const [pick, setPick] = useState<number | null>(null);
  const hit = new Set(pick !== null ? issues[pick]?.frames ?? [] : issues.flatMap((i) => i.frames));
  const times = g.metrics?.sampleTimes ?? [];

  return (
    <Panel
      title={
        <span className="row" style={{ gap: 8 }}>
          <ScanSearch size={15} />
          <span className="serif" style={{ fontSize: 20 }}>{generationTitle(state, g)}</span>
        </span>
      }
      meta={`${genreName(g.genre)} · guide v${g.guideVersion}`}
      actions={
        <span className="row" style={{ gap: 6 }}>
          <StatusChip status={g.status} />
          <button type="button" className="btn sm" onClick={() => go("compare", g.id)}>Compare <ArrowUpRight size={11} /></button>
          <button type="button" className="btn sm exp" onClick={() => void lab.act({ action: "inspect.run", generationId: g.id, previousId: prev?.id ?? null }, "Inspection re-run")}>
            <RefreshCw size={12} /> Re-run inspection
          </button>
        </span>
      }
    >
      <div className="grid" style={{ gap: 16 }}>
        <div className="grid" style={{ gap: 6 }}>
          <span className="eyebrow">Judging frames {pick !== null ? `· frames for “${ISSUE_LABEL[issues[pick].kind]}” outlined` : "· frames named by any issue outlined"}</span>
          {frames.length ? (
            <div className="rs-strip">
              {frames.map((f, i) => (
                <div className="rs-frame" key={i} data-hit={hit.has(i)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f} alt={`Frame ${i + 1}`} loading="lazy" />
                  <span className="tc">{times[i] !== undefined ? `${times[i].toFixed(1)}s` : `#${i + 1}`}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No judging frames stored for this render.</p>
          )}
        </div>

        <div className="rs-split">
          <div className="grid" style={{ gap: 6 }}>
            <span className="eyebrow">Expected</span>
            {prev ? (
              <>
                <div className="rs-frame" style={{ width: "100%" }}>
                  {prevFrames.length ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={prevFrames[prevFrames.length - 1]} alt="Previous scene's last frame" />
                  ) : (
                    <div className="thumb" />
                  )}
                  <span className="tc">previous scene · last frame</span>
                </div>
                <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => go("inspector", prev.id)}>Open the previous scene</button>
              </>
            ) : spec ? (
              <dl className="rs-kv" style={{ margin: 0 }}>
                <dt>Camera</dt>
                <dd className="mono">{spec.camera.move} · {spec.camera.amount} · {spec.camera.speed}</dd>
                <dt>Action</dt>
                <dd>{spec.action || "—"}</dd>
                <dt>Intended</dt>
                <dd>{spec.intentionalChanges.length ? spec.intentionalChanges.join(", ") : "no intentional changes — everything should hold"}</dd>
              </dl>
            ) : (
              <span className="muted">The spec this render came from no longer exists.</span>
            )}
          </div>
          <div className="grid" style={{ gap: 6 }}>
            <span className="eyebrow">Observed</span>
            {prev ? (
              <div className="rs-frame" style={{ width: "100%" }}>
                {frames[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={frames[0]} alt="This scene's first frame" />
                ) : (
                  <div className="thumb" />
                )}
                <span className="tc">this scene · first frame</span>
              </div>
            ) : g.metrics ? (
              <MetricsBlock m={g.metrics} requested={spec ? spec.camera.move : null} />
            ) : (
              <span className="muted">No measurements stored for this render.</span>
            )}
          </div>
        </div>

        <div className="grid" style={{ gap: 8 }}>
          <span className="eyebrow">Issues ({issues.length}) — click one to outline its frames</span>
          {issues.length ? (
            issues.map((x, i) => (
              <div
                key={i}
                className="rs-issue"
                data-sev={x.severity}
                role="button"
                tabIndex={0}
                aria-pressed={pick === i}
                onClick={() => setPick(pick === i ? null : i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPick(pick === i ? null : i);
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                <span className="row" style={{ gap: 6 }}>
                  <b style={{ fontWeight: 600 }}>{ISSUE_LABEL[x.kind]}</b>
                  <Chip tone={x.severity === "high" ? "bad" : x.severity === "medium" ? "warn" : undefined}>{x.severity}</Chip>
                  <Chip tone={x.source === "vision" ? "cyan" : undefined} title={x.source === "measured" ? "From ffmpeg numbers on the clip" : "From the judge who saw the frames"}>{x.source}</Chip>
                  <span className="mono muted" style={{ fontSize: 11 }}>{Math.round(x.confidence * 100)}% confidence{x.at !== null ? ` · at ${x.at.toFixed(1)}s` : ""}</span>
                </span>
                <span className="dim">{x.evidence}</span>
                <span style={{ fontSize: 12 }}><span className="eyebrow" style={{ color: "var(--amber)" }}>Fix</span> {x.recommendation}</span>
              </div>
            ))
          ) : (
            <p className="muted" style={{ margin: 0 }}>Inspected — nothing flagged.</p>
          )}
        </div>

        {g.metrics && prev ? (
          <div className="grid" style={{ gap: 6 }}>
            <span className="eyebrow">Measurements</span>
            <MetricsBlock m={g.metrics} requested={spec ? spec.camera.move : null} />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
