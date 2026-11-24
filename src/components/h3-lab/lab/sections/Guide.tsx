"use client";

// Master Prompt Guide — the approved guide, section by section, with its
// compiler defaults, any older version readable (and restorable), and the
// SKILL.md it publishes as.

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, Copy, History, Search, Undo2, X } from "lucide-react";
import type { GuideSection } from "@/lib/h3-lab/model";
import { currentVersion, guideMarkdown, skillMarkdown, strategyFor, versionOf } from "@/lib/h3-lab/guide";
import { KNOBS, parseTechnique, techniqueLabel } from "@/lib/h3-lab/strategy";
import { FAMILY_LABEL, genreById, genreName } from "@/lib/h3-lab/genres";
import type { GenreFamily } from "@/lib/h3-lab/model";
import { allStats } from "@/lib/h3-lab/state";
import { discoveries } from "@/lib/h3-lab/score";
import type { SectionProps } from "../sections";
import { Chip, Empty, Markdown, Panel, SectionHead, when } from "../ui";

const FAMILY_ORDER: GenreFamily[] = ["narrative", "cinematic", "action", "gaming", "commercial"];

export default function Guide({ lab, go, focus }: SectionProps) {
  const s = lab.state;
  const current = currentVersion(s.guide);
  const [viewing, setViewing] = useState<number>(current.version);
  const v = versionOf(s.guide, viewing) ?? current;
  const isCurrent = v.version === s.guide.current;

  const [selected, setSelected] = useState<string>(() => (focus && v.sections.some((x) => x.id === focus) ? focus : v.sections[0]?.id ?? ""));
  const [query, setQuery] = useState("");
  const [readAll, setReadAll] = useState(false);
  const [showKnobs, setShowKnobs] = useState(true);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (focus && v.sections.some((x) => x.id === focus)) setSelected(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // When the guide moves on (approve / rollback elsewhere) and we were on the current one, follow it.
  const [lastCurrent, setLastCurrent] = useState(s.guide.current);
  useEffect(() => {
    if (s.guide.current !== lastCurrent) {
      if (viewing === lastCurrent) setViewing(s.guide.current);
      setLastCurrent(s.guide.current);
    }
  }, [s.guide.current, lastCurrent, viewing]);

  const change = s.guide.changes.find((c) => c.id === v.changeId);
  const pending = s.guide.changes.filter((c) => c.status === "pending").length;

  const q = query.trim().toLowerCase();
  const match = (sec: GuideSection) => !q || sec.title.toLowerCase().includes(q) || sec.body.toLowerCase().includes(q);
  const core = v.sections.filter((x) => !x.genre && match(x));
  const byFamily = useMemo(() => {
    const out = new Map<GenreFamily | "other", GuideSection[]>();
    for (const sec of v.sections) {
      if (!sec.genre || !match(sec)) continue;
      const fam = genreById(sec.genre)?.family ?? "other";
      out.set(fam, [...(out.get(fam) ?? []), sec]);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, q]);
  const shown = core.length + [...byFamily.values()].reduce((n, l) => n + l.length, 0);

  const section = v.sections.find((x) => x.id === selected) ?? v.sections[0];

  const newTechniques = useMemo(() => {
    const { byGenre } = allStats(s);
    const cur = currentVersion(s.guide);
    const out: { genre: string; technique: string; effect: number; ciLo: number; ciHi: number; n: number }[] = [];
    for (const [genre, stats] of byGenre) {
      for (const d of discoveries(stats, s.agent.minPairs, s.agent.minLowerBound)) {
        const t = parseTechnique(d.technique);
        if (t && strategyFor(cur, genre)[t.knob] === t.value) continue;
        out.push({ genre, technique: d.technique, effect: d.effect, ciLo: d.ciLo, ciHi: d.ciHi, n: d.n });
      }
    }
    return out.sort((a, b) => b.ciLo - a.ciLo);
  }, [s]);

  const approved = s.guide.changes
    .filter((c) => c.status === "approved" && c.kind !== "seed")
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt))
    .slice(0, 6);

  async function copySkill() {
    try {
      await navigator.clipboard.writeText(skillMarkdown(v));
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    window.setTimeout(() => setCopied(null), 2200);
  }

  async function doRollback() {
    const res = await lab.act({ action: "guide.rollback", version: v.version, why: reason.trim() }, `Roll back to v${v.version}`);
    if (res) {
      setRollingBack(false);
      setReason("");
      setViewing(res.state.guide.current);
      setLastCurrent(res.state.guide.current);
    }
  }

  const versionsDesc = [...s.guide.versions].sort((a, b) => b.version - a.version);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <SectionHead
        eyebrow="Master Prompt Guide"
        title={
          <span>
            H3 Master Prompt Guide <span className="serif" style={{ color: isCurrent ? "var(--amber)" : "var(--ink-3)" }}>v{v.version}</span>
          </span>
        }
        lede={
          <>
            <span className="mono muted">{when(v.createdAt)}</span> · {change?.title ?? v.summary}
          </>
        }
        actions={
          <>
            <button type="button" className="btn ghost sm" onClick={() => go("evolution")}>
              <Chip tone={pending ? "amber" : undefined}>Pending changes: {pending}</Chip>
            </button>
            <label className="row" style={{ gap: 6 }}>
              <History size={14} className="muted" aria-hidden />
              <select className="in" style={{ width: "auto", minHeight: 30 }} aria-label="View version" value={viewing} onChange={(e) => { setViewing(Number(e.target.value)); setRollingBack(false); }}>
                {versionsDesc.map((x) => (
                  <option key={x.version} value={x.version}>
                    v{x.version}{x.version === s.guide.current ? " (current)" : ""} · {x.createdAt.slice(0, 10)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn sm" onClick={() => setReadAll((r) => !r)} aria-pressed={readAll}>
              <BookOpen size={13} /> {readAll ? "Back to sections" : "Read it all"}
            </button>
            <button type="button" className="btn sm" onClick={() => void copySkill()}>
              {copied === "ok" ? <Check size={13} /> : <Copy size={13} />}
              {copied === "ok" ? "Copied" : copied === "fail" ? "Copy blocked by browser" : "Copy as SKILL.md"}
            </button>
          </>
        }
      />

      {!isCurrent ? (
        <div className="notice">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              <b>Viewing v{v.version} — not current.</b> The approved guide is v{s.guide.current}. This view is read-only.
            </span>
            <span className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm" onClick={() => setViewing(s.guide.current)}>Back to v{s.guide.current}</button>
              {!rollingBack ? (
                <button type="button" className="btn sm danger" onClick={() => setRollingBack(true)}>
                  <Undo2 size={13} /> Roll back to this version
                </button>
              ) : null}
            </span>
          </div>
          {rollingBack ? (
            <form
              className="row"
              style={{ marginTop: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim()) void doRollback();
              }}
            >
              <input
                className="in"
                style={{ flex: "1 1 260px", width: "auto" }}
                placeholder={`Why go back to v${v.version}? (kept in the change history)`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
                aria-label="Reason for rollback"
              />
              <button type="submit" className="btn primary sm" disabled={!reason.trim() || !!lab.busy}>
                Create v{Math.max(...s.guide.versions.map((x) => x.version)) + 1} from v{v.version}
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setRollingBack(false)}>Cancel</button>
              <span className="muted" style={{ flexBasis: "100%", fontSize: 12 }}>
                Nothing is deleted: a rollback makes a new version that copies v{v.version}, and v{s.guide.current} stays in history.
              </span>
            </form>
          ) : null}
        </div>
      ) : null}

      {readAll ? (
        <Panel title={`The whole guide · v${v.version}`} meta={`${v.sections.length} sections`}>
          <div style={{ maxHeight: "75vh", overflowY: "auto", paddingRight: 6 }}>
            <Markdown text={guideMarkdown(v)} />
          </div>
        </Panel>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
          {/* Table of contents */}
          <nav className="panel gd-toc" aria-label="Guide sections">
            <style>{TOC_CSS}</style>
            <div className="panel-head" style={{ gap: 6 }}>
              <Search size={14} className="muted" aria-hidden />
              <input className="in" style={{ minHeight: 26, padding: "3px 8px" }} placeholder="Search sections" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search guide sections" />
              {query ? (
                <button type="button" className="btn ghost sm" aria-label="Clear search" onClick={() => setQuery("")}><X size={13} /></button>
              ) : null}
            </div>
            <div style={{ overflowY: "auto", padding: "8px 6px 12px" }}>
              {q ? <p className="muted mono" style={{ margin: "0 8px 6px", fontSize: 11 }}>{shown} of {v.sections.length} match</p> : null}
              {core.length ? <TocGroup label="Core" items={core} selected={section?.id} onPick={setSelected} /> : null}
              {FAMILY_ORDER.filter((f) => byFamily.has(f)).map((f) => (
                <TocGroup key={f} label={FAMILY_LABEL[f]} items={byFamily.get(f) ?? []} selected={section?.id} onPick={setSelected} />
              ))}
              {byFamily.has("other") ? <TocGroup label="Other modules" items={byFamily.get("other") ?? []} selected={section?.id} onPick={setSelected} /> : null}
              {!shown ? <p className="muted" style={{ margin: 8 }}>No section mentions “{query}”.</p> : null}
            </div>
          </nav>

          {/* Selected section */}
          <div className="grid" style={{ flex: "999 1 460px", minWidth: 0 }}>
            <Panel
              title="Default compiler settings"
              meta={`v${v.version} base strategy · genre modules override`}
              actions={<button type="button" className="btn ghost sm" onClick={() => setShowKnobs((x) => !x)} aria-expanded={showKnobs}>{showKnobs ? "Hide" : "Show"}</button>}
              bodyClass={showKnobs ? "tbl-wrap" : "hidden-body"}
            >
              {showKnobs ? (
                <table className="tbl">
                  <thead>
                    <tr><th>Knob</th><th>Setting</th><th>What it does</th><th className="hide-sm">Source</th></tr>
                  </thead>
                  <tbody>
                    {KNOBS.map((k) => {
                      const val = k.values.find((x) => x.value === v.strategy[k.knob]);
                      return (
                        <tr key={k.knob}>
                          <td style={{ whiteSpace: "nowrap" }}>{k.label}</td>
                          <td><Chip tone="amber">{val?.label ?? v.strategy[k.knob]}</Chip></td>
                          <td className="dim">{val?.does}</td>
                          <td className="muted hide-sm" style={{ fontSize: 11.5 }}>{val?.source}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </Panel>

            {section ? (
              <Panel
                title={<span className="serif" style={{ fontSize: 22, fontWeight: 400 }}>{section.title}</span>}
                meta={section.genre ? `genre module · ${genreById(section.genre)?.family ? FAMILY_LABEL[genreById(section.genre)!.family] : "genre"}` : "core"}
              >
                {section.genre ? (
                  <div style={{ marginBottom: 14 }}>
                    <span className="eyebrow">Effective settings for {genreName(section.genre)}</span>
                    <div className="row" style={{ gap: 6, marginTop: 6 }}>
                      {KNOBS.map((k) => {
                        const eff = strategyFor(v, section.genre!);
                        const differs = eff[k.knob] !== v.strategy[k.knob];
                        const label = k.values.find((x) => x.value === eff[k.knob])?.label ?? eff[k.knob];
                        return (
                          <Chip key={k.knob} tone={differs ? "amber" : undefined} title={differs ? "Set by this genre module" : "Guide default"}>
                            {k.label}: {label}
                          </Chip>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <Markdown text={section.body} />
              </Panel>
            ) : (
              <Empty title="This version has no sections">The guide's sections come from its seed and from approved section changes.</Empty>
            )}
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <Panel title="Newly discovered techniques" meta="cleared the bar, not in the guide yet" bodyClass="tbl-wrap">
          {newTechniques.length ? (
            <table className="tbl">
              <thead><tr><th>Technique</th><th>Genre</th><th>Effect</th><th>Interval</th><th>n</th></tr></thead>
              <tbody>
                {newTechniques.map((d) => (
                  <tr key={`${d.genre}|${d.technique}`} className="clickable" onClick={() => go("evolution")}>
                    <td><Chip tone="cyan">{techniqueLabel(d.technique)}</Chip></td>
                    <td className="dim">{genreName(d.genre)}</td>
                    <td className="mono" style={{ color: "var(--good)" }}>+{d.effect.toFixed(2)}</td>
                    <td className="mono muted">{d.ciLo.toFixed(2)} … {d.ciHi.toFixed(2)}</td>
                    <td className="mono">{d.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="panel-body">
              <Empty title="Nothing waiting to enter the guide">
                A technique lands here when {s.agent.minPairs}+ judged pairs put its 90% interval above +{s.agent.minLowerBound} and the guide does not use it yet.
              </Empty>
            </div>
          )}
        </Panel>
        <Panel title="Recently approved improvements" bodyClass="tbl-wrap">
          {approved.length ? (
            <table className="tbl">
              <tbody>
                {approved.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => go("evolution", c.id)}>
                    <td><span className="serif" style={{ fontSize: 17, color: "var(--amber)" }}>v{c.version ?? "?"}</span></td>
                    <td>{c.title}</td>
                    <td className="mono muted" style={{ whiteSpace: "nowrap" }}>{when(c.decidedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="panel-body">
              <Empty title="v1 is still the seed">No change has been approved since the guide was consolidated. Approvals appear here with their version.</Empty>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function TocGroup({ label, items, selected, onPick }: { label: string; items: GuideSection[]; selected: string | undefined; onPick: (id: string) => void }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <span className="eyebrow" style={{ display: "block", padding: "4px 8px" }}>{label} <span className="mono">· {items.length}</span></span>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="h3l-nav"
          aria-current={selected === it.id ? "page" : undefined}
          onClick={() => onPick(it.id)}
          style={{ padding: "4px 8px", fontSize: 12.5 }}
        >
          {it.title}
        </button>
      ))}
    </div>
  );
}

const TOC_CSS = `
.h3l .gd-toc { flex: 1 1 240px; max-width: 100%; min-width: 0; position: sticky; top: 56px; max-height: calc(100dvh - 72px); display: flex; flex-direction: column; }
@media (max-width: 900px) { .h3l .gd-toc { position: static; max-height: 340px; } }
`;
