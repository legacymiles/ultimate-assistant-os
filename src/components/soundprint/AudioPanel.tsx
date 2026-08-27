"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeRange,
  fmt,
  loadAudio,
  type AudioFeatures,
  type LoadedAudio,
} from "@/lib/soundprint/audio-analysis";
import { analyzeWithEssentia, danceabilityLabel } from "@/lib/soundprint/essentia-analysis";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";

/** Fold essentia's superior tempo/key + new groove feature into DSP results. */
function mergeEssentia(
  f: AudioFeatures,
  ess: NonNullable<Awaited<ReturnType<typeof analyzeWithEssentia>>>,
): AudioFeatures {
  return {
    ...f,
    bpm: ess.bpm || f.bpm,
    bpmConfidence: ess.bpm ? Math.max(f.bpmConfidence, 0.85) : f.bpmConfidence,
    key: ess.key || f.key,
    keyConfidence: ess.key ? ess.keyStrength : f.keyConfidence,
    danceability: ess.danceability,
    danceabilityLabel: danceabilityLabel(ess.danceability),
    analyzer: "essentia",
  };
}

interface Props {
  onFeatures: (f: AudioFeatures | null) => void;
}

interface Range {
  start: number;
  end: number;
}

export function AudioPanel({ onFeatures }: Props) {
  const [audio, setAudio] = useState<LoadedAudio | null>(null);
  const [range, setRange] = useState<Range>({ start: 0, end: 0 });
  const [features, setFeatures] = useState<AudioFeatures | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const dragStartRef = useRef<number | null>(null);

  // Revoke the object URL when the file changes or we unmount.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const pickFile = async (file: File) => {
    setLoading(true);
    setError("");
    try {
      const loaded = await loadAudio(file);
      setAudio(loaded);

      // Default to the opening — it's what people are usually chasing.
      const end = Math.min(loaded.durationSec, 20);
      setRange({ start: 0, end });

      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(file);
      if (audioElRef.current) audioElRef.current.src = urlRef.current;
    } catch (err) {
      console.error("Audio load failed:", err);
      setError(
        err instanceof Error && /decode/i.test(err.message)
          ? "Couldn't decode that file. Try MP3, WAV, M4A, OGG or FLAC."
          : "Couldn't read that file.",
      );
      setAudio(null);
      onFeatures(null);
    } finally {
      setLoading(false);
    }
  };

  // Re-measure whenever the selection settles. The fast DSP pass shows
  // instantly; essentia.js then upgrades tempo/key and adds groove in the
  // background (and is skipped entirely if it fails to load).
  useEffect(() => {
    if (!audio || range.end <= range.start) return;
    let cancelled = false;

    const id = setTimeout(() => {
      const f = analyzeRange(audio, range.start, range.end);
      if (cancelled) return;
      setFeatures(f);
      onFeatures(f);

      const from = Math.max(0, Math.floor(range.start * audio.sampleRate));
      const to = Math.min(audio.samples.length, Math.floor(range.end * audio.sampleRate));
      const slice = audio.samples.slice(from, to);

      void analyzeWithEssentia(slice, audio.sampleRate).then((ess) => {
        if (cancelled || !ess) return;
        const upgraded = mergeEssentia(f, ess);
        setFeatures(upgraded);
        onFeatures(upgraded);
      });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [audio, range, onFeatures]);

  // ----- waveform ----------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audio) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const peaks = audio.peaks;
    const mid = h / 2;
    const barW = w / peaks.length;
    const selFrom = (range.start / audio.durationSec) * w;
    const selTo = (range.end / audio.durationSec) * w;

    for (let i = 0; i < peaks.length; i++) {
      const x = i * barW;
      const inSel = x >= selFrom - barW && x <= selTo;
      const amp = Math.max(1, peaks[i] * (h * 0.46));
      ctx.fillStyle = inSel ? "#6366f1" : "#2a2f3d";
      ctx.fillRect(x, mid - amp, Math.max(0.6, barW * 0.8), amp * 2);
    }

    // Selection edges
    ctx.strokeStyle = "#818cf8";
    ctx.lineWidth = 1.5;
    for (const x of [selFrom, selTo]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }, [audio, range]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  const timeAt = (clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || !audio) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * audio.durationSec;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!audio) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = timeAt(e.clientX);
    dragStartRef.current = t;
    setDragging(true);
    setRange({ start: t, end: t });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging || dragStartRef.current === null || !audio) return;
    const t = timeAt(e.clientX);
    const from = dragStartRef.current;
    setRange({ start: Math.min(from, t), end: Math.max(from, t) });
  };

  const onPointerUp = () => {
    if (!dragging || !audio) return;
    setDragging(false);
    dragStartRef.current = null;
    // A click (rather than a drag) selects a sensible window instead of nothing.
    setRange((r) =>
      r.end - r.start < 1
        ? { start: r.start, end: Math.min(audio.durationSec, r.start + 15) }
        : r,
    );
  };

  // ----- preview playback --------------------------------------------------
  const togglePlay = () => {
    const el = audioElRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    el.currentTime = range.start;
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    const onTime = () => {
      if (el.currentTime >= range.end) {
        el.pause();
        setPlaying(false);
      }
    };
    const onEnd = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, [range.end]);

  const quick = (seconds: number | "all") => {
    if (!audio) return;
    setRange(
      seconds === "all"
        ? { start: 0, end: audio.durationSec }
        : { start: 0, end: Math.min(audio.durationSec, seconds) },
    );
  };

  const clear = () => {
    setAudio(null);
    setFeatures(null);
    onFeatures(null);
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  };

  return (
    <section className="rounded-xl border border-line bg-panel p-3.5">
      <div className="mb-3 flex items-center gap-2">
        <Icon.Mic width={14} height={14} className="text-brand" />
        <h2 className="text-sm font-semibold text-ink">Let it listen</h2>
        <span className="rounded-md bg-core/15 px-1.5 py-0.5 text-[10px] font-semibold text-core">
          Optional
        </span>
      </div>

      <audio ref={audioElRef} className="hidden" preload="auto" />

      {!audio && (
        <label
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-4 py-7 text-center transition hover:border-brand/50 hover:bg-panel-2",
            loading && "pointer-events-none opacity-60",
          )}
        >
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickFile(f);
              e.target.value = "";
            }}
          />
          {loading ? (
            <>
              <Spinner />
              <span className="text-xs text-ink-muted">Decoding audio…</span>
            </>
          ) : (
            <>
              <Icon.Upload width={18} height={18} className="text-ink-faint" />
              <span className="text-xs font-medium text-ink">Drop an audio file</span>
              <span className="max-w-xs text-[11px] leading-relaxed text-ink-faint">
                Tempo, key, brightness, dynamics and whether the drums are in get measured
                from the waveform — right here, nothing uploaded.
              </span>
            </>
          )}
        </label>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          {error}
        </p>
      )}

      {audio && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="truncate font-medium text-ink">{audio.name}</span>
            <span className="text-ink-faint">{fmt(audio.durationSec)}</span>
            <button
              onClick={clear}
              className="ml-auto text-ink-faint transition hover:text-ink"
              aria-label="Remove audio"
            >
              <Icon.Close width={13} height={13} />
            </button>
          </div>

          <canvas
            ref={canvasRef}
            className="h-24 w-full cursor-crosshair touch-none rounded-lg bg-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={togglePlay}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-2"
            >
              {playing ? "Stop" : "Play selection"}
            </button>
            <span className="rounded-md bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink-muted">
              {fmt(range.start)} – {fmt(range.end)}
            </span>
            <span className="text-[10px] text-ink-faint">drag the waveform to change</span>
            <div className="ml-auto flex gap-1">
              <QuickBtn onClick={() => quick(15)}>First 15s</QuickBtn>
              <QuickBtn onClick={() => quick(30)}>30s</QuickBtn>
              <QuickBtn onClick={() => quick("all")}>All</QuickBtn>
            </div>
          </div>

          {features && <Measurements f={features} />}
        </div>
      )}
    </section>
  );
}

