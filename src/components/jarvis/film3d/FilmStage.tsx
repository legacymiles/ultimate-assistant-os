"use client";

// ---------------------------------------------------------------------------
// The stage: the actual film, playing live in the page.
//
// Not an animatic — the same FilmPlayer the MP4 render uses, drawing the same
// frames, with the same score. Every edit reloads the film into the running
// player (sets are rebuilt only when they change), so the owner sees a change
// the moment they make it. The engine (three.js) loads lazily on first view.
// ---------------------------------------------------------------------------

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../../icons";
import type { Film3D } from "@/lib/studio/film3d/plan";
import type { FilmPlayer } from "@/lib/studio/film3d/player";

export interface FilmStageHandle {
  seek: (t: number, play?: boolean) => void;
}

interface Props {
  film: Film3D;
  /** Loop forever (the Character turntable) and hide the controls. */
  loop?: boolean;
  controls?: boolean;
  autoPlay?: boolean;
  /** Mute the score (the turntable). */
  silent?: boolean;
  onTime?: (t: number) => void;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

const RATIO: Record<Film3D["aspect"], number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 };

function fmt(t: number) {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export const FilmStage = forwardRef<FilmStageHandle, Props>(function FilmStage(
  { film, loop = false, controls = true, autoPlay = false, silent = false, onTime, className = "", style, label },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<FilmPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(autoPlay);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  const clock = useRef({ t: 0, at: 0 });
  const audio = useRef<{ ctx: AudioContext; buf: AudioBuffer | null; src: AudioBufferSourceNode | null; key: string } | null>(null);
  const filmKey = JSON.stringify(film);
  const tRef = useRef(0);
  tRef.current = t;
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  // Create the player once.
  useEffect(() => {
    let cancelled = false;
    let p: FilmPlayer | null = null;
    (async () => {
      try {
        const { FilmPlayer } = await import("@/lib/studio/film3d/player");
        if (cancelled || !canvas.current) return;
        p = new FilmPlayer({ canvas: canvas.current, width: 640, height: 360, quality: "preview" });
        player.current = p;
        setReady(true);
      } catch (e) {
        setError(e instanceof Error && /WebGL/i.test(e.message) ? "This device can't show 3D (WebGL is off)." : "The 3D stage couldn't start on this device.");
      }
    })();
    return () => {
      cancelled = true;
      p?.dispose();
      player.current = null;
      audio.current?.src?.stop();
      void audio.current?.ctx.close();
      audio.current = null;
    };
  }, []);

  // Size the canvas to its box (capped, so phones stay smooth).
  useEffect(() => {
    if (!ready || !box.current) return;
    const el = box.current;
    const fit = () => {
      const w = el.clientWidth;
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const ratio = RATIO[film.aspect];
      let width = Math.round(w * dpr);
      let height = Math.round(width / ratio);
      const cap = 1280;
      if (Math.max(width, height) > cap) {
        const k = cap / Math.max(width, height);
        width = Math.round(width * k);
        height = Math.round(height * k);
      }
      player.current?.setSize(width - (width % 2), height - (height % 2));
      player.current?.render(tRef.current);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, film.aspect]);

  // Load the film (and every edit to it), keeping the playhead where it was.
  useEffect(() => {
    if (!ready || !player.current) return;
    let live = true;
    const id = setTimeout(async () => {
      try {
        await player.current?.setFilm(film);
        if (!live || !player.current) return;
        const d = player.current.duration;
        setDuration(d);
        // Never rest on the black fade-in: a fresh film opens on its title frame.
        if (tRef.current === 0 && !loop && d > 3) {
          tRef.current = 1.4;
          setT(1.4);
        }
        const at = Math.min(tRef.current, Math.max(0, d - 0.05));
        player.current.render(at);
      } catch {
        if (live) setError("The 3D stage couldn't draw this film.");
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(id);
    };
    // filmKey stands in for `film` (deep compare).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, filmKey]);

  const stopAudio = () => {
    const a = audio.current;
    if (a?.src) {
      try {
        a.src.stop();
      } catch {
        /* already stopped */
      }
      a.src = null;
    }
  };

  const startAudio = useCallback(
    async (from: number) => {
      if (silent) return;
      try {
        if (!audio.current) audio.current = { ctx: new AudioContext(), buf: null, src: null, key: "" };
        const a = audio.current;
        if (a.ctx.state === "suspended") await a.ctx.resume();
        if (a.key !== filmKey || !a.buf) {
          const { renderScore } = await import("@/lib/studio/film3d/score");
          a.buf = await renderScore(film, 44100);
          a.key = filmKey;
        }
        stopAudio();
        const src = a.ctx.createBufferSource();
        src.buffer = a.buf;
        src.connect(a.ctx.destination);
        src.start(0, Math.max(0, from));
        a.src = src;
      } catch {
        /* music is a bonus; the picture keeps playing */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filmKey, silent],
  );

  // The play loop.
  useEffect(() => {
    if (!ready || !playing) {
      stopAudio();
      return;
    }
    let raf = 0;
    clock.current = { t: tRef.current >= duration - 0.05 ? 0 : tRef.current, at: performance.now() };
    void startAudio(clock.current.t);
    const tick = () => {
      const p = player.current;
      if (!p) return;
      let now = clock.current.t + (performance.now() - clock.current.at) / 1000;
      const d = p.duration;
      if (d > 0 && now >= d) {
        if (loop) {
          clock.current = { t: 0, at: performance.now() };
          now = 0;
        } else {
          p.render(d - 0.01);
          setT(d);
          setPlaying(false);
          return;
        }
      }
      p.render(now);
      setT(now);
      onTimeRef.current?.(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stopAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, playing, filmKey, loop]);

  const seek = useCallback(
    (to: number, play?: boolean) => {
      const d = player.current?.duration ?? duration;
      const at = Math.max(0, Math.min(to, Math.max(0, d - 0.02)));
      setT(at);
      tRef.current = at;
      clock.current = { t: at, at: performance.now() };
      player.current?.render(at);
      onTimeRef.current?.(at);
      if (play !== undefined) setPlaying(play);
      else if (playing) void startAudio(at);
    },
    [duration, playing, startAudio],
  );

  useImperativeHandle(ref, () => ({ seek }), [seek]);

  const scrubFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * duration);
  };

  return (
    <div
      ref={box}
      className={`f3-stage ${playing ? "" : "is-paused"} ${className}`}
      style={{ aspectRatio: String(RATIO[film.aspect]), ...style }}
      aria-label={label ?? `${film.title} — 3D preview`}
      role="region"
    >
      {/* A tap on the picture plays or pauses, like any video player. */}
      <canvas ref={canvas} onClick={controls && ready ? () => setPlaying((p) => !p) : undefined} />
      {!ready && !error && <div className="f3-loading"><span className="f3-busy" aria-hidden /></div>}
      {error && <div className="f3-loading px-4 text-center">{error}</div>}
      {controls && ready && (
        <div className="f3-stage__bar">
          <button type="button" className="f3-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Icon.Pause width={13} height={13} /> : <Icon.Play width={13} height={13} />}
          </button>
          <span className="f3-time">{fmt(t)}</span>
          <div
            className="f3-scrub"
            role="slider"
            tabIndex={0}
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(t)}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              scrubFrom(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons) scrubFrom(e);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") seek(t + 1);
              if (e.key === "ArrowLeft") seek(t - 1);
              if (e.key === " ") {
                e.preventDefault();
                setPlaying((p) => !p);
              }
            }}
          >
            <div className="f3-scrub__track">
              <div className="f3-scrub__fill" style={{ width: `${duration ? (t / duration) * 100 : 0}%` }} />
            </div>
            {duration > 0 && film.beats.slice(1).map((b) => <span key={b.id} className="f3-scrub__tick" style={{ left: `${(b.start / duration) * 100}%` }} />)}
            <span className="f3-scrub__head" style={{ left: `${duration ? (t / duration) * 100 : 0}%` }} />
          </div>
          <span className="f3-time">{fmt(duration)}</span>
        </div>
      )}
    </div>
  );
});
