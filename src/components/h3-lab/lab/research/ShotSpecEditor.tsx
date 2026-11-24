"use client";

// The ShotSpec editor — one form for a scenario (Experiment Lab) and a
// production scene (Production Library). Controlled: the parent owns the spec.

import { Plus, Trash2 } from "lucide-react";
import type { Amount, CameraMove, Character, DialogueLine, Environment, IntentChange, ShotSpec, Speed } from "@/lib/h3-lab/model";
import { FAMILY_LABEL, GENRES } from "@/lib/h3-lab/genres";
import type { GenreFamily } from "@/lib/h3-lab/model";

export const CAMERA_MOVES: CameraMove[] = [
  "static", "handheld", "push-in", "pull-out", "dolly-in", "track", "pan-left", "pan-right",
  "tilt-up", "tilt-down", "crane-up", "crane-down", "arc", "orbit", "zoom-in", "zoom-out", "pov", "shake",
];
const AMOUNTS: Amount[] = ["small", "medium", "large"];
const SPEEDS: Speed[] = ["slow", "medium", "fast"];
const INTENT: { id: IntentChange; label: string }[] = [
  { id: "position", label: "Position (people move)" },
  { id: "lighting", label: "Lighting" },
  { id: "wardrobe", label: "Wardrobe" },
  { id: "environment", label: "Environment" },
  { id: "framing", label: "Framing" },
  { id: "props", label: "Props" },
  { id: "time", label: "Time of day" },
];

export function blankSpec(genre = "movie-scene"): ShotSpec {
  return {
    genre,
    title: "",
    durationSec: 5,
    aspect: "16:9",
    framing: "medium shot",
    camera: { move: "static", amount: "medium", speed: "medium" },
    action: "",
    beats: [],
    characterIds: [],
    environmentId: null,
    dialogue: [],
    mood: "",
    lighting: "",
    style: "Live-action, cinematic",
    sound: "",
    music: "",
    intentionalChanges: [],
  };
}

