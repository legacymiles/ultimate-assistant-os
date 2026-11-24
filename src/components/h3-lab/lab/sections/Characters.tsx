"use client";

// Character Bible — every character the compiler can write, field by field,
// with a live view of exactly how the compiler writes them.

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Plus, Save, Trash2, UserRound } from "lucide-react";
import type { SectionProps } from "../sections";
import { Chip, Empty, Panel, SectionHead, ago } from "../ui";
import type { Character, LabState } from "@/lib/h3-lab/model";
import { anchorClause } from "@/lib/h3-lab/compile";
import { compileSpec } from "@/lib/h3-lab/state";
import { currentVersion, strategyFor } from "@/lib/h3-lab/guide";
import { ResearchStyles } from "../research/ResearchStyles";
import { RefImages, RulesEditor } from "../research/BibleParts";
import { blankSpec } from "../research/ShotSpecEditor";

type Draft = Omit<Character, "id" | "createdAt" | "updatedAt"> & { id?: string };

const FIELDS: { key: keyof Draft; label: string; hint: string }[] = [
  { key: "identity", label: "Identity", hint: "Who they are in one or two sentences: role, age band, presence." },
  { key: "face", label: "Face", hint: "Shape, skin, eyes, marks — with sides (LEFT / RIGHT) where it matters." },
  { key: "hair", label: "Hair", hint: "Colour, length, cut, parting." },
  { key: "wardrobe", label: "Wardrobe", hint: "Every visible garment, colour first." },
  { key: "body", label: "Body", hint: "Build, height, how they hold themselves." },
  { key: "accessories", label: "Accessories", hint: "Watches, glasses, props they always carry — and which side." },
  { key: "relationships", label: "Relationships", hint: "Who they are to the others." },
];

function blank(): Draft {
  return { name: "", identity: "", face: "", hair: "", wardrobe: "", body: "", accessories: "", relationships: "", referenceImages: [], continuityRules: [] };
}

function fromCharacter(c: Character): Draft {
  return { ...c, referenceImages: [...c.referenceImages], continuityRules: [...c.continuityRules] };
}

function usage(state: LabState, id: string) {
  return {
    scenarios: state.scenarios.filter((s) => s.spec.characterIds.includes(id)),
    productions: state.productions.filter((p) => p.characterIds.includes(id) || p.scenes.some((s) => s.spec.characterIds.includes(id))),
  };
}

