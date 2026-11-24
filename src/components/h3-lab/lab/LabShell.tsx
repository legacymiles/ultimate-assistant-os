"use client";

// H3 Prompt Lab — the shell: rail navigation, the glass tally bar (agent,
// H3, guide version, today's budget, last result) and the active section.
// The section lives in ?s= so a link can open any record (?s=lab&f=exp-a).

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import { Menu } from "lucide-react";
import { h3Mono, h3Sans, h3Serif } from "@/lib/fonts";
import { useLab } from "./useLab";
import { NAV, SECTION_IDS, type SectionId, type SectionProps } from "./sections";
import { ago } from "./ui";
import { todayCounts } from "@/lib/h3-lab/state";
import "./lab.css";

const load = (f: () => Promise<{ default: ComponentType<SectionProps> }>) =>
  dynamic(f, { ssr: false, loading: () => <p className="muted">Loading…</p> });

const SECTIONS: Record<SectionId, ComponentType<SectionProps>> = {
  overview: load(() => import("./sections/Overview")),
  guide: load(() => import("./sections/Guide")),
  evolution: load(() => import("./sections/Evolution")),
  genres: load(() => import("./sections/Genres")),
  lab: load(() => import("./sections/ExperimentLab")),
  compare: load(() => import("./sections/Comparisons")),
  inspector: load(() => import("./sections/Inspector")),
  reverse: load(() => import("./sections/Reverse")),
  characters: load(() => import("./sections/Characters")),
  environments: load(() => import("./sections/Environments")),
  productions: load(() => import("./sections/Productions")),
  repos: load(() => import("./sections/Repos")),
  activity: load(() => import("./sections/Activity")),
  connection: load(() => import("./sections/Connection")),
  skill: load(() => import("./sections/Skill")),
  settings: load(() => import("./sections/Settings")),
};

function readUrl(): { s: SectionId; f: string | null } {
  if (typeof window === "undefined") return { s: "overview", f: null };
  const p = new URLSearchParams(window.location.search);
  const s = p.get("s") as SectionId | null;
  return { s: s && SECTION_IDS.includes(s) ? s : "overview", f: p.get("f") };
}

