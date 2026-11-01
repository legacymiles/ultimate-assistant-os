"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { newPersona, suggestUsername } from "@/lib/social-personas/logic";
import { PRESETS, type Persona } from "@/lib/social-personas/types";
import { Avatar, Btn, inputCls } from "./bits";

/** Longest side of a stored profile picture. Enough for a 48px avatar at 3x. */
const AVATAR_PX = 256;

export function PersonaForm({ initial, onClose, onSave }: { initial?: Persona; ai?: boolean; onClose: () => void; onSave: (p: Persona) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [avatar, setAvatar] = useState<string | null>(initial?.avatar ?? null);
  const [imgError, setImgError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const [niche, setNiche] = useState(initial?.niche ?? "");
  const [overview, setOverview] = useState(initial?.overview ?? "");
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

  /**
   * Resize on the way in, never on the way out.
   *
   * A phone photo is several megabytes and this board is one synced JSON blob
   * — storing the original would push the whole board past the platform's
   * request cap and break syncing for every persona, not just this one.
   */
  const pickFile = async (f: File) => {
    setImgError("");
    if (!/^image\//.test(f.type)) return setImgError("That file isn't an image.");
    if (f.size > 12 * 1024 * 1024) return setImgError("That image is over 12 MB. Pick a smaller one.");
    try {
      const bitmap = await createImageBitmap(f);
      const scale = Math.min(1, AVATAR_PX / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();
      setAvatar(canvas.toDataURL("image/jpeg", 0.86));
    } catch {
      setImgError("That image couldn't be read. Try a JPEG or PNG.");
    }
  };

  const save = () => {
    if (!name.trim()) return;
    const fields = {
      name: name.trim(),
      nickname: nickname.trim() || niche.trim() || "Unfiled",
      username: username.trim().replace(/^@/, "").replace(/\s+/g, ""),
      avatar,
      niche: niche.trim(),
      overview: overview.trim(),
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
          <h2 className="text-base font-semibold text-ink">{initial ? "Edit profile" : "New persona"}</h2>
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
          <Field label="Nickname" hint="The job. Several personas can share one.">
            <input className={inputCls} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Trolling agent" list="nickname-options" />
            <datalist id="nickname-options">
              {[...new Set(PRESETS.map((x) => x.nickname).filter(Boolean))].map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>

          {/* Identity, laid out the way a profile reads. */}
          <div className="flex items-start gap-3 rounded-xl border border-line bg-canvas/40 p-2.5">
            <div className="shrink-0 text-center">
              <Avatar name={name || "?"} hue={initial?.hue ?? 210} size={56} src={avatar} />
              <div className="mt-1.5 flex flex-col gap-1">
                <button onClick={() => file.current?.click()} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted transition hover:bg-panel-2 hover:text-ink">
                  <Icon.Upload width={10} height={10} className="inline" /> Picture
                </button>
                {avatar && (
                  <button onClick={() => setAvatar(null)} className="text-[11px] text-ink-faint transition hover:text-ink">
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={file}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pickFile(f);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <Field label="Username" hint="Shown next to the picture">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-ink-faint">@</span>
                  <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} placeholder={name ? suggestUsername(name) : "barryknowsthings"} />
                </div>
              </Field>
              {imgError && <p className="text-xs text-rose-300">{imgError}</p>}
              {!avatar && (
                <input
                  className={inputCls}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (/^https:\/\//i.test(v)) setAvatar(v);
                  }}
                  placeholder="…or paste an https:// image address"
                />
              )}
            </div>
          </div>

          <Field label="Persona name" hint="What you call this identity">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lil Verse, Explain It Fast, Baby Mila" />
          </Field>
          <Field label="Niche" hint="The kind of content, in a few words">
            <input className={inputCls} value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Rap music videos" />
          </Field>
          <Field label="Profile overview" hint="Who this persona is — the AI follows it">
            <textarea
              rows={3}
              className={inputCls + " resize-y"}
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
              placeholder="A 19-year-old rapper from Columbus who drops a verse every day and lets fans pick the next beat. Faceless, voice-first, lots of studio B-roll."
            />
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
