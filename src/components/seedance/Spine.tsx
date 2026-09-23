"use client";

// ---------------------------------------------------------------------------
// The timeline — three lanes, and only three.
//
//   Video prompts   the film, laid end to end. Every prompt lives here.
//   Song            the waveform, and the clock
//   Lip sync        ranges of song that get sung. No prompts in here.
//
// The song sits in the middle on purpose: the video lane and the lip-sync lane
// are both against the waveform, so lining a vocal up with a shot is a matter
// of looking straight up or straight down.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLAYS, SINGS, secs, timecode } from "@/lib/seedance/constants";
import { mergedCinema } from "@/lib/seedance/prompt";
import { layout, lipOverlap, songSec, sortLip, spanSec, videoSec } from "@/lib/seedance/reel";
import type { Reel } from "@/lib/seedance/types";
import { Icon } from "../icons";
import { LipRangeView, VideoBlockView } from "./Blocks";
import { SONG_HEIGHT, SongBar } from "./SongBar";

const LABEL_W = 122;
const RULER_H = 26;
const VIDEO_H = 86;
const SONG_ROW_H = SONG_HEIGHT + 10;
const LIP_H = 46;
const TAIL = 120;

const MIN_PPS = 2;
const MAX_PPS = 400;
const BASE_PPS = 14;
const TICKS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

const clampPps = (v: number) => Math.min(MAX_PPS, Math.max(MIN_PPS, v));
const toSlider = (pps: number) =>
  Math.round((1000 * Math.log(pps / MIN_PPS)) / Math.log(MAX_PPS / MIN_PPS));
const fromSlider = (v: number) => MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v / 1000);

function tickEvery(pps: number): number {
  for (const iv of TICKS) if (iv * pps >= 68) return iv;
  return TICKS[TICKS.length - 1];
}

export interface SpineProps {
  reel: Reel;
  selectedId: string | null;
  playheadSec: number;
  onScrub: (sec: number) => void;
  onSelect: (id: string) => void;
  onAddPrompt: (afterIndex?: number) => void;
  onResizePrompt: (index: number, durationSec: number) => void;
  onReorderPrompt: (index: number, toIndex: number) => void;
  onDeletePrompt: (index: number) => void;
  onAddLip: (atSec?: number) => void;
  onMoveLip: (id: string, startSec: number, durationSec: number) => void;
  onNudgeLip: (id: string, deltaSec: number) => void;
  onDeleteLip: (id: string) => void;
  onPickSong: () => void;
  onClearSong: () => void;
}

