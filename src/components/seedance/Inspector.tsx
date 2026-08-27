"use client";

import { useRef } from "react";
import { EDIT_MAX_DURATION, EDIT_MIN_DURATION, EFFECTS, MOODS, moodHue } from "@/lib/seedance/constants";
import type { Segment } from "@/lib/seedance/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { Dropdown } from "./Dropdown";

interface Props {
  segment: Segment | null;
  index: number;
  onChange: (patch: Partial<Segment>) => void;
  onAddRefs: (files: FileList) => void;
  onRemoveRef: (refId: string) => void;
  onGenerate: () => void;
  onDelete: () => void;
}

const MOOD_LABELS = MOODS.map((m) => m.label);
const EFFECT_LABELS = EFFECTS.map((e) => e.label);

export function Inspector({
  segment,
  index,
  onChange,
  onAddRefs,
  onRemoveRef,
  onGenerate,
  onDelete,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  if (!segment) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-line p-6 text-center">
        <Icon.Edit width={22} height={22} className="text-ink-faint" />
        <p className="mt-2 text-sm font-medium text-ink">No segment selected</p>
        <p className="mt-1 text-xs text-ink-muted">
          Pick a clip on the Video track, or add one with the <span className="text-accent">+</span>.
        </p>
      </div>
    );
  }

  const generating = segment.status === "generating";

  return (
    <div className="flex h-full flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-accent/15 text-[10px] font-semibold text-accent">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="text-sm font-semibold text-ink">Segment prompt</h3>
        </div>
        <button
          onClick={onDelete}
          aria-label="Delete segment"
          className="rounded p-1 text-ink-faint transition hover:text-red-400"
        >
          <Icon.Trash width={13} height={13} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Segment type */}
        <Field label="Segment type">
          <div className="grid grid-cols-2 gap-2">
            <TypeBtn
              active={segment.type === "broll"}
              onClick={() => onChange({ type: "broll" })}
              icon={<Icon.Film width={14} height={14} />}
              title="B-roll"
              subtitle="Visual footage"
            />
            <TypeBtn
              active={segment.type === "lipsync"}
              onClick={() => onChange({ type: "lipsync" })}
              icon={<Icon.Mic width={14} height={14} />}
              title="Lip sync"
              subtitle="Sings the song"
            />
          </div>
          {segment.type === "lipsync" && (
            <p className="mt-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1.5 text-[10px] leading-relaxed text-ink-muted">
              The subject will sing this slice of the song, lip-synced to the audio under this
              segment. Add a face reference below for a consistent performer.
            </p>
          )}
        </Field>

        {/* Prompt */}
        <Field label="Prompt">
          <textarea
            value={segment.prompt}
            onChange={(e) => onChange({ prompt: e.target.value })}
            rows={3}
            placeholder="Describe this shot — subject, action, setting…"
            className="w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
        </Field>

        {/* Mood + effect */}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Mood">
            <Dropdown
              value={segment.mood}
              options={MOOD_LABELS}
              onChange={(mood) => onChange({ mood })}
              hueFor={moodHue}
              ariaLabel="Mood"
            />
          </Field>
          <Field label="Video effect">
            <Dropdown
              value={segment.effect}
              options={EFFECT_LABELS}
              onChange={(effect) => onChange({ effect })}
              ariaLabel="Video effect"
            />
          </Field>
        </div>

        {/* Duration */}
        <Field label={`Duration — ${fmtDur(segment.durationSec)}`}>
          <input
            type="range"
            min={EDIT_MIN_DURATION}
            max={EDIT_MAX_DURATION}
            step={0.5}
            value={segment.durationSec}
            onChange={(e) => onChange({ durationSec: Number(e.target.value) })}
            className="w-full accent-[var(--color-accent)]"
          />
          <p className="mt-0.5 text-[9px] text-ink-faint">
            Drag a clip&apos;s right edge on the timeline to trim. Seedance renders 5–10s per clip.
          </p>
        </Field>

        {/* Reference media */}
        <Field label="Reference images / videos">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) onAddRefs(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            {segment.refs.map((r) => (
              <div key={r.id} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-line bg-canvas">
                {r.kind === "image" && r.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.url} alt={r.name} className="h-full w-full object-cover" />
                ) : r.kind === "video" && r.url ? (
                  <video src={r.url} muted className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-ink-faint">
                    <Icon.File width={16} height={16} />
                  </div>
                )}
                <button
                  onClick={() => onRemoveRef(r.id)}
                  aria-label={`Remove ${r.name}`}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
                >
                  <Icon.Close width={9} height={9} />
                </button>
              </div>
            ))}
            <button
              onClick={() => fileRef.current?.click()}
              aria-label="Upload reference media"
              className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-line text-ink-faint transition hover:border-accent hover:text-accent"
            >
              <Icon.Upload width={15} height={15} />
              <span className="text-[8px]">Upload</span>
            </button>
          </div>
        </Field>
      </div>

      <div className="border-t border-line p-3">
        <button
          onClick={onGenerate}
          disabled={generating}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition",
            "bg-accent text-[#04121a] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {generating ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/40 border-t-black" />
          ) : (
            <Icon.Sparkles width={15} height={15} />
          )}
          {generating ? "Rendering…" : "Generate this segment"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

function TypeBtn({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition",
        active
          ? "border-accent bg-accent/10 text-ink"
          : "border-line bg-panel-2 text-ink-muted hover:text-ink",
      )}
    >
      <span className={cn("shrink-0", active ? "text-accent" : "text-ink-faint")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold">{title}</span>
        <span className="block text-[9px] text-ink-faint">{subtitle}</span>
      </span>
    </button>
  );
}

const fmtDur = (d: number) => (d % 1 === 0 ? `${d}s` : `${d.toFixed(1)}s`);
