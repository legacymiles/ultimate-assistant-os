"use client";

// Environment Bible — every set the compiler can write, with a live view of
// how it is written under the two set-description techniques.

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Building2, Plus, Save, Trash2 } from "lucide-react";
import type { SectionProps } from "../sections";
import { Chip, Empty, Panel, SectionHead, ago, diffWords } from "../ui";
import type { Environment, LabState } from "@/lib/h3-lab/model";
import { compileSpec } from "@/lib/h3-lab/state";
import { currentVersion, strategyFor } from "@/lib/h3-lab/guide";
import { ResearchStyles } from "../research/ResearchStyles";
import { RefImages, RulesEditor } from "../research/BibleParts";
import { blankSpec } from "../research/ShotSpecEditor";

type Draft = Omit<Environment, "id" | "createdAt" | "updatedAt"> & { id?: string };

const FIELDS: { key: keyof Draft; label: string; hint: string }[] = [
  { key: "description", label: "Description", hint: "The place in two sentences: what it is, when, what it feels like." },
  { key: "architecture", label: "Architecture", hint: "Walls, ceiling, floor, materials." },
  { key: "furniture", label: "Furniture", hint: "Each piece and where it stands relative to the others." },
  { key: "doorsWindows", label: "Doors & windows", hint: "Which wall, which side, what is beyond." },
  { key: "lighting", label: "Lighting", hint: "Sources, colour, direction." },
  { key: "objects", label: "Objects", hint: "The 3–4 hero objects a viewer would remember." },
  { key: "cameraPerspectives", label: "Camera perspectives", hint: "The angles this set is usually shot from." },
  { key: "spatial", label: "Spatial layout", hint: "Left / right / far / near — the map a shot must respect." },
];

function blank(): Draft {
  return { name: "", description: "", architecture: "", furniture: "", doorsWindows: "", lighting: "", objects: "", cameraPerspectives: "", spatial: "", referenceImages: [], continuityRules: [] };
}

function fromEnv(e: Environment): Draft {
  return { ...e, referenceImages: [...e.referenceImages], continuityRules: [...e.continuityRules] };
}

function usage(state: LabState, id: string) {
  return {
    scenarios: state.scenarios.filter((s) => s.spec.environmentId === id),
    productions: state.productions.filter((p) => p.environmentIds.includes(id) || p.scenes.some((s) => s.spec.environmentId === id)),
  };
}

