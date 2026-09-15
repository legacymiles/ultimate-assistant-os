"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Aspect, DirectorPlan } from "@/lib/studio3d/types";
import type { AnimaticEngine } from "@/lib/studio3d/animatic/engine";
import { formatSec } from "./api";

// The screening-room player for the animatic: plays the plan as 3D previz,
// scrubs by scene, and records the same canvas to a WebM the owner can keep.

const ASPECT_CLASS: Record<Aspect, string> = {
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16] max-h-[70vh] mx-auto",
  "1:1": "aspect-square max-h-[70vh] mx-auto",
};

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export function Animatic({
  plan,
  aspect,
  title,
  onScene,
  seekTo,
}: {
  plan: DirectorPlan;
  aspect: Aspect;
  title: string;
  /** Tells the page which scene is on screen, to highlight its card. */
  onScene?: (index: number) => void;
  /** Jump request from outside (clicking a scene card): {sec, nonce}. */
  seekTo?: { sec: number; nonce: number } | null;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const engine = useRef<AnimaticEngine | null>(null);
  const time = useRef(0);
  const playingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(plan.totalSec);
  const [error, setError] = useState("");
  const [exportState, setExportState] = useState<{ progress: number } | null>(null);
  const [download, setDownload] = useState<{ url: string; ext: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const lastScene = useRef(-1);
  const planKey = useMemo(() => JSON.stringify({ plan, aspect }), [plan, aspect]);

  // Build the engine for this plan.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    (async () => {
      try {
        const { AnimaticEngine } = await import("@/lib/studio3d/animatic/engine");
        if (cancelled || !stage.current) return;
        const e = new AnimaticEngine(JSON.parse(planKey).plan, aspect);
        engine.current = e;
        stage.current.replaceChildren(e.canvas);
        e.canvas.setAttribute("role", "img");
        e.canvas.setAttribute("aria-label", `Animatic of ${title}`);
        setDuration(e.duration);
        time.current = Math.min(time.current, e.duration);
        e.draw(time.current);

        let last = performance.now();
        const loop = (ts: number) => {
          const dt = Math.min(0.1, (ts - last) / 1000);
          last = ts;
          if (playingRef.current && engine.current) {
            time.current += dt;
            if (time.current >= e.duration) {
              time.current = e.duration;
              playingRef.current = false;
              setPlaying(false);
              if (recorder.current?.state === "recording") recorder.current.stop();
            }
            e.draw(time.current);
            setNow(time.current);
            if (recorder.current?.state === "recording") setExportState({ progress: time.current / e.duration });
          }
          const idx = e.sceneAt(time.current).index;
          if (idx !== lastScene.current) {
            lastScene.current = idx;
            onScene?.(idx);
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (err) {
        setError((err as Error).message || "The animatic could not start in this browser.");
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      engine.current?.dispose();
      engine.current = null;
    };
    // onScene/title are display-only; rebuilding the 3D sets for them would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  const seek = useCallback((sec: number) => {
    const e = engine.current;
    if (!e) return;
    time.current = Math.min(Math.max(0, sec), e.duration);
    e.draw(time.current);
    setNow(time.current);
  }, []);

  useEffect(() => {
    if (seekTo) seek(seekTo.sec + 0.05);
  }, [seekTo, seek]);

  const toggle = () => {
    if (exportState) return;
    const e = engine.current;
    if (!e) return;
    if (!playingRef.current && time.current >= e.duration - 0.05) seek(0);
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
  };

  const startExport = () => {
    const e = engine.current;
    const mime = pickMime();
    if (!e || !mime || !("captureStream" in e.canvas)) {
      setError("This browser cannot record the animatic. Try Chrome, Edge or Firefox.");
      return;
    }
    if (download) URL.revokeObjectURL(download.url);
    setDownload(null);
    const stream = e.canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      setDownload({ url: URL.createObjectURL(blob), ext: mime.includes("mp4") ? "mp4" : "webm" });
      setExportState(null);
      recorder.current = null;
    };
    recorder.current = rec;
    seek(0);
    rec.start(250);
    setExportState({ progress: 0 });
    playingRef.current = true;
    setPlaying(true);
  };

  const cancelExport = () => {
    const rec = recorder.current;
    if (!rec) return;
    rec.onstop = null;
    rec.stop();
    recorder.current = null;
    setExportState(null);
    playingRef.current = false;
    setPlaying(false);
  };

  useEffect(() => () => {
    if (download) URL.revokeObjectURL(download.url);
  }, [download]);

  // Browsers stop animation frames in a hidden tab, so the animatic freezes.
  // Pause the recorder with it, or the file would fill with a frozen frame.
  const [hiddenPause, setHiddenPause] = useState(false);
  useEffect(() => {
    const onVisibility = () => {
      const rec = recorder.current;
      if (!rec) return;
      if (document.hidden && rec.state === "recording") {
        rec.pause();
        setHiddenPause(true);
      } else if (!document.hidden && rec.state === "paused") {
        rec.resume();
        setHiddenPause(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Space toggles playback when the player has focus.
  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === " " || ev.key === "k") {
      ev.preventDefault();
      toggle();
    }
    if (ev.key === "ArrowRight") seek(time.current + 2);
    if (ev.key === "ArrowLeft") seek(time.current - 2);
  };

  const fileName = `${title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "animatic"}-animatic`;

  return (
    <div className="flex flex-col gap-2" onKeyDown={onKey}>
      <div className={`s3d-stage relative w-full overflow-hidden rounded-2xl bg-black ${ASPECT_CLASS[aspect]}`}>
        <div ref={stage} className="absolute inset-0" />
        {error && <p className="absolute inset-x-0 bottom-3 text-center text-xs text-red-300">{error}</p>}
        {!playing && !exportState && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Play animatic"
            className="absolute inset-0 grid place-items-center bg-black/10 transition hover:bg-black/20"
          >
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white/90 text-black shadow-xl">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
                <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
              </svg>
            </span>
          </button>
        )}
        {exportState && (
          <div className="absolute inset-x-3 top-3 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-1.5 text-[11px] text-white backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
            {hiddenPause ? "Paused — recording continues when you come back to this tab" : `Recording animatic… ${Math.round(exportState.progress * 100)}%`}
            <button type="button" onClick={cancelExport} className="ml-auto rounded border border-white/30 px-1.5 py-0.5 hover:bg-white/10">
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={Boolean(exportState)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-ink transition hover:bg-elevated disabled:opacity-40"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
              <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
            </svg>
          )}
        </button>

        {/* Scrubber: one segment per scene, proportional to its length. */}
        <div className="relative flex h-8 min-w-0 flex-1 items-center">
          <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full">
            {plan.scenes.map((s, i) => {
              const start = plan.scenes.slice(0, i).reduce((a, x) => a + x.durationSec, 0);
              const fill = Math.min(1, Math.max(0, (now - start) / s.durationSec));
              return (
                <div key={s.id} className="relative h-full bg-line" style={{ flex: s.durationSec }}>
                  <div className="absolute inset-y-0 left-0 bg-brand" style={{ width: `${fill * 100}%` }} />
                </div>
              );
            })}
          </div>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={now}
            disabled={Boolean(exportState)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Scrub the animatic"
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          />
        </div>
        <span className="w-[76px] shrink-0 text-right font-mono text-[11px] text-ink-muted">
          {formatSec(now)} / {formatSec(duration)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={startExport}
          disabled={Boolean(exportState)}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-elevated disabled:opacity-40"
        >
          {exportState ? "Recording…" : download ? "Record again" : "Export animatic"}
        </button>
        {download && (
          <a
            href={download.url}
            download={`${fileName}.${download.ext}`}
            className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/25"
          >
            Download {download.ext.toUpperCase()}
          </a>
        )}
        <span className="text-[11px] text-ink-faint">Plays in real time while recording · {formatSec(duration)}</span>
      </div>
    </div>
  );
}

/** Render one still per scene (for storyboard cards) with a small throwaway engine. */
export function useSceneThumbs(plan: DirectorPlan, aspect: Aspect): (string | null)[] {
  const key = useMemo(() => JSON.stringify({ plan, aspect }), [plan, aspect]);
  const [thumbs, setThumbs] = useState<(string | null)[]>(() => plan.scenes.map(() => null));

  useEffect(() => {
    let cancelled = false;
    let e: AnimaticEngine | null = null;
    (async () => {
      try {
        const { AnimaticEngine } = await import("@/lib/studio3d/animatic/engine");
        if (cancelled) return;
        const parsed = JSON.parse(key) as { plan: DirectorPlan; aspect: Aspect };
        e = new AnimaticEngine(parsed.plan, parsed.aspect, 0.34);
        const out: (string | null)[] = [];
        for (let i = 0; i < parsed.plan.scenes.length; i++) {
          if (cancelled) break;
          // Past the title card on scene one, mid-action elsewhere.
          const s = parsed.plan.scenes[i];
          const at = e.starts[i] + Math.max(i === 0 ? 2.6 : 0, s.durationSec * 0.55);
          out.push(e.snapshot(Math.min(at, e.starts[i] + s.durationSec - 0.4)));
          setThumbs([...out, ...parsed.plan.scenes.slice(out.length).map(() => null)]);
          await new Promise((r) => setTimeout(r, 0));
        }
      } catch {
        /* thumbnails are decoration; the cards still read without them */
      } finally {
        e?.dispose();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return thumbs;
}
