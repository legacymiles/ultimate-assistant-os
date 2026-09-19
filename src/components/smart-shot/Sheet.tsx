"use client";

// ---------------------------------------------------------------------------
// The shot-plan sheet — one tall production document in the OpenArt Smart
// Shot layout: shared choices, Section 1 character / product reference,
// Section 2 environment / set design with a floor plan, Section 3 the cut
// storyboard, Section 4 lighting / mood / style notes. Every word is editable
// in place and every picture can be redrawn.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { DirectorChat } from "./DirectorChat";
import { Icon } from "../icons";
import { APERTURES, FRAMINGS, LENSES, MOVES } from "@/lib/smart-shot/constants";
import { panelFor } from "@/lib/smart-shot/panels";
import type { Panel, PanelKind, Plan, PlanCut } from "@/lib/smart-shot/types";
import type { Studio } from "./studio";

export function Sheet({ s }: { s: Studio }) {
  const plan = s.project.plan!;
  const panels = s.project.panels;
  const drawing = panels.filter((p) => p.status === "drawing").length;
  const missing = panels.filter((p) => p.status !== "done").length;
  const [exporting, setExporting] = useState(false);
  const chatInput = useRef<HTMLTextAreaElement>(null);
  const lastFull = s.project.takes.filter((t) => t.cutId === null).pop();
  const total = plan.cuts.reduce((a, c) => a + c.durationSec, 0);

  const downloadSheet = async () => {
    setExporting(true);
    const url = await s.composeSheet();
    setExporting(false);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${plan.title.replace(/[^\w-]+/g, "-").toLowerCase()}-shot-plan.jpg`;
    a.click();
  };

  const section1Title =
    plan.products.length && !plan.characters.length
      ? "SECTION 1: PRODUCT / HERO OBJECT REFERENCE"
      : plan.products.length
        ? "SECTION 1: CHARACTER + PRODUCT REFERENCE"
        : "SECTION 1: CHARACTER REFERENCE";

  return (
    <div className="ss-sheetlayout">
    <div className="ss-sheetwrap">
      <div className="ss-toolbar">
        <div>
          <div className="ss-label">Shot plan · {plan.cuts.length} cuts · {total}s</div>
          <Editable value={plan.title} onChange={(title) => s.updatePlan((p) => ({ ...p, title }))} className="ss-title" />
        </div>
        <div className="ss-toolbar-actions">
          {drawing > 0 && (
            <span className="ss-status">
              <span className="ss-dot" /> drawing {drawing} panel{drawing === 1 ? "" : "s"}…
            </span>
          )}
          {drawing === 0 && missing > 0 && (
            <button type="button" className="ss-btn" onClick={s.drawAll}>
              <Icon.Refresh width={13} height={13} /> Draw {missing} missing
            </button>
          )}
          <button type="button" className="ss-btn" onClick={downloadSheet} disabled={drawing > 0 || exporting}>
            <Icon.Download width={13} height={13} /> {exporting ? "Composing…" : "Sheet"}
          </button>
          <button type="button" className="ss-btn" onClick={() => s.setStage("brief")}>
            <Icon.ArrowLeft width={13} height={13} /> Brief
          </button>
          <button type="button" className="ss-primary" onClick={s.startVideo} disabled={drawing > 0 || s.chatBusy}>
            <Icon.Film width={14} height={14} /> Create video
          </button>
        </div>
      </div>

      <div className="ss-sheet">
        {/* ----- shared choices strip ----- */}
        <div className="ss-strip">
          <span className="ss-strip-k">SHARED CHOICES</span>
          <span>
            <b>Cut Count:</b> {plan.cuts.length}
          </span>
          <span>
            <b>Aspect:</b> {s.project.brief.aspectRatio}
          </span>
          <span className="ss-strip-short">
            <b>Lighting:</b>
            <Editable value={plan.lightingNote} onChange={(lightingNote) => s.updatePlan((p) => ({ ...p, lightingNote: lightingNote.toUpperCase() }))} />
          </span>
          <span className="ss-strip-short">
            <b>Lens:</b>
            <Editable value={plan.lensNote} onChange={(lensNote) => s.updatePlan((p) => ({ ...p, lensNote: lensNote.toUpperCase() }))} />
          </span>
          <span className="ss-strip-pal">
            <b>Palette:</b>
            <Swatches colors={plan.palette} compact />
            <Editable value={plan.paletteNote} onChange={(paletteNote) => s.updatePlan((p) => ({ ...p, paletteNote }))} />
          </span>
          <span className="ss-strip-fp">
            <b>Environment Fingerprint:</b>
            <Editable value={plan.environmentFingerprint} onChange={(environmentFingerprint) => s.updatePlan((p) => ({ ...p, environmentFingerprint }))} />
          </span>
        </div>

        <div className="ss-row2">
          {/* ----- section 1: character / product reference ----- */}
          <section className="ss-section">
            <h3>{section1Title}</h3>
            <div className="ss-chars">
              {plan.characters.map((c) => (
                <div key={c.id} className="ss-char">
                  <Editable value={c.name} className="ss-h" onChange={(name) => s.updatePlan((p) => ({ ...p, characters: p.characters.map((x) => (x.id === c.id ? { ...x, name: name.toUpperCase() } : x)) }))} />
                  <PanelImg s={s} kind="character" targetId={c.id} square />
                  <Swatches colors={c.palette} />
                  <Editable value={c.look} className="ss-small" placeholder="Look — age, face, hair, build" multiline onChange={(look) => s.updatePlan((p) => ({ ...p, characters: p.characters.map((x) => (x.id === c.id ? { ...x, look } : x)) }))} />
                  <Editable value={c.wardrobe} className="ss-small" placeholder="Wardrobe" multiline onChange={(wardrobe) => s.updatePlan((p) => ({ ...p, characters: p.characters.map((x) => (x.id === c.id ? { ...x, wardrobe } : x)) }))} />
                </div>
              ))}
              {plan.products.map((pr) => (
                <div key={pr.id} className="ss-char ss-product">
                  <Editable value={pr.name} className="ss-h" onChange={(name) => s.updatePlan((p) => ({ ...p, products: p.products.map((x) => (x.id === pr.id ? { ...x, name: name.toUpperCase() } : x)) }))} />
                  <PanelImg s={s} kind="product" targetId={pr.id} />
                  <div className="ss-product-views">
                    {["1. FRONT VIEW", "2. THREE-QUARTER", "3. SIDE / EDGE", "4. MACRO DETAIL", "5. IN-CONTEXT"].map((v) => (
                      <span key={v}>{v}</span>
                    ))}
                  </div>
                  <Swatches colors={pr.palette} />
                  <Editable value={pr.description} className="ss-small" placeholder="Shape, materials, wrapper, markings" multiline onChange={(description) => s.updatePlan((p) => ({ ...p, products: p.products.map((x) => (x.id === pr.id ? { ...x, description } : x)) }))} />
                  <div className="ss-notes-list">
                    {pr.notes.map((n, i) => (
                      <div key={i} className="ss-note">
                        <Editable value={n.label} className="ss-note-k" onChange={(label) => s.updatePlan((p) => ({ ...p, products: p.products.map((x) => (x.id === pr.id ? { ...x, notes: x.notes.map((y, j) => (j === i ? { ...y, label: label.toUpperCase() } : y)) } : x)) }))} />
                        <Editable value={n.text} className="ss-small" multiline onChange={(text) => s.updatePlan((p) => ({ ...p, products: p.products.map((x) => (x.id === pr.id ? { ...x, notes: x.notes.map((y, j) => (j === i ? { ...y, text } : y)) } : x)) }))} />
                      </div>
                    ))}
                    <button type="button" className="ss-mini" onClick={() => s.updatePlan((p) => ({ ...p, products: p.products.map((x) => (x.id === pr.id ? { ...x, notes: [...x.notes, { label: "NOTE", text: "…" }] } : x)) }))}>
                      <Icon.Plus width={10} height={10} /> note
                    </button>
                  </div>
                </div>
              ))}
              {!plan.characters.length && !plan.products.length && <p className="ss-small">No characters or products in this plan. Add a reference on the brief and re-plan, or edit the cuts directly.</p>}
            </div>
          </section>

          {/* ----- section 2: environment / set design ----- */}
          <section className="ss-section">
            <h3>SECTION 2: ENVIRONMENT / SET DESIGN</h3>
            <div className="ss-envs">
              {plan.environments.map((e) => (
                <div key={e.id} className="ss-env">
                  <Editable value={e.name} className="ss-h" onChange={(name) => s.updatePlan((p) => ({ ...p, environments: p.environments.map((x) => (x.id === e.id ? { ...x, name: name.toUpperCase() } : x)) }))} />
                  <PanelImg s={s} kind="environment" targetId={e.id} />
                  <Editable value={e.description} className="ss-small" multiline placeholder="Set description" onChange={(description) => s.updatePlan((p) => ({ ...p, environments: p.environments.map((x) => (x.id === e.id ? { ...x, description } : x)) }))} />
                </div>
              ))}
            </div>
            <div className="ss-plan">
              <div className="ss-plan-top">
                <div className="ss-h">TOP-DOWN FLOOR PLAN</div>
                <PanelImg s={s} kind="floorplan" targetId="floorplan" />
                <div className="ss-plan-legend">
                  {plan.cuts.map((c, i) => (
                    <span key={c.id}>
                      <i>{i + 1}</i> {c.title}: {c.move.toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>
              <div className="ss-plan-side">
                <div className="ss-h">{plan.cuts[plan.cuts.length - 1]?.title.toUpperCase()} — SIDE ELEVATION ({plan.cuts[plan.cuts.length - 1]?.move.toUpperCase()})</div>
                <PanelImg s={s} kind="elevation" targetId="elevation" tall />
              </div>
            </div>
            <div className="ss-setnotes">
              <div>
                <div className="ss-h">SET NOTES</div>
                <Editable value={plan.setNotes} className="ss-small" multiline placeholder="Surfaces, background, light pools, dressing" onChange={(setNotes) => s.updatePlan((p) => ({ ...p, setNotes }))} />
              </div>
              <div>
                <div className="ss-h">PROPS</div>
                <Editable value={plan.props} className="ss-small" multiline placeholder="What is on set" onChange={(props) => s.updatePlan((p) => ({ ...p, props }))} />
              </div>
            </div>
          </section>
        </div>

        {/* ----- section 3: storyboard ----- */}
        <section className="ss-section">
          <h3>
            SECTION 3: STORYBOARD ({plan.cuts.length} SEQUENTIAL CUTS · {total}s)
            <button type="button" className="ss-mini" onClick={() => s.addCut()} disabled={plan.cuts.length >= 8}>
              <Icon.Plus width={11} height={11} /> add cut
            </button>
          </h3>
          <div className="ss-cuts">
            {plan.cuts.map((c, i) => (
              <CutCard key={c.id} s={s} cut={c} index={i} total={plan.cuts.length} plan={plan} />
            ))}
          </div>
        </section>

        {/* ----- section 4: lighting / mood / style ----- */}
        <section className="ss-section">
          <h3>SECTION 4: LIGHTING / MOOD / STYLE NOTES</h3>
          <div className="ss-notes">
            <div className="ss-lights">
              {plan.lighting.map((l) => (
                <div key={l.id} className="ss-light">
                  <PanelImg s={s} kind="lighting" targetId={l.id} />
                  <Editable value={l.caption} className="ss-small" multiline onChange={(caption) => s.updatePlan((p) => ({ ...p, lighting: p.lighting.map((x) => (x.id === l.id ? { ...x, caption } : x)) }))} />
                </div>
              ))}
            </div>
            <div className="ss-mood">
              <div className="ss-h">MOOD KEYWORDS</div>
              <Editable value={plan.moods.join(", ")} className="ss-moodwords" multiline onChange={(v) => s.updatePlan((p) => ({ ...p, moods: v.split(/,|\n/).map((x) => x.trim()).filter(Boolean) }))} />
              <div className="ss-h" style={{ marginTop: 8 }}>
                STYLE ESSENCE
              </div>
              <Editable value={plan.styleEssence} className="ss-essence" multiline placeholder="One sentence: the essence of the look" onChange={(styleEssence) => s.updatePlan((p) => ({ ...p, styleEssence }))} />
            </div>
            <div className="ss-cine">
              <div className="ss-h">CINEMATOGRAPHY NOTES</div>
              <Editable value={plan.cinematography} className="ss-small ss-bullets" multiline placeholder="One note per line" onChange={(cinematography) => s.updatePlan((p) => ({ ...p, cinematography }))} />
              <div className="ss-h" style={{ marginTop: 8 }}>
                SOUND
              </div>
              <Editable value={plan.soundscape} className="ss-small" multiline placeholder="Ambience" onChange={(soundscape) => s.updatePlan((p) => ({ ...p, soundscape }))} />
              <Editable value={plan.music} className="ss-small" multiline placeholder="Music" onChange={(music) => s.updatePlan((p) => ({ ...p, music }))} />
            </div>
          </div>
        </section>
      </div>

      <div className="ss-next">
        <div>
          <div className="ss-label">Happy with the storyboard?</div>
          <p className="ss-hint">
            {drawing > 0
              ? `Still drawing ${drawing} panel${drawing === 1 ? "" : "s"}…`
              : "Render all cuts as one H3 video, or tell the AI director what to change first."}
          </p>
        </div>
        <div className="ss-next-actions">
          <button type="button" className="ss-btn ss-btn-lg" onClick={() => chatInput.current?.focus()}>
            <Icon.Sparkles width={14} height={14} /> Edit with AI
          </button>
          <button type="button" className="ss-primary ss-btn-lg" onClick={s.startVideo} disabled={drawing > 0 || s.chatBusy}>
            <Icon.Film width={15} height={15} /> Create video
          </button>
          {lastFull?.status === "done" && (
            <button type="button" className="ss-btn ss-btn-lg" onClick={() => s.setStage("video")}>
              View last video
            </button>
          )}
        </div>
      </div>
    </div>
    <DirectorChat s={s} inputRef={chatInput} />
    </div>
  );
}

// ----- pieces ------------------------------------------------------------------

function CutCard({ s, cut, index, total, plan }: { s: Studio; cut: PlanCut; index: number; total: number; plan: Plan }) {
  const [open, setOpen] = useState(false);
  const env = plan.environments.find((e) => e.id === cut.environmentId);
  return (
    <div className="ss-cut">
      <div className="ss-cut-head">
        <span className="ss-cutno">{cut.title}</span>
        <span className="ss-cut-tools">
          <button type="button" onClick={() => s.moveCut(cut.id, -1)} disabled={index === 0} aria-label="Move earlier">
            ‹
          </button>
          <button type="button" onClick={() => s.moveCut(cut.id, 1)} disabled={index === total - 1} aria-label="Move later">
            ›
          </button>
          <button type="button" onClick={() => setOpen(!open)} aria-label="Edit shot">
            <Icon.Edit width={11} height={11} />
          </button>
          <button type="button" onClick={() => s.deleteCut(cut.id)} disabled={total <= 1} aria-label="Delete cut">
            <Icon.Trash width={11} height={11} />
          </button>
        </span>
      </div>
      <PanelImg s={s} kind="cut" targetId={cut.id} />
      <div className="ss-cut-spec">
        {cut.lensMm}mm anamorphic | {cut.aperture} | {cut.durationSec}s | {cut.move.toUpperCase()} | {cut.framing.toUpperCase()}
      </div>
      <Editable value={cut.description} className="ss-small" multiline onChange={(description) => s.updateCut(cut.id, { description })} />
      {open && (
        <div className="ss-cut-edit">
          <label>
            Lens
            <select value={cut.lensMm} onChange={(e) => s.updateCut(cut.id, { lensMm: Number(e.target.value) })}>
              {[...new Set([...LENSES, cut.lensMm])].sort((a, b) => a - b).map((l) => (
                <option key={l} value={l}>
                  {l}mm
                </option>
              ))}
            </select>
          </label>
          <label>
            Aperture
            <select value={cut.aperture} onChange={(e) => s.updateCut(cut.id, { aperture: e.target.value })}>
              {[...new Set([...APERTURES, cut.aperture])].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label>
            Move
            <select value={cut.move} onChange={(e) => s.updateCut(cut.id, { move: e.target.value as PlanCut["move"] })}>
              {MOVES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            Framing
            <select value={cut.framing} onChange={(e) => s.updateCut(cut.id, { framing: e.target.value as PlanCut["framing"] })}>
              {FRAMINGS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label>
            Seconds
            <input type="number" min={2} max={15} value={cut.durationSec} onChange={(e) => s.updateCut(cut.id, { durationSec: Math.min(15, Math.max(2, Number(e.target.value) || 2)) })} />
          </label>
          <label>
            Set
            <select value={cut.environmentId ?? ""} onChange={(e) => s.updateCut(cut.id, { environmentId: e.target.value || null })}>
              {plan.environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <div className="ss-cut-cast">
            {plan.characters.map((c) => (
              <label key={c.id} className="ss-check">
                <input
                  type="checkbox"
                  checked={cut.characterIds.includes(c.id)}
                  onChange={(e) => s.updateCut(cut.id, { characterIds: e.target.checked ? [...cut.characterIds, c.id] : cut.characterIds.filter((x) => x !== c.id) })}
                />
                {c.name}
              </label>
            ))}
            {plan.products.map((p) => (
              <label key={p.id} className="ss-check">
                <input
                  type="checkbox"
                  checked={cut.productIds.includes(p.id)}
                  onChange={(e) => s.updateCut(cut.id, { productIds: e.target.checked ? [...cut.productIds, p.id] : cut.productIds.filter((x) => x !== p.id) })}
                />
                {p.name}
              </label>
            ))}
          </div>
          <label className="ss-span">
            Action
            <textarea rows={2} value={cut.action} onChange={(e) => s.updateCut(cut.id, { action: e.target.value })} placeholder="What the subject physically does across the cut" />
          </label>
          <label className="ss-span">
            Dialogue
            <input value={cut.dialogue} onChange={(e) => s.updateCut(cut.id, { dialogue: e.target.value })} placeholder="NAME: line (H3 lip-syncs it). Leave empty for none." />
          </label>
          <label className="ss-span">
            Position on the floor plan
            <input value={cut.position} onChange={(e) => s.updateCut(cut.id, { position: e.target.value })} placeholder="e.g. camera at the front edge of the table, facing the bar" />
          </label>
          <p className="ss-hint ss-span">
            {env ? `Set: ${env.name}. ` : ""}Edits change the H3 prompt immediately; hit Redraw on the frame to update the picture.
          </p>
        </div>
      )}
    </div>
  );
}

export function PanelImg({ s, kind, targetId, square, tall }: { s: Studio; kind: PanelKind; targetId: string; square?: boolean; tall?: boolean }) {
  const panel: Panel | undefined = panelFor(s.project.panels, kind, targetId);
  const url = panel?.mediaId ? s.urls[panel.mediaId] : undefined;
  const cls = `ss-img ${square ? "is-square" : tall ? "is-tall" : ""} ${panel?.status ?? "idle"}`;
  return (
    <div className={cls}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" />
      ) : (
        <div className="ss-img-empty">
          {panel?.status === "drawing" ? (
            <>
              <span className="ss-spinner" /> drawing…
            </>
          ) : panel?.status === "error" ? (
            <span className="ss-err">{panel.error}</span>
          ) : (
            "not drawn yet"
          )}
        </div>
      )}
      {panel?.placeholder && url && <span className="ss-badge">offline preview</span>}
      {panel?.status !== "drawing" && (
        <button type="button" className="ss-redraw" onClick={() => s.drawPanel(kind, targetId)} title="Redraw this panel from the current text">
          <Icon.Refresh width={11} height={11} /> {url ? "Recreate image" : "Draw"}
        </button>
      )}
    </div>
  );
}

function Swatches({ colors, compact }: { colors: string[]; compact?: boolean }) {
  return (
    <div className={`ss-swatches ${compact ? "is-compact" : ""}`}>
      {colors.map((c, i) => (
        <span key={i} style={{ background: c }} title={c} />
      ))}
    </div>
  );
}

function Editable({
  value,
  onChange,
  className = "",
  multiline,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const done = () => {
    if (draft !== null && draft !== value) onChange(draft.trim());
    setDraft(null);
  };
  if (multiline)
    return (
      <textarea
        className={`ss-editable ${className}`}
        value={shown}
        placeholder={placeholder}
        rows={Math.max(2, Math.min(9, Math.ceil(shown.length / 46) + (shown.match(/\n/g)?.length ?? 0)))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={done}
      />
    );
  return (
    <input
      className={`ss-editable ${className}`}
      value={shown}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
