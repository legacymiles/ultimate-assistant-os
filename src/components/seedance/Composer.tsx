"use client";

import { ASPECT_RATIOS, MOODS, moodHue } from "@/lib/seedance/constants";
import type { AspectRatio, SeedanceProject } from "@/lib/seedance/types";
import { Icon } from "../icons";
import { Dropdown } from "./Dropdown";

interface Props {
  project: SeedanceProject;
  generatingAll: boolean;
  saved: boolean;
  onName: (v: string) => void;
  onBasePrompt: (v: string) => void;
  onGlobalMood: (v: string) => void;
  onAspect: (v: AspectRatio) => void;
  onGenerateAll: () => void;
  onSave: () => void;
}

const MOOD_LABELS = MOODS.map((m) => m.label);
const ASPECT_LABELS = ASPECT_RATIOS.map((a) => a.value);

export function Composer({
  project,
  generatingAll,
  saved,
  onName,
  onBasePrompt,
  onGlobalMood,
  onAspect,
  onGenerateAll,
  onSave,
}: Props) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={project.name}
          onChange={(e) => onName(e.target.value)}
          aria-label="Reel name"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-1 text-base font-semibold text-ink outline-none transition hover:border-line focus:border-accent"
        />
        <button
          onClick={onSave}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          {saved ? <Icon.Check width={13} height={13} /> : <Icon.Download width={13} height={13} />}
          {saved ? "Saved" : "Save"}
        </button>
        <button
          onClick={onGenerateAll}
          disabled={generatingAll}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-[#04121a] transition hover:opacity-90 disabled:opacity-50"
        >
          {generatingAll ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/40 border-t-black" />
          ) : (
            <Icon.Sparkles width={14} height={14} />
          )}
          {generatingAll ? "Rendering reel…" : "Generate reel"}
        </button>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Base prompt <span className="normal-case text-ink-faint/70">— applied to every segment</span>
          </span>
          <input
            value={project.basePrompt}
            onChange={(e) => onBasePrompt(e.target.value)}
            placeholder="e.g. a lone surfer at dawn, 35mm, muted teal grade"
            className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
        </label>
        <label className="block sm:w-40">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Default mood
          </span>
          <Dropdown
            value={project.globalMood}
            options={MOOD_LABELS}
            onChange={onGlobalMood}
            hueFor={moodHue}
            ariaLabel="Default mood"
          />
        </label>
        <label className="block sm:w-24">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Aspect
          </span>
          <Dropdown
            value={project.aspectRatio}
            options={ASPECT_LABELS}
            onChange={(v) => onAspect(v as AspectRatio)}
            ariaLabel="Aspect ratio"
          />
        </label>
      </div>
    </div>
  );
}