export function Spine(p: SpineProps) {
  const { reel } = p;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pxPerSec, setPxPerSec] = useState(BASE_PPS);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Once the owner has picked a zoom, the pane resizing must not undo it. Fit
  // clears the flag, because fitting IS asking for the automatic zoom back.
  const userZoomed = useRef(false);
  const zoomTo = (next: number) => {
    userZoomed.current = true;
    setPxPerSec(clampPps(next));
  };

  const total = spanSec(reel);
  const laneW = total * pxPerSec + TAIL;
  const cut = videoSec(reel.prompts);
  const song = songSec(reel);

  const placed = useMemo(() => layout(reel), [reel]);
  const lip = useMemo(() => sortLip(reel.lipsync), [reel.lipsync]);
  const sungSec = lip.reduce((s, r) => s + r.durationSec, 0);

  const every = tickEvery(pxPerSec);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= total + 1e-6; t += every) out.push(Math.round(t * 100) / 100);
    return out;
  }, [total, every]);

  const fit = useCallback(() => {
    const el = scrollRef.current;
    const avail = (el?.clientWidth ?? 0) - LABEL_W - 28;
    // Before first layout clientWidth is 0, which would clamp the whole song
    // down to the minimum zoom and leave the lanes as a stub. Wait for width.
    if (avail > 40) setPxPerSec(clampPps(avail / total));
  }, [total]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    fit();
    const ro = new ResizeObserver(() => {
      if (!userZoomed.current) fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // ----- scrubbing ---------------------------------------------------------
  const secAt = (clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const box = el.getBoundingClientRect();
    const x = clientX - box.left + el.scrollLeft - LABEL_W;
    return Math.max(0, Math.min(total, x / pxPerSec));
  };
  const scrubbing = useRef(false);

  /** A dragged block lands wherever the pointer's centre is, by index. */
  const dropIndex = (sec: number): number => {
    for (const q of placed) {
      if (sec < q.startSec + q.durationSec / 2) return q.index;
    }
    return placed.length - 1;
  };

  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">Timeline</h2>
        <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-muted">
          {timecode(cut)} cut
        </span>
        <span
          className="text-[10px] tabular-nums"
          style={{ color: cut > song ? "var(--color-ink-muted)" : "var(--color-ink-faint)" }}
        >
          of {timecode(song)} song
        </span>
        <span className="text-[10px] tabular-nums" style={{ color: SINGS.text }}>
          {timecode(sungSec)} lip sync
        </span>

        {reel.song ? (
          <button
            onClick={p.onClearSong}
            className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent transition hover:border-accent hover:bg-accent/15"
          >
            <Icon.Waveform width={11} height={11} />
            <span className="max-w-[160px] truncate">{reel.song.name}</span>
            <Icon.Close width={10} height={10} />
          </button>
        ) : (
          <button
            onClick={p.onPickSong}
            className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1 text-[10px] font-medium text-ink-muted transition hover:border-accent hover:text-ink"
          >
            <Icon.Upload width={11} height={11} />
            Load the song
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => {
              userZoomed.current = false;
              fit();
            }}
            className="rounded-md border border-line px-2 py-1 text-[10px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            Fit
          </button>
          <ZoomBtn label="Zoom out" onClick={() => zoomTo(pxPerSec / 1.45)}>
            <Icon.ZoomOut width={13} height={13} />
          </ZoomBtn>
          <input
            type="range"
            min={0}
            max={1000}
            value={toSlider(pxPerSec)}
            onChange={(e) => zoomTo(fromSlider(Number(e.target.value)))}
            aria-label="Timeline zoom"
            className="sd-range w-24"
          />
          <ZoomBtn label="Zoom in" onClick={() => zoomTo(pxPerSec * 1.45)}>
            <Icon.ZoomIn width={13} height={13} />
          </ZoomBtn>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-auto">
        <div className="relative" style={{ minWidth: LABEL_W + laneW }}>
          {/* Ruler — also the scrub bar */}
          <div
            className="sticky top-0 z-30 flex bg-panel/95 backdrop-blur-sm"
            style={{ height: RULER_H }}
          >
            <div
              className="sticky left-0 z-10 shrink-0 border-b border-r border-line-soft bg-panel"
              style={{ width: LABEL_W }}
            />
            <div
              className="relative shrink-0 cursor-col-resize touch-none border-b border-line-soft"
              style={{ width: laneW }}
              onPointerDown={(e) => {
                scrubbing.current = true;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                p.onScrub(secAt(e.clientX));
              }}
              onPointerMove={(e) => scrubbing.current && p.onScrub(secAt(e.clientX))}
              onPointerUp={() => (scrubbing.current = false)}
              onPointerCancel={() => (scrubbing.current = false)}
              role="slider"
              aria-label="Playhead"
              aria-valuemin={0}
              aria-valuemax={Math.round(total)}
              aria-valuenow={Math.round(p.playheadSec)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") p.onScrub(Math.max(0, p.playheadSec - (e.shiftKey ? 5 : 1)));
                if (e.key === "ArrowRight")
                  p.onScrub(Math.min(total, p.playheadSec + (e.shiftKey ? 5 : 1)));
              }}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute bottom-0 flex flex-col items-center"
                  style={{ left: t * pxPerSec }}
                >
                  <span className="mb-px whitespace-nowrap text-[8.5px] tabular-nums text-ink-faint">
                    {timecode(t, every < 1)}
                  </span>
                  <span className="h-1.5 w-px bg-line" />
                </div>
              ))}
            </div>
          </div>

          {/* ---- Video prompts ------------------------------------------- */}
          <Row
            label="Video prompts"
            icon={<Icon.Film width={12} height={12} />}
            height={VIDEO_H}
            tint={PLAYS.bed}
            accent={PLAYS.text}
            note={`${reel.prompts.length}`}
            action={
              <button
                onClick={() => p.onAddPrompt()}
                aria-label="Add a video prompt at the end"
                title="Add a video prompt"
                className="flex h-5 w-5 items-center justify-center rounded border text-ink-muted transition hover:text-ink"
                style={{ borderColor: PLAYS.edge }}
              >
                <Icon.Plus width={12} height={12} />
              </button>
            }
          >
            <div className="relative" style={{ width: laneW, height: VIDEO_H }}>
              {placed.map((ps) => (
                <VideoBlockView
                  key={ps.block.id}
                  placed={ps}
                  cinema={mergedCinema(reel, ps.block)}
                  selected={p.selectedId === ps.block.id}
                  pxPerSec={pxPerSec}
                  dragging={draggingId === ps.block.id}
                  onSelect={() => p.onSelect(ps.block.id)}
                  onDragTo={(sec) => {
                    setDraggingId(ps.block.id);
                    const to = dropIndex(sec);
                    if (to !== ps.index) p.onReorderPrompt(ps.index, to);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  onResize={(d) => p.onResizePrompt(ps.index, d)}
                  onAddAfter={() => p.onAddPrompt(ps.index)}
                  onDelete={() => p.onDeletePrompt(ps.index)}
                />
              ))}

              {/* The + at the end of the run — same gesture as the original. */}
              <button
                onClick={() => p.onAddPrompt()}
                aria-label="Add a video prompt at the end"
                className="absolute top-1 bottom-1 flex w-[54px] flex-col items-center justify-center gap-1 rounded-[8px] border border-dashed border-line text-ink-muted transition hover:border-accent hover:text-accent"
                style={{ left: cut * pxPerSec + 6 }}
              >
                <Icon.Plus width={16} height={16} />
                <span className="text-[9px] font-medium">Prompt</span>
              </button>
            </div>
          </Row>

          {/* ---- The song ------------------------------------------------ */}
          <Row
            label="Song"
            icon={<Icon.Waveform width={12} height={12} />}
            height={SONG_ROW_H}
            tint="hsl(188 80% 50% / 0.05)"
          >
            <div style={{ width: laneW }} className="flex items-center py-[5px]">
              <SongBar
                peaks={reel.song?.peaks}
                totalSec={total}
                songSec={song}
                pxPerSec={pxPerSec}
                lipsync={lip}
                hasSong={Boolean(reel.song)}
              />
            </div>
          </Row>

          {/* ---- Lip sync ------------------------------------------------ */}
          <Row
            label="Lip sync"
            icon={<Icon.Mic width={12} height={12} />}
            height={LIP_H}
            tint={SINGS.bed}
            accent={SINGS.text}
            note={lip.length ? `${lip.length}` : undefined}
            action={
              <button
                onClick={() => p.onAddLip()}
                aria-label="Add a lip sync range"
                title="Add a lip sync range"
                className="flex h-5 w-5 items-center justify-center rounded border text-ink-muted transition hover:text-ink"
                style={{ borderColor: SINGS.edge }}
              >
                <Icon.Plus width={12} height={12} />
              </button>
            }
          >
            <div className="relative" style={{ width: laneW, height: LIP_H }}>
              {/* Clicking bare lane drops a range exactly there — the fastest
                  way to aim at a line you just heard. */}
              <button
                type="button"
                aria-label="Add a lip sync range at the clicked moment"
                className="absolute inset-0 z-0 cursor-copy"
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  p.onAddLip(Math.max(0, Math.min(total, (e.clientX - box.left) / pxPerSec)));
                }}
              />
              {lip.map((r) => (
                <LipRangeView
                  key={r.id}
                  range={r}
                  selected={p.selectedId === r.id}
                  pxPerSec={pxPerSec}
                  coveredCount={
                    placed.filter(
                      (q) => lipOverlap([r], q.startSec, q.durationSec) > 0,
                    ).length
                  }
                  onSelect={() => p.onSelect(r.id)}
                  onMove={(s, d) => p.onMoveLip(r.id, s, d)}
                  onNudge={(delta) => p.onNudgeLip(r.id, delta)}
                  onDelete={() => p.onDeleteLip(r.id)}
                />
              ))}
              {!lip.length && (
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center whitespace-nowrap text-[11px] text-ink-faint">
                  Click anywhere here to mark a stretch that gets sung.
                </span>
              )}
            </div>
          </Row>

          {/* Playhead */}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 z-20 w-px bg-accent"
            style={{ top: RULER_H, left: LABEL_W + Math.min(p.playheadSec, total) * pxPerSec }}
          >
            <span className="absolute -left-[3.5px] -top-[5px] h-2 w-2 rotate-45 bg-accent" />
          </div>
        </div>
      </div>

      {cut < song && (
        <p className="border-t border-line bg-panel-2 px-3 py-1.5 text-[10px] text-ink-muted">
          The cut is {secs(song - cut)} shorter than the song. Add prompts with the
          <span className="mx-1 text-accent">+</span>
          until it reaches the end.
        </p>
      )}
      {cut > song && reel.song && (
        <p className="border-t border-line bg-panel-2 px-3 py-1.5 text-[10px] text-ink-muted">
          The cut runs {secs(cut - song)} past the end of the song. Trim a block or drop one.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function Row({
  label,
  icon,
  height,
  tint,
  accent,
  note,
  action,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  height: number;
  tint?: string;
  accent?: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex border-b border-line-soft last:border-b-0" style={{ background: tint }}>
      <div
        className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-r border-line-soft bg-panel px-2"
        style={{ width: LABEL_W, height }}
      >
        <span
          className="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.07em]"
          style={{ color: accent ?? "var(--color-ink-faint)" }}
        >
          {icon}
          <span className="truncate">{label}</span>
        </span>
        {(action || note) && (
          <span className="flex items-center gap-1.5">
            {action}
            {note && <span className="text-[9.5px] tabular-nums text-ink-faint">{note}</span>}
          </span>
        )}
      </div>
      <div className="shrink-0" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

function ZoomBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
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
