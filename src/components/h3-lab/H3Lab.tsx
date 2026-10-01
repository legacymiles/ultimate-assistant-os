"use client";

// H3 Experiments — a lab ledger for video METHODS.
//
// Three panes, deliberately dense: the skills that can drive a render, the runs
// made with the selected one, and a dossier on whichever run is open. A fourth
// view, the Queue, lists every skill x brief pair that has NEVER been rendered,
// because the owner's complaint was that undone work is invisible until someone
// remembers it.
//
// The comparison only means anything if every skill renders the same brief, so a
// brief is a first-class object here and runs are filed under one.
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import {
  EMPTY_LAB, LAB_KEY, defectTally, gapId, openGaps, runsForSkill, skillScore,
  type Brief, type LabState, type Run, type Verdict,
} from "@/lib/h3-lab/types";
import { KIND_ORDER, type Method } from "@/lib/h3-lab/methods";
import { ScrubRow } from "./ScrubRow";

interface FilmOnDisk {
  id: string;
  cut: string | null;
  shots: number;
  clips: string[];
  modified: string;
  complete: boolean;
}

const VERDICTS: Array<{ value: Verdict; label: string; cls: string }> = [
  { value: "good", label: "good", cls: "border-emerald-400/40 text-emerald-300" },
  { value: "mixed", label: "mixed", cls: "border-amber-400/40 text-amber-300" },
  { value: "bad", label: "bad", cls: "border-rose-500/40 text-rose-300" },
];

// The defects measured across this project so far, offered as one-tap tags so
// the same fault is named the same way every time and the tally is meaningful.
const DEFECTS = [
  "identity drift", "style break", "dead shot", "locked landing", "wrong direction",
  "prop never acted", "creature off-model", "no threat", "bad join", "flat pacing",
];

