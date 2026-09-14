"use client";

import { useRef, useState } from "react";
import { Icon } from "../icons";
import { ASPECTS, CUT_COUNTS, LOOKS, MAX_UPLOADS, QUALITY, ROLE_LABEL, TOTAL_SECONDS, estimateCost } from "@/lib/smart-shot/constants";
import { imageUrlFromDrop, isHeic, pickImageFiles } from "@/lib/image-studio/files";
import { downscaleToDataUrl } from "@/lib/smart-shot/media";
import type { Brief as BriefT, Quality, Upload, UploadRole } from "@/lib/smart-shot/types";
import { uid } from "@/lib/utils";

interface Props {
  brief: BriefT;
  uploads: Upload[];
  onBrief: (b: BriefT) => void;
  onUploads: (u: Upload[]) => void;
  onPlan: () => void;
  onCreate: () => void;
  busy: string;
}

const EXAMPLES = [
  "A premium dark chocolate bar commercial on a dark wooden table, warm cinematic lighting, slow product reveal, close-ups of the chocolate texture, luxury food advertising style.",
  "A refreshing canned drink on a bright summer table, condensation on the can, quick product reveal, splash of fruit, and clean commercial lighting.",
  "A girl on a bicycle rides a coastal road at golden hour; a boy walking the other way passes her, they share one glance, and she ends alone at an abandoned hillside pool looking out to sea.",
];

