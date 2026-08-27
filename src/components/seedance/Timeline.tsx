"use client";

import { useMemo, useRef, useState } from "react";
import type { SeedanceProject } from "@/lib/seedance/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { SegmentBlock } from "./SegmentBlock";

interface Props {
  project: SeedanceProject;
  selectedId: string | null;
  playheadSec: number;
  onSelectSegment: (id: string) => void;
  onAddSegment: () => void;
  onDeleteSegment: (id: string) => void;
  onMoveSegment: (id: string, dir: -1 | 1) => void;
  onResizeSegment: (id: string, durationSec: number) => void;
  onPickSong: () => void;
  onClearSong: () => void;
}

const TRACK_LABEL_W = 68;
const GAP = 8;

const MIN_PPS = 3;
const MAX_PPS = 800;
const BASE_PPS = 26; // "100%"

const TICK_INTERVALS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

const clampPps = (v: number) => Math.min(MAX_PPS, Math.max(MIN_PPS, v));
const toSlider = (pps: number) => Math.round((1000 * Math.log(pps / MIN_PPS)) / Math.log(MAX_PPS / MIN_PPS));
const fromSlider = (v: number) => MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v / 1000);

function chooseInterval(pps: number): number {
  for (const iv of TICK_INTERVALS) if (iv * pps >= 64) return iv;
  return TICK_INTERVALS[TICK_INTERVALS.length - 1];
}

function formatTick(sec: number, interval: number): string {
  if (interval >= 60) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  if (Number.isInteger(sec)) return `${sec}s`;
  return `${sec.toFixed(2)}s`;
}

