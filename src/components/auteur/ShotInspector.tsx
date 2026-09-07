"use client";

// Everything about one shot: its fields, its H3 prompt (read, then edit),
// shot-level references, the retake box, and every take it has had.

import { useEffect, useRef, useState } from "react";
import { MAX_SHOT_SEC, MIN_SHOT_SEC, hueFor } from "@/lib/auteur/constants";
import { activeTake, findShot } from "@/lib/auteur/repo";
import type { Camera, CameraAngle, CameraMovement, Framing, Shot } from "@/lib/auteur/types";
import { cn, relativeTime } from "@/lib/utils";
import { Icon } from "../icons";
import { busyLabel } from "./Storyboard";
import { useStudio } from "./studio";
import { Btn, Field, Mono, Spinner, TakeFrame, fmtSec } from "./ui";

const ANGLES: CameraAngle[] = ["eye level", "low angle", "high angle", "overhead", "dutch angle", "over the shoulder", "POV"];
const MOVEMENTS: CameraMovement[] = ["static", "push in", "pull out", "pan left", "pan right", "tilt up", "tilt down", "tracking", "handheld", "crane up", "crane down", "orbit", "zoom in", "zoom out", "shake"];
const FRAMINGS: Framing[] = ["extreme wide", "wide", "medium wide", "medium", "medium close-up", "close-up", "extreme close-up", "insert"];

const RETAKE_HINTS = ["Make the camera closer.", "Make this scene darker.", "Change her outfit to a green dress.", "Make him look angry. Keep everything else the same.", "Slower, more intimate."];

