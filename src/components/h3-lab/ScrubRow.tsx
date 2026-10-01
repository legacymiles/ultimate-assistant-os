"use client";

// A run as a single dense row that is also the film.
//
// The job this app exists for is comparing twenty takes quickly, and opening
// twenty players is the slow way to do it. So the row is the timeline: the
// pointer's x position across the row maps straight onto the clip's duration,
// and the frame under the cursor is the frame you get. Hovering plays; moving
// scrubs. Nothing to open, nothing to close.
//
// The video only mounts on first hover — a page of forty rows must not fetch
// forty films.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Run } from "@/lib/h3-lab/types";

const VERDICT_DOT: Record<string, string> = {
  good: "bg-emerald-400",
  mixed: "bg-amber-400",
  bad: "bg-rose-500",
};

export function ScrubRow({
  run,
  selected,
  onSelect,
}: {
  run: Run;
  selected: boolean;
  onSelect: () => void;
}) {
  const [armed, setArmed] = useState(false);     // has it ever been hovered
  const [scrubbing, setScrubbing] = useState(false);
  const [progress, setProgress] = useState(0);   // 0..1, drives the head
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const seekTo = useCallback((fraction: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = Math.max(0, Math.min(1, fraction)) * video.duration;
  }, []);

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = rowRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      setProgress(Math.max(0, Math.min(1, fraction)));
      if (scrubbing) seekTo(fraction);
    },
    [scrubbing, seekTo],
  );

  const enter = useCallback(() => {
    setArmed(true);
    const video = videoRef.current;
    // Reduced motion gets a still frame it can scrub, never autoplay.
    if (video && !reduced.current) void video.play().catch(() => undefined);
  }, []);

  const leave = useCallback(() => {
    setScrubbing(false);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setProgress(0);
  }, []);

  const src = `/api/h3-lab/films?file=${encodeURIComponent(run.file)}`;

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      aria-label={`${run.skill} — ${run.durationSec}s, ${run.shots} shots${run.verdict ? `, rated ${run.verdict}` : ", unrated"}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onPointerMove={onMove}
      onPointerDown={(e) => {
        // Drag anywhere along the row to scrub it by hand.
        e.currentTarget.setPointerCapture(e.pointerId);
        setScrubbing(true);
        const rect = e.currentTarget.getBoundingClientRect();
        seekTo((e.clientX - rect.left) / rect.width);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setScrubbing(false);
      }}
      className={`group relative isolate grid cursor-pointer grid-cols-[1.6fr_5rem_4rem_1fr_6rem] items-center gap-3
        border-b border-white/5 px-3 py-2 font-mono text-[11px] transition-colors
        ${selected ? "bg-white/[0.07]" : "hover:bg-white/[0.035]"}`}
    >
      {/* The film itself, behind the text, revealed on hover. */}
      {armed && (
        <video
          ref={videoRef}
          src={src}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-0
            transition-opacity duration-200 group-hover:opacity-[0.38]"
        />
      )}
      {/* Scrub head. Only while the pointer is actually over the row. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -z-10 w-px bg-white/70 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ left: `${progress * 100}%` }}
      />

      <span className="truncate text-neutral-200">{run.skill}</span>
      <span className="tabular-nums text-neutral-500">{run.durationSec.toFixed(1)}s</span>
      <span className="tabular-nums text-neutral-500">{run.shots} sh</span>
      <span className="truncate text-neutral-600">{run.settings}</span>
      <span className="flex items-center justify-end gap-1.5">
        {run.defects.length > 0 && (
          <span className="tabular-nums text-neutral-600">{run.defects.length}&times;</span>
        )}
        <span
          className={`h-1.5 w-1.5 rounded-full ${run.verdict ? VERDICT_DOT[run.verdict] : "bg-neutral-700"}`}
          title={run.verdict ?? "unrated"}
        />
      </span>
    </div>
  );
}