export function GenreSelect({ value, onChange, id, allowAll }: { value: string; onChange: (v: string) => void; id?: string; allowAll?: string }) {
  const families = Object.keys(FAMILY_LABEL) as GenreFamily[];
  return (
    <select id={id} className="in" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll ? <option value="all">{allowAll}</option> : null}
      {families.map((f) => (
        <optgroup key={f} label={FAMILY_LABEL[f]}>
          {GENRES.filter((g) => g.family === f).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function ShotSpecEditor({
  value,
  onChange,
  characters,
  environments,
}: {
  value: ShotSpec;
  onChange: (next: ShotSpec) => void;
  characters: Character[];
  environments: Environment[];
}) {
  const set = <K extends keyof ShotSpec>(k: K, v: ShotSpec[K]) => onChange({ ...value, [k]: v });
  const setCam = (patch: Partial<ShotSpec["camera"]>) => onChange({ ...value, camera: { ...value.camera, ...patch } });
  const setLine = (i: number, patch: Partial<DialogueLine>) => set("dialogue", value.dialogue.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="rs-form">
        <label className="field span">
          <span>Title</span>
          <input className="in" value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="What this shot is, in a few words" />
        </label>
        <label className="field">
          <span>Genre</span>
          <GenreSelect value={value.genre} onChange={(v) => set("genre", v)} />
        </label>
        <label className="field">
          <span>Duration (4–15 s)</span>
          <input
            className="in mono"
            type="number"
            min={4}
            max={15}
            step={0.5}
            value={value.durationSec}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) set("durationSec", n);
            }}
            onBlur={() => set("durationSec", Math.max(4, Math.min(15, value.durationSec || 4)))}
          />
        </label>
        <label className="field">
          <span>Aspect</span>
          <select className="in" value={value.aspect} onChange={(e) => set("aspect", e.target.value as ShotSpec["aspect"])}>
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
          </select>
        </label>
        <label className="field">
          <span>Framing</span>
          <input className="in" value={value.framing} onChange={(e) => set("framing", e.target.value)} placeholder="medium two-shot" />
        </label>
      </div>

      <fieldset className="rs-form" style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="field">
          <span>Camera move</span>
          <select className="in" value={value.camera.move} onChange={(e) => setCam({ move: e.target.value as CameraMove })}>
            {CAMERA_MOVES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Amount</span>
          <select className="in" value={value.camera.amount} onChange={(e) => setCam({ amount: e.target.value as Amount })}>
            {AMOUNTS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Speed</span>
          <select className="in" value={value.camera.speed} onChange={(e) => setCam({ speed: e.target.value as Speed })}>
            {SPEEDS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Camera focus</span>
          <input className="in" value={value.camera.focus ?? ""} onChange={(e) => setCam({ focus: e.target.value || undefined })} placeholder="her eyes" />
        </label>
      </fieldset>

      <label className="field">
        <span>Action — the change, as it should be seen</span>
        <textarea className="in" value={value.action} onChange={(e) => set("action", e.target.value)} placeholder="Already under way in frame one: who does what, where" />
      </label>

      <div className="field" style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Beats (in order)</span>
        {value.beats.map((b, i) => (
          <div className="row" key={i} style={{ flexWrap: "nowrap" }}>
            <span className="mono muted" style={{ width: 18 }}>{i + 1}</span>
            <input className="in" value={b} onChange={(e) => set("beats", value.beats.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="btn ghost sm" aria-label={`Remove beat ${i + 1}`} onClick={() => set("beats", value.beats.filter((_, j) => j !== i))}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div>
          <button type="button" className="btn sm" onClick={() => set("beats", [...value.beats, ""])}>
            <Plus size={13} /> Beat
          </button>
        </div>
      </div>

      <div className="rs-form">
        <div className="field">
          <span className="eyebrow">Characters</span>
          {characters.length ? (
            <div className="rs-pill-list">
              {characters.map((c) => (
                <label className="rs-check" key={c.id}>
                  <input type="checkbox" checked={value.characterIds.includes(c.id)} onChange={() => set("characterIds", toggle(value.characterIds, c.id))} />
                  {c.name}
                </label>
              ))}
            </div>
          ) : (
            <span className="muted">No characters in the Character Bible yet.</span>
          )}
        </div>
        <label className="field">
          <span>Environment</span>
          <select className="in" value={value.environmentId ?? ""} onChange={(e) => set("environmentId", e.target.value || null)}>
            <option value="">None</option>
            {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
      </div>

      <div className="field" style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Dialogue</span>
        {value.dialogue.map((d, i) => (
          <div key={i} className="rs-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", alignItems: "end", borderLeft: "2px solid var(--line-2)", paddingLeft: 8 }}>
            <label className="field">
              <span>Speaker</span>
              <select className="in" value={d.speaker} onChange={(e) => setLine(i, { speaker: e.target.value })}>
                <option value="">Unnamed voice</option>
                {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="field span">
              <span>Line</span>
              <input className="in" value={d.line} onChange={(e) => setLine(i, { line: e.target.value })} />
            </label>
            <label className="field">
              <span>Delivery</span>
              <input className="in" value={d.delivery} onChange={(e) => setLine(i, { delivery: e.target.value })} placeholder="a low, steady voice" />
            </label>
            <div className="row">
              <label className="rs-check">
                <input type="checkbox" checked={Boolean(d.voiceover)} onChange={(e) => setLine(i, { voiceover: e.target.checked })} />
                Voiceover
              </label>
              <button type="button" className="btn ghost sm" aria-label={`Remove line ${i + 1}`} onClick={() => set("dialogue", value.dialogue.filter((_, j) => j !== i))}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        <div>
          <button type="button" className="btn sm" onClick={() => set("dialogue", [...value.dialogue, { speaker: value.characterIds[0] ?? "", line: "", delivery: "" }])}>
            <Plus size={13} /> Line
          </button>
        </div>
      </div>

      <div className="rs-form">
        <label className="field"><span>Mood</span><input className="in" value={value.mood} onChange={(e) => set("mood", e.target.value)} /></label>
        <label className="field"><span>Lighting</span><input className="in" value={value.lighting} onChange={(e) => set("lighting", e.target.value)} /></label>
        <label className="field"><span>Style</span><input className="in" value={value.style} onChange={(e) => set("style", e.target.value)} /></label>
        <label className="field"><span>Sound</span><input className="in" value={value.sound} onChange={(e) => set("sound", e.target.value)} /></label>
        <label className="field"><span>Music</span><input className="in" value={value.music} onChange={(e) => set("music", e.target.value)} /></label>
      </div>

      <div className="field">
        <span className="eyebrow">Intentional changes — never flagged by the Inspector</span>
        <div className="rs-pill-list">
          {INTENT.map((x) => (
            <label className="rs-check" key={x.id}>
              <input type="checkbox" checked={value.intentionalChanges.includes(x.id)} onChange={() => set("intentionalChanges", toggle(value.intentionalChanges, x.id))} />
              {x.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
