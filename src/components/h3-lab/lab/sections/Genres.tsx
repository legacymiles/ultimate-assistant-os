"use client";

// Genre Research — the 43 genre modules inside the one master guide: what
// each genre's prompts use, what its scores weigh, and what the lab has
// learned about it.

import { Fragment, useEffect, useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import type { SectionProps } from "../sections";
import { Chip, Delta, Empty, Markdown, Panel, ScoreBar, SectionHead } from "../ui";
import type { Dimension, GenreFamily, Knob } from "@/lib/h3-lab/model";
import { DIMENSIONS, DIMENSION_LABEL } from "@/lib/h3-lab/model";
import { FAMILY_LABEL, GENRES, genreById, weightOf } from "@/lib/h3-lab/genres";
import { currentVersion, strategyFor } from "@/lib/h3-lab/guide";
import { KNOBS, knobDef, parseTechnique, techniqueLabel } from "@/lib/h3-lab/strategy";
import { allStats } from "@/lib/h3-lab/state";
import { discoveries } from "@/lib/h3-lab/score";
import { ResearchStyles } from "../research/ResearchStyles";

function valueLabel(knob: Knob, value: string): string {
  return knobDef(knob).values.find((v) => v.value === value)?.label ?? value;
}

export default function Genres({ lab, go, focus }: SectionProps) {
  const state = lab.state;
  const v = currentVersion(state.guide);
  const stats = useMemo(() => allStats(state), [state]);
  const [sel, setSel] = useState<string | null>(null);
  const [family, setFamily] = useState<GenreFamily | "all">("all");

  useEffect(() => {
    if (focus) setSel(focus.replace(/^genre:/, ""));
  }, [focus]);

  const rows = useMemo(
    () =>
      GENRES.map((g) => {
        const strat = strategyFor(v, g.id);
        const differs = KNOBS.filter((k) => strat[k.knob] !== v.strategy[k.knob]);
        const masters = state.generations.filter((x) => x.genre === g.id && x.arm === "master" && x.status === "done" && typeof x.overall === "number");
        const scored = state.generations.filter((x) => x.genre === g.id && x.status === "done" && x.scores).length;
        const gs = stats.byGenre.get(g.id) ?? [];
        return {
          g,
          strat,
          differs,
          top: [...DIMENSIONS].sort((a, b) => weightOf(g.id, b) - weightOf(g.id, a)).slice(0, 3),
          scenarios: state.scenarios.filter((s) => s.spec.genre === g.id).length,
          scored,
          mean: masters.length ? masters.reduce((s, x) => s + (x.overall ?? 0), 0) / masters.length : null,
          meanN: masters.length,
          found: discoveries(gs, state.agent.minPairs, state.agent.minLowerBound),
        };
      }),
    [state, v, stats],
  );

  const families = Object.keys(FAMILY_LABEL) as GenreFamily[];
  const shown = families.filter((f) => family === "all" || f === family);
  const selected = sel ? rows.find((r) => r.g.id === sel) ?? null : null;

  return (
    <div className="grid rs-root" style={{ gap: 16 }}>
      <ResearchStyles />
      <SectionHead
        eyebrow="Guide · Genre Research"
        title="Genre Research"
        lede={`A fight is not a sitcom. Each of the ${GENRES.length} genre modules sets the compiler's knobs for that genre, weighs the scoring dimensions it cares about, and carries its own rules — all inside the one master guide. Amber chips are where a genre departs from the guide's base strategy.`}
        actions={
          <div className="rs-tabs" role="group" aria-label="Family">
            <button type="button" aria-pressed={family === "all"} onClick={() => setFamily("all")}>All</button>
            {families.map((f) => (
              <button key={f} type="button" aria-pressed={family === f} onClick={() => setFamily(f)}>{FAMILY_LABEL[f].split(" ")[0]}</button>
            ))}
          </div>
        }
      />

      {selected ? <Module row={selected} lab={lab} go={go} onClose={() => setSel(null)} /> : null}

      <Panel title="Genre modules" meta={`guide v${v.version}`} bodyClass="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Genre</th>
              <th className="hide-sm">Essence</th>
              <th>Strategy over base</th>
              <th className="hide-sm">Weighs most</th>
              <th>Sc.</th>
              <th className="hide-sm">Scored</th>
              <th>Master mean</th>
              <th>Found</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <Fragment key={f}>
                <tr>
                  <td colSpan={8} style={{ background: "var(--panel-2)" }}>
                    <span className="eyebrow">{FAMILY_LABEL[f]}</span>
                  </td>
                </tr>
                {rows
                  .filter((r) => r.g.family === f)
                  .map((r) => (
                    <tr key={r.g.id} className="clickable" aria-selected={r.g.id === sel} onClick={() => { setSel(r.g.id); window.scrollTo({ top: 0 }); }}>
                      <td style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{r.g.name}</td>
                      <td className="hide-sm dim" style={{ maxWidth: 340, fontSize: 12 }}>{r.g.essence}</td>
                      <td>
                        <span className="rs-pill-list">
                          {r.differs.length ? r.differs.map((k) => <Chip key={k.knob} tone="amber" title={`${k.label}: ${valueLabel(k.knob, r.strat[k.knob])}`}>{valueLabel(k.knob, r.strat[k.knob])}</Chip>) : <span className="muted">base</span>}
                        </span>
                      </td>
                      <td className="hide-sm">
                        <span className="rs-pill-list">{r.top.map((d) => <Chip key={d} title={`weight ${weightOf(r.g.id, d).toFixed(2)}`}>{d}</Chip>)}</span>
                      </td>
                      <td className="mono">{r.scenarios || <span className="muted">0</span>}</td>
                      <td className="hide-sm mono">{r.scored || <span className="muted">0</span>}</td>
                      <td>{r.mean !== null ? <ScoreBar value={r.mean} width={48} /> : <span className="muted mono">—</span>}</td>
                      <td>{r.found.length ? <Chip tone="good">{r.found.length}</Chip> : <span className="muted mono">—</span>}</td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

type Row = {
  g: (typeof GENRES)[number];
  strat: ReturnType<typeof strategyFor>;
  differs: typeof KNOBS;
  scenarios: number;
  scored: number;
  mean: number | null;
  meanN: number;
  found: ReturnType<typeof discoveries>;
};

function Module({ row, lab, go, onClose }: { row: Row; lab: SectionProps["lab"]; go: SectionProps["go"]; onClose: () => void }) {
  const state = lab.state;
  const v = currentVersion(state.guide);
  const g = genreById(row.g.id)!;
  const stats = useMemo(() => allStats(state).byGenre.get(g.id) ?? [], [state, g.id]);
  const found = new Set(row.found.map((d) => d.technique));
  const section = v.sections.find((s) => s.id === `genre:${g.id}`);

  return (
    <Panel
      className="rs-arm"
      title={<span className="serif" style={{ fontSize: 24 }}>{g.name}</span>}
      meta={`${FAMILY_LABEL[g.family]} · ${row.scenarios} scenario${row.scenarios === 1 ? "" : "s"} · ${row.scored} scored render${row.scored === 1 ? "" : "s"}${row.mean !== null ? ` · master mean ${row.mean.toFixed(1)} (n=${row.meanN})` : ""}`}
      actions={
        <span className="row" style={{ gap: 6 }}>
          <button type="button" className="btn exp sm" onClick={() => go("lab", `genre:${g.id}`)}><FlaskConical size={12} /> Test a technique in this genre</button>
          <button type="button" className="btn ghost sm" onClick={onClose}>Close</button>
        </span>
      }
    >
      <div className="grid" style={{ gap: 16 }}>
        <p style={{ margin: 0, color: "var(--ink)" }}>{g.essence}</p>

        <div className="rs-split">
          <div className="grid" style={{ gap: 10 }}>
            <div>
              <span className="eyebrow">Strategy under guide v{v.version}</span>
              <dl className="rs-kv" style={{ margin: "6px 0 0" }}>
                {KNOBS.map((k) => {
                  const diff = row.strat[k.knob] !== v.strategy[k.knob];
                  return (
                    <Fragment key={k.knob}>
                      <dt>{k.label}</dt>
                      <dd style={diff ? { color: "var(--amber)" } : undefined}>{valueLabel(k.knob, row.strat[k.knob])}{diff ? <span className="muted"> (base: {valueLabel(k.knob, v.strategy[k.knob])})</span> : null}</dd>
                    </Fragment>
                  );
                })}
              </dl>
            </div>
            <div>
              <span className="eyebrow">Rules</span>
              <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>{g.rules.map((r) => <li key={r} style={{ margin: "3px 0" }}>{r}</li>)}</ul>
            </div>
            <dl className="rs-kv" style={{ margin: 0 }}>
              <dt>Pacing</dt><dd>{g.pacing}</dd>
              <dt>Camera</dt><dd><span className="rs-pill-list">{g.camera.map((c) => <Chip key={c}>{c}</Chip>)}</span></dd>
              <dt>Continuity</dt><dd><ul style={{ margin: 0, paddingLeft: 16 }}>{g.continuity.map((c) => <li key={c}>{c}</li>)}</ul></dd>
            </dl>
          </div>

          <div className="grid" style={{ gap: 6, alignContent: "start" }}>
            <span className="eyebrow">What the score weighs in this genre</span>
            {[...DIMENSIONS]
              .sort((a, b) => weightOf(g.id, b) - weightOf(g.id, a))
              .map((d: Dimension) => {
                const w = weightOf(g.id, d);
                const set = typeof g.weights[d] === "number";
                return (
                  <div className="rs-wbar" key={d}>
                    <span className="dim" style={{ fontSize: 12 }}>{DIMENSION_LABEL[d]}</span>
                    <span className="bar" style={{ height: 8 }}>
                      <i style={{ width: `${w * 100}%`, background: w >= 0.8 ? "var(--amber)" : "var(--ink-3)" }} />
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: set ? "var(--ink)" : "var(--ink-3)" }} title={set ? "set by the module" : "module silent — default 0.5"}>{w.toFixed(2)}</span>
                  </div>
                );
              })}
          </div>
        </div>

        <div>
          <span className="eyebrow">Techniques tested in this genre</span>
          {stats.length ? (
            <div className="tbl-wrap" style={{ marginTop: 6 }}>
              <table className="tbl">
                <thead>
                  <tr><th>Technique</th><th className="hide-sm">Knob</th><th>n</th><th>Effect</th><th>90% interval</th><th /></tr>
                </thead>
                <tbody>
                  {stats.map((s) => {
                    const t = parseTechnique(s.technique);
                    return (
                      <tr key={s.technique} className="clickable" onClick={() => s.pairKeys[0] && go("compare", s.pairKeys[0])}>
                        <td>{techniqueLabel(s.technique).split(": ")[1] ?? s.technique}</td>
                        <td className="hide-sm dim">{t ? knobDef(t.knob).label : "—"}</td>
                        <td className="mono">{s.n}</td>
                        <td><Delta value={s.effect} digits={2} /></td>
                        <td className="mono" style={{ fontSize: 11.5 }}>{s.ciLo.toFixed(2)} .. {s.ciHi.toFixed(2)}</td>
                        <td>{found.has(s.technique) ? <Chip tone="good">discovery</Chip> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ margin: "6px 0 0" }}>No judged pairs in this genre yet — the button above opens the Live compiler on one of its scenarios.</p>
          )}
        </div>

        <div>
          <span className="eyebrow">Its section in the master guide</span>
          {section ? (
            <div style={{ marginTop: 6, borderLeft: "2px solid var(--amber-line)", paddingLeft: 12 }}>
              <Markdown text={section.body} />
            </div>
          ) : (
            <Empty title="No guide section for this genre in this version.">The module's rules above still drive the compiler.</Empty>
          )}
        </div>
      </div>
    </Panel>
  );
}
