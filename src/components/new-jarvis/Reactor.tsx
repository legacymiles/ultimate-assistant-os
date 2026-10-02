"use client";

// ---------------------------------------------------------------------------
// The Reactor.
//
// A voice visualiser that only gets louder tells you something is making a
// noise, which you can already hear. This one encodes the DIRECTION of the
// conversation — the spectrum collapses inward while it is listening to you and
// radiates outward while it is talking back, and while it is thinking there is
// no spectrum at all, because there is no sound and silence should look like
// silence. All of that lives in reactor.ts, tested; this file only draws it.
//
// Canvas 2D rather than WebGL, on purpose. This is a HUD: hairlines and small
// type are crisper in 2D, it composites over anything, it costs almost nothing
// next to a three.js context, and it has no context-loss failure mode — which
// matters, because losing one on this surface would take the voice UI down.
//
// It reads the analyser from a REF on its own frame loop. The hook used to push
// a level into React state sixty times a second, re-rendering every component
// that read it on every frame; nothing here causes a React render at all.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activity,
  badgeOf,
  colourVar,
  coreRadius,
  flowOf,
  formatFps,
  formatMs,
  Fps,
  idleFactor,
  ignition,
  motePosition,
  motes,
  REACTOR_MODES,
  REST_RADIUS,
  ribbon,
  ringSpecs,
  sweepAngle,
  type ReactorMode,
} from "@/lib/new-jarvis/reactor";
import {
  BAND_COUNT,
  bandsFrom,
  idleEnvelope,
  loudness,
  smoothBands,
  speechEnvelope,
} from "@/lib/new-jarvis/spectrum";
import type { UseWakeVoice, VoiceState } from "@/lib/new-jarvis/useWakeVoice";

interface Props {
  voice: UseWakeVoice;
  mode: ReactorMode;
  onMode: (m: ReactorMode) => void;
}