function Measurements({ f }: { f: AudioFeatures }) {
  const essentia = f.analyzer === "essentia";
  return (
    <div className="animate-fade-in space-y-2 rounded-lg border border-line bg-canvas p-3">
      <div className="flex items-center gap-1.5">
        <Icon.Sparkles width={11} height={11} className="text-core" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-core">
          Measured from your audio
        </span>
        <span
          className={cn(
            "ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
            essentia ? "bg-core/15 text-core" : "bg-panel-2 text-ink-faint",
          )}
          title={
            essentia
              ? "Analysed with the essentia.js music-analysis library"
              : "Built-in DSP — essentia.js is still loading or unavailable"
          }
        >
          {essentia ? "essentia.js" : "DSP"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        <Stat label="Tempo" value={f.bpm ? `${f.bpm} BPM` : "—"} />
        <Stat label="Key" value={f.key || "—"} />
        <Stat
          label="Groove"
          value={
            f.danceability !== undefined ? `${f.danceability.toFixed(1)}` : `${f.dynamicRangeDb.toFixed(0)} dB`
          }
        />
      </div>

      <Sparkline points={f.energyCurve} />

      <ul className="space-y-0.5 text-[11px] leading-relaxed text-ink-muted">
        <li>· {f.percussionLabel}</li>
        <li>· {f.brightness}</li>
        {f.danceabilityLabel && <li>· {f.danceabilityLabel}</li>}
        <li>· {f.density}</li>
        <li>· {f.dynamics}</li>
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="text-xs font-semibold text-ink">{value}</div>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  return (
    <div className="flex h-8 items-end gap-px" aria-hidden>
      {points.map((p, i) => (
        <span
          key={i}
          className="flex-1 rounded-sm bg-brand/60"
          style={{ height: `${Math.max(4, p * 100)}%` }}
        />
      ))}
    </div>
  );
}

function QuickBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-line px-1.5 py-1 text-[10px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand/40 border-t-brand" />
  );
}
