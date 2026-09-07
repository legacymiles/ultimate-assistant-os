"use client";

// The Director's plan: concept, characters, worlds, style. All editable.
// This is where an idea becomes a production before a single shot exists.

import { useState } from "react";
import type { Character, World } from "@/lib/auteur/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { useStudio } from "./studio";
import { Btn, EmptyState, Field, Mono, Spinner } from "./ui";

export function DirectorPanel() {
  const studio = useStudio();
  const p = studio.project!;
  const developing = studio.working.has("develop");
  const boarding = studio.working.has("breakdown");
  const hasPlan = Boolean(p.concept);
  const hasBoard = p.scenes.length > 0;
  const undescribed = p.references.filter((r) => !r.described && r.mime.startsWith("image/")).length;

  return (
    <div className="mx-auto max-w-[980px] px-5 py-6 md:px-8">
      {/* idea + actions */}
      <div className="au-panel p-4 md:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <Mono>The idea</Mono>
            <textarea
              className="mt-1.5 w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none"
              rows={2}
              value={p.idea}
              onChange={(e) => studio.update((pp) => ({ ...pp, idea: e.target.value }))}
            />
            <textarea
              className="au-input mt-2 !text-[12px]"
              rows={1}
              value={p.notes}
              onChange={(e) => studio.update((pp) => ({ ...pp, notes: e.target.value }))}
              placeholder="Creative direction for the Director (optional)"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Btn variant={hasPlan ? "default" : "primary"} disabled={developing || boarding} onClick={() => void studio.runDevelop()}>
              {developing ? <Spinner /> : <Icon.Sparkles width={14} height={14} />}
              {hasPlan ? "Re-develop" : "Develop the plan"}
            </Btn>
            <Btn variant={hasPlan && !hasBoard ? "primary" : "default"} disabled={!hasPlan || developing || boarding} onClick={() => void studio.runBreakdown()}>
              {boarding ? <Spinner /> : <Icon.Grid width={14} height={14} />}
              {hasBoard ? "Re-board the shots" : "Break down into shots"}
            </Btn>
            {undescribed > 0 && (
              <p className="max-w-[200px] text-[10.5px] leading-snug text-[var(--au-ink-3)]">
                {undescribed} image reference{undescribed > 1 ? "s" : ""} not yet described — the Director reads them once an AI key is set.
              </p>
            )}
          </div>
        </div>
        {developing && (
          <div className="mt-4 space-y-2">
            <div className="au-shimmer h-3 w-2/3 rounded" />
            <div className="au-shimmer h-3 w-1/2 rounded" />
            <div className="au-shimmer h-3 w-3/5 rounded" />
          </div>
        )}
      </div>

      {!hasPlan && !developing && (
        <div className="mt-6">
          <EmptyState
            title="No plan yet"
            body="The Director will turn the idea, template, genre and references into a concept, a cast with continuity sheets, the worlds it happens in, and a visual style. Then it breaks all of that into scenes and shots."
            action={
              <Btn variant="primary" onClick={() => void studio.runDevelop()}>
                <Icon.Sparkles width={14} height={14} /> Develop the plan
              </Btn>
            }
          />
        </div>
      )}

      {hasPlan && (
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
          {/* concept */}
          <section className="au-panel p-4 au-fade-in">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Concept</h2>
              <Mono>story</Mono>
            </div>
            <Field label="Logline">
              <textarea className="au-input" rows={2} value={p.concept!.logline} onChange={(e) => studio.update((pp) => ({ ...pp, concept: { ...pp.concept!, logline: e.target.value } }))} />
            </Field>
            <Field label="Synopsis" className="mt-3">
              <textarea className="au-input" rows={4} value={p.concept!.synopsis} onChange={(e) => studio.update((pp) => ({ ...pp, concept: { ...pp.concept!, synopsis: e.target.value } }))} />
            </Field>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Theme">
                <input className="au-input" value={p.concept!.theme} onChange={(e) => studio.update((pp) => ({ ...pp, concept: { ...pp.concept!, theme: e.target.value } }))} />
              </Field>
              <Field label="Tone">
                <input className="au-input" value={p.concept!.tone} onChange={(e) => studio.update((pp) => ({ ...pp, concept: { ...pp.concept!, tone: e.target.value } }))} />
              </Field>
            </div>
            <Field label="Structure" hint="one beat per scene" className="mt-3">
              <BeatEditor beats={p.concept!.structure} onChange={(structure) => studio.update((pp) => ({ ...pp, concept: { ...pp.concept!, structure } }))} />
            </Field>
          </section>

          {/* style */}
          <section className="au-panel p-4 au-fade-in">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Visual style</h2>
              <Mono>look</Mono>
            </div>
            {(["lookName", "palette", "lighting", "cameraLanguage", "grade", "pacing"] as const).map((k) => (
              <Field key={k} label={STYLE_LABELS[k]} className="mb-2.5">
                <input
                  className="au-input"
                  value={p.style?.[k] ?? ""}
                  onChange={(e) => studio.update((pp) => ({ ...pp, style: { ...(pp.style ?? EMPTY_STYLE), [k]: e.target.value } }))}
                />
              </Field>
            ))}
          </section>

          {/* characters */}
          <section className="au-panel p-4 au-fade-in lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Characters</h2>
                <p className="text-[11px] text-[var(--au-ink-3)]">Each description is a continuity sheet. It is restated in every shot the character is in.</p>
              </div>
              <Btn size="sm" onClick={() => studio.update((pp) => ({ ...pp, characters: [...pp.characters, newCharacter(pp.characters.length)] }))}>
                <Icon.Plus width={12} height={12} /> Character
              </Btn>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {p.characters.map((c) => (
                <CharacterCard key={c.id} c={c} />
              ))}
              {!p.characters.length && <p className="text-[12px] text-[var(--au-ink-3)]">No characters. Fine for a product film.</p>}
            </div>
          </section>

          {/* worlds */}
          <section className="au-panel p-4 au-fade-in lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Worlds</h2>
                <p className="text-[11px] text-[var(--au-ink-3)]">Where it happens. Time of day and props carry across every shot set there.</p>
              </div>
              <Btn size="sm" onClick={() => studio.update((pp) => ({ ...pp, worlds: [...pp.worlds, newWorld(pp.worlds.length)] }))}>
                <Icon.Plus width={12} height={12} /> World
              </Btn>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {p.worlds.map((w) => (
                <WorldCard key={w.id} w={w} />
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

const STYLE_LABELS = {
  lookName: "Look",
  palette: "Palette",
  lighting: "Lighting",
  cameraLanguage: "Camera language",
  grade: "Grade",
  pacing: "Pacing",
} as const;

const EMPTY_STYLE = { lookName: "", palette: "", lighting: "", cameraLanguage: "", grade: "", pacing: "measured", referenceIds: [] as string[] };

function newCharacter(n: number): Character {
  return { id: `chr_${Date.now().toString(36)}${n}`, name: `Character ${n + 1}`, role: n === 0 ? "Lead" : "Supporting", description: "", manner: "", referenceIds: [] };
}

function newWorld(n: number): World {
  return { id: `wld_${Date.now().toString(36)}${n}`, name: `Location ${n + 1}`, description: "", timeOfDay: "", referenceIds: [] };
}

function BeatEditor({ beats, onChange }: { beats: string[]; onChange: (b: string[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {beats.map((b, i) => (
        <span key={i} className="flex items-center gap-1 rounded-full border border-[var(--au-line-strong)] bg-[var(--au-stage)] pl-2.5 pr-1 py-1">
          <span className="au-mono !text-[var(--au-gold-2)]">{i + 1}</span>
          <input
            className="w-[90px] bg-transparent text-[12px] outline-none"
            value={b}
            onChange={(e) => onChange(beats.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button type="button" className="p-0.5 text-[var(--au-ink-3)] hover:text-[#ff8a78]" onClick={() => onChange(beats.filter((_, j) => j !== i))} aria-label="Remove beat">
            <Icon.Close width={10} height={10} />
          </button>
        </span>
      ))}
      <button type="button" className="au-chip" onClick={() => onChange([...beats, "Beat"])}>
        <Icon.Plus width={10} height={10} /> beat
      </button>
    </div>
  );
}

function CharacterCard({ c }: { c: Character }) {
  const studio = useStudio();
  const p = studio.project!;
  const refs = p.references.filter((r) => c.referenceIds.includes(r.id));
  const candidates = p.references.filter((r) => (r.kind === "character" || r.kind === "image") && !c.referenceIds.includes(r.id));
  const patch = (x: Partial<Character>) => studio.update((pp) => ({ ...pp, characters: pp.characters.map((k) => (k.id === c.id ? { ...k, ...x } : k)) }));
  return (
    <div className="rounded-xl border border-[var(--au-line)] bg-[var(--au-stage)]/60 p-3">
      <div className="flex items-start gap-3">
        <div className="flex flex-none flex-col gap-1">
          {refs.length ? (
            refs.map((r) => (
              <div key={r.id} className="relative h-14 w-14 overflow-hidden rounded-lg bg-[var(--au-panel-2)]">
                {r.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumb} alt="" className="h-full w-full object-cover" />
                ) : null}
                <button
                  type="button"
                  className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white/70 hover:text-white"
                  onClick={() => patch({ referenceIds: c.referenceIds.filter((x) => x !== r.id) })}
                  aria-label="Detach reference"
                >
                  <Icon.Close width={9} height={9} />
                </button>
              </div>
            ))
          ) : (
            <div className="grid h-14 w-14 place-items-center rounded-lg border border-dashed border-[var(--au-line-strong)] text-[var(--au-ink-3)]">
              <Icon.Users width={16} height={16} />
            </div>
          )}
          {candidates.length > 0 && (
            <select className="au-select !px-1.5 !py-0.5 !text-[10px]" value="" onChange={(e) => e.target.value && patch({ referenceIds: [...c.referenceIds, e.target.value] })}>
              <option value="">+ ref</option>
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none" value={c.name} onChange={(e) => patch({ name: e.target.value })} />
            <input className="w-[90px] bg-transparent text-right text-[11px] text-[var(--au-ink-3)] outline-none" value={c.role} onChange={(e) => patch({ role: e.target.value })} />
            <button type="button" className="text-[var(--au-ink-3)] hover:text-[#ff8a78]" onClick={() => studio.update((pp) => ({ ...pp, characters: pp.characters.filter((k) => k.id !== c.id) }))} aria-label="Delete character">
              <Icon.Trash width={12} height={12} />
            </button>
          </div>
          <textarea className="au-input mt-1.5 !text-[12px]" rows={3} value={c.description} placeholder="Age, build, hair, exact wardrobe with colours, one telling detail" onChange={(e) => patch({ description: e.target.value })} />
          <input className="au-input mt-1.5 !text-[12px]" value={c.manner} placeholder="Manner: how they move and speak" onChange={(e) => patch({ manner: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

function WorldCard({ w }: { w: World }) {
  const studio = useStudio();
  const p = studio.project!;
  const refs = p.references.filter((r) => w.referenceIds.includes(r.id));
  const candidates = p.references.filter((r) => (r.kind === "location" || r.kind === "image") && !w.referenceIds.includes(r.id));
  const patch = (x: Partial<World>) => studio.update((pp) => ({ ...pp, worlds: pp.worlds.map((k) => (k.id === w.id ? { ...k, ...x } : k)) }));
  return (
    <div className="rounded-xl border border-[var(--au-line)] bg-[var(--au-stage)]/60 p-3">
      <div className="flex items-start gap-3">
        <div className="flex flex-none flex-col gap-1">
          {refs.length ? (
            refs.map((r) => (
              <div key={r.id} className="relative h-14 w-20 overflow-hidden rounded-lg bg-[var(--au-panel-2)]">
                {r.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumb} alt="" className="h-full w-full object-cover" />
                ) : null}
                <button type="button" className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white/70 hover:text-white" onClick={() => patch({ referenceIds: w.referenceIds.filter((x) => x !== r.id) })} aria-label="Detach reference">
                  <Icon.Close width={9} height={9} />
                </button>
              </div>
            ))
          ) : (
            <div className="grid h-14 w-20 place-items-center rounded-lg border border-dashed border-[var(--au-line-strong)] text-[var(--au-ink-3)]">
              <Icon.Globe width={16} height={16} />
            </div>
          )}
          {candidates.length > 0 && (
            <select className="au-select !px-1.5 !py-0.5 !text-[10px]" value="" onChange={(e) => e.target.value && patch({ referenceIds: [...w.referenceIds, e.target.value] })}>
              <option value="">+ ref</option>
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none" value={w.name} onChange={(e) => patch({ name: e.target.value })} />
            <input className={cn("w-[120px] bg-transparent text-right text-[11px] text-[var(--au-ink-3)] outline-none")} value={w.timeOfDay} placeholder="time of day" onChange={(e) => patch({ timeOfDay: e.target.value })} />
            <button type="button" className="text-[var(--au-ink-3)] hover:text-[#ff8a78]" onClick={() => studio.update((pp) => ({ ...pp, worlds: pp.worlds.filter((k) => k.id !== w.id) }))} aria-label="Delete world">
              <Icon.Trash width={12} height={12} />
            </button>
          </div>
          <textarea className="au-input mt-1.5 !text-[12px]" rows={3} value={w.description} placeholder="Environment, architecture, weather, key props" onChange={(e) => patch({ description: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