export function LabShell() {
  const lab = useLab();
  const [section, setSection] = useState<SectionId>("overview");
  const [focus, setFocus] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  useEffect(() => {
    const { s, f } = readUrl();
    setSection(s);
    setFocus(f);
    const onPop = () => {
      const u = readUrl();
      setSection(u.s);
      setFocus(u.f);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((s: SectionId, f?: string) => {
    setSection(s);
    setFocus(f ?? null);
    setRailOpen(false);
    const p = new URLSearchParams();
    p.set("s", s);
    if (f) p.set("f", f);
    window.history.pushState(null, "", `?${p.toString()}`);
    window.scrollTo({ top: 0 });
  }, []);

  const counts = useMemo(() => {
    const s = lab.state;
    if (!s) return {} as Partial<Record<SectionId, number>>;
    return {
      lab: s.experiments.filter((e) => e.status !== "archived").length,
      characters: s.characters.length,
      environments: s.environments.length,
      productions: s.productions.length,
      reverse: s.blueprints.length,
      repos: s.repos.length,
      inspector: s.generations.reduce((n, g) => n + (g.issues?.filter((i) => i.severity !== "low").length ?? 0), 0),
      evolution: s.guide.changes.filter((c) => c.status === "pending").length,
    } as Partial<Record<SectionId, number>>;
  }, [lab.state]);

  const Active = SECTIONS[section];
  const fonts = `${h3Serif.variable} ${h3Sans.variable} ${h3Mono.variable}`;

  return (
    <div className={`h3l ${fonts}`}>
      <div className="h3l-frame">
        <nav className="h3l-rail" aria-label="H3 Prompt Lab sections" data-open={railOpen}>
          <div className="h3l-brand">
            <b>H3 Prompt Lab</b>
            <i>v{lab.state?.guide.current ?? "–"}</i>
          </div>
          {NAV.map((g) => (
            <div className="h3l-group" key={g.group}>
              <span className="eyebrow">{g.group}</span>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="h3l-nav"
                  aria-current={section === it.id ? "page" : undefined}
                  onClick={() => go(it.id)}
                >
                  {it.label}
                  {counts[it.id] ? <span className="count">{counts[it.id]}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="h3l-main">
          <Tally lab={lab} onMenu={() => setRailOpen((o) => !o)} go={go} />
          <main className="h3l-content">
            {lab.error && !lab.state ? (
              <div className="notice bad">
                <b>The lab could not load.</b> {lab.error}{" "}
                <button type="button" className="btn sm" onClick={() => void lab.reload()}>Try again</button>
              </div>
            ) : !lab.state ? (
              <LoadingLab />
            ) : (
              <Active lab={lab as SectionProps["lab"]} go={go} focus={focus} />
            )}
          </main>
        </div>
      </div>
      {railOpen ? (
        <button type="button" aria-label="Close menu" onClick={() => setRailOpen(false)} style={{ all: "unset", position: "fixed", inset: 0, zIndex: 30, background: "rgba(0,0,0,0.5)" }} />
      ) : null}
    </div>
  );
}

/**
 * First paint, before the lab has answered. It shows the page's real heading
 * and the shape of what is coming rather than one line of grey text, so the
 * first thing on screen is never an empty dark page.
 */
function LoadingLab() {
  return (
    <div aria-busy="true">
      <header className="sec-head">
        <div>
          <span className="eyebrow">H3 Prompt Lab</span>
          <h1>The guide, the agent and the evidence</h1>
          <p>Reading the guide, the experiments and what the PC worker has rendered…</p>
        </div>
      </header>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel" style={{ height: 150, opacity: 0.55 }} />
        ))}
      </div>
    </div>
  );
}

function Tally({ lab, onMenu, go }: { lab: ReturnType<typeof useLab>; onMenu: () => void; go: (s: SectionId) => void }) {
  const s = lab.state;
  const online = s?.worker.lastSeen ? Date.now() - Date.parse(s.worker.lastSeen) < 90_000 : false;
  const h3 = !online ? "offline" : s?.worker.wangp ?? "unknown";
  const rendering = s?.generations.find((g) => g.status === "rendering" || g.status === "claimed");
  const mode = s?.agent.mode ?? "paused";
  return (
    <div className="h3l-tally" role="status" aria-live="polite">
      <button type="button" className="h3l-menu-btn" aria-label="Open sections" onClick={onMenu}>
        <Menu size={16} />
      </button>
      <button type="button" className="btn ghost sm" onClick={() => go("activity")} title="Agent">
        <span className={`lamp ${mode === "running" ? "on pulse" : mode === "paused" ? "amber" : "bad"}`} />
        Agent {mode}
      </button>
      <button type="button" className="btn ghost sm" onClick={() => go("connection")} title={s?.worker.wangpDetail || "H3 connection"}>
        <span className={`lamp ${h3 === "ready" ? "on" : h3 === "busy" ? "amber pulse" : "bad"}`} />
        H3 {h3 === "offline" ? `offline · seen ${ago(s?.worker.lastSeen)}` : h3}
      </button>
      {rendering ? (
        <span className="tally-item mono" style={{ color: "var(--cyan)" }}>
          rendering {rendering.genre}
        </span>
      ) : null}
      <button type="button" className="btn ghost sm" onClick={() => go("guide")}>
        <span className="lamp amber" /> Guide <span className="serif" style={{ fontSize: 15, color: "var(--amber)" }}>v{s?.guide.current ?? "–"}</span>
      </button>
      <span className="tally-item mono hide-sm">
        {s ? (() => {
          const t = todayCounts(s, new Date().toISOString());
          return `${t.renders}/${s.agent.rendersPerDay} renders · ${t.aiCalls}/${s.agent.aiCallsPerDay} AI today`;
        })() : ""}
      </span>
      <span style={{ flex: 1 }} />
      {lab.busy ? <span className="tally-item muted">{lab.busy}…</span> : null}
      {lab.status && !lab.busy ? (
        <span className="tally-item" style={{ color: lab.status.tone === "bad" ? "var(--bad)" : "var(--ink-2)", maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis" }}>
          {lab.status.text}
        </span>
      ) : null}
    </div>
  );
}