export function Brief({ brief, uploads, onBrief, onUploads, onPlan, onCreate, busy }: Props) {
  const [drag, setDrag] = useState<UploadRole | null>(null);
  const [notice, setNotice] = useState("");
  const [url, setUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const pendingRole = useRef<UploadRole>("character");
  const room = MAX_UPLOADS - uploads.length;

  const addFiles = async (files: File[], role: UploadRole) => {
    const { accepted, skipped } = pickImageFiles(files, room, MAX_UPLOADS);
    const next: Upload[] = [];
    const problems = skipped.map((s) => `${s.name} ${s.reason}`);
    for (const f of accepted) {
      try {
        let blob: Blob = f;
        if (isHeic(f)) {
          const heic2any = (await import("heic2any")).default;
          const out = await heic2any({ blob: f, toType: "image/jpeg", quality: 0.9 });
          blob = Array.isArray(out) ? out[0] : out;
        }
        const dataUrl = await downscaleToDataUrl(blob, 1024);
        next.push({ id: uid("up"), role, name: "", dataUrl, description: "" });
      } catch {
        problems.push(`${f.name} could not be decoded`);
      }
    }
    if (next.length) onUploads([...uploads, ...next]);
    setNotice(problems.join(" · "));
  };

  const addUrl = async (u: string, role: UploadRole) => {
    if (!u.trim() || room <= 0) return;
    try {
      const res = await fetch(u.trim());
      const blob = await res.blob();
      const dataUrl = await downscaleToDataUrl(blob, 1024);
      onUploads([...uploads, { id: uid("up"), role, name: "", dataUrl, description: "" }]);
      setUrl("");
      setNotice("");
    } catch {
      setNotice("That link could not be fetched as an image. Save the picture and upload it instead.");
    }
  };

  const update = (id: string, patch: Partial<Upload>) => onUploads(uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  const pick = (role: UploadRole) => {
    pendingRole.current = role;
    input.current?.click();
  };
  const q = QUALITY[brief.quality];
  const canGo = !!brief.prompt.trim() && !busy;

  const DropZone = ({ role, title, hint }: { role: UploadRole; title: string; hint: string }) => (
    <div
      className={`ss-drop ss-drop-sm ${drag === role ? "is-drag" : ""}`}
      onClick={() => pick(role)}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(role);
      }}
      onDragLeave={() => setDrag(null)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(null);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) return void addFiles(files, role);
        const u = imageUrlFromDrop(e.dataTransfer.getData("text/uri-list"), e.dataTransfer.getData("text/html"));
        if (u) void addUrl(u, role);
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length) void addFiles(files, role);
      }}
      tabIndex={0}
      role="button"
    >
      <Icon.Upload width={16} height={16} />
      <span>
        <b>{title}</b>
        <br />
        <small>{hint}</small>
      </span>
    </div>
  );

  return (
    <div className="ss-brief">
      <section className="ss-card">
        <div className="ss-label">1 · Describe your scene</div>
        <textarea
          className="ss-textarea"
          rows={5}
          value={brief.prompt}
          onChange={(e) => onBrief({ ...brief, prompt: e.target.value })}
          placeholder="Describe the multi-shot video in plain language: the product or people, where, what happens, how it should feel. One paragraph is enough — the planner turns it into cuts."
        />
        <div className="ss-chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="ss-chip" onClick={() => onBrief({ ...brief, prompt: ex })}>
              {ex.slice(0, 64)}…
            </button>
          ))}
        </div>
      </section>

      <section className="ss-card">
        <div className="ss-label">
          2 · Add references <span className="ss-optional">optional</span>
        </div>
        <div className="ss-drops">
          <DropZone role="character" title="Characters & objects" hint="a person keeps their face; a product stays exact" />
          <DropZone role="location" title="Environment" hint="the set: a room, a road, a table" />
          <DropZone role="style" title="Style" hint="borrow the colour and light only" />
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void addFiles(files, pendingRole.current);
          }}
        />
        <div className="ss-urlrow">
          <input className="ss-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste an image link (added as a character/object)" onKeyDown={(e) => e.key === "Enter" && addUrl(url, "character")} />
          <button type="button" className="ss-btn" onClick={() => addUrl(url, "character")} disabled={!url.trim() || room <= 0}>
            Add
          </button>
        </div>
        <p className="ss-hint">
          {room} of {MAX_UPLOADS} slots left · paste a screenshot with Ctrl+V while a box is focused
        </p>
        {notice && <p className="ss-notice">{notice}</p>}

        {uploads.length > 0 && (
          <div className="ss-uploads">
            {uploads.map((u) => (
              <div key={u.id} className="ss-upload">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u.dataUrl} alt="" />
                <div className="ss-upload-fields">
                  <select className="ss-select" value={u.role} onChange={(e) => update(u.id, { role: e.target.value as UploadRole })}>
                    {(Object.keys(ROLE_LABEL) as UploadRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <input
                    className="ss-input"
                    value={u.name}
                    onChange={(e) => update(u.id, { name: e.target.value })}
                    placeholder={u.role === "character" ? "Name, e.g. GIRL" : u.role === "location" ? "e.g. COASTAL ROAD" : u.role === "object" ? "e.g. THE CHOCOLATE BAR" : "e.g. film look"}
                  />
                  <input className="ss-input" value={u.description} onChange={(e) => update(u.id, { description: e.target.value })} placeholder="Optional note about this image" />
                </div>
                <button type="button" className="ss-x" onClick={() => onUploads(uploads.filter((x) => x.id !== u.id))} aria-label="Remove">
                  <Icon.Close width={12} height={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ss-card">
        <div className="ss-label">3 · Shoot settings</div>
        <div className="ss-settings">
          <Field label="Cuts">
            <Segmented value={brief.cutCount} options={[...CUT_COUNTS]} onChange={(v) => onBrief({ ...brief, cutCount: v })} />
          </Field>
          <Field label="Length">
            <Segmented value={brief.totalSec} options={[...TOTAL_SECONDS]} onChange={(v) => onBrief({ ...brief, totalSec: v })} format={(v) => `${v}s`} />
          </Field>
          <Field label="Aspect">
            <Segmented value={brief.aspectRatio} options={ASPECTS} onChange={(v) => onBrief({ ...brief, aspectRatio: v })} />
          </Field>
          <Field label="Shoot quality">
            <Segmented value={brief.quality} options={["medium", "high"] as Quality[]} onChange={(v) => onBrief({ ...brief, quality: v })} format={(v) => QUALITY[v].name} />
          </Field>
          <Field label="Look">
            <select className="ss-select" value={brief.look} onChange={(e) => onBrief({ ...brief, look: e.target.value as BriefT["look"] })}>
              {LOOKS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="ss-help">
          <b>
            {brief.aspectRatio} | {q.label} | {brief.totalSec}s
          </b>{" "}
          · {brief.cutCount} cuts of ~{Math.max(2, Math.round(brief.totalSec / brief.cutCount))}s, rendered as one MiniMax H3 generation · {estimateCost(brief.totalSec, brief.quality)}
        </p>
      </section>

      <div className="ss-actions">
        <button type="button" className="ss-btn ss-btn-lg" onClick={onPlan} disabled={!canGo}>
          <Icon.Sparkles width={15} height={15} />
          {busy || "Preview shot plan"}
        </button>
        <button type="button" className="ss-primary ss-primary-lg" onClick={onCreate} disabled={!canGo}>
          <Icon.Film width={15} height={15} />
          {busy ? "Working…" : "Create video"}
        </button>
      </div>
      <p className="ss-help ss-center">Preview gives you the editable storyboard sheet first. Create video plans, draws the sheet and renders the film in one go.</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="ss-field">
      <span className="ss-label">{label}</span>
      {children}
    </label>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, format }: { value: T; options: T[]; onChange: (v: T) => void; format?: (v: T) => string }) {
  return (
    <div className="ss-seg" role="radiogroup">
      {options.map((o) => (
        <button key={String(o)} type="button" role="radio" aria-checked={o === value} className={o === value ? "is-on" : ""} onClick={() => onChange(o)}>
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}
