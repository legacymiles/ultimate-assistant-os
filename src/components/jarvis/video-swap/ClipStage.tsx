"use client";

// The driving video: drop it in, watch it, scrub to the moment where every
// face is clearest, then tap each person on that frame. The strip under it is
// the whole clip; its handles trim what gets made, its pin is the marked frame.

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../icons";
import type { VideoSwap } from "@/lib/studio/video-swap/useVideoSwap";
import { filmstrip, formatBytes, formatTime } from "@/lib/studio/video-swap/frame";
import { MAX_PEOPLE, isMarked, workSeconds } from "@/lib/studio/video-swap/plan";
import { Slot } from "./Slot";

export function ClipStage({ swap }: { swap: VideoSwap }) {
  const { clip, meta, draft, still } = swap;
  const [mode, setMode] = useState<"mark" | "play">("mark");
  const [strip, setStrip] = useState<string[]>([]);
  const [scrub, setScrub] = useState(draft.frameAt);
  const video = useRef<HTMLVideoElement>(null);
  const screen = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStrip([]);
    if (!clip) return;
    let alive = true;
    void filmstrip(clip.url, 12).then((s) => alive && setStrip(s));
    return () => {
      alive = false;
    };
  }, [clip]);

  useEffect(() => setScrub(draft.frameAt), [draft.frameAt]);

  const dur = meta?.duration ?? 0;
  const trim = draft.trim ?? { start: 0, end: dur };
  const marked = draft.people.filter(isMarked).length;
  const pct = (t: number) => (dur ? `${(t / dur) * 100}%` : "0%");

  if (!clip) {
    return (
      <div className="grid gap-3">
        <Slot
          label={meta ? `Add “${meta.name}” again` : "Drop your driving video"}
          hint={meta ? "Clips stay on this device only — re-add it after a reload." : "MP4 or MOV · the motion, camera and timing all come from this clip"}
          accept="video/*"
          icon={<Icon.Film width={22} height={22} aria-hidden />}
          className="aspect-[16/10] w-full"
          onFile={(f) => void swap.setClip(f)}
        />
        {swap.busy && <div className="vs-skel h-11" aria-label={swap.busy} />}
      </div>
    );
  }

  const onTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== "mark" || !still) return;
    const img = screen.current?.querySelector("img.vs-still") as HTMLImageElement | null;
    if (!img) return;
    // Map the tap into the picture itself (it's letterboxed inside the screen).
    const box = img.getBoundingClientRect();
    const ratio = img.naturalWidth / img.naturalHeight;
    const boxRatio = box.width / box.height;
    const w = boxRatio > ratio ? box.height * ratio : box.width;
    const h = boxRatio > ratio ? box.height : box.width / ratio;
    const left = box.left + (box.width - w) / 2;
    const top = box.top + (box.height - h) / 2;
    const x = (e.clientX - left) / w;
    const y = (e.clientY - top) / h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    void swap.tap(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
  };

  const portrait = (meta?.height ?? 0) > (meta?.width ?? 1);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="vs-seg" role="group" aria-label="Video mode">
          <button type="button" aria-pressed={mode === "mark"} onClick={() => setMode("mark")}>
            <Icon.Target width={12} height={12} aria-hidden /> Mark people
          </button>
          <button
            type="button"
            aria-pressed={mode === "play"}
            onClick={() => {
              setMode("play");
              requestAnimationFrame(() => video.current?.play().catch(() => {}));
            }}
          >
            <Icon.Play width={11} height={11} aria-hidden /> Play
          </button>
        </div>
        <span className="mono text-[11px] text-[var(--vs-ink-3)]">
          {meta ? `${meta.width}×${meta.height} · ${formatTime(dur)} · ${formatBytes(meta.size)}` : ""}
        </span>
      </div>

      <div
        ref={screen}
        className={`vs-screen ${mode === "mark" ? "is-marking" : ""} ${portrait ? "mx-auto aspect-[9/16] max-h-[58vh]" : "aspect-video w-full"}`}
        onClick={onTap}
      >
        {mode === "play" ? (
          <video
            ref={video}
            src={clip.url}
            controls
            playsInline
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime;
              if (t > trim.end) e.currentTarget.currentTime = trim.start;
            }}
          />
        ) : still ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local frame */}
            <img className="vs-still" src={still} alt="The frame you mark people on" draggable={false} />
            <MarkLayer swap={swap} />
            <span className="vs-hint">
              {marked === 0
                ? "Tap each person you want to replace"
                : marked < Math.min(MAX_PEOPLE, Math.max(1, draft.people.length))
                  ? `Marked ${marked} — tap the next person`
                  : "Tap a mark again to move it"}
            </span>
          </>
        ) : (
          <div className="vs-skel h-full w-full" aria-label="Reading the frame" />
        )}
      </div>

      {/* The strip: the whole clip, trim handles, and the marking pin */}
      <div className="grid gap-1.5">
        <div className="vs-strip" aria-hidden>
          {strip.length
            ? // eslint-disable-next-line @next/next/no-img-element -- local stills
              strip.map((s, i) => <img key={i} src={s} alt="" />)
            : Array.from({ length: 12 }, (_, i) => <span key={i} className="vs-skel flex-1 !rounded-none" />)}
          <span className="vs-strip__out" style={{ left: 0, width: pct(trim.start) }} />
          <span className="vs-strip__out" style={{ left: pct(trim.end), right: 0 }} />
          <span className="vs-strip__pin" style={{ left: pct(scrub) }} />
        </div>
        <div className="vs-range" aria-label="Trim">
          <span className="vs-range__track" />
          <span className="vs-range__fill" style={{ left: pct(trim.start), width: `calc(${pct(trim.end)} - ${pct(trim.start)})` }} />
          <input
            type="range"
            min={0}
            max={dur}
            step={0.1}
            value={trim.start}
            aria-label="Start"
            onChange={(e) => swap.patch({ trim: { start: Math.min(Number(e.target.value), trim.end - 1), end: trim.end } })}
          />
          <input
            type="range"
            min={0}
            max={dur}
            step={0.1}
            value={trim.end}
            aria-label="End"
            onChange={(e) => swap.patch({ trim: { start: trim.start, end: Math.max(Number(e.target.value), trim.start + 1) } })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--vs-ink-3)]">
          <span>
            Using <b className="mono font-medium text-[var(--vs-ink)]">{formatTime(trim.start)}–{formatTime(trim.end)}</b> ({workSeconds(draft, meta).toFixed(1)} s)
          </span>
          <label className="ml-auto flex min-w-[200px] flex-1 items-center gap-2">
            <span className="whitespace-nowrap">Mark on</span>
            <input
              className="vs-scrub"
              type="range"
              min={0}
              max={dur}
              step={0.1}
              value={scrub}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={() => void swap.markFrame(scrub)}
              onKeyUp={() => void swap.markFrame(scrub)}
              aria-label="Which frame to mark people on"
            />
            <span className="mono text-[var(--vs-ink)]">{formatTime(scrub)}</span>
          </label>
          <button type="button" className="vs-ghost !h-7" onClick={() => void swap.setClip(null)}>
            <Icon.Refresh width={11} height={11} aria-hidden /> Change clip
          </button>
        </div>
      </div>
    </div>
  );
}

function MarkLayer({ swap }: { swap: VideoSwap }) {
  const [box, setBox] = useState<{ left: number; top: number; w: number; h: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.parentElement?.querySelector("img.vs-still") as HTMLImageElement | null;
    if (!el) return;
    const measure = () => {
      const parent = el.parentElement!.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (!el.naturalWidth) return;
      const ratio = el.naturalWidth / el.naturalHeight;
      const boxRatio = b.width / b.height;
      const w = boxRatio > ratio ? b.height * ratio : b.width;
      const h = boxRatio > ratio ? b.height : b.width / ratio;
      setBox({ left: b.left - parent.left + (b.width - w) / 2, top: b.top - parent.top + (b.height - h) / 2, w, h });
    };
    measure();
    el.addEventListener("load", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("load", measure);
      ro.disconnect();
    };
  }, [swap.still]);
  const ordered = swap.draft.people;
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {box &&
        ordered.map((p, i) =>
          isMarked(p) ? (
            <span
              key={p.id}
              className="vs-mark"
              data-n={i + 1}
              style={{ left: box.left + p.x * box.w, top: box.top + p.y * box.h }}
              aria-label={`Person ${i + 1}`}
            />
          ) : null,
        )}
    </div>
  );
}