export default function Characters({ lab, go, focus }: SectionProps) {
  const state = lab.state;
  const [selId, setSelId] = useState<string | null>(state.characters[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(() => (state.characters[0] ? fromCharacter(state.characters[0]) : null));
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = (id: string | null) => {
    const c = id ? state.characters.find((x) => x.id === id) : null;
    setSelId(c?.id ?? null);
    setDraft(c ? fromCharacter(c) : blank());
    setConfirm(false);
    setErr(null);
  };

  useEffect(() => {
    if (focus && state.characters.some((c) => c.id === focus)) open(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const saved = selId ? state.characters.find((c) => c.id === selId) : null;
  const dirty = draft && (!saved || JSON.stringify(fromCharacter(saved)) !== JSON.stringify(draft));

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return setErr("A character needs a name.");
    setErr(null);
    const clean = { ...draft, name: draft.name.trim(), continuityRules: draft.continuityRules.map((r) => r.trim()).filter(Boolean) };
    const r = await lab.act({ action: "character.save", character: clean }, `Saved ${clean.name}`);
    if (r) {
      const id = r.id ?? clean.id ?? r.state.characters.find((c) => c.name === clean.name)?.id ?? null;
      const c = id ? r.state.characters.find((x) => x.id === id) : null;
      if (c) {
        setSelId(c.id);
        setDraft(fromCharacter(c));
      }
    }
  };

  return (
    <div className="grid rs-root" style={{ gap: 16 }}>
      <ResearchStyles />
      <SectionHead
        eyebrow="Library · Character Bible"
        title="Character Bible"
        lede="H3 keeps a person consistent only as well as the prompt pins them down. “The same character” means nothing to the model; “scar through the LEFT eyebrow, never the right” is a fact it can hold. Write the facts here once — the compiler carries them into every shot."
        actions={<button type="button" className="btn primary" onClick={() => open(null)}><Plus size={14} /> New character</button>}
      />

      <div className="rs-split-wide">
        <Panel title="Cast" meta={`${state.characters.length}`} bodyClass="tbl-wrap">
          {state.characters.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th />
                  <th>Name</th>
                  <th className="hide-sm">Identity</th>
                  <th>Rules</th>
                  <th>Refs</th>
                  <th className="hide-sm">Used in</th>
                  <th className="hide-sm">Updated</th>
                </tr>
              </thead>
              <tbody>
                {state.characters.map((c) => {
                  const u = usage(state, c.id);
                  return (
                    <tr key={c.id} className="clickable" aria-selected={c.id === selId} onClick={() => open(c.id)}>
                      <td>{c.referenceImages[0] ? <img className="rs-thumb-sm" style={{ width: 34, aspectRatio: "1" }} src={c.referenceImages[0]} alt="" /> : <UserRound size={16} className="muted" />}</td>
                      <td style={{ fontWeight: 500 }}>{c.name}</td>
                      <td className="hide-sm dim" style={{ maxWidth: 320 }}>{c.identity}</td>
                      <td className="mono">{c.continuityRules.length}</td>
                      <td className="mono">{c.referenceImages.length}</td>
                      <td className="hide-sm mono muted">{u.scenarios.length} sc · {u.productions.length} prod</td>
                      <td className="hide-sm muted">{ago(c.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="panel-body">
              <Empty title="No characters yet.">
                Add the first one with New character — scenarios and productions pick their cast from here.
              </Empty>
            </div>
          )}
        </Panel>

        {draft ? (
          <div className="grid" style={{ gap: 14 }}>
            <Panel
              title={saved ? `Edit · ${saved.name}` : "New character"}
              actions={
                <span className="row" style={{ gap: 6 }}>
                  {dirty ? <Chip tone="warn">unsaved</Chip> : null}
                  {saved ? (
                    confirm ? (
                      <>
                        <button type="button" className="btn danger sm" onClick={async () => { const r = await lab.act({ action: "character.delete", id: saved.id }, `Deleted ${saved.name}`); if (r) { setSelId(null); setDraft(null); } }}>Delete {saved.name}</button>
                        <button type="button" className="btn ghost sm" onClick={() => setConfirm(false)}>Keep</button>
                      </>
                    ) : (
                      <button type="button" className="btn ghost sm" onClick={() => setConfirm(true)} aria-label="Delete character"><Trash2 size={12} /></button>
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
                        ? `${saved.name} is in ${u.scenarios.length} scenario${u.scenarios.length === 1 ? "" : "s"} and ${u.productions.length} production${u.productions.length === 1 ? "" : "s"}; they lose this character's description.`
                        : `${saved.name} is not used anywhere yet.`;
                    })()}
                  </div>
                ) : null}
                <label className="field">
                  <span>Name</span>
                  <input className="in" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                {FIELDS.map((f) => (
                  <label className="field" key={f.key}>
                    <span>{f.label}</span>
                    <textarea className="in" style={{ minHeight: 52 }} value={String(draft[f.key] ?? "")} placeholder={f.hint} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                  </label>
                ))}
                <RulesEditor rules={draft.continuityRules} onChange={(continuityRules) => setDraft({ ...draft, continuityRules })} hint="Concrete and checkable: sides, colours, counts." />
                <RefImages images={draft.referenceImages} onChange={(referenceImages) => setDraft({ ...draft, referenceImages })} label="<Subject N>, fully preserved" />
                {err ? <div className="notice bad">{err}</div> : null}
                <div className="row">
                  <button type="button" className="btn primary" onClick={() => void save()}><Save size={13} /> {saved ? "Save character" : "Create character"}</button>
                  {saved && dirty ? <button type="button" className="btn ghost" onClick={() => open(saved.id)}>Discard changes</button> : null}
                </div>
              </div>
            </Panel>

            <Preview state={state} draft={draft} />
            {saved ? <UsedIn state={state} id={saved.id} go={go} /> : null}
          </div>
        ) : (
          <Panel title="Character">
            <Empty title="Pick a character, or start a new one.">Every field the compiler writes from lives here.</Empty>
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
    const c: Character = { ...draft, id: draft.id ?? "draft-character", name: draft.name || "Unnamed", createdAt: now, updatedAt: now };
    const spec = { ...blankSpec("character-introduction"), title: "Character preview", characterIds: [c.id], framing: "medium close-up" };
    const strategy = strategyFor(v, spec.genre);
    const compiled = compileSpec({ ...state, characters: [c], environments: [] }, spec, strategy);
    return { anchor: anchorClause(c), compiled, strategy };
  }, [draft, state, v]);
  return (
    <Panel title="How the compiler writes this character" meta={`guide v${v.version} · ${out.compiled.mode}`}>
      <div className="grid" style={{ gap: 10 }}>
        <div>
          <span className="eyebrow">Anchor clause — used in later shots when identity handling is “anchor clause”</span>
          <pre className="prompt" style={{ marginTop: 6 }}>{out.anchor}</pre>
        </div>
        <div>
          <span className="eyebrow">First block — a one-character shot compiled with the master strategy</span>
          <pre className="prompt" style={{ marginTop: 6, maxHeight: 280, overflow: "auto" }}>{out.compiled.prompt}</pre>
        </div>
        <span className="muted" style={{ fontSize: 11.5 }}>
          Only the face, hair, body, wardrobe and (at rich length) accessories reach the prompt; identity and relationships guide the people writing scenes. The first rule leads the anchor clause, so put the most breakable fact first.
        </span>
      </div>
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
