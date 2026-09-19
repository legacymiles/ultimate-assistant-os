"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { newPersona } from "@/lib/social-personas/logic";
import { PRESETS, type Persona } from "@/lib/social-personas/types";
import { Btn, inputCls } from "./bits";

export function PersonaForm({ initial, onClose, onSave }: { initial?: Persona; onClose: () => void; onSave: (p: Persona) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [niche, setNiche] = useState(initial?.niche ?? "");
  const [types, setTypes] = useState(initial?.contentTypes.join(", ") ?? "");
  const [audience, setAudience] = useState(initial?.audience ?? "");
  const [tone, setTone] = useState(initial?.tone ?? "");
  const [goals, setGoals] = useState(initial?.goals ?? "");
  const [avoid, setAvoid] = useState(initial?.avoid ?? "");

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const save = () => {
    if (!name.trim()) return;
    const fields = {
      name: name.trim(),
      niche: niche.trim(),
      contentTypes: types.split(",").map((s) => s.trim()).filter(Boolean),
      audience: audience.trim(),
      tone: tone.trim(),
      goals: goals.trim(),
      avoid: avoid.trim(),
    };
    onSave(initial ? { ...initial, ...fields } : newPersona(fields));
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-3" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold text-ink">{initial ? "Edit persona" : "New persona"}</h2>
          <button onClick={onClose} className="ml-auto rounded-lg p-1 text-ink-muted hover:bg-panel-2 hover:text-ink" aria-label="Close">
            <Icon.Close width={16} height={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3">
          {!initial && (
            <div>
              <Label>Start from</Label>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.niche}
                    onClick={() => {
                      setNiche(p.niche);
                      setTypes(p.contentTypes.join(", "));
                      setAudience(p.audience);
                      setTone(p.tone);
                    }}
                    className={
                      "rounded-full border px-2.5 py-1 text-xs transition " +
                      (niche === p.niche ? "border-brand bg-brand/15 text-brand" : "border-line text-ink-muted hover:bg-panel-2 hover:text-ink")
                    }
                  >
                    {p.niche}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="Persona name" hint="What you call this identity">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lil Verse, Explain It Fast, Baby Mila" />
          </Field>
          <Field label="Niche" hint="The kind of content, in a few words">
            <input className={inputCls} value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Rap music videos" />
          </Field>
          <Field label="Content types" hint="Comma separated">
            <input className={inputCls} value={types} onChange={(e) => setTypes(e.target.value)} placeholder="music video, verse snippet, studio session" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Audience">
              <input className={inputCls} value={audience} onChange={(e) => setAudience(e.target.value)} />
            </Field>
            <Field label="Tone / voice">
              <input className={inputCls} value={tone} onChange={(e) => setTone(e.target.value)} />
            </Field>
          </div>
          <Field label="Goals" hint="What should this account achieve?">
            <input className={inputCls} value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="Grow to 10k, promote the new single, sell merch…" />
          </Field>
          <Field label="Never suggest" hint="Topics or styles the AI must avoid">
            <input className={inputCls} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="Showing the baby's face, profanity…" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary onClick={save} disabled={!name.trim()}>
            <Icon.Check width={14} height={14} /> {initial ? "Save" : "Create persona"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">{children}</div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <Label>
        {label}
        {hint && <span className="ml-1.5 normal-case tracking-normal text-ink-faint/70">— {hint}</span>}
      </Label>
      {children}
    </label>
  );
}
