"use client";

// Production Library — multi-scene films built on the bibles. Scenes are
// ShotSpecs; "Compile prompts" freezes each scene's prompt with the guide
// version it was written under, and the continuity strip shows every join.

import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronDown, ChevronRight, Clapperboard, Cpu, Pencil, Play, Plus, Save, Trash2 } from "lucide-react";
import type { SectionProps } from "../sections";
import { Chip, Empty, Panel, SectionHead, StatusChip, ago, useFrames } from "../ui";
import type { Generation, LabState, Production, ProductionScene, ShotSpec } from "@/lib/h3-lab/model";
import { currentVersion } from "@/lib/h3-lab/guide";
import { genreName } from "@/lib/h3-lab/genres";
import { ResearchStyles } from "../research/ResearchStyles";
import { GenreSelect, ShotSpecEditor, blankSpec } from "../research/ShotSpecEditor";
import { RulesEditor } from "../research/BibleParts";
import { fmtMinutes, renderEstimate, rendersLeftToday } from "../research/helpers";

const sceneId = () => `scene-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function sceneGens(state: LabState, sc: ProductionScene): Generation[] {
  return sc.generationIds.map((id) => state.generations.find((g) => g.id === id)).filter((g): g is Generation => Boolean(g));
}

function latestDone(state: LabState, sc: ProductionScene): Generation | null {
  const done = sceneGens(state, sc).filter((g) => g.status === "done");
  return done[done.length - 1] ?? null;
}

export default function Productions({ lab, go, focus }: SectionProps) {
  const state = lab.state;
  const [selId, setSelId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const list = [...state.productions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selected = state.productions.find((p) => p.id === selId) ?? null;

  useEffect(() => {
    if (focus && state.productions.some((p) => p.id === focus)) setSelId(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const create = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const r = await lab.act({ action: "production.save", production: { title, genre: "movie-scene", scenes: [], characterIds: [], environmentIds: [], continuityRules: [] } }, `Created ${title}`);
    if (r) {
      const id = r.id ?? r.state.productions.find((p) => p.title === title)?.id ?? null;
      setSelId(id);
      setNewTitle("");
      setCreating(false);
    }
  };

  return (
    <div className="grid rs-root" style={{ gap: 16 }}>
      <ResearchStyles />
      <SectionHead
        eyebrow="Library · Production Library"
        title="Productions"
        lede="A production is a film in scenes. Each scene is a shot spec the compiler writes with the approved guide; compiling freezes the prompt with its guide version, so a later guide change never silently rewrites a scene."
        actions={<button type="button" className="btn primary" onClick={() => setCreating(true)}><Plus size={14} /> New production</button>}
      />

      {creating ? (
        <Panel title="New production" actions={<button type="button" className="btn ghost sm" onClick={() => setCreating(false)}>Cancel</button>}>
          <form className="row" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input className="in" style={{ maxWidth: 420 }} autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title" aria-label="Production title" />
            <button type="submit" className="btn primary"><Save size={13} /> Create</button>
          </form>
        </Panel>
      ) : null}

      <Panel title="Library" meta={`${list.length}`} bodyClass="tbl-wrap">
        {list.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Title</th>
                <th>Genre</th>
                <th>Scenes</th>
                <th className="hide-sm">Rendered</th>
                <th className="hide-sm">Cast</th>
                <th className="hide-sm">From</th>
                <th className="hide-sm">Updated</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const rendered = p.scenes.filter((s) => latestDone(state, s)).length;
                return (
                  <tr key={p.id} className="clickable" aria-selected={p.id === selId} onClick={() => setSelId(p.id)}>
                    <td className="serif" style={{ fontSize: 16 }}>{p.title}</td>
                    <td className="dim">{genreName(p.genre)}</td>
                    <td className="mono">{p.scenes.length}</td>
                    <td className="hide-sm mono">{rendered}/{p.scenes.length}</td>
                    <td className="hide-sm dim">{p.characterIds.map((id) => state.characters.find((c) => c.id === id)?.name ?? "?").join(", ") || "—"}</td>
                    <td className="hide-sm">{p.blueprintId ? <Chip tone="cyan">blueprint</Chip> : <Chip>owner</Chip>}</td>
                    <td className="hide-sm muted">{ago(p.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="panel-body">
            <Empty title="No productions yet.">
              Start one with New production, or rebuild a reference's structure in{" "}
              <button type="button" className="btn sm" onClick={() => go("reverse")}>Video Reverse Engineering</button>
            </Empty>
          </div>
        )}
      </Panel>

      {selected ? <Detail key={selected.id} p={selected} lab={lab} go={go} onDeleted={() => setSelId(null)} /> : null}
    </div>
  );
}

// ----- detail ------------------------------------------------------------------------

type Meta = Pick<Production, "title" | "genre" | "logline" | "style" | "story" | "cameraLanguage" | "continuityRules" | "characterIds" | "environmentIds">;

function metaOf(p: Production): Meta {
  return {
    title: p.title,
    genre: p.genre,
    logline: p.logline ?? "",
    style: p.style ?? "",
    story: p.story ?? "",
    cameraLanguage: p.cameraLanguage ?? "",
    continuityRules: [...(p.continuityRules ?? [])],
    characterIds: [...(p.characterIds ?? [])],
    environmentIds: [...(p.environmentIds ?? [])],
  };
}

function Detail({ p, lab, go, onDeleted }: { p: Production; lab: SectionProps["lab"]; go: SectionProps["go"]; onDeleted: () => void }) {
  const state = lab.state;
  const v = currentVersion(state.guide);
  const [meta, setMeta] = useState<Meta>(() => metaOf(p));
  const [editMeta, setEditMeta] = useState(false);
  const [sceneEdit, setSceneEdit] = useState<{ id: string | null; spec: ShotSpec } | null>(null);
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const scenes = [...p.scenes].sort((a, b) => a.order - b.order);
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  const saveScenes = (next: ProductionScene[], label: string) =>
    lab.act({ action: "production.save", production: { id: p.id, title: p.title, scenes: next.map((s, i) => ({ ...s, order: i })) } }, label);

  const estimate = useMemo(() => {
    let total = 0;
    let known = true;
    let basis = "";
    for (const s of scenes) {
      const e = renderEstimate(state, s.spec);
      basis = e.basis;
      if (e.minutes === null) known = false;
      else total += e.minutes;
    }
    return { minutes: known ? Math.round(total * 10) / 10 : null, basis };
  }, [scenes, state]);

  const move = (i: number, d: -1 | 1) => {
    const next = [...scenes];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void saveScenes(next, "Scene order saved");
  };

  const saveScene = async () => {
    if (!sceneEdit) return;
    const next = sceneEdit.id
      ? scenes.map((s) => (s.id === sceneEdit.id ? { ...s, spec: sceneEdit.spec } : s))
      : [...scenes, { id: sceneId(), order: scenes.length, spec: sceneEdit.spec, generationIds: [] }];
    const r = await saveScenes(next, sceneEdit.id ? "Scene saved" : "Scene added");
    if (r) setSceneEdit(null);
  };

  const left = rendersLeftToday(state);
  const stale = scenes.filter((s) => s.compiled && s.compiled.guideVersion !== v.version).length;

  return (
    <div className="grid" style={{ gap: 14 }}>
      <Panel
        className="rs-arm"
        title={<span className="serif" style={{ fontSize: 24 }}>{p.title}</span>}
        meta={`${genreName(p.genre)} · ${scenes.length} scene${scenes.length === 1 ? "" : "s"}`}
        actions={
          <span className="row" style={{ gap: 6 }}>
            {p.blueprintId ? <button type="button" className="btn sm" onClick={() => go("reverse", p.blueprintId ?? undefined)}>Blueprint <ArrowUpRight size={11} /></button> : null}
            <button type="button" className="btn sm" onClick={() => { setMeta(metaOf(p)); setEditMeta((e) => !e); }}><Pencil size={12} /> {editMeta ? "Close" : "Edit details"}</button>
            {confirm ? (
              <>
                <button type="button" className="btn danger sm" onClick={async () => { const r = await lab.act({ action: "production.delete", id: p.id }, `Deleted ${p.title}`); if (r) onDeleted(); }}>Delete production</button>
                <button type="button" className="btn ghost sm" onClick={() => setConfirm(false)}>Keep</button>
              </>
            ) : (
              <button type="button" className="btn ghost sm" onClick={() => setConfirm(true)} aria-label="Delete production"><Trash2 size={12} /></button>
            )}
          </span>
        }
      >
        {editMeta ? (
          <div className="grid" style={{ gap: 12 }}>
            <div className="rs-form">
              <label className="field"><span>Title</span><input className="in" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></label>
              <label className="field"><span>Genre</span><GenreSelect value={meta.genre} onChange={(genre) => setMeta({ ...meta, genre })} /></label>
              <label className="field span"><span>Logline</span><input className="in" value={meta.logline} onChange={(e) => setMeta({ ...meta, logline: e.target.value })} /></label>
              <label className="field"><span>Style</span><input className="in" value={meta.style} onChange={(e) => setMeta({ ...meta, style: e.target.value })} /></label>
              <label className="field"><span>Camera language</span><input className="in" value={meta.cameraLanguage} onChange={(e) => setMeta({ ...meta, cameraLanguage: e.target.value })} /></label>
              <label className="field span"><span>Story</span><textarea className="in" value={meta.story} onChange={(e) => setMeta({ ...meta, story: e.target.value })} /></label>
            </div>
            <div className="rs-form">
              <div className="field">
                <span className="eyebrow">Cast</span>
                <div className="rs-pill-list">
                  {state.characters.map((c) => (
                    <label className="rs-check" key={c.id}><input type="checkbox" checked={meta.characterIds.includes(c.id)} onChange={() => setMeta({ ...meta, characterIds: toggle(meta.characterIds, c.id) })} />{c.name}</label>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="eyebrow">Sets</span>
                <div className="rs-pill-list">
                  {state.environments.map((e) => (
                    <label className="rs-check" key={e.id}><input type="checkbox" checked={meta.environmentIds.includes(e.id)} onChange={() => setMeta({ ...meta, environmentIds: toggle(meta.environmentIds, e.id) })} />{e.name}</label>
                  ))}
                </div>
              </div>
            </div>
            <RulesEditor rules={meta.continuityRules} onChange={(continuityRules) => setMeta({ ...meta, continuityRules })} hint="Appended to every scene's closing block when the production compiles." />
            <div className="row">
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  if (!meta.title.trim()) return;
                  const r = await lab.act({ action: "production.save", production: { id: p.id, ...meta, title: meta.title.trim(), continuityRules: meta.continuityRules.map((x) => x.trim()).filter(Boolean) } }, "Production saved");
                  if (r) setEditMeta(false);
                }}
              >
                <Save size={13} /> Save details
              </button>
              <button type="button" className="btn ghost" onClick={() => setEditMeta(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <dl className="rs-kv" style={{ margin: 0 }}>
            <dt>Logline</dt><dd style={{ color: "var(--ink)" }}>{p.logline || <span className="muted">not written</span>}</dd>
            <dt>Style</dt><dd>{p.style || "—"}</dd>
            <dt>Camera</dt><dd>{p.cameraLanguage || "—"}</dd>
            <dt>Cast</dt><dd>{p.characterIds.map((id) => state.characters.find((c) => c.id === id)?.name ?? "?").join(", ") || "—"}</dd>
            <dt>Sets</dt><dd>{p.environmentIds.map((id) => state.environments.find((e) => e.id === id)?.name ?? "?").join(", ") || "—"}</dd>
            <dt>Rules</dt><dd>{p.continuityRules.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{p.continuityRules.map((r) => <li key={r}>{r}</li>)}</ul> : "—"}</dd>
            {p.story ? (<><dt>Story</dt><dd style={{ whiteSpace: "pre-wrap" }}>{p.story}</dd></>) : null}
          </dl>
        )}
      </Panel>

      <Panel
        title="Scenes"
        meta={stale ? `${stale} compiled under an older guide` : undefined}
        actions={
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm" onClick={() => setSceneEdit({ id: null, spec: { ...blankSpec(p.genre), style: p.style || blankSpec().style, characterIds: [...p.characterIds], environmentId: p.environmentIds[0] ?? null } })}>
              <Plus size={12} /> Scene
            </button>
            {scenes.length ? (
              <>
                <button type="button" className="btn sm" onClick={() => void lab.act({ action: "production.compile", id: p.id }, "Prompts compiled")}><Cpu size={12} /> Compile prompts</button>
                <button type="button" className="btn sm primary" onClick={() => void lab.act({ action: "production.render", id: p.id }, `Queued ${scenes.length} scene render${scenes.length === 1 ? "" : "s"}`)}>
                  <Play size={12} /> Render all scenes
                </button>
              </>
            ) : null}
          </span>
        }
        bodyClass="tbl-wrap"
      >
        {scenes.length ? (
          <>
            <p className="muted" style={{ margin: 0, padding: "8px 14px", fontSize: 12 }}>
              Render all = <span className="mono">{scenes.length}</span> render{scenes.length === 1 ? "" : "s"} ≈ <span className="mono">{fmtMinutes(estimate.minutes)}</span> at {state.agent.quality} ({estimate.basis}) · <span className="mono">{left}</span> renders left today.
            </p>
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Scene</th>
                  <th className="hide-sm">Camera</th>
                  <th className="hide-sm">Action</th>
                  <th>Prompt</th>
                  <th>Renders</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scenes.map((sc, i) => {
                  const gens = sceneGens(state, sc);
                  const isOpen = openPrompt === sc.id;
                  return (
                    <Fragment key={sc.id}>
                      <tr>
                        <td className="mono">{i + 1}</td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{sc.spec.title || `Scene ${i + 1}`}</div>
                          <span className="mono muted" style={{ fontSize: 11 }}>{sc.spec.durationSec}s · {sc.spec.framing}</span>
                        </td>
                        <td className="hide-sm mono" style={{ fontSize: 11.5 }}>{sc.spec.camera.move}<br /><span className="muted">{sc.spec.camera.amount} · {sc.spec.camera.speed}</span></td>
                        <td className="hide-sm dim" style={{ maxWidth: 340, fontSize: 12 }}>{sc.spec.action || <span className="muted">no action written</span>}</td>
                        <td>
                          {sc.compiled ? (
                            <button type="button" className="btn ghost sm" onClick={() => setOpenPrompt(isOpen ? null : sc.id)} aria-expanded={isOpen}>
                              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              <Chip tone={sc.compiled.guideVersion === v.version ? "amber" : "warn"}>v{sc.compiled.guideVersion}</Chip>
                            </button>
                          ) : (
                            <span className="muted">not compiled</span>
                          )}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                            <SceneThumb g={latestDone(state, sc)} />
                            <span className="rs-pill-list">{gens.slice(-3).map((g) => <StatusChip key={g.id} status={g.status} />)}</span>
                          </div>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button type="button" className="btn ghost sm" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={12} /></button>
                          <button type="button" className="btn ghost sm" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === scenes.length - 1}><ArrowDown size={12} /></button>
                          <button type="button" className="btn ghost sm" aria-label="Edit scene" onClick={() => setSceneEdit({ id: sc.id, spec: { ...sc.spec, camera: { ...sc.spec.camera }, beats: [...sc.spec.beats], dialogue: sc.spec.dialogue.map((d) => ({ ...d })), characterIds: [...sc.spec.characterIds], intentionalChanges: [...sc.spec.intentionalChanges] } })}><Pencil size={12} /></button>
                          <button type="button" className="btn sm" title={`≈ ${fmtMinutes(renderEstimate(state, sc.spec).minutes)}`} onClick={() => void lab.act({ action: "production.render", id: p.id, sceneIds: [sc.id] }, `Queued scene ${i + 1}`)}><Play size={11} /> Render</button>
                          <button type="button" className="btn ghost sm" aria-label="Remove scene" onClick={() => void saveScenes(scenes.filter((s) => s.id !== sc.id), "Scene removed")}><Trash2 size={12} /></button>
                        </td>
                      </tr>
                      {isOpen && sc.compiled ? (
                        <tr>
                          <td />
                          <td colSpan={6}>
                            <span className="muted mono" style={{ fontSize: 11 }}>frozen {ago(sc.compiled.at)} under guide v{sc.compiled.guideVersion}{sc.compiled.guideVersion !== v.version ? ` — the guide is now v${v.version}; compile again to update` : ""}</span>
                            <pre className="prompt" style={{ marginTop: 6 }}>{sc.compiled.prompt}</pre>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <div className="panel-body">
            <Empty title="No scenes yet.">Add the first scene — a shot spec with cast, set, camera and action.</Empty>
          </div>
        )}
      </Panel>

      {sceneEdit ? (
        <Panel title={sceneEdit.id ? "Edit scene" : "New scene"} actions={<button type="button" className="btn ghost sm" onClick={() => setSceneEdit(null)}>Cancel</button>}>
          <div className="grid" style={{ gap: 12 }}>
            <ShotSpecEditor value={sceneEdit.spec} onChange={(spec) => setSceneEdit({ ...sceneEdit, spec })} characters={state.characters} environments={state.environments} />
            <div className="row">
              <button type="button" className="btn primary" onClick={() => void saveScene()}><Save size={13} /> Save scene</button>
              <button type="button" className="btn ghost" onClick={() => setSceneEdit(null)}>Cancel</button>
            </div>
          </div>
        </Panel>
      ) : null}

      {scenes.length > 1 ? (
        <Panel title={<span className="row" style={{ gap: 8 }}><Clapperboard size={14} /> Continuity strip</span>} meta="each join: the last frame out, the first frame in">
          <div className="rs-strip" style={{ gap: 14 }}>
            {scenes.slice(0, -1).map((sc, i) => (
              <Join key={sc.id} a={latestDone(state, sc)} b={latestDone(state, scenes[i + 1])} n={i + 1} go={go} />
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function SceneThumb({ g }: { g: Generation | null }) {
  const frames = useFrames(g?.id, g?.frameCount);
  if (!g) return null;
  return frames[0] ? <img className="rs-thumb-sm" src={frames[Math.floor(frames.length / 2)]} alt="Latest render" /> : <span className="rs-thumb-sm" />;
}

function Join({ a, b, n, go }: { a: Generation | null; b: Generation | null; n: number; go: SectionProps["go"] }) {
  const fa = useFrames(a?.id, a?.frameCount);
  const fb = useFrames(b?.id, b?.frameCount);
  const out = fa[fa.length - 1];
  const inn = fb[0];
  return (
    <div className="grid" style={{ gap: 4 }}>
      <span className="eyebrow">Scene {n} → {n + 1}</span>
      <div className="row" style={{ gap: 3, flexWrap: "nowrap" }}>
        <div className="rs-frame">
          {out ? <img src={out} alt={`Scene ${n} last frame`} /> : <div className="thumb" style={{ display: "grid", placeItems: "center" }}><span className="muted" style={{ fontSize: 10.5 }}>not rendered</span></div>}
          <span className="tc">out</span>
        </div>
        <div className="rs-frame">
          {inn ? <img src={inn} alt={`Scene ${n + 1} first frame`} /> : <div className="thumb" style={{ display: "grid", placeItems: "center" }}><span className="muted" style={{ fontSize: 10.5 }}>not rendered</span></div>}
          <span className="tc">in</span>
        </div>
      </div>
      {b ? (
        <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => go("inspector", b.id)}>
          {b.issues?.length ? <Chip tone="warn">{b.issues.length} issue{b.issues.length === 1 ? "" : "s"}</Chip> : null} Inspect <ArrowUpRight size={11} />
        </button>
      ) : null}
    </div>
  );
}