export function Timeline({
  project,
  selectedId,
  playheadSec,
  onSelectSegment,
  onAddSegment,
  onDeleteSegment,
  onMoveSegment,
  onResizeSegment,
  onPickSong,
  onClearSong,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pxPerSec, setPxPerSec] = useState(BASE_PPS);

  const totalSec = useMemo(
    () => Math.max(2, project.segments.reduce((s, seg) => s + seg.durationSec, 0)),
    [project.segments],
  );
  const laneWidth = totalSec * pxPerSec + project.segments.length * GAP + 120;

  const interval = chooseInterval(pxPerSec);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= totalSec + 1e-6; t += interval) out.push(Math.round(t * 100) / 100);
    return out;
  }, [totalSec, interval]);

  // Cumulative segment starts — used to align the song track to the video.
  const starts = useMemo(() => {
    const acc: number[] = [];
    let sum = 0;
    for (const seg of project.segments) {
      acc.push(sum);
      sum += seg.durationSec;
    }
    return acc;
  }, [project.segments]);

  const fit = () => {
    const el = scrollRef.current;
    if (!el) return;
    const avail = el.clientWidth - TRACK_LABEL_W - 24;
    setPxPerSec(clampPps(avail / totalSec));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Timeline</span>
        <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-muted">
          {formatTick(totalSec, totalSec >= 60 ? 60 : 1)} total
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={fit}
            className="rounded-md border border-line px-2 py-1 text-[10px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            Fit
          </button>
          <ZoomBtn label="Zoom out" onClick={() => setPxPerSec((p) => clampPps(p / 1.4))}>
            <Icon.ZoomOut width={13} height={13} />
          </ZoomBtn>
          <input
            type="range"
            min={0}
            max={1000}
            value={toSlider(pxPerSec)}
            onChange={(e) => setPxPerSec(clampPps(fromSlider(Number(e.target.value))))}
            aria-label="Timeline zoom"
            className="w-28 accent-[var(--color-accent)]"
          />
          <ZoomBtn label="Zoom in" onClick={() => setPxPerSec((p) => clampPps(p * 1.4))}>
            <Icon.ZoomIn width={13} height={13} />
          </ZoomBtn>
          <span className="w-11 text-right text-[10px] tabular-nums text-ink-faint">
            {Math.round((pxPerSec / BASE_PPS) * 100)}%
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto">
        <div className="relative" style={{ minWidth: TRACK_LABEL_W + laneWidth }}>
          {/* Ruler */}
          <div className="flex h-6 items-end border-b border-line-soft">
            <div className="sticky left-0 z-10 h-full w-[68px] shrink-0 border-r border-line-soft bg-panel" />
            <div className="relative h-full" style={{ width: laneWidth }}>
              {ticks.map((t) => (
                <div key={t} className="absolute bottom-0 flex flex-col items-center" style={{ left: t * pxPerSec }}>
                  <span className="mb-0.5 whitespace-nowrap text-[8px] tabular-nums text-ink-faint">
                    {formatTick(t, interval)}
                  </span>
                  <span className="h-1.5 w-px bg-line" />
                </div>
              ))}
            </div>
          </div>

          {/* Song track */}
          <Row label="Song" icon={<Icon.Sparkles width={12} height={12} />}>
            <div style={{ width: laneWidth }} className="relative py-1.5">
              {/* segment-boundary guides so the song reads as synced to the video */}
              {starts.slice(1).map((s, i) => (
                <span
                  key={i}
                  className="pointer-events-none absolute inset-y-1 w-px bg-line-soft"
                  style={{ left: s * pxPerSec }}
                />
              ))}
              {project.song ? (
                <div className="group relative flex h-10 items-center gap-2 overflow-hidden rounded-lg border border-accent/40 bg-accent/10 px-2">
                  <Waveform />
                  <span className="relative z-[1] truncate text-[11px] font-medium text-ink">{project.song.name}</span>
                  <button
                    onClick={onClearSong}
                    aria-label="Remove song"
                    className="relative z-[1] ml-auto rounded p-1 text-ink-faint opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  >
                    <Icon.Trash width={12} height={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={onPickSong}
                  className="flex h-10 w-56 items-center gap-2 rounded-lg border border-dashed border-line px-3 text-[11px] font-medium text-ink-muted transition hover:border-accent hover:text-ink"
                >
                  <Icon.Upload width={13} height={13} />
                  Add a song / audio track
                </button>
              )}
            </div>
          </Row>

          {/* Video segments track */}
          <Row label="Video" icon={<Icon.Layers width={12} height={12} />}>
            <div className="flex items-center py-1.5" style={{ gap: GAP, width: laneWidth }}>
              {project.segments.map((seg, i) => (
                <SegmentBlock
                  key={seg.id}
                  segment={seg}
                  index={i}
                  selected={seg.id === selectedId}
                  pxPerSec={pxPerSec}
                  isFirst={i === 0}
                  isLast={i === project.segments.length - 1}
                  onSelect={() => onSelectSegment(seg.id)}
                  onDelete={() => onDeleteSegment(seg.id)}
                  onMoveLeft={() => onMoveSegment(seg.id, -1)}
                  onMoveRight={() => onMoveSegment(seg.id, 1)}
                  onResize={(dur) => onResizeSegment(seg.id, dur)}
                />
              ))}
              <button
                onClick={onAddSegment}
                aria-label="Add prompt segment"
                className="flex h-24 w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-ink-muted transition hover:border-accent hover:text-accent"
              >
                <Icon.Plus width={18} height={18} />
                <span className="text-[9px] font-medium">Prompt</span>
              </button>
            </div>
          </Row>

          {/* Playhead */}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 top-6 z-20 w-px bg-accent"
            style={{ left: TRACK_LABEL_W + Math.min(playheadSec, totalSec) * pxPerSec }}
          >
            <span className="absolute -left-[3px] -top-1 h-2 w-2 rotate-45 bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoomBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-6 w-6 items-center justify-center rounded-md border border-line text-ink-muted transition hover:bg-panel-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

function Row({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex border-b border-line-soft last:border-b-0">
      <div className="sticky left-0 z-10 flex w-[68px] shrink-0 items-center gap-1 border-r border-line-soft bg-panel px-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {icon}
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Waveform() {
  const bars = Array.from({ length: 48 }, (_, i) => 6 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)) * 22);
  return (
    <div className="absolute inset-0 flex items-center gap-0.5 px-2 opacity-40">
      {bars.map((h, i) => (
        <span key={i} className="w-0.5 shrink-0 rounded-full bg-accent" style={{ height: `${h}px` }} />
      ))}
    </div>
  );
}
