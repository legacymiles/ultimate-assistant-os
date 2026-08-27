"use client";

import { moodHue } from "@/lib/seedance/constants";
import type { AspectRatio, Segment } from "@/lib/seedance/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";

interface Props {
  aspectRatio: AspectRatio;
  currentSegment: Segment | null;
  currentIndex: number;
  playing: boolean;
  playheadSec: number;
  totalSec: number;
  renderedCount: number;
  totalCount: number;
  onTogglePlay: () => void;
}

const RATIO: Record<AspectRatio, string> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "1:1": "1 / 1",
};

export function PreviewPlayer({
  aspectRatio,
  currentSegment,
  currentIndex,
  playing,
  playheadSec,
  totalSec,
  renderedCount,
  totalCount,
  onTogglePlay,
}: Props) {
  const seg = currentSegment;
  const hue = seg ? seg.posterHue ?? moodHue(seg.mood) : 200;
  const gradient = `linear-gradient(135deg, hsl(${hue} 60% 30%), hsl(${(hue + 40) % 360} 55% 18%))`;
  const progress = totalSec > 0 ? Math.min(100, (playheadSec / totalSec) * 100) : 0;

  return (
    <div className="flex h-full flex-col rounded-xl border border-line bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Preview</h3>
        <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] font-medium text-ink-muted">
          {renderedCount}/{totalCount} rendered
        </span>
      </div>

      {/* Stage */}
      <div className="flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
        <div
          className="relative w-full max-w-full overflow-hidden"
          style={{ aspectRatio: RATIO[aspectRatio], maxHeight: "46vh" }}
        >
          {seg && seg.status === "done" && seg.engine === "seedance" && seg.videoUrl ? (
            <video
              key={seg.id}
              src={seg.videoUrl}
              autoPlay={playing}
              muted
              loop
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : seg && seg.status === "done" ? (
            <div className="absolute inset-0" style={{ background: gradient }}>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
                  Segment {currentIndex + 1} · {seg.mood}
                </span>
                <p className="max-w-md text-sm font-medium text-white/90">
                  {seg.prompt.trim() || "Untitled shot"}
                </p>
                <span className="text-[10px] text-white/50">
                  Placeholder preview — add AI_GATEWAY_API_KEY to render real Seedance video
                </span>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <Icon.Launch width={22} height={22} className="text-ink-faint" />
              <p className="text-xs text-ink-muted">
                {totalCount === 0 ? "Add a segment to begin" : "Generate segments to preview the reel"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Transport */}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={onTogglePlay}
          disabled={renderedCount === 0}
          aria-label={playing ? "Pause" : "Play"}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[#04121a] transition hover:opacity-90 disabled:opacity-40",
          )}
        >
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <span className="w-16 shrink-0 text-[11px] tabular-nums text-ink-muted">
          {fmt(playheadSec)} / {fmt(totalSec)}
        </span>
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function PlayGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
