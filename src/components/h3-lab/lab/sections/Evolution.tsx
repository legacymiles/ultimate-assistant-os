"use client";

// Prompt Evolution — every change the guide has seen (approved, pending and
// rejected), what each one changed and why, the evidence behind it, and how
// the master guide's renders scored per version.

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, GitCompare, X } from "lucide-react";
import type { ChangeRecord, ChangeStatus, GuideVersion, LabState, Strategy } from "@/lib/h3-lab/model";
import { currentVersion, diffVersions, strategyFor, versionOf } from "@/lib/h3-lab/guide";
import { KNOBS, knobDef, techniqueLabel } from "@/lib/h3-lab/strategy";
import { genreName } from "@/lib/h3-lab/genres";
import type { SectionProps } from "../sections";
import { Chip, Empty, Panel, SectionHead, StatusChip, when } from "../ui";

type Filter = "all" | ChangeStatus;

function valueLabel(knob: keyof Strategy, value: string | null | undefined): string {
  if (!value) return "guide default";
  return knobDef(knob).values.find((v) => v.value === value)?.label ?? value;
}

/** The version a change was (or will be) applied on top of. */
function baseOf(s: LabState, c: ChangeRecord): GuideVersion {
  if (c.status === "approved" && c.version) {
    const earlier = s.guide.versions.filter((v) => v.version < c.version!).sort((a, b) => b.version - a.version)[0];
    if (earlier) return earlier;
  }
  return currentVersion(s.guide);
}

