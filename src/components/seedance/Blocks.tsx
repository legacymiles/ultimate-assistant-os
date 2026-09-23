"use client";

// ---------------------------------------------------------------------------
// The two things you can put on the timeline.
//
//   VideoBlockView   A prompt. It wears its own reference image until it has a
//                    rendered clip, so the lane reads as a storyboard rather
//                    than a row of coloured rectangles. Drag to reorder, drag
//                    the right edge to trim, "+" to add another after it.
//
//   LipRangeView     A stretch of song that gets sung. No prompt, no look, no
//                    settings — drag it, trim it, delete it. Whichever video
//                    blocks it lands on turn amber and lip-sync to the audio.
// ---------------------------------------------------------------------------

import { useRef } from "react";
import { SINGS, blockSkin, secs } from "@/lib/seedance/constants";
import { overrideCount, paletteOf, posterOf } from "@/lib/seedance/prompt";
import { MAX_BLOCK_SEC, MAX_LIP_SEC, MIN_BLOCK_SEC, MIN_LIP_SEC } from "@/lib/seedance/reel";
import type { LipRange, PlacedPrompt } from "@/lib/seedance/types";
import type { CinemaSelection } from "@/lib/studio/cinema";
import { Icon } from "../icons";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A drag surface, not a button. The pointer is captured here, so the whole
 * gesture — down, move, up — has to live on this element too; splitting it
 * across siblings silently drops every move event.
 */
function TrimHandle({
  side,
  color,
  onDown,
  onMove,
  onUp,
  label,
}: {
  side: "left" | "right";
  color: string;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: (e: React.PointerEvent) => void;
  label: string;
}) {
  return (
    <span
      role="separator"
      aria-label={label}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className={
        "sd-trim absolute inset-y-0 z-30 w-2.5 cursor-ew-resize touch-none " +
        (side === "left" ? "left-0" : "right-0")
      }
    >
      <span
        className="absolute inset-y-1.5 w-[3px] rounded-full opacity-0 transition-opacity duration-150"
        style={{ background: color, [side === "left" ? "left" : "right"]: 3 } as React.CSSProperties}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// A video prompt.
// ---------------------------------------------------------------------------

export function VideoBlockView({
  placed,
  cinema,
  selected,
  pxPerSec,
  dragging,
  onSelect,
  onDragTo,
  onDragEnd,
  onResize,
  onAddAfter,
  onDelete,
}: {
  placed: PlacedPrompt;
  cinema: CinemaSelection;
  selected: boolean;
  pxPerSec: number;
  dragging: boolean;
  onSelect: () => void;
  /** Where the pointer has reached on the lane, in seconds. The lane reorders. */
  onDragTo: (sec: number) => void;
  onDragEnd: () => void;
  onResize: (durationSec: number) => void;
  onAddAfter: () => void;
  onDelete: () => void;
}) {
  const { block, startSec, durationSec, lipSynced, lipSec } = placed;
  const skin = blockSkin(lipSynced);
  const width = Math.max(22, durationSec * pxPerSec);
  const poster = posterOf(block);
  const palette = paletteOf(cinema);
  const overrides = overrideCount(block);
  const empty = !block.prompt.trim();
  const roomy = width >= 112;
  const showPrompt = width >= 52;

  const drag = useRef<{ mode: "move" | "trim"; x: number; dur: number; mid: number } | null>(null);

  const begin = (mode: "move" | "trim") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = { mode, x: e.clientX, dur: durationSec, mid: startSec + durationSec / 2 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect();
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const deltaSec = (e.clientX - d.x) / pxPerSec;
    if (d.mode === "trim") onResize(clamp(d.dur + deltaSec, MIN_BLOCK_SEC, MAX_BLOCK_SEC));
    else onDragTo(d.mid + deltaSec);
  };

  const end = (e: React.PointerEvent) => {
    if (drag.current?.mode === "move") onDragEnd();
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div
      className={
        "sd-block group absolute top-1 bottom-1 flex flex-col overflow-hidden rounded-[8px] " +
        (dragging ? "z-40 opacity-90" : "sd-slide")
      }
      style={{
        left: startSec * pxPerSec,
        width,
        background: skin.fill,
        border: `1px ${empty && !poster ? "dashed" : "solid"} ${selected ? skin.edgeOn : skin.edge}`,
        boxShadow: selected
          ? `0 10px 26px -14px hsl(${skin.hue} 90% 55% / 0.85)`
          : "0 3px 10px -8px rgba(0,0,0,0.9)",
      }}
    >
      {/* The reference image IS the block until a clip exists. */}
      {poster && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={poster} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          <span aria-hidden className="absolute inset-0" style={{ background: skin.fill }} />
          <span
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/10"
          />
        </>
      )}

      <button
        type="button"
        onPointerDown={begin("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => {
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onDelete();
          }
        }}
        aria-label={`Shot at ${secs(startSec)}, ${secs(durationSec)} long${
          lipSynced ? ", lip synced" : ""
        }. ${block.prompt || "no prompt yet"}`}
        aria-pressed={selected}
        className="absolute inset-0 z-10 cursor-grab touch-none text-left active:cursor-grabbing focus-visible:outline-none"
      />

      <div className="pointer-events-none relative z-[5] flex min-w-0 items-center gap-1 px-2 pt-1.5">
        {width >= 54 && (
          <span
            className="flex shrink-0 items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: skin.text }}
          >
            {lipSynced && <Icon.Mic width={9} height={9} />}
            {roomy ? skin.label : null}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[9px] font-medium tabular-nums text-ink-muted">
          {secs(durationSec)}
        </span>
      </div>

      {showPrompt && (
        <p
          className={
            "pointer-events-none relative z-[5] mt-0.5 line-clamp-2 px-2 text-[11px] leading-[1.25] " +
            (empty ? "text-ink-faint" : "text-ink")
          }
        >
          {empty ? "Write this shot" : block.prompt}
        </p>
      )}

      {roomy && (overrides > 0 || block.status !== "idle" || lipSec > 0) && (
        <div className="pointer-events-none relative z-[5] mt-auto flex items-center gap-1 px-2 pb-1.5">
          {lipSec > 0 && (
            <span className="text-[9px] font-medium tabular-nums" style={{ color: SINGS.text }}>
              {secs(lipSec)} sung
            </span>
          )}
          {overrides > 0 && (
            <span className="rounded bg-black/40 px-1 py-px text-[9px] font-medium tabular-nums text-ink-muted">
              {overrides} own
            </span>
          )}
          {block.status === "done" && (
            <span className="ml-auto text-[9px] font-medium text-ink-muted">
              {block.engine === "seedance" ? "rendered" : "stand-in"}
            </span>
          )}
          {block.status === "error" && (
            <span className="ml-auto text-[9px] font-medium text-red-400">failed</span>
          )}
        </div>
      )}

      {palette && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 z-[6] flex h-[3px] overflow-hidden">
          {palette.map((c, i) => (
            <span key={i} className="flex-1" style={{ background: c }} />
          ))}
        </span>
      )}

      {block.status === "generating" && (
        <span aria-hidden className="sd-render absolute inset-0 z-[7] rounded-[8px]" />
      )}
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[8] rounded-[8px]"
          style={{ boxShadow: `inset 0 0 0 1.5px ${skin.edgeOn}` }}
        />
      )}

      {width >= 64 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddAfter();
          }}
          aria-label="Add a prompt after this one"
          title="Add a prompt after this one"
          className="sd-split absolute right-1 top-1 z-30 flex h-4 w-4 items-center justify-center rounded border border-line bg-canvas/85 text-ink-muted opacity-0 transition hover:border-accent hover:text-accent focus-visible:opacity-100"
        >
          <Icon.Plus width={10} height={10} />
        </button>
      )}
      <TrimHandle
        side="right"
        color={skin.edgeOn}
        onDown={begin("trim")}
        onMove={move}
        onUp={end}
        label="Trim this shot"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// A lip-sync range. It holds a decision, not a description.
