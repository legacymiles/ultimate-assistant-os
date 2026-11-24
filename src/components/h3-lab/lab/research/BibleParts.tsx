"use client";

// Pieces the Character and Environment bibles share: reference photos
// (downscaled in the browser), an editable rule list, and "used by".

import { useRef, useState } from "react";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import { downscaleImage } from "./helpers";

export const MAX_REFS = 4;

export function RefImages({ images, onChange, label }: { images: string[]; onChange: (next: string[]) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    setBusy(true);
    const room = MAX_REFS - images.length;
    const picked = [...files].slice(0, Math.max(0, room));
    const out: string[] = [];
    for (const f of picked) {
      try {
        out.push(await downscaleImage(f, 768, 0.85));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not read that image.");
      }
    }
    if (files.length > room) setErr(`At most ${MAX_REFS} reference photos — ${files.length - room} not added.`);
    onChange([...images, ...out]);
    setBusy(false);
    if (input.current) input.current.value = "";
  };

  return (
    <div className="grid" style={{ gap: 6 }}>
      <span className="eyebrow">Reference photos ({images.length}/{MAX_REFS}) — the first is sent to H3 as {label}</span>
      <div className="row" style={{ gap: 8 }}>
        {images.map((src, i) => (
          <div key={i} style={{ position: "relative", width: 112 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Reference ${i + 1}`} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 5, border: `1px solid ${i === 0 ? "var(--amber-line)" : "var(--line)"}`, display: "block" }} />
            <button type="button" className="btn sm" aria-label={`Remove reference ${i + 1}`} style={{ position: "absolute", top: 4, right: 4, padding: "0 5px" }} onClick={() => onChange(images.filter((_, j) => j !== i))}>
              <X size={12} />
            </button>
          </div>
        ))}
        {images.length < MAX_REFS ? (
          <button type="button" className="btn" style={{ height: 112, width: 112, flexDirection: "column" }} onClick={() => input.current?.click()} disabled={busy}>
            <ImagePlus size={16} />
            {busy ? "Reading…" : "Add photo"}
          </button>
        ) : null}
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files)} />
      </div>
      {err ? <span style={{ color: "var(--bad)", fontSize: 12 }}>{err}</span> : null}
    </div>
  );
}

export function RulesEditor({ rules, onChange, hint }: { rules: string[]; onChange: (next: string[]) => void; hint: string }) {
  return (
    <div className="grid" style={{ gap: 6 }}>
      <span className="eyebrow">Continuity rules — the first one leads every anchor clause</span>
      {rules.map((r, i) => (
        <div className="row" key={i} style={{ flexWrap: "nowrap" }}>
          <span className="mono muted" style={{ width: 18 }}>{i + 1}</span>
          <input className="in" value={r} onChange={(e) => onChange(rules.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="btn ghost sm" aria-label={`Remove rule ${i + 1}`} onClick={() => onChange(rules.filter((_, j) => j !== i))}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn sm" onClick={() => onChange([...rules, ""])}><Plus size={12} /> Rule</button>
        <span className="muted" style={{ fontSize: 11.5 }}>{hint}</span>
      </div>
    </div>
  );
}
