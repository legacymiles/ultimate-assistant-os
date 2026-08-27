"use client";

import { useRef } from "react";
import { EDIT_MAX_DURATION, EDIT_MIN_DURATION, moodHue } from "@/lib/seedance/constants";
import type { Segment } from "@/lib/seedance/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";

interface Props {
  segment: Segment;
  index: number;
  selected: boolean;
  pxPerSec: number;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onResize: (durationSec: number) => void;
}

const fmtDur = (d: number) => (d % 1 === 0 ? `${d}s` : `${d.toFixed(1)}s`);

export function SegmentBlock({
  segment,
  index,
  selected,
  pxPerSec,
  isFirst,
  isLast,
  onSelect,
  onDelete,
  onMoveLeft,
  onMoveRight,
  onResize,
}: Props) {
  const hue = segment.posterHue ?? moodHue(segment.mood);
  const width = Math.max(72, segment.durationSec * pxPerSec);
  const gradient = `linear-gradient(135deg, hsl(${hue} 65% 32%), hsl(${(hue + 40) % 360} 60% 22%))`;
  const done = segment.status === "done";
  const generating = segment.status === "generating";
  const lip = segment.type === "lipsync";

  const drag = useRef<{ startX: number; startDur: number } | null>(null);

  const onHandleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = { startX: e.clientX, startDur: segment.durationSec };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const deltaSec = (e.clientX - drag.current.startX) / pxPerSec;
    const next = Math.min(
      EDIT_MAX_DURATION,
      Math.max(EDIT_MIN_DURATION, Math.round((drag.current.startDur + deltaSec) * 10) / 10),
    );
    onResize(next);
  };
  const onHandleUp = (e: React.PointerEvent) => {
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
      style={{ width }}
      className={cn(
        "group relative h-24 shrink-0 overflow-hidden rounded-lg border text-left transition-[box-shadow,border-color]",
        selected ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-line-soft",
      )}
    >
      {/* Clip surface */}
      <div className="absolute inset-0" style={{ background: done || generating ? gradient : "var(--color-panel-2)" }} />

      {done && segment.engine === "seedance" && segment.videoUrl && (
        <video src={segment.videoUrl} muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
      )}

      {done && segment.engine === "placeholder" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/30 text-white/90">
            {lip ? <Icon.Mic width={13} height={13} /> : <Icon.Launch width={13} height={13} />}
          </span>
        </div>
      )}

      {generating && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          <span className="motion-safe:animate-pulse absolute inset-x-0 top-0 h-0.5 bg-accent" />
        </div>
      )}

      {/* Top row: index + type + duration */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-1 bg-gradient-to-b from-black/50 to-transparent p-1.5">
        <span className="flex items-center gap-1 rounded bg-black/40 px-1 py-0.5 text-[9px] font-semibold text-white/85">
          {lip ? <Icon.Mic width={9} height={9} /> : <Icon.Film width={9} height={9} />}
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="rounded bg-black/40 px-1 py-0.5 text-[9px] font-medium tabular-nums text-white/80">
          {fmtDur(segment.durationSec)}
        </span>
      </div>

      {/* Bottom row: prompt + mood/effect */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
        <p className="line-clamp-2 text-[10px] font-medium leading-tight text-white/90">
          {segment.prompt.trim() || (lip ? "Lip-sync shot" : "Empty prompt")}
        </p>
        <div className="mt-0.5 flex items-center gap-1">
          <span className="truncate text-[9px] text-white/60">{segment.mood}</span>
          {segment.effect !== "None" && (
            <span className="truncate text-[9px] text-accent">· {segment.effect}</span>
          )}
        </div>
      </div>

      {/* Hover controls */}
      <div className="absolute left-1 top-1/2 flex -translate-y-1/2 flex-col gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <MiniBtn label="Move left" disabled={isFirst} onClick={(e) => stop(e, onMoveLeft)}>
          <Icon.Chevron width={11} height={11} className="rotate-180" />
        </MiniBtn>
        <MiniBtn label="Move right" disabled={isLast} onClick={(e) => stop(e, onMoveRight)}>
          <Icon.Chevron width={11} height={11} />
        </MiniBtn>
        <MiniBtn label="Delete segment" danger onClick={(e) => stop(e, onDelete)}>
          <Icon.Trash width={11} height={11} />
        </MiniBtn>
      </div>

      {/* Right-edge resize handle */}
      <div
        role="separator"
        aria-label="Resize segment duration"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "absolute inset-y-0 right-0 z-10 flex w-2.5 cursor-ew-resize items-center justify-center",
          "opacity-0 transition group-hover:opacity-100",
          selected && "opacity-100",
        )}
      >
        <span className="h-8 w-1 rounded-full bg-accent/80" />
      </div>
    </div>
  );
}

function stop(e: React.MouseEvent, fn: () => void) {
  e.stopPropagation();
  fn();
}

function MiniBtn({
  children,
  label,
  disabled,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white/80 transition hover:bg-black/70",
        danger && "hover:text-red-400",
        disabled && "pointer-events-none opacity-30",
      )}
    >
      {children}
    </button>
  );
}
