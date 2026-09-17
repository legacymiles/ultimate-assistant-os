"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { RadioFeed, RadioKind, RadioStation } from "@/lib/gods-eye/radio";
import styles from "./gods-eye.module.css";

// ---------------------------------------------------------------------------
// The radio scanner deck: NOAA Weather Radio, scanner/ATC feeds and local
// broadcast stations around the view centre, with a live level meter.
//
// Two <audio> elements: streams whose host sends CORS headers go through a Web
// Audio analyser (a real meter); the rest play on a plain element, because an
// analysed element outputs silence for cross-origin audio without CORS.
// ---------------------------------------------------------------------------

export interface RadioHandle {
  play(kind?: RadioKind): Promise<void>;
  step(dir: 1 | -1): void;
  pause(): void;
  resume(): void;
  stop(): void;
  nowPlaying(): string | null;
}

type Filter = "all" | RadioKind;

const KIND_LABEL: Record<RadioKind, string> = { weather: "WEATHER", scanner: "SCANNER", local: "LOCAL" };

interface Props {
  open: boolean;
  onClose(): void;
  center(): { lat: number; lon: number } | null;
  onNowPlaying(label: string | null): void;
  onFlyTo(lon: number, lat: number): void;
  flash(text: string): void;
}

export const RadioDeck = forwardRef<RadioHandle, Props>(function RadioDeck({ open, onClose, center, onNowPlaying, onFlyTo, flash }, ref) {
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [current, setCurrent] = useState<RadioStation | null>(null);
  const [state, setState] = useState<"idle" | "tuning" | "playing" | "paused" | "error">("idle");
  const [volume, setVolume] = useState(80);
  const [metered, setMetered] = useState(false);

  const plainRef = useRef<HTMLAudioElement>(null);
  const corsRef = useRef<HTMLAudioElement>(null);
  const meterRef = useRef<HTMLCanvasElement>(null);
  const audioCtx = useRef<{ ctx: AudioContext; analyser: AnalyserNode } | null>(null);
  const stationsRef = useRef<RadioStation[]>([]);
  stationsRef.current = stations;
  const currentRef = useRef<RadioStation | null>(null);
  currentRef.current = current;
  const scannedAt = useRef<{ lat: number; lon: number } | null>(null);

  const element = (s: RadioStation | null) => (s?.cors ? corsRef.current : plainRef.current);

  const scan = useCallback(async (): Promise<RadioStation[]> => {
    const c = center();
    if (!c) return stationsRef.current;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(`/api/gods-eye/radio?lat=${c.lat.toFixed(3)}&lon=${c.lon.toFixed(3)}`);
      const body = (await res.json()) as RadioFeed & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setStations(body.stations);
      scannedAt.current = c;
      return body.stations;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      return stationsRef.current;
    } finally {
      setScanning(false);
    }
  }, [center]);

  // First open scans around the view.
  useEffect(() => {
    if (open && !scannedAt.current && !scanning) void scan();
  }, [open, scan, scanning]);

  const stopAll = useCallback(() => {
    for (const el of [plainRef.current, corsRef.current]) {
      if (!el) continue;
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
  }, []);

  const tune = useCallback(
    async (s: RadioStation) => {
      stopAll();
      setCurrent(s);
      setState("tuning");
      setMetered(!!s.cors);
      const el = element(s);
      if (!el) return;
      if (s.cors) {
        // Build the analyser on first use (needs a user gesture, which tuning always follows).
        if (!audioCtx.current) {
          try {
            const ctx = new AudioContext();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 128;
            ctx.createMediaElementSource(el).connect(analyser);
            analyser.connect(ctx.destination);
            audioCtx.current = { ctx, analyser };
          } catch {
            setMetered(false);
          }
        }
        void audioCtx.current?.ctx.resume();
      }
      el.volume = volume / 100;
      el.src = s.url;
      try {
        await el.play();
        setState("playing");
        onNowPlaying(`${s.name}${s.freq ? ` ${s.freq}` : ""}`);
      } catch {
        setState("error");
        onNowPlaying(null);
        flash(`NO SIGNAL · ${s.name.toUpperCase()}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flash, onNowPlaying, stopAll, volume],
  );

  const visible = useCallback(
    (list: RadioStation[], f: Filter) => list.filter((s) => f === "all" || s.kind === f).sort((a, b) => a.distanceKm - b.distanceKm),
    [],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      const list = visible(stationsRef.current, filter);
      if (!list.length) return;
      const i = list.findIndex((s) => s.id === currentRef.current?.id);
      void tune(list[i < 0 ? 0 : (i + dir + list.length) % list.length]);
    },
    [filter, tune, visible],
  );

  const stop = useCallback(() => {
    stopAll();
    setState("idle");
    setCurrent(null);
    onNowPlaying(null);
  }, [onNowPlaying, stopAll]);

  useImperativeHandle(
    ref,
    () => ({
      async play(kind) {
        const f: Filter = kind ?? "all";
        setFilter(f);
        const c = center();
        const moved =
          !scannedAt.current || !c || Math.abs(c.lat - scannedAt.current.lat) > 1 || Math.abs(c.lon - scannedAt.current.lon) > 1;
        const list = visible(moved ? await scan() : stationsRef.current, f);
        if (!list.length) {
          flash(kind ? `NO ${KIND_LABEL[kind]} STATIONS NEAR HERE` : "NO STATIONS NEAR HERE");
          return;
        }
        await tune(list[0]);
      },
      step,
      pause() {
        element(currentRef.current)?.pause();
        if (currentRef.current) setState("paused");
      },
      resume() {
        const el = element(currentRef.current);
        if (el && currentRef.current) void el.play().then(() => setState("playing"));
      },
      stop,
      nowPlaying() {
        const s = currentRef.current;
        return s ? `${s.name}${s.freq ? ` ${s.freq}` : ""} (${state})` : null;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [center, flash, scan, state, step, stop, tune, visible],
  );

  useEffect(() => {
    for (const el of [plainRef.current, corsRef.current]) if (el) el.volume = volume / 100;
  }, [volume]);

  // Level meter: real bars from the analyser, or a flat line when the stream can't be read.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = meterRef.current;
      const g = canvas?.getContext("2d");
      if (!canvas || !g) return;
      const w = (canvas.width = canvas.clientWidth * 2);
      const h = (canvas.height = canvas.clientHeight * 2);
      g.clearRect(0, 0, w, h);
      const a = audioCtx.current?.analyser;
      const bars = 32;
      const data = new Uint8Array(a?.frequencyBinCount ?? bars);
      if (a && metered && state === "playing") a.getByteFrequencyData(data);
      for (let i = 0; i < bars; i++) {
        const v = data[Math.floor((i / bars) * data.length)] / 255;
        const bh = Math.max(2, v * h);
        g.fillStyle = v > 0.8 ? "#ff3b3b" : v > 0.55 ? "#ffb020" : "#39ff88";
        g.fillRect((i * w) / bars + 1, h - bh, w / bars - 3, bh);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [open, metered, state]);

  const list = visible(stations, filter);

  return (
    <>
      <audio ref={plainRef} preload="none" onEnded={() => setState("idle")} onError={() => current && !current.cors && setState("error")} />
      <audio ref={corsRef} preload="none" crossOrigin="anonymous" onError={() => current?.cors && setState("error")} />
      {open && (
        <div className={`${styles.pop} ${styles.radio}`}>
          <div className={styles.cardHead}>
            RADIO · SCANNER
            <button className={styles.close} onClick={onClose} aria-label="Close radio">
              ×
            </button>
          </div>

          <div className={styles.radioNow} data-state={state}>
            <div className={styles.radioFreq}>{current?.freq ?? (current ? "STREAM" : "---.---")}</div>
            <div className={styles.radioName}>{current ? current.name : "NO STATION"}</div>
            <div className={styles.dim}>
              {current
                ? `${KIND_LABEL[current.kind]} · ${current.place} · ${Math.round(current.distanceKm)} KM${current.bitrate ? ` · ${current.bitrate} KBPS` : ""}`
                : "Pick a station below, or say “play weather radio”."}
            </div>
            <canvas ref={meterRef} className={styles.radioMeter} aria-hidden />
            <div className={styles.radioStatus}>
              {state === "tuning" ? "TUNING…" : state === "playing" ? (metered ? "● ON AIR · LEVEL" : "● ON AIR · METER N/A") : state === "paused" ? "PAUSED" : state === "error" ? "NO SIGNAL" : "STANDBY"}
            </div>
          </div>

          <label className={styles.slider}>
            <span>VOLUME</span>
            <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
            <b>{volume}</b>
          </label>
          <div className={styles.row}>
            <button className={styles.btn} onClick={() => step(-1)} disabled={!list.length}>
              ‹ PREV
            </button>
            {state === "paused" ? (
              <button
                className={styles.btn}
                onClick={() => {
                  const el = element(current);
                  if (el) void el.play().then(() => setState("playing"));
                }}
              >
                ▶ RESUME
              </button>
            ) : (
              <button
                className={styles.btn}
                disabled={state !== "playing"}
                onClick={() => {
                  element(current)?.pause();
                  setState("paused");
                }}
              >
                ❚❚ PAUSE
              </button>
            )}
            <button className={styles.btn} onClick={() => step(1)} disabled={!list.length}>
              NEXT ›
            </button>
            <button className={`${styles.btn} ${styles.btnHot}`} onClick={stop} disabled={!current}>
              ■ STOP
            </button>
          </div>

          <div className={styles.seg}>
            {(["all", "weather", "scanner", "local"] as Filter[]).map((f) => (
              <button key={f} data-on={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "ALL" : KIND_LABEL[f]} {f === "all" ? stations.length : stations.filter((s) => s.kind === f).length}
              </button>
            ))}
          </div>
          <ul className={styles.contactList}>
            {list.map((s) => (
              <li key={s.id}>
                <button data-on={current?.id === s.id} onClick={() => void tune(s)}>
                  <b>
                    {s.freq ? `${s.freq} · ` : ""}
                    {s.name}
                  </b>
                  <span>
                    {KIND_LABEL[s.kind]} · {s.place}
                  </span>
                  <em
                    title="Fly to transmitter"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFlyTo(s.lon, s.lat);
                    }}
                  >
                    {Math.round(s.distanceKm)} KM ⌖
                  </em>
                </button>
              </li>
            ))}
            {!list.length && <li className={styles.hint}>{scanning ? "Scanning…" : error ?? "Nothing in this band near here."}</li>}
          </ul>
          <div className={styles.row}>
            <button className={styles.btn} onClick={() => void scan()} disabled={scanning}>
              {scanning ? "SCANNING…" : "⟳ SCAN HERE"}
            </button>
            <span className={styles.dim}>WXRadio.org · NWS · Radio Browser</span>
          </div>
        </div>
      )}
    </>
  );
});