export default function Evolution({ lab, go, focus }: SectionProps) {
  const s = lab.state;
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Set<string>>(() => new Set(focus ? [focus] : []));

  useEffect(() => {
    if (!focus) return;
    setOpen((o) => new Set(o).add(focus));
    setFilter("all");
    const t = window.setTimeout(() => document.getElementById(`chg-${focus}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
    return () => window.clearTimeout(t);
  }, [focus]);

  const changes = useMemo(
    () => [...s.guide.changes].sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt)),
    [s.guide.changes],
  );
  const counts = {
    all: changes.length,
    pending: changes.filter((c) => c.status === "pending").length,
    approved: changes.filter((c) => c.status === "approved").length,
    rejected: changes.filter((c) => c.status === "rejected").length,
  };
  // Pending first within the newest-first list, so decisions waiting on the owner are never buried.
  const shown = changes
    .filter((c) => filter === "all" || c.status === filter)
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));

  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <SectionHead
        eyebrow="Prompt Evolution"
        title="How the guide changed, and why"
        lede="Every version comes from one change with its problem, reasoning, experiments and evidence. Rejected and pending changes stay in the record; nothing is rewritten."
      />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        <ScoreByVersion s={s} />
        <CompareVersions s={s} />
      </div>

      <Panel
        title="Change history"
        meta={`${counts.all} change${counts.all === 1 ? "" : "s"} · newest first`}
        actions={
          <div className="row" role="tablist" aria-label="Filter changes" style={{ gap: 4 }}>
            {(["all", "pending", "approved", "rejected"] as Filter[]).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} className={`btn sm ${filter === f ? "" : "ghost"}`} onClick={() => setFilter(f)}>
                {f[0].toUpperCase() + f.slice(1)} <span className="mono muted">{counts[f]}</span>
              </button>
            ))}
          </div>
        }
      >
        {shown.length ? (
          <ol className="ev-line" style={{ listStyle: "none", margin: 0, padding: 0, position: "relative" }}>
            <style>{TIMELINE_CSS}</style>
            {shown.map((c) => (
              <ChangeCard key={c.id} c={c} s={s} lab={lab} go={go} open={open.has(c.id)} onToggle={() => toggle(c.id)} />
            ))}
          </ol>
        ) : (
          <Empty title={`No ${filter} changes`}>
            {filter === "pending"
              ? "The agent proposes a change when a technique clears the evidence bar; it waits here for your decision."
              : "Changes appear here as the guide evolves."}
          </Empty>
        )}
      </Panel>
    </div>
  );
}

function ChangeCard({ c, s, lab, go, open, onToggle }: { c: ChangeRecord; s: LabState; lab: SectionProps["lab"]; go: SectionProps["go"]; open: boolean; onToggle: () => void }) {
  const [note, setNote] = useState("");
  const base = baseOf(s, c);
  const isCurrent = c.version === s.guide.current && c.status === "approved";
  const tone = c.status === "approved" ? "var(--amber)" : c.status === "pending" ? "var(--warn)" : "var(--bad)";

  return (
    <li id={`chg-${c.id}`} className="ev-item" style={{ scrollMarginTop: 64 }}>
      <span className="ev-dot" style={{ background: c.status === "approved" ? tone : "var(--panel)", borderColor: tone }} aria-hidden />
      <div className="ev-card" style={{ borderColor: isCurrent ? "var(--amber-line)" : undefined }}>
        <button type="button" className="ev-head" onClick={onToggle} aria-expanded={open} aria-controls={`chg-body-${c.id}`}>
          {open ? <ChevronDown size={14} className="muted" /> : <ChevronRight size={14} className="muted" />}
          <span className="serif" style={{ fontSize: 24, lineHeight: 1, minWidth: 34, color: c.status === "approved" ? "var(--amber)" : "var(--ink-4)" }}>
            {c.version ? `v${c.version}` : "—"}
          </span>
          <span style={{ display: "grid", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontWeight: 600, color: "var(--ink)" }}>{c.title}</span>
            <span className="row" style={{ gap: 6 }}>
              <StatusChip status={c.status} />
              <Chip>{c.kind}</Chip>
              <Chip tone={c.proposedBy === "agent" ? "cyan" : c.proposedBy === "owner" ? "amber" : undefined}>by {c.proposedBy}</Chip>
              {isCurrent ? <Chip tone="amber">current</Chip> : null}
              <span className="mono muted" style={{ fontSize: 11 }}>
                proposed {when(c.createdAt)}{c.decidedAt && c.status !== "pending" ? ` · ${c.status} ${when(c.decidedAt)}` : ""}
              </span>
            </span>
          </span>
        </button>

        {open ? (
          <div id={`chg-body-${c.id}`} style={{ padding: "4px 14px 14px 14px", display: "grid", gap: 14 }}>
            <PatchView c={c} base={base} />

            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
              <div>
                <span className="eyebrow">Why</span>
                <p className="dim" style={{ margin: "4px 0 0" }}>{c.why || <span className="muted">No reason recorded.</span>}</p>
              </div>
              <div>
                <span className="eyebrow">Problem it addresses</span>
                <p className="dim" style={{ margin: "4px 0 0" }}>{c.problem || <span className="muted">No problem recorded.</span>}</p>
              </div>
            </div>

            {c.decisionNote ? (
              <div>
                <span className="eyebrow">Decision note</span>
                <p className="dim" style={{ margin: "4px 0 0" }}>{c.decisionNote}</p>
              </div>
            ) : null}

            <div>
              <span className="eyebrow">Experiments</span>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                {c.experimentIds.length ? (
                  c.experimentIds.map((id) => {
                    const e = s.experiments.find((x) => x.id === id);
                    return (
                      <button key={id} type="button" className="btn sm exp" onClick={() => go("lab", id)}>
                        {e ? `${e.code} · ${e.name}` : id}
                      </button>
                    );
                  })
                ) : (
                  <span className="muted">None — {c.kind === "seed" ? "the seed was consolidated from existing skills and official guides." : c.kind === "rollback" ? "a rollback restores an earlier version." : "proposed without a lab experiment."}</span>
                )}
              </div>
            </div>

            <div>
              <span className="eyebrow">Evidence</span>
              {c.evidence.length ? (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
                  {c.evidence.map((ev, i) => (
                    <li key={i}>
                      <span className="dim">{ev.text}</span>
                      {typeof ev.n === "number" || typeof ev.ciLo === "number" ? (
                        <span className="mono muted" style={{ fontSize: 11.5 }}>
                          {" "}
                          {typeof ev.n === "number" ? `n=${ev.n}` : ""}
                          {typeof ev.ciLo === "number" && typeof ev.ciHi === "number" ? ` · 90% ${ev.ciLo.toFixed(2)}…${ev.ciHi.toFixed(2)}` : ""}
                        </span>
                      ) : null}
                      {ev.generationIds?.length ? (
                        <span className="row" style={{ gap: 4, marginTop: 4 }}>
                          {ev.generationIds.map((gid) => (
                            <button key={gid} type="button" className="btn sm ghost mono" onClick={() => go("compare", gid)} title="Open this render in Comparisons">
                              {gid.slice(-6)}
                            </button>
                          ))}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ margin: "4px 0 0" }}>No evidence attached.</p>
              )}
            </div>

            {c.status === "pending" ? (
              <form
                className="row"
                style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void lab.act({ action: "change.approve", id: c.id, note: note.trim() || undefined }, "Approve change");
                }}
              >
                <input className="in" style={{ flex: "1 1 240px", width: "auto" }} placeholder="Note (optional) — kept with the decision" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" />
                <button type="submit" className="btn primary sm" disabled={!!lab.busy}>
                  <Check size={13} /> Approve → v{Math.max(...s.guide.versions.map((v) => v.version)) + 1}
                </button>
                <button type="button" className="btn danger sm" disabled={!!lab.busy} onClick={() => void lab.act({ action: "change.reject", id: c.id, note: note.trim() || undefined }, "Reject change")}>
                  <X size={13} /> Reject
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function PatchView({ c, base }: { c: ChangeRecord; base: GuideVersion }) {
  const strat = Object.entries(c.patch.strategy ?? {}) as [keyof Strategy, string][];
  const genres = c.patch.genreStrategy ?? [];
  const sections = c.patch.sections ?? [];
  const empty = !strat.length && !genres.length && !sections.length;

  return (
    <div>
      <span className="eyebrow">What changed</span>
      {empty ? (
        <p className="muted" style={{ margin: "4px 0 0" }}>
          {c.kind === "seed" ? "The first version: the whole guide." : c.kind === "rollback" ? `The content of an earlier version was copied forward (see "${c.title}").` : "No patch recorded."}
        </p>
      ) : (
        <div className="tbl-wrap" style={{ marginTop: 6 }}>
          <table className="tbl">
            <thead>
              <tr><th>Scope</th><th>Knob / section</th><th>From</th><th>To</th></tr>
            </thead>
            <tbody>
              {strat.map(([knob, to]) => (
                <tr key={`s-${knob}`}>
                  <td><Chip tone="amber">default</Chip></td>
                  <td>{knobDef(knob).label}</td>
                  <td className="muted">{valueLabel(knob, base.strategy[knob])}</td>
                  <td><Chip tone="cyan">{techniqueLabel(`${knob}=${to}`).split(": ")[1] ?? to}</Chip></td>
                </tr>
              ))}
              {genres.flatMap((g) =>
                (Object.entries(g.set) as [keyof Strategy, string][]).map(([knob, to]) => (
                  <tr key={`g-${g.genre}-${knob}`}>
                    <td><Chip>{genreName(g.genre)}</Chip></td>
                    <td>{knobDef(knob).label}</td>
                    <td className="muted">{valueLabel(knob, strategyFor(base, g.genre)[knob])}</td>
                    <td><Chip tone="cyan">{valueLabel(knob, to)}</Chip></td>
                  </tr>
                )),
              )}
              {sections.map((sec) => (
                <tr key={`x-${sec.id}`}>
                  <td><Chip>section</Chip></td>
                  <td>{sec.title} <span className="mono muted">({sec.id})</span></td>
                  <td className="muted">{base.sections.some((x) => x.id === sec.id) ? "existing text" : "—"}</td>
                  <td>{base.sections.some((x) => x.id === sec.id) ? "rewritten" : "added"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ----- overall score per guide version (master arm, finished, scored) ----------------------

function ScoreByVersion({ s }: { s: LabState }) {
  const points = useMemo(() => {
    const by = new Map<number, number[]>();
    for (const g of s.generations) {
      if (g.status !== "done" || g.arm !== "master" || typeof g.overall !== "number") continue;
      by.set(g.guideVersion, [...(by.get(g.guideVersion) ?? []), g.overall]);
    }
    return [...by.entries()]
      .map(([version, xs]) => ({ version, mean: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length }))
      .sort((a, b) => a.version - b.version);
  }, [s.generations]);

  const W = 560;
  const H = 200;
  const P = { l: 34, r: 16, t: 14, b: 30 };
  const x = (i: number) => P.l + (points.length <= 1 ? 0 : (i * (W - P.l - P.r)) / (points.length - 1));
  const y = (v: number) => P.t + (1 - v / 10) * (H - P.t - P.b);

  return (
    <Panel title="Overall score per guide version" meta="mean of scored master renders">
      {points.length >= 2 ? (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Mean overall score by guide version: ${points.map((p) => `v${p.version} ${p.mean.toFixed(1)} (n=${p.n})`).join(", ")}`}>
          {[0, 2.5, 5, 7.5, 10].map((t) => (
            <g key={t}>
              <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={P.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--ink-3)" fontFamily="var(--font-h3-mono), monospace">{t}</text>
            </g>
          ))}
          <polyline
            points={points.map((p, i) => `${x(i)},${y(p.mean)}`).join(" ")}
            fill="none"
            stroke="var(--amber)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {points.map((p, i) => (
            <g key={p.version}>
              <circle cx={x(i)} cy={y(p.mean)} r={4} fill="var(--amber)" stroke="var(--panel)" strokeWidth={2}>
                <title>{`v${p.version}: ${p.mean.toFixed(2)} from ${p.n} render${p.n === 1 ? "" : "s"}`}</title>
              </circle>
              <text x={x(i)} y={y(p.mean) - 9} textAnchor="middle" fontSize={10.5} fill="var(--ink)" fontFamily="var(--font-h3-mono), monospace">{p.mean.toFixed(1)}</text>
              <text x={x(i)} y={H - 12} textAnchor="middle" fontSize={12} fill="var(--ink-2)" fontFamily="var(--font-h3-serif), Georgia, serif">v{p.version}</text>
              <text x={x(i)} y={H - 1} textAnchor="middle" fontSize={9} fill="var(--ink-3)" fontFamily="var(--font-h3-mono), monospace">n={p.n}</text>
            </g>
          ))}
        </svg>
      ) : (
        <Empty title={points.length ? `Only v${points[0].version} has scored renders so far` : "No scored master renders yet"}>
          {points.length
            ? `v${points[0].version}: mean ${points[0].mean.toFixed(1)} from ${points[0].n} render${points[0].n === 1 ? "" : "s"}. A line needs a second version with judged master renders to compare against.`
            : "Once the worker renders and the judge scores master-arm clips, each guide version's mean overall score is plotted here."}
        </Empty>
      )}
    </Panel>
  );
}