export function ShotInspector() {
  const studio = useStudio();
  const p = studio.project!;
  const hit = studio.selectedShotId ? findShot(p, studio.selectedShotId) : null;
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [section, setSection] = useState<"shot" | "prompt" | "takes">("shot");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditingPrompt(false);
    setInstruction("");
  }, [studio.selectedShotId]);

  if (!hit) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <Icon.Film width={22} height={22} className="text-[var(--au-ink-3)]" />
        <p className="mt-2 text-sm font-medium">No shot selected</p>
        <p className="mt-1 text-xs text-[var(--au-ink-2)]">Pick a card on the board to direct it.</p>
      </div>
    );
  }

  const { scene, shot, index } = hit;
  const take = activeTake(shot);
  const busy = studio.busy[shot.id];
  const retaking = studio.working.has(`retake:${shot.id}`);
  const polishing = studio.working.has(`prompt:${shot.id}`);
  const patch = (fn: (s: Shot) => Shot) => studio.patchShot(shot.id, fn);
  const setCamera = (c: Partial<Camera>) => patch((s) => ({ ...s, camera: { ...s.camera, ...c } }));
  const shotRefs = p.references.filter((r) => r.scope.level === "shot" && r.scope.shotId === shot.id);

  const runRetake = () => {
    if (!instruction.trim() || retaking || busy) return;
    void studio.runRetake(shot.id, instruction.trim());
    setInstruction("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--au-line)] p-3">
        <div className="flex items-center gap-2">
          <span className="au-mono !text-[var(--au-gold-2)]">SH {String(index + 1).padStart(2, "0")}</span>
          <input className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none" value={shot.title} onChange={(e) => patch((s) => ({ ...s, title: e.target.value }))} />
        </div>
        <div className="mt-2">
          <TakeFrame take={take} aspect={p.aspectRatio} hue={hueFor(p)} controls={Boolean(take?.mediaId)} muted={false} caption={take ? undefined : shot.description} />
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <Btn variant="primary" size="sm" disabled={Boolean(busy) || retaking} onClick={() => void studio.generate(shot.id)} className="flex-1 justify-center">
            {busy ? <Spinner /> : <Icon.Launch width={12} height={12} />}
            {busy ? busyLabel(busy) : take ? "New take" : "Generate"}
          </Btn>
          {busy && (
            <Btn size="sm" onClick={() => studio.cancel(shot.id)}>Cancel</Btn>
          )}
          <span className="au-mono">{studio.resolution}</span>
        </div>
        <div className="mt-3 flex rounded-lg border border-[var(--au-line)] p-0.5">
          {(["shot", "prompt", "takes"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={cn("flex-1 rounded-md py-1 text-[11px] capitalize transition", section === s ? "bg-[var(--au-panel-2)] text-[var(--au-ink)]" : "text-[var(--au-ink-3)] hover:text-[var(--au-ink-2)]")}
            >
              {s}{s === "takes" && shot.takes.length ? ` (${shot.takes.length})` : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {section === "shot" && (
          <div className="space-y-3">
            {/* retake box first: it is the thing people do most */}
            <div className="rounded-xl border border-[rgba(232,185,92,.35)] bg-[rgba(232,185,92,.06)] p-2.5">
              <Mono className="!text-[var(--au-gold)]">Retake · tell the Director</Mono>
              <textarea
                className="au-input mt-1.5 !text-[12px]"
                rows={2}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runRetake();
                }}
                placeholder="Make the camera closer. Change her outfit. Keep everything else the same."
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {RETAKE_HINTS.map((h) => (
                  <button key={h} type="button" className="rounded-full border border-transparent px-2 py-0.5 text-[10px] text-[var(--au-ink-3)] hover:border-[var(--au-line)] hover:text-[var(--au-ink-2)]" onClick={() => setInstruction(h)}>
                    {h}
                  </button>
                ))}
              </div>
              <Btn size="sm" variant="primary" className="mt-2 w-full justify-center" disabled={!instruction.trim() || retaking || Boolean(busy)} onClick={runRetake}>
                {retaking ? <Spinner /> : <Icon.Refresh width={12} height={12} />} Retake this shot
              </Btn>
            </div>

            <Field label="Description" hint="what we see">
              <textarea className="au-input !text-[12px]" rows={2} value={shot.description} onChange={(e) => patch((s) => ({ ...s, description: e.target.value }))} />
            </Field>
            <Field label="Action" hint="what happens">
              <textarea className="au-input !text-[12px]" rows={2} value={shot.action} onChange={(e) => patch((s) => ({ ...s, action: e.target.value }))} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Framing">
                <select className="au-select w-full" value={shot.camera.framing} onChange={(e) => setCamera({ framing: e.target.value as Framing })}>
                  {FRAMINGS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="Movement">
                <select className="au-select w-full" value={shot.camera.movement} onChange={(e) => setCamera({ movement: e.target.value as CameraMovement })}>
                  {MOVEMENTS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Angle">
                <select className="au-select w-full" value={shot.camera.angle} onChange={(e) => setCamera({ angle: e.target.value as CameraAngle })}>
                  {ANGLES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Lens">
                <input className="au-input !py-1.5 !text-[12px]" value={shot.camera.lens} onChange={(e) => setCamera({ lens: e.target.value })} />
              </Field>
            </div>
            <Field label="Lighting">
              <input className="au-input !text-[12px]" value={shot.lighting} onChange={(e) => patch((s) => ({ ...s, lighting: e.target.value }))} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Expression">
                <input className="au-input !text-[12px]" value={shot.expression} placeholder="none" onChange={(e) => patch((s) => ({ ...s, expression: e.target.value }))} />
              </Field>
              <Field label="Duration" hint={`${shot.durationSec}s`}>
                <input type="range" className="au-range mt-2" min={MIN_SHOT_SEC} max={MAX_SHOT_SEC} value={shot.durationSec} onChange={(e) => patch((s) => ({ ...s, durationSec: Number(e.target.value) }))} />
              </Field>
            </div>
            <Field label="Dialogue" hint="Name: line · lip-synced">
              <input className="au-input !text-[12px]" value={shot.dialogue} placeholder="Nora: Don't go." onChange={(e) => patch((s) => ({ ...s, dialogue: e.target.value }))} />
            </Field>
            <Field label="Cast">
              <div className="flex flex-wrap gap-1">
                {p.characters.map((c) => {
                  const on = shot.characterIds.includes(c.id);
                  return (
                    <button key={c.id} type="button" className="au-chip" data-on={on ? "true" : "false"} onClick={() => patch((s) => ({ ...s, characterIds: on ? s.characterIds.filter((x) => x !== c.id) : [...s.characterIds, c.id] }))}>
                      {c.name}
                    </button>
                  );
                })}
                {!p.characters.length && <span className="text-[11px] text-[var(--au-ink-3)]">No characters in this project.</span>}
              </div>
            </Field>
            <Field label="World">
              <select className="au-select w-full" value={shot.worldId ?? ""} onChange={(e) => patch((s) => ({ ...s, worldId: e.target.value || null }))}>
                <option value="">Scene default ({p.worlds.find((w) => w.id === scene.worldId)?.name ?? "none"})</option>
                {p.worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="Continuity" hint="from the previous shot">
              <textarea className="au-input !text-[12px]" rows={2} value={shot.continuity} onChange={(e) => patch((s) => ({ ...s, continuity: e.target.value }))} />
            </Field>

            <Field label="Shot references" hint="only this shot">
              <div className="space-y-1.5">
                {shotRefs.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 rounded-lg border border-[var(--au-line)] bg-[var(--au-stage)] p-1.5">
                    <div className="h-8 w-8 flex-none overflow-hidden rounded bg-[var(--au-panel-2)]">
                      {r.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.thumb} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px]">{r.name}</div>
                      <div className="au-mono">{r.kind}</div>
                    </div>
                    <button type="button" className="text-[var(--au-ink-3)] hover:text-[#ff8a78]" onClick={() => studio.removeReference(r.id)} aria-label="Remove reference">
                      <Icon.Close width={11} height={11} />
                    </button>
                  </div>
                ))}
                <Btn size="sm" onClick={() => fileRef.current?.click()}>
                  <Icon.Upload width={12} height={12} /> Add to this shot
                </Btn>
                <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*" hidden onChange={(e) => {
                  if (e.target.files?.length) void studio.addReferences(Array.from(e.target.files), { level: "shot", shotId: shot.id });
                  e.target.value = "";
                }} />
              </div>
            </Field>
          </div>
        )}

        {section === "prompt" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Mono>H3 prompt {shot.promptEdited ? "· hand-edited" : "· composed by the Director"}</Mono>
              <div className="flex gap-1">
                <Btn size="sm" variant="ghost" disabled={polishing} onClick={() => void studio.runPrompt(shot.id)} title="Recompose (and polish with AI when a key is set)">
                  {polishing ? <Spinner /> : <Icon.Refresh width={11} height={11} />} Rewrite
                </Btn>
                <Btn size="sm" variant={editingPrompt ? "primary" : "default"} onClick={() => setEditingPrompt((e) => !e)}>
                  <Icon.Edit width={11} height={11} /> {editingPrompt ? "Done" : "Edit"}
                </Btn>
              </div>
            </div>
            {editingPrompt ? (
              <textarea
                className="au-input !font-[family-name:var(--au-mono)] !text-[11px] !leading-relaxed"
                rows={22}
                value={shot.prompt.text}
                onChange={(e) => studio.update((pp) => ({
                  ...pp,
                  scenes: pp.scenes.map((sc) => ({ ...sc, shots: sc.shots.map((s) => (s.id === shot.id ? { ...s, prompt: { ...s.prompt, text: e.target.value }, promptEdited: true } : s)) })),
                }))}
              />
            ) : (
              <pre className="whitespace-pre-wrap rounded-lg border border-[var(--au-line)] bg-[var(--au-stage)] p-2.5 font-[family-name:var(--au-mono)] text-[11px] leading-relaxed text-[var(--au-ink-2)]">
                {shot.prompt.text || "No prompt yet — it is composed the moment the shot is boarded or generated."}
              </pre>
            )}
            {shot.prompt.notes && (
              <div className="rounded-lg border border-[var(--au-line)] p-2.5 text-[11px] leading-relaxed text-[var(--au-ink-3)]">
                {shot.prompt.notes.split("\n").map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
            {shot.prompt.references.length > 0 && (
              <div>
                <Mono>Sent with the request, in this order</Mono>
                <div className="mt-1 flex flex-wrap gap-1">
                  {shot.prompt.references.map((r) => {
                    const ref = p.references.find((x) => x.id === r.referenceId);
                    return (
                      <span key={r.label} className="au-chip" title={ref?.name}>
                        <span className="au-mono !text-[var(--au-gold-2)]">{r.label}</span> {ref?.name ?? "?"}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="text-[10.5px] leading-relaxed text-[var(--au-ink-3)]">
              Change any field on the Shot tab and the prompt recomposes itself. Editing it by hand freezes it; Rewrite hands it back to the Director.
            </p>
          </div>
        )}

        {section === "takes" && (
          <div className="space-y-2">
            {!shot.takes.length && <p className="text-[12px] text-[var(--au-ink-3)]">No takes yet. Generate one, then retake with a note; every version is kept.</p>}
            {[...shot.takes].reverse().map((t, i) => {
              const n = shot.takes.length - i;
              const active = t.id === (shot.activeTakeId ?? shot.takes[shot.takes.length - 1]?.id);
              return (
                <div key={t.id} className={cn("rounded-xl border p-2", active ? "border-[var(--au-gold-2)] bg-[rgba(232,185,92,.05)]" : "border-[var(--au-line)]")}>
                  <div className="flex gap-2">
                    <div className="w-[120px] flex-none">
                      <TakeFrame take={t} aspect={p.aspectRatio} hue={hueFor(p)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="au-dot" data-s={t.status} />
                        <span className="text-[12px] font-medium">Take {n}</span>
                        <span className="au-mono">{t.engine === "minimax" ? "H3" : "animatic"}</span>
                        <span className="ml-auto text-[10px] text-[var(--au-ink-3)]">{relativeTime(t.createdAt)}</span>
                      </div>
                      {t.retakeNote && <div className="mt-1 text-[11px] text-[var(--au-ink-2)]">↳ {t.retakeNote}</div>}
                      {t.error && <div className="mt-1 text-[11px] text-[#ff9b8c]">{t.error}</div>}
                      <div className="mt-1.5 flex gap-1">
                        {!active && t.status === "done" && (
                          <Btn size="sm" onClick={() => studio.setActiveTake(shot.id, t.id)}>Use this take</Btn>
                        )}
                        {t.status === "error" && (
                          <Btn size="sm" onClick={() => void studio.generate(shot.id, { retakeNote: t.retakeNote })}>Retry</Btn>
                        )}
                        <Btn size="sm" variant="danger" onClick={() => studio.deleteTake(shot.id, t.id)}>Delete</Btn>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--au-line)] px-3 py-2 text-[10px] text-[var(--au-ink-3)]">
        Scene {p.scenes.indexOf(scene) + 1} · {scene.title} · {fmtSec(shot.durationSec)} · <span className="au-kbd">⌘↵</span> retake
      </div>
    </div>
  );
}
