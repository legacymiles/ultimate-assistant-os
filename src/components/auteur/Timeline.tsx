"use client";

// The cut: every shot's active take laid end to end under an audio track,
// with a playhead that walks through them. Real clips play; animatics hold
// for their duration so the rhythm of the edit can be judged before a single
// frame is rendered.

import { useEffect, useMemo, useRef, useState } from "react";
import { hueFor } from "@/lib/auteur/constants";
import { activeTake, allShots } from "@/lib/auteur/repo";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { useStudio } from "./studio";
import { Btn, EmptyState, Mono, TakeFrame, fmtSec, useMediaUrl } from "./ui";

export function Timeline() {
  const studio = useStudio();
  const p = studio.project!;
  const shots = useMemo(() => allShots(p), [p]);
  const total = shots.reduce((s, x) => s + x.shot.durationSec, 0);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [pxPerSec, setPxPerSec] = useState(28);
  const audioUrl = useMediaUrl(p.audio?.mediaId);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const startRef = useRef(0);
  const audioInput = useRef<HTMLInputElement>(null);

  // Which shot the playhead is in, and how far into it.
  const at = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < shots.length; i++) {
      const d = shots[i].shot.durationSec;
      if (t < acc + d || i === shots.length - 1) return { i, offset: Math.max(0, t - acc), start: acc };
      acc += d;
    }
    return { i: 0, offset: 0, start: 0 };
  }, [shots, t]);
  const currentShot = shots[at.i]?.shot ?? null;
  const currentTake = currentShot ? activeTake(currentShot) : null;

  // Timestamp-based clock so the rate is right even under StrictMode.
  useEffect(() => {
    if (!playing) return;
    startRef.current = performance.now() - t * 1000;
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - startRef.current) / 1000;
      if (elapsed >= total) {
        setT(total);
        setPlaying(false);
        audioRef.current?.pause();
      } else {
        setT(Math.round(elapsed * 20) / 20);
      }
    }, 50);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total]);

  // Keep the current clip in step with the playhead when the shot changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      if (Math.abs(v.currentTime - at.offset) > 0.4) v.currentTime = at.offset;
      void v.play().catch(() => {});
    } else {
      v.pause();
      v.currentTime = at.offset;
    }
    // Only re-sync on shot change or play toggle, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.i, playing, currentTake?.mediaId]);

  const toggle = () => {
    if (playing) {
      setPlaying(false);
      audioRef.current?.pause();
      return;
    }
    if (t >= total) setT(0);
    setPlaying(true);
    const a = audioRef.current;
    if (a && audioUrl) {
      a.currentTime = t >= total ? 0 : t;
      void a.play().catch(() => {});
    }
  };

  const seek = (sec: number) => {
    const s = Math.max(0, Math.min(total, sec));
    setT(s);
    startRef.current = performance.now() - s * 1000;
    if (audioRef.current) audioRef.current.currentTime = s;
  };

  if (!shots.length) {
    return (
      <div className="p-6">
        <EmptyState title="Nothing to cut yet" body="Board the shots first. The timeline plays every shot's active take in order, animatics included, so you can feel the pacing before rendering." />
      </div>
    );
  }

  const width = Math.max(600, total * pxPerSec + 40);

  return (
    <div className="flex h-full flex-col">
      {/* program monitor */}
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-[860px]">
          <TakeFrame
            key={currentShot?.id}
            take={currentTake}
            aspect={p.aspectRatio}
            hue={hueFor(p)}
            caption={currentShot && !currentTake?.mediaId ? currentShot.description : undefined}
            muted={Boolean(audioUrl)}
            videoRef={videoRef}
            className="shadow-[0_30px_80px_rgba(0,0,0,.6)]"
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--au-ink-3)]">
            <span>
              <span className="au-mono !text-[var(--au-gold-2)]">SH {String(at.i + 1).padStart(2, "0")}</span> · {currentShot?.title}
            </span>
            <span className="font-[family-name:var(--au-mono)]">{fmtSec(t)} / {fmtSec(total)}</span>
          </div>
        </div>
      </div>

      {/* transport */}
      <div className="flex items-center gap-2 border-t border-[var(--au-line)] bg-[var(--au-stage)]/80 px-3 py-2">
        <Btn size="icon" onClick={() => seek(at.start - 0.01 < 0 ? 0 : t - at.offset > 0.3 ? at.start : (shots[at.i - 1] ? at.start - shots[at.i - 1].shot.durationSec : 0))} title="Previous shot">
          <Icon.ArrowLeft width={13} height={13} />
        </Btn>
        <Btn variant="primary" size="icon" onClick={toggle} title={playing ? "Pause" : "Play"} className="!px-3">
          {playing ? <Icon.Square width={13} height={13} /> : <Icon.Launch width={13} height={13} />}
        </Btn>
        <Btn size="icon" onClick={() => seek(at.start + (currentShot?.durationSec ?? 0))} title="Next shot">
          <Icon.ArrowRight width={13} height={13} />
        </Btn>
        <div className="mx-2 h-5 w-px bg-[var(--au-line)]" />
        <Mono>Zoom</Mono>
        <input type="range" className="au-range !w-28" min={8} max={120} value={pxPerSec} onChange={(e) => setPxPerSec(Number(e.target.value))} />
        <span className="flex-1" />
        {p.audio ? (
          <span className="flex items-center gap-2 text-[11px] text-[var(--au-ink-2)]">
            <Icon.Mic width={12} height={12} className="text-[var(--au-gold)]" />
            <span className="max-w-[180px] truncate">{p.audio.name}</span>
            {p.audio.durationSec && <span className="au-mono">{fmtSec(p.audio.durationSec)}</span>}
            <button type="button" className="text-[var(--au-ink-3)] hover:text-[#ff8a78]" onClick={() => void studio.setAudio(null)} aria-label="Remove audio">
              <Icon.Close width={11} height={11} />
            </button>
          </span>
        ) : (
          <Btn size="sm" onClick={() => audioInput.current?.click()}>
            <Icon.Mic width={12} height={12} /> Add music
          </Btn>
        )}
        <input ref={audioInput} type="file" accept="audio/*" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void studio.setAudio(f);
          e.target.value = "";
        }} />
        {audioUrl && <audio ref={audioRef} src={audioUrl} />}
      </div>

      {/* tracks */}
      <div className="h-[178px] flex-none overflow-x-auto overflow-y-hidden border-t border-[var(--au-line)] bg-[var(--au-stage)]">
        <div className="relative" style={{ width }}>
          {/* ruler */}
          <div className="relative h-5 border-b border-[var(--au-line)]" onClick={(e) => seek((e.nativeEvent.offsetX - 20) / pxPerSec)}>
            {Array.from({ length: Math.floor(total) + 1 }, (_, s) => (
              <div key={s} className="absolute top-0 h-full" style={{ left: 20 + s * pxPerSec }}>
                <div className={cn("w-px bg-[var(--au-line-strong)]", s % 5 === 0 ? "h-full" : "h-1.5")} />
                {s % 5 === 0 && <div className="absolute left-1 top-0.5 font-[family-name:var(--au-mono)] text-[9px] text-[var(--au-ink-3)]">{fmtSec(s)}</div>}
              </div>
            ))}
          </div>
          {/* audio track */}
          <div className="relative h-9 border-b border-[var(--au-line)]">
            <div className="absolute left-2 top-1 au-mono">Audio</div>
            {p.audio && (
              <div
                className="absolute top-1.5 h-6 rounded-md border border-[rgba(232,185,92,.5)] bg-[repeating-linear-gradient(90deg,rgba(232,185,92,.22)_0_2px,rgba(232,185,92,.06)_2px_5px)]"
                style={{ left: 20, width: Math.max(8, (p.audio.durationSec ?? total) * pxPerSec) }}
              />
            )}
          </div>
          {/* video track */}
          <div className="relative h-[120px] pt-2">
            <div className="absolute left-2 top-1 au-mono">Video</div>
            {shots.map(({ shot, index }, i) => {
              const start = shots.slice(0, i).reduce((s, x) => s + x.shot.durationSec, 0);
              const take = activeTake(shot);
              const on = studio.selectedShotId === shot.id;
              return (
                <button
                  key={shot.id}
                  type="button"
                  onClick={() => {
                    studio.selectShot(shot.id);
                    seek(start);
                  }}
                  onDoubleClick={() => studio.setTab("storyboard")}
                  className={cn("absolute top-6 h-[84px] overflow-hidden rounded-lg border text-left transition", on ? "border-[var(--au-gold)]" : "border-[var(--au-line-strong)] hover:border-[var(--au-ink-3)]")}
                  style={{ left: 20 + start * pxPerSec, width: Math.max(24, shot.durationSec * pxPerSec - 2) }}
                >
                  <div className="absolute inset-0">
                    <TakeFrame take={take} aspect={p.aspectRatio} hue={hueFor(p)} className="!h-full !w-full !rounded-none !border-0" />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/85 to-transparent px-1.5 py-1">
                    <span className="au-dot" data-s={take?.status ?? "idle"} style={{ animation: "none" }} />
                    <span className="truncate text-[10px] text-white/85">{String(index + 1).padStart(2, "0")} {shot.title}</span>
                  </div>
                </button>
              );
            })}
          </div>
          {/* playhead */}
          <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--au-gold)]" style={{ left: 20 + t * pxPerSec }}>
            <div className="-ml-[5px] h-0 w-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-[var(--au-gold)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