/** `#rrggbb` → `rgba(r,g,b,a)`, so one token can be drawn at any opacity. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(233,236,243,${alpha})`;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function Reactor({ voice, mode, onMode }: Props) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [reduced, setReduced] = useState(false);
  const [fpsText, setFpsText] = useState("—");

  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);

  const field = useMemo(() => motes(56), []);

  // Everything the frame loop needs that changes between renders, held in a ref
  // so the loop never has to be torn down and rebuilt when the state changes.
  const live = useRef({ state: "off" as VoiceState, mode, reduced });
  live.current = { state: voice.state, mode, reduced };

  const draw = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      size: number,
      bands: Float32Array,
      state: VoiceState,
      now: number,
      colour: string,
      which: ReactorMode,
    ) => {
      const t = now / 1000;
      const cx = size / 2;
      const cy = size / 2;
      const R = size * 0.46;
      const level = loudness(bands);
      const flow = flowOf(state);
      const idle = idleFactor(state, now - (voice.lastSoundAt.current || now));
      const flash = ignition(voice.wakeAt.current, now);
      // Dormant, not absent. At 0.3 the rim landed at 4% alpha against the
      // panel and the whole instrument read as a rendering failure; the point
      // of the off state is that you can see it is there and switched off.
      const dim = state === "off" ? 0.62 : 0.72 + idle * 0.28;

      ctx.clearRect(0, 0, size, size);
      ctx.lineCap = "round";

      // --- the rim: a fixed reference the spectrum is read against ---------
      ctx.strokeStyle = withAlpha(colour, 0.14 * dim);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      // Tick marks. Rotating, constant velocity — the machine half of the
      // object, against the springy human half that is the spectrum.
      const sweep = sweepAngle(state, t, idle);
      ctx.strokeStyle = withAlpha(colour, 0.22 * dim);
      for (let i = 0; i < 48; i += 1) {
        const a = sweep + (i / 48) * Math.PI * 2;
        const long = i % 4 === 0;
        const r0 = R * (long ? 0.94 : 0.965);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.stroke();
      }

      // The sweep hand, fading behind itself like a radar trace.
      const trail = 0.85;
      for (let i = 0; i < 14; i += 1) {
        const a = sweep - i * 0.035;
        ctx.strokeStyle = withAlpha(colour, (0.3 - i * 0.021) * dim);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62);
        ctx.lineTo(cx + Math.cos(a) * R * trail, cy + Math.sin(a) * R * trail);
        ctx.stroke();
      }

      if (which === "ring") {
        const specs = ringSpecs(bands, flow);
        ctx.lineWidth = Math.max(1.5, (size / specs.length) * 0.5);
        for (const bar of specs) {
          const a = bar.angle;
          const alpha = (0.2 + bar.strength * 0.8) * dim;
          ctx.strokeStyle = withAlpha(colour, alpha);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * R * bar.from, cy + Math.sin(a) * R * bar.from);
          ctx.lineTo(cx + Math.cos(a) * R * bar.to, cy + Math.sin(a) * R * bar.to);
          ctx.stroke();
        }
        // The rest circle, so the direction of travel is readable even at a
        // glance: bars clearly inside it, or clearly outside it.
        ctx.strokeStyle = withAlpha(colour, 0.1 * dim);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, R * REST_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
      } else if (which === "wave") {
        const ys = ribbon(bands);
        const w = R * 1.55;
        const left = cx - w / 2;
        const step = w / Math.max(1, ys.length - 1);
        const sign = flow === "in" ? -1 : 1;
        for (const dir of [1, -1]) {
          ctx.beginPath();
          for (let i = 0; i < ys.length; i += 1) {
            const x = left + i * step;
            const y = cy - dir * sign * ys[i] * R * 0.78;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = withAlpha(colour, (0.45 + level * 0.5) * dim);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        ctx.strokeStyle = withAlpha(colour, 0.12 * dim);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, cy);
        ctx.lineTo(left + w, cy);
        ctx.stroke();
      } else {
        for (const m of field) {
          const p = motePosition(m, bands, flow, t);
          const r = 0.8 + p.strength * 2.2;
          ctx.fillStyle = withAlpha(colour, (0.18 + p.strength * 0.7) * dim);
          ctx.beginPath();
          ctx.arc(cx + p.x * R, cy + p.y * R, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // --- the core ---------------------------------------------------------
      const core = coreRadius(state, level, t) * R * (1 + flash * 0.5);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, core * 2.4));
      glow.addColorStop(0, withAlpha(colour, (0.55 + level * 0.4 + flash * 0.4) * dim));
      glow.addColorStop(0.45, withAlpha(colour, 0.14 * dim));
      glow.addColorStop(1, withAlpha(colour, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, core * 2.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = withAlpha(colour, (0.85 + flash * 0.15) * dim);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, core * 0.42), 0, Math.PI * 2);
      ctx.fill();

      // The ignition ring — the moment it hears its name, which until now had
      // no feedback at all.
      if (flash > 0) {
        ctx.strokeStyle = withAlpha(colour, flash * 0.8);
        ctx.lineWidth = 1 + flash * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (0.3 + (1 - flash) * 0.72), 0, Math.PI * 2);
        ctx.stroke();
      }
    },
    [field, voice.lastSoundAt, voice.wakeAt],
  );

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    let raw = new Uint8Array(0);
    const target = new Float32Array(BAND_COUNT);
    const shown = new Float32Array(BAND_COUNT);
    const fps = new Fps();
    let frame = 0;
    let lastFpsPost = 0;
    let colour = "#9aa3b5";
    let colourFor: VoiceState | null = null;

    const size = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const css = Math.max(80, Math.min(rect.width, rect.height) || 200);
      if (el.width !== Math.round(css * dpr)) {
        el.width = Math.round(css * dpr);
        el.height = Math.round(css * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return css;
    };

    const sample = (state: VoiceState, now: number) => {
      const a = voice.analyser.current;
      if (a && state !== "off" && state !== "thinking") {
        // Sized to the analyser rather than sliced out of a fixed buffer: a
        // subarray is a different typed-array shape, and re-allocating only
        // when the bin count changes is once per analyser, not once per frame.
        if (raw.length !== a.frequencyBinCount) raw = new Uint8Array(a.frequencyBinCount);
        a.getByteFrequencyData(raw);
        bandsFrom(raw, BAND_COUNT, target);
        // A live analyser that is reporting nothing while Jarvis is audibly
        // talking means the browser-voice path, which exposes no stream.
        if (state === "speaking" && loudness(target) < 0.01) speechEnvelope(now / 1000, target, BAND_COUNT);
      } else if (state === "speaking") {
        speechEnvelope(now / 1000, target, BAND_COUNT);
      } else if (state === "thinking" || state === "off") {
        target.fill(0);
      } else {
        idleEnvelope(now / 1000, target, BAND_COUNT);
      }
      // Fast attack, slow decay — the thing that makes a meter read as alive.
      smoothBands(shown, target);
    };

    const paint = (now: number) => {
      const { state, mode: which, reduced: still } = live.current;

      if (colourFor !== state) {
        colourFor = state;
        const value = getComputedStyle(el).getPropertyValue(colourVar(state)).trim();
        colour = value || "#9aa3b5";
      }

      const css = size();
      sample(state, now);
      draw(ctx, css, shown, state, now, colour, which);

      fps.tick(now);
      if (now - lastFpsPost > 500) {
        lastFpsPost = now;
        setFpsText(formatFps(fps.value));
      }

      if (!still) frame = requestAnimationFrame(paint);
    };

    if (reduced) {
      // One representative frame and no loop. The honest reduced-motion answer
      // is a legible still, not a slower animation.
      shown.fill(0.35);
      const css = size();
      const value = getComputedStyle(el).getPropertyValue(colourVar(voice.state)).trim();
      draw(ctx, css, shown, voice.state, performance.now(), value || "#9aa3b5", mode);
      setFpsText("—");
    } else {
      frame = requestAnimationFrame(paint);
    }

    const onResize = () => size();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
    // `live` carries state/mode into the loop, so this is set up once per
    // mount rather than torn down and rebuilt on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, reduced]);

  const badge = badgeOf(voice.state);

  return (
    <div className="nj-reactor">
      <div className="nj-reactor__stage">
        <canvas ref={canvas} className="nj-reactor__canvas" aria-hidden />
        {!voice.supported && (
          <p className="nj-reactor__unsupported">
            This browser cannot listen. Chrome, Edge or Safari can.
          </p>
        )}
      </div>

      <div className="nj-reactor__badge">
        <span className="nj-dot" data-live={voice.state === "hearing" || voice.state === "speaking" ? "true" : undefined} aria-hidden />
        <span aria-live="polite">{badge}</span>
      </div>

      {/* Telemetry. Tabular figures so the numbers do not jitter sideways as
          they change — the one thing that makes a live readout unreadable. */}
      <dl className="nj-reactor__tele">
        <div>
          <dt>Round trip</dt>
          <dd data-num>{formatMs(voice.latencyMs)}</dd>
        </div>
        <div>
          <dt>Frame</dt>
          <dd data-num>{fpsText}</dd>
        </div>
      </dl>

      {/* What it is hearing, live. Reserved height, so the panel does not jump
          every time a word arrives. */}
      <p className="nj-reactor__heard" aria-live="polite">
        {voice.heard || (voice.state === "waiting" ? <span className="nj-reactor__hint">Say “Jarvis”</span> : "")}
      </p>

      <div className="nj-reactor__modes" role="group" aria-label="Reactor display">
        {REACTOR_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onMode(m.id)}
            aria-pressed={mode === m.id}
            className={mode === m.id ? "is-on" : ""}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