export default function Environments({ lab, go, focus }: SectionProps) {
  const state = lab.state;
  const [selId, setSelId] = useState<string | null>(state.environments[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(() => (state.environments[0] ? fromEnv(state.environments[0]) : null));
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = (id: string | null) => {
    const e = id ? state.environments.find((x) => x.id === id) : null;
    setSelId(e?.id ?? null);
    setDraft(e ? fromEnv(e) : blank());
    setConfirm(false);
    setErr(null);
  };

  useEffect(() => {
    if (focus && state.environments.some((e) => e.id === focus)) open(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const saved = selId ? state.environments.find((e) => e.id === selId) : null;
  const dirty = draft && (!saved || JSON.stringify(fromEnv(saved)) !== JSON.stringify(draft));

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return setErr("An environment needs a name.");
    setErr(null);
    const clean = { ...draft, name: draft.name.trim(), continuityRules: draft.continuityRules.map((r) => r.trim()).filter(Boolean) };
    const r = await lab.act({ action: "environment.save", environment: clean }, `Saved ${clean.name}`);
    if (r) {
      const id = r.id ?? clean.id ?? r.state.environments.find((e) => e.name === clean.name)?.id ?? null;
      const e = id ? r.state.environments.find((x) => x.id === id) : null;
      if (e) {
        setSelId(e.id);
        setDraft(fromEnv(e));
      }
    }
  };

  return (
    <div className="grid rs-root" style={{ gap: 16 }}>
      <ResearchStyles />
      <SectionHead
        eyebrow="Library · Environment Bible"
        title="Environment Bible"
        lede="Sets drift when they are described by mood alone: the sofa swaps sides, the door moves walls. Record where things are once — the compiler writes it as a layout or as a mood depending on the technique in force."
        actions={<button type="button" className="btn primary" onClick={() => open(null)}><Plus size={14} /> New environment</button>}
      />

      <div className="rs-split-wide">
        <Panel title="Sets" meta={`${state.environments.length}`} bodyClass="tbl-wrap">
          {state.environments.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th />
                  <th>Name</th>
                  <th className="hide-sm">Description</th>
                  <th>Rules</th>
                  <th>Refs</th>
                  <th className="hide-sm">Used in</th>
                  <th className="hide-sm">Updated</th>
                </tr>
              </thead>
              <tbody>
                {state.environments.map((e) => {
                  const u = usage(state, e.id);
                  return (
                    <tr key={e.id} className="clickable" aria-selected={e.id === selId} onClick={() => open(e.id)}>
                      <td>{e.referenceImages[0] ? <img className="rs-thumb-sm" style={{ width: 48 }} src={e.referenceImages[0]} alt="" /> : <Building2 size={16} className="muted" />}</td>
                      <td style={{ fontWeight: 500 }}>{e.name}</td>
                      <td className="hide-sm dim" style={{ maxWidth: 320 }}>{e.description}</td>
                      <td className="mono">{e.continuityRules.length}</td>
                      <td className="mono">{e.referenceImages.length}</td>
                      <td className="hide-sm mono muted">{u.scenarios.length} sc · {u.productions.length} prod</td>
                      <td className="hide-sm muted">{ago(e.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="panel-body">
              <Empty title="No environments yet.">Add the first set with New environment — scenarios and productions pick their location from here.</Empty>
            </div>
          )}
        </Panel>

        {draft ? (
          <div className="grid" style={{ gap: 14 }}>
            <Panel
              title={saved ? `Edit · ${saved.name}` : "New environment"}
              actions={
                <span className="row" style={{ gap: 6 }}>
                  {dirty ? <Chip tone="warn">unsaved</Chip> : null}
                  {saved ? (
                    confirm ? (
                      <>
                        <button type="button" className="btn danger sm" onClick={async () => { const r = await lab.act({ action: "environment.delete", id: saved.id }, `Deleted ${saved.name}`); if (r) { setSelId(null); setDraft(null); } }}>Delete {saved.name}</button>
                        <button type="button" className="btn ghost sm" onClick={() => setConfirm(false)}>Keep</button>
                      </>
                    ) : (
                      <button type="button" className="btn ghost sm" onClick={() => setConfirm(true)} aria-label="Delete environment"><Trash2 size={12} /></button>
                    )
                  ) : null}
                </span>
              }
            >
              <div className="grid" style={{ gap: 12 }}>
                {confirm && saved ? (
                  <div className="notice bad">
                    {(() => {
                      const u = usage(state, saved.id);
                      return u.scenarios.length || u.productions.length
                        ? `${saved.name} is the set of ${u.scenarios.length} scenario${u.scenarios.length === 1 ? "" : "s"} and ${u.productions.length} production${u.productions.length === 1 ? "" : "s"}; they lose this set's description.`
                        : `${saved.name} is not used anywhere yet.`;
                    })()}
                  </div>
                ) : null}
                <label className="field">
                  <span>Name</span>
                  <input className="in" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <div className="rs-form">
                  {FIELDS.map((f) => (
                    <label className={`field ${f.key === "description" || f.key === "spatial" ? "span" : ""}`} key={f.key}>
                      <span>{f.label}</span>
                      <textarea className="in" style={{ minHeight: 52 }} value={String(draft[f.key] ?? "")} placeholder={f.hint} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                    </label>
                  ))}
                </div>
                <RulesEditor rules={draft.continuityRules} onChange={(continuityRules) => setDraft({ ...draft, continuityRules })} hint="e.g. Door on the far LEFT wall; the sofa always faces the window." />
                <RefImages images={draft.referenceImages} onChange={(referenceImages) => setDraft({ ...draft, referenceImages })} label="the set, partially preserved" />
                {err ? <div className="notice bad">{err}</div> : null}
                <div className="row">
                  <button type="button" className="btn primary" onClick={() => void save()}><Save size={13} /> {saved ? "Save environment" : "Create environment"}</button>
                  {saved && dirty ? <button type="button" className="btn ghost" onClick={() => open(saved.id)}>Discard changes</button> : null}
                </div>
              </div>
            </Panel>

            <Preview state={state} draft={draft} />
            {saved ? <UsedIn state={state} id={saved.id} go={go} /> : null}
          </div>
        ) : (
          <Panel title="Environment">
            <Empty title="Pick a set, or start a new one.">Every field the compiler writes from lives here.</Empty>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Preview({ state, draft }: { state: LabState; draft: Draft }) {
  const v = currentVersion(state.guide);
  const out = useMemo(() => {
    const now = new Date(0).toISOString();
    const e: Environment = { ...draft, id: draft.id ?? "draft-environment", name: draft.name || "Unnamed set", createdAt: now, updatedAt: now };
    const spec = { ...blankSpec("movie-scene"), title: "Set preview", environmentId: e.id, framing: "wide establishing shot" };
    const s = { ...state, environments: [e], characters: [] };
    const layout = compileSpec(s, spec, strategyFor(v, spec.genre, { environment: "layout-explicit" }));
    const mood = compileSpec(s, spec, strategyFor(v, spec.genre, { environment: "mood-only" }));
    const master = strategyFor(v, spec.genre).environment;
    return { layout, mood, master, diff: diffWords(mood.prompt, layout.prompt) };
  }, [draft, state, v]);
  return (
    <Panel title="How the compiler writes this set" meta={`guide v${v.version} · master uses ${out.master}`}>
      <div className="rs-split" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
        <div>
          <span className="row" style={{ gap: 6 }}>
            <span className="eyebrow">Mood only</span>
            {out.master === "mood-only" ? <Chip tone="amber">master</Chip> : null}
            <span className="mono muted" style={{ fontSize: 11 }}>{out.mood.chars} ch</span>
          </span>
          <pre className="prompt" style={{ marginTop: 6, maxHeight: 300, overflow: "auto" }}>{out.mood.prompt}</pre>
        </div>
        <div>
          <span className="row" style={{ gap: 6 }}>
            <span className="eyebrow">Layout explicit</span>
            {out.master === "layout-explicit" ? <Chip tone="amber">master</Chip> : null}
            <span className="mono muted" style={{ fontSize: 11 }}>{out.layout.chars} ch · diff vs mood</span>
          </span>
          <pre className="prompt" style={{ marginTop: 6, maxHeight: 300, overflow: "auto" }} dangerouslySetInnerHTML={{ __html: out.diff }} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0" }}>
        Layout explicit writes architecture, doors and windows, furniture and the spatial map; mood only writes the description, light and hero objects. Camera perspectives and rules guide the people writing shots.
      </p>
    </Panel>
  );
}

function UsedIn({ state, id, go }: { state: LabState; id: string; go: SectionProps["go"] }) {
  const u = usage(state, id);
  if (!u.scenarios.length && !u.productions.length) return <p className="muted" style={{ margin: 0 }}>Not in any scenario or production yet.</p>;
  return (
    <Panel title="Used in">
      <div className="grid" style={{ gap: 8 }}>
        {u.scenarios.length ? (
          <div className="rs-pill-list">
            <span className="eyebrow" style={{ marginRight: 6 }}>Scenarios</span>
            {u.scenarios.map((s) => <button key={s.id} type="button" className="btn sm" onClick={() => go("lab")}>{s.title}</button>)}
          </div>
        ) : null}
        {u.productions.length ? (
          <div className="rs-pill-list">
            <span className="eyebrow" style={{ marginRight: 6 }}>Productions</span>
            {u.productions.map((p) => <button key={p.id} type="button" className="btn sm" onClick={() => go("productions", p.id)}>{p.title} <ArrowUpRight size={11} /></button>)}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