function CompareVersions({ s }: { s: LabState }) {
  const versions = [...s.guide.versions].sort((a, b) => a.version - b.version);
  const cur = s.guide.current;
  const prev = versions.filter((v) => v.version < cur).pop()?.version ?? versions[0].version;
  const [from, setFrom] = useState(prev);
  const [to, setTo] = useState(cur);
  const a = versionOf(s.guide, from);
  const b = versionOf(s.guide, to);
  const d = a && b ? diffVersions(a, b) : null;
  const rows = d
    ? [
        ...d.strategy.map((r) => ({ scope: "default", what: KNOBS.find((k) => k.knob === r.knob)?.label ?? r.knob, from: valueLabel(r.knob as keyof Strategy, r.from), to: valueLabel(r.knob as keyof Strategy, r.to) })),
        ...d.genres.map((r) => ({ scope: genreName(r.genre), what: KNOBS.find((k) => k.knob === r.knob)?.label ?? r.knob, from: valueLabel(r.knob as keyof Strategy, r.from), to: valueLabel(r.knob as keyof Strategy, r.to) })),
        ...d.sectionsAdded.map((id) => ({ scope: "section", what: b!.sections.find((x) => x.id === id)?.title ?? id, from: "—", to: "added" })),
        ...d.sectionsChanged.map((id) => ({ scope: "section", what: b!.sections.find((x) => x.id === id)?.title ?? id, from: "text", to: "rewritten" })),
        ...d.sectionsRemoved.map((id) => ({ scope: "section", what: a!.sections.find((x) => x.id === id)?.title ?? id, from: "present", to: "removed" })),
      ]
    : [];

  return (
    <Panel
      title={<span className="row" style={{ gap: 6 }}><GitCompare size={14} /> Compare versions</span>}
      actions={
        <span className="row" style={{ gap: 6 }}>
          <select className="in" style={{ width: "auto", minHeight: 26, padding: "2px 6px" }} aria-label="From version" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {versions.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}
          </select>
          <span className="muted">→</span>
          <select className="in" style={{ width: "auto", minHeight: 26, padding: "2px 6px" }} aria-label="To version" value={to} onChange={(e) => setTo(Number(e.target.value))}>
            {versions.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}
          </select>
        </span>
      }
      bodyClass="tbl-wrap"
    >
      {versions.length < 2 ? (
        <div className="panel-body">
          <Empty title="Only one version exists">Approve a change (or roll back) and the differences between any two versions show here.</Empty>
        </div>
      ) : from === to ? (
        <p className="muted panel-body" style={{ margin: 0 }}>Pick two different versions.</p>
      ) : rows.length ? (
        <div style={{ maxHeight: 260, overflowY: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Scope</th><th>What</th><th>v{from}</th><th>v{to}</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="dim">{r.scope}</td>
                  <td>{r.what}</td>
                  <td className="muted">{r.from}</td>
                  <td><Chip tone="cyan">{r.to}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted panel-body" style={{ margin: 0 }}>v{from} and v{to} have identical settings and sections.</p>
      )}
    </Panel>
  );
}

const TIMELINE_CSS = `
.h3l .ev-line::before { content: ""; position: absolute; left: 6px; top: 8px; bottom: 8px; width: 1px; background: var(--line-2); }
.h3l .ev-item { position: relative; padding-left: 24px; margin-bottom: 10px; }
.h3l .ev-item:last-child { margin-bottom: 0; }
.h3l .ev-dot { position: absolute; left: 1px; top: 17px; width: 11px; height: 11px; border-radius: 99px; border: 2px solid; }
.h3l .ev-card { border: 1px solid var(--line); border-radius: var(--r); background: var(--panel-2); }
.h3l button.ev-head { all: unset; box-sizing: border-box; width: 100%; display: flex; gap: 10px; align-items: flex-start; padding: 11px 14px; cursor: pointer; }
.h3l button.ev-head:hover { background: var(--raise); border-radius: var(--r); }
.h3l button.ev-head:focus-visible { outline: 2px solid var(--amber); outline-offset: -2px; border-radius: var(--r); }
`;