// ---------------------------------------------------------------------------

export function LipRangeView({
  range,
  selected,
  pxPerSec,
  coveredCount,
  onSelect,
  onMove,
  onNudge,
  onDelete,
}: {
  range: LipRange;
  selected: boolean;
  pxPerSec: number;
  /** How many video blocks this range is currently landing on. */
  coveredCount: number;
  onSelect: () => void;
  onMove: (startSec: number, durationSec: number) => void;
  onNudge: (deltaSec: number) => void;
  onDelete: () => void;
}) {
  const width = Math.max(22, range.durationSec * pxPerSec);
  const roomy = width >= 108;
  const drag = useRef<{
    mode: "move" | "left" | "right";
    x: number;
    start: number;
    dur: number;
  } | null>(null);

  const begin = (mode: "move" | "left" | "right") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = { mode, x: e.clientX, start: range.startSec, dur: range.durationSec };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect();
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const delta = (e.clientX - d.x) / pxPerSec;
    if (d.mode === "move") onMove(d.start + delta, d.dur);
    else if (d.mode === "right") onMove(d.start, clamp(d.dur + delta, MIN_LIP_SEC, MAX_LIP_SEC));
    else {
      const dur = clamp(d.dur - delta, MIN_LIP_SEC, MAX_LIP_SEC);
      onMove(d.start + (d.dur - dur), dur);
    }
  };

  const end = (e: React.PointerEvent) => {
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div
      className="sd-block group absolute top-1 bottom-1 flex items-center overflow-hidden rounded-[8px]"
      style={{
        left: range.startSec * pxPerSec,
        width,
        background: SINGS.fill,
        border: `1px solid ${selected ? SINGS.edgeOn : SINGS.edge}`,
        boxShadow: selected ? `0 10px 26px -14px hsl(${SINGS.hue} 90% 55% / 0.85)` : "none",
      }}
    >
      <button
        type="button"
        onPointerDown={begin("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onNudge(e.shiftKey ? -1 : -0.1);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onNudge(e.shiftKey ? 1 : 0.1);
          } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onDelete();
          }
        }}
        aria-label={`Lip sync from ${secs(range.startSec)} for ${secs(
          range.durationSec,
        )}, over ${coveredCount || "no"} shot${coveredCount === 1 ? "" : "s"}`}
        aria-pressed={selected}
        className="absolute inset-0 z-10 cursor-grab touch-none text-left active:cursor-grabbing focus-visible:outline-none"
      />

      <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-1.5 px-2">
        <Icon.Mic width={11} height={11} style={{ color: SINGS.text }} className="shrink-0" />
        {roomy && (
          <span
            className="truncate text-[10px] font-semibold uppercase tracking-[0.07em]"
            style={{ color: SINGS.text }}
          >
            Sings
          </span>
        )}
        {width >= 58 && (
          <span className="ml-auto shrink-0 text-[9px] font-medium tabular-nums text-ink-muted">
            {secs(range.durationSec)}
          </span>
        )}
      </div>

      <TrimHandle
        side="left"
        color={SINGS.edgeOn}
        onDown={begin("left")}
        onMove={move}
        onUp={end}
        label="Trim the start"
      />
      <TrimHandle
        side="right"
        color={SINGS.edgeOn}
        onDown={begin("right")}
        onMove={move}
        onUp={end}
        label="Trim the end"
      />
    </div>
  );
}