export function H3Lab() {
  const [state, setState] = useState<LabState>(EMPTY_LAB);
  const [methods, setMethods] = useState<Method[]>([]);
  const [films, setFilms] = useState<FilmOnDisk[]>([]);
  const [localFilms, setLocalFilms] = useState(true);
  const [skill, setSkill] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [view, setView] = useState<"runs" | "queue">("runs");
  const [briefId, setBriefId] = useState<string | null>(null);

  useEffect(() => setState(loadLocal<LabState>(LAB_KEY, EMPTY_LAB)), []);
  useRemotePull(LAB_KEY, () => setState(loadLocal<LabState>(LAB_KEY, EMPTY_LAB)));

  useEffect(() => {
    void fetch("/api/h3-lab/skills")
      .then((r) => r.json())
      .then((d: { methods: Method[] }) => {
        setMethods(d.methods ?? []);
        setSkill((s) => s ?? d.methods?.[0]?.id ?? null);
      })
      .catch(() => setMethods([]));
    void fetch("/api/h3-lab/films")
      .then((r) => r.json())
      .then((d: { films: FilmOnDisk[]; local: boolean }) => {
        setFilms(d.films ?? []);
        setLocalFilms(d.local !== false);
      })
      .catch(() => setLocalFilms(false));
  }, []);

  const commit = useCallback((next: LabState) => {
    setState(next);
    saveSynced(LAB_KEY, next);
  }, []);

  const brief = useMemo(
    () => state.briefs.find((b) => b.id === briefId) ?? state.briefs[0] ?? null,
    [state.briefs, briefId],
  );
  const runs = useMemo(() => (skill ? runsForSkill(state, skill) : []), [state, skill]);
  const gaps = useMemo(() => openGaps(state, methods), [state, methods]);
  const run = useMemo(() => state.runs.find((r) => r.id === openRun) ?? null, [state.runs, openRun]);
  const activeSkill = useMemo(() => methods.find((m) => m.id === skill) ?? null, [methods, skill]);

  // Films on disk that no run has claimed — the bridge rendered them, so they
  // should be one click from becoming a record rather than being retyped.
  const unclaimed = useMemo(() => {
    const taken = new Set(state.runs.map((r) => r.file));
    return films.filter((f) => f.cut && !taken.has(f.cut));
  }, [films, state.runs]);

  function addBrief() {
    const title = window.prompt("Brief title", "Walk home");
    if (!title) return;
    const text = window.prompt("The story, in plain words", "A man walking home from work is chased by something.");
    if (!text) return;
    const b: Brief = {
      id: `b${Date.now().toString(36)}`,
      title, text, seconds: 20, createdAt: new Date().toISOString(),
    };
    commit({ ...state, briefs: [...state.briefs, b] });
    setBriefId(b.id);
  }

  function claim(film: FilmOnDisk) {
    if (!skill || !brief) return;
    const r: Run = {
      id: `r${Date.now().toString(36)}`,
      skill, briefId: brief.id,
      renderedAt: film.modified,
      file: film.cut!,
      durationSec: 0, shots: film.shots,
      settings: "", verdict: null, notes: "", defects: [],
    };
    commit({ ...state, runs: [...state.runs, r] });
    setOpenRun(r.id);
  }

  function patch(id: string, fields: Partial<Run>) {
    commit({ ...state, runs: state.runs.map((r) => (r.id === id ? { ...r, ...fields } : r)) });
  }

  return (
    <div className="flex h-screen flex-col bg-[#0a0a0b] text-neutral-300">
      {/* ---- header ---------------------------------------------------- */}
      <header className="flex shrink-0 items-center gap-4 border-b border-white/10 px-4 py-2.5">
        <h1 className="font-mono text-[13px] tracking-widest text-neutral-100">H3 EXPERIMENTS</h1>
        <div className="flex items-center gap-1 font-mono text-[11px]">
          {(["runs", "queue"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-2 py-1 transition-colors ${
                view === v ? "bg-white/10 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {v}
              {v === "queue" && gaps.length > 0 && (
                <span className="ml-1.5 rounded bg-amber-400/20 px-1 tabular-nums text-amber-300">{gaps.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 font-mono text-[11px]">
          <select
            value={brief?.id ?? ""}
            onChange={(e) => setBriefId(e.target.value)}
            className="rounded border border-white/10 bg-transparent px-2 py-1 text-neutral-300 outline-none"
          >
            {state.briefs.length === 0 && <option value="">no brief yet</option>}
            {state.briefs.map((b) => (
              <option key={b.id} value={b.id} className="bg-neutral-900">{b.title} · {b.seconds}s</option>
            ))}
          </select>
          <button onClick={addBrief} className="rounded border border-white/15 px-2 py-1 text-neutral-400 hover:text-neutral-100">
            + brief
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---- skills ---------------------------------------------------- */}
        <aside className="w-48 shrink-0 overflow-y-auto border-r border-white/10 lg:w-56 xl:w-64">
          {KIND_ORDER.map((kind) => {
            const group = methods.filter((m) => m.kind === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind}>
                <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-neutral-600">
                  <span>{kind}s</span>
                  <span className="tabular-nums">{group.length}</span>
                </div>
                {group.map((m) => {
                  const score = skillScore(state, m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => { setSkill(m.id); setOpenRun(null); setView("runs"); }}
                      className={`flex w-full items-center gap-2 border-b border-white/5 px-3 py-2 text-left font-mono text-[11px] transition-colors ${
                        skill === m.id ? "bg-white/[0.07] text-neutral-100" : "text-neutral-400 hover:bg-white/[0.03]"
                      }`}
                    >
                      {/* Untried is the state worth noticing, so it gets the mark. */}
                      <span className={`h-1 w-1 shrink-0 rounded-full ${m.status === "used" ? "bg-neutral-700" : "bg-amber-400/70"}`} />
                      <span className="truncate">{m.name}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums text-[10px]">
                        {score.good > 0 && <span className="text-emerald-400">{score.good}</span>}
                        {score.bad > 0 && <span className="text-rose-400">{score.bad}</span>}
                        <span className="text-neutral-600">{score.runs}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {methods.length === 0 && (
            <p className="px-3 py-4 text-[11px] leading-relaxed text-neutral-600">No methods loaded.</p>
          )}
        </aside>

        {/* ---- runs or queue --------------------------------------------- */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {view === "queue" ? (
            <>
              <div className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-neutral-600">
                not rendered yet · {gaps.length}
              </div>
              {gaps.length === 0 && (
                <p className="px-3 py-4 font-mono text-[11px] text-neutral-600">
                  {state.briefs.length === 0 ? "Add a brief and every skill becomes a row here." : "Every skill has rendered every brief."}
                </p>
              )}
              {gaps.map((g) => (
                <div key={gapId(g.skill, g.briefId)}
                  className="grid grid-cols-[1.5fr_1.5fr_auto] items-center gap-3 border-b border-white/5 px-3 py-2 font-mono text-[11px]">
                  <button onClick={() => { setSkill(g.skill); setView("runs"); }} className="truncate text-left text-neutral-300 hover:text-white">
                    {g.skill}
                  </button>
                  <span className="truncate text-neutral-600">{g.briefTitle}</span>
                  <button
                    onClick={() => commit({ ...state, dismissedGaps: [...state.dismissedGaps, gapId(g.skill, g.briefId)] })}
                    className="text-neutral-600 hover:text-neutral-300"
                  >
                    skip
                  </button>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="grid grid-cols-[1.6fr_5rem_4rem_1fr_6rem] gap-3 border-b border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-neutral-600">
                <span className="truncate">run — hover plays, drag scrubs</span>
                <span>len</span><span>shots</span><span className="truncate">settings</span>
                <span className="text-right">verdict</span>
              </div>
              {runs.map((r) => (
                <ScrubRow key={r.id} run={r} selected={openRun === r.id} onSelect={() => setOpenRun(r.id)} />
              ))}
              {runs.length === 0 && (
                <p className="px-3 py-4 font-mono text-[11px] text-neutral-600">
                  No runs filed for {skill ?? "this skill"} yet.
                </p>
              )}

              {unclaimed.length > 0 && brief && (
                <>
                  <div className="mt-6 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-neutral-600">
                    on disk, unfiled · {unclaimed.length}
                  </div>
                  {unclaimed.slice(0, 12).map((f) => (
                    <div key={f.id} className="grid grid-cols-[1fr_4rem_auto] items-center gap-3 border-b border-white/5 px-3 py-2 font-mono text-[11px]">
                      <span className="truncate text-neutral-500">{f.id}</span>
                      <span className="tabular-nums text-neutral-600">{f.shots} sh</span>
                      <button onClick={() => claim(f)} className="text-neutral-400 hover:text-white">
                        file under {skill}
                      </button>
                    </div>
                  ))}
                </>
              )}
              {!localFilms && (
                <p className="px-3 py-4 font-mono text-[11px] text-neutral-600">
                  No local renders visible — this is the deployed hub. Records still sync; the footage lives on the PC.
                </p>
              )}
            </>
          )}
        </main>

        {/* ---- dossier ---------------------------------------------------- */}
        <aside className="hidden w-[20rem] shrink-0 overflow-y-auto border-l border-white/10 md:block xl:w-[26rem]">
          {run ? (
            <div className="space-y-4 p-4">
              <video
                key={run.id}
                src={`/api/h3-lab/films?file=${encodeURIComponent(run.file)}`}
                controls
                className="w-full rounded border border-white/10 bg-black"
              />
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <label className="flex flex-col gap-1">
                  <span className="text-neutral-600">length (s)</span>
                  <input type="number" step="0.1" value={run.durationSec}
                    onChange={(e) => patch(run.id, { durationSec: Number(e.target.value) })}
                    className="rounded border border-white/10 bg-transparent px-2 py-1 outline-none" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-neutral-600">shots</span>
                  <input type="number" value={run.shots}
                    onChange={(e) => patch(run.id, { shots: Number(e.target.value) })}
                    className="rounded border border-white/10 bg-transparent px-2 py-1 outline-none" />
                </label>
              </div>
              <label className="flex flex-col gap-1 font-mono text-[11px]">
                <span className="text-neutral-600">settings that actually applied</span>
                <input value={run.settings} placeholder="10 steps · 832x480 · 1 phase"
                  onChange={(e) => patch(run.id, { settings: e.target.value })}
                  className="rounded border border-white/10 bg-transparent px-2 py-1 outline-none" />
              </label>

              <div className="flex gap-1.5">
                {VERDICTS.map((v) => (
                  <button key={v.label}
                    onClick={() => patch(run.id, { verdict: run.verdict === v.value ? null : v.value })}
                    className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
                      run.verdict === v.value ? v.cls : "border-white/10 text-neutral-600 hover:text-neutral-300"
                    }`}>
                    {v.label}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-600">defects</span>
                <div className="flex flex-wrap gap-1.5">
                  {DEFECTS.map((d) => {
                    const on = run.defects.includes(d);
                    return (
                      <button key={d}
                        onClick={() => patch(run.id, {
                          defects: on ? run.defects.filter((x) => x !== d) : [...run.defects, d],
                        })}
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                          on ? "border-rose-500/40 text-rose-300" : "border-white/10 text-neutral-600 hover:text-neutral-400"
                        }`}>
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="flex flex-col gap-1 font-mono text-[11px]">
                <span className="text-neutral-600">what was actually wrong or right</span>
                <textarea rows={6} value={run.notes}
                  onChange={(e) => patch(run.id, { notes: e.target.value })}
                  className="resize-y rounded border border-white/10 bg-transparent px-2 py-1 leading-relaxed outline-none" />
              </label>

              <button
                onClick={() => { commit({ ...state, runs: state.runs.filter((r) => r.id !== run.id) }); setOpenRun(null); }}
                className="font-mono text-[11px] text-neutral-700 hover:text-rose-400"
              >
                remove this record
              </button>
            </div>
          ) : activeSkill ? (
            <div className="space-y-4 p-4">
              <div className="space-y-1">
                <h2 className="font-mono text-[12px] text-neutral-100">{activeSkill.name}</h2>
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
                  <span className="text-neutral-600">{activeSkill.kind}</span>
                  <span className={activeSkill.status === "used" ? "text-neutral-600" : "text-amber-400/80"}>
                    {activeSkill.status}
                  </span>
                </div>
              </div>
              <p className="text-[12px] leading-relaxed text-neutral-400">{activeSkill.description}</p>
              {activeSkill.note && (
                <p className="border-l-2 border-white/10 pl-3 text-[12px] leading-relaxed text-neutral-500">
                  {activeSkill.note}
                </p>
              )}
              {activeSkill.source && (
                activeSkill.source.startsWith("http") ? (
                  <a href={activeSkill.source} target="_blank" rel="noreferrer"
                    className="block break-all font-mono text-[11px] text-neutral-500 underline decoration-white/20 hover:text-neutral-300">
                    {activeSkill.source}
                  </a>
                ) : (
                  <p className="break-all font-mono text-[11px] text-neutral-600">{activeSkill.source}</p>
                )
              )}
              {defectTally(state, activeSkill.name).length > 0 && (
                <div className="space-y-1.5 border-t border-white/10 pt-4">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-600">
                    its defects, counted
                  </span>
                  {defectTally(state, activeSkill.name).map(([d, n]) => (
                    <div key={d} className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="w-6 tabular-nums text-neutral-500">{n}&times;</span>
                      <span className="text-neutral-400">{d}</span>
                    </div>
                  ))}
                </div>
              )}
              {brief && (
                <div className="space-y-1 border-t border-white/10 pt-4">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-600">current brief</span>
                  <p className="text-[12px] leading-relaxed text-neutral-400">{brief.text}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="p-4 font-mono text-[11px] text-neutral-600">Pick a skill.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
