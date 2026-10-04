"use client";

// ---------------------------------------------------------------------------
// The orb — the one control that means "talk to Jarvis", and the chamber it
// opens into.
//
// The voice UI used to be a panel in a column on the right, which is the worst
// possible place for it: the thing you most want to be able to reach without
// looking was the thing furthest from where you were typing, and on a phone it
// was not there at all. So it leaves the layout entirely and becomes an object
// that floats over it.
//
// Two ideas carry the whole thing:
//
//   THE BUTTON IS THE INSTRUMENT. It is not an icon of a microphone — it is a
//   live core reading the same analyser as the Reactor, breathing while idle,
//   collapsing inward while it hears you, radiating outward while Jarvis
//   answers. You can tell across the room whose turn it is, because the colour
//   of the conversation is the colour of the orb: cyan in, brand out.
//
//   PRESSING IT IS TALKING. Tapping arms the capture immediately — no wake
//   word, because saying his name to a button you just pressed is theatre.
//   Press and hold is the same thing with a held floor: it will not endpoint
//   while your finger is down, which is what you want when you are thinking
//   mid-sentence.
//
// The chamber is the same instrument given the room it deserves, with the
// transcript under it and the two switches that were buried in the old panel.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { Reactor } from "./Reactor";
import { badgeOf, colourVar, flowOf, ignition, type ReactorMode } from "@/lib/new-jarvis/reactor";
import {
  BAND_COUNT,
  bandsFrom,
  idleEnvelope,
  loudness,
  smoothBands,
  speechEnvelope,
} from "@/lib/new-jarvis/spectrum";
import type { UseWakeVoice, VoiceState } from "@/lib/new-jarvis/useWakeVoice";

/** `#rrggbb` → `rgba(…)`, so one token can be drawn at any opacity. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(233,236,243,${alpha})`;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * The orb's own miniature of the Reactor.
 *
 * Deliberately NOT the Reactor component shrunk down: at 56px the rings, the
 * sweep, the motes and the telemetry all collapse into mush. This draws the
 * three things that still read at that size — rim, bars, core — from the same
 * analyser and the same state tokens, so the two instruments agree without
 * sharing a renderer.
 */
function OrbCanvas({ voice, reduced }: { voice: UseWakeVoice; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const live = useRef<VoiceState>(voice.state);
  live.current = voice.state;

  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;

    let raw = new Uint8Array(0);
    const target = new Float32Array(BAND_COUNT);
    const shown = new Float32Array(BAND_COUNT);
    let frame = 0;
    let colour = "#9aa3b5";
    let colourFor: VoiceState | null = null;

    const size = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const css = Math.max(32, Math.min(rect.width, rect.height) || 56);
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
        if (raw.length !== a.frequencyBinCount) raw = new Uint8Array(a.frequencyBinCount);
        a.getByteFrequencyData(raw);
        bandsFrom(raw, BAND_COUNT, target);
        // The browser-voice path exposes no stream to analyse, so a silent
        // analyser during an audible answer gets a synthetic envelope rather
        // than a flat line.
        if (state === "speaking" && loudness(target) < 0.01) speechEnvelope(now / 1000, target, BAND_COUNT);
      } else if (state === "speaking") {
        speechEnvelope(now / 1000, target, BAND_COUNT);
      } else if (state === "thinking" || state === "off") {
        target.fill(0);
      } else {
        idleEnvelope(now / 1000, target, BAND_COUNT);
      }
      smoothBands(shown, target);
    };

    const paint = (now: number) => {
      const state = live.current;
      if (colourFor !== state) {
        colourFor = state;
        colour = getComputedStyle(el).getPropertyValue(colourVar(state)).trim() || "#9aa3b5";
      }

      const css = size();
      sample(state, now);

      const cx = css / 2;
      const cy = css / 2;
      const R = css * 0.42;
      const t = now / 1000;
      const level = loudness(shown);
      const flow = flowOf(state);
      const flash = ignition(voice.wakeAt.current, now);
      const dim = state === "off" ? 0.5 : 1;

      ctx.clearRect(0, 0, css, css);
      ctx.lineCap = "round";

      // rim
      ctx.strokeStyle = withAlpha(colour, 0.22 * dim);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      // bars — inward while hearing, outward while answering, still otherwise
      const bars = 24;
      ctx.lineWidth = Math.max(1.2, css * 0.026);
      for (let i = 0; i < bars; i++) {
        const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
        const band = shown[Math.floor((i / bars) * BAND_COUNT)] ?? 0;
        const reach = band * css * 0.17;
        const from = flow === "in" ? R : R - 1;
        const to = flow === "in" ? R - reach : R + reach * 0.9;
        if (Math.abs(to - from) < 0.4) continue;
        ctx.strokeStyle = withAlpha(colour, (0.3 + band * 0.6) * dim);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * from, cy + Math.sin(angle) * from);
        ctx.lineTo(cx + Math.cos(angle) * to, cy + Math.sin(angle) * to);
        ctx.stroke();
      }

      // the core, which breathes even with nothing to listen to, so an idle
      // orb reads as dormant rather than broken
      const breath = state === "off" ? 0 : Math.sin(t * 1.5) * 0.06;
      const r = css * (0.13 + breath * 0.5 + level * 0.1) + flash * css * 0.07;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(r, 1) * 2.4);
      glow.addColorStop(0, withAlpha(colour, 0.95 * dim));
      glow.addColorStop(0.45, withAlpha(colour, 0.3 * dim));
      glow.addColorStop(1, withAlpha(colour, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(r, 1) * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = withAlpha(colour, 0.92 * dim);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(r, 1), 0, Math.PI * 2);
      ctx.fill();

      if (!reduced) frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);
    const onResize = () => size();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
    // `live` carries the state into the loop, so the loop is built once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return <canvas ref={ref} className="nj-orb__canvas" aria-hidden />;
}

interface Props {
  voice: UseWakeVoice;
  mode: ReactorMode;
  onMode: (m: ReactorMode) => void;
  speakReplies: boolean;
  onSpeakReplies: (v: boolean) => void;
}

export function VoiceOrb({ voice, mode, onMode, speakReplies, onSpeakReplies }: Props) {
  const [open, setOpen] = useState(false);
  const [reduced, setReduced] = useState(false);
  const held = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);

  // Escape closes the chamber. Registered only while it is open, so it never
  // swallows an Escape meant for the command line.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * A press that becomes a hold.
   *
   * A tap arms the capture and lets endpointing decide when you are done. A
   * hold longer than 300ms opens the chamber instead, because holding is how
   * you ask to SEE it — and the orb has nowhere else to put a second action.
   */
  const onDown = useCallback(() => {
    held.current = false;
    holdTimer.current = setTimeout(() => {
      held.current = true;
      setOpen(true);
    }, 300);
  }, []);

  const onUp = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (held.current) return;
    void voice.talk();
  }, [voice]);

  const badge = badgeOf(voice.state);
  const flowing = voice.state === "hearing" || voice.state === "speaking";

  return (
    <>
      {/* --- the floating orb -------------------------------------------- */}
      <div className="nj-orb-dock">
        <button
          type="button"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={() => {
            if (holdTimer.current) clearTimeout(holdTimer.current);
            holdTimer.current = null;
          }}
          onKeyDown={(e) => {
            // Keyboard has no "hold", so the two actions split: Enter/Space
            // talks, and the chevron beside it opens the chamber.
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void voice.talk();
            }
          }}
          aria-label={
            voice.state === "hearing"
              ? "Listening — speak now"
              : voice.state === "speaking"
                ? "Jarvis is speaking — press to interrupt and talk"
                : "Talk to Jarvis"
          }
          title="Talk to Jarvis · hold to open the chamber"
          className="nj-orb"
          data-state={voice.state}
        >
          <OrbCanvas voice={voice} reduced={reduced} />
        </button>

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the voice chamber"
          className="nj-orb__more"
        >
          <Icon.Chevron width={11} height={11} className="-rotate-90" aria-hidden />
        </button>

        {/* What it is hearing, beside the orb, so a spoken command is visible
            without opening anything. Hidden when there is nothing to show, so
            it never sits there as an empty bubble.

            It carries the FAILURE too. Pressing the orb where the browser has
            no speech recognition, or where the microphone is refused, used to
            do nothing at all: the hook set an error that only the chamber
            could show, so the one control the owner had just pressed sat there
            looking broken. A button that cannot do its job has to say so where
            it was pressed. */}
        {(voice.error || voice.heard || flowing) && (
          <p className={`nj-orb__heard ${voice.error ? "is-err" : ""}`} aria-live="polite">
            {voice.error || voice.heard || badge.toLowerCase()}
          </p>
        )}
      </div>

      {/* --- the chamber -------------------------------------------------- */}
      {open && (
        <div
          className="nj-chamber"
          role="dialog"
          aria-modal="true"
          aria-label="Voice"
          data-state={voice.state}
        >
          {/* The backdrop is its own button so a click outside closes without
              putting a click handler on the dialog and stopping propagation
              inside it, which is how a dialog ends up eating its own buttons. */}
          <button
            type="button"
            className="nj-chamber__scrim"
            aria-label="Close"
            onClick={() => setOpen(false)}
          />

          <div className="nj-chamber__stage">
            {/* The head is the dialog's title, not a second readout. The
                Reactor already announces the state in a live region directly
                under the ring, which is where the eye is — printing the same
                word twice on one panel just makes it look like two facts. */}
            <div className="nj-chamber__head">
              <span className="nj-dot" data-live={flowing ? "true" : undefined} aria-hidden />
              <span className="nj-chamber__badge">Voice</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="nj-chamber__close"
                aria-label="Close"
              >
                <Icon.Close width={13} height={13} aria-hidden />
              </button>
            </div>

            {/* The Reactor whole, at the size it was designed for. */}
            <Reactor voice={voice} mode={mode} onMode={onMode} />

            <div className="nj-chamber__controls">
              <button
                type="button"
                onClick={() => void voice.talk()}
                disabled={!voice.supported}
                className="nj-chamber__talk"
                autoFocus
              >
                <Icon.Mic width={14} height={14} aria-hidden />
                {voice.state === "hearing" ? "Listening…" : voice.state === "speaking" ? "Interrupt" : "Talk"}
              </button>

              <button
                type="button"
                onClick={voice.toggle}
                disabled={!voice.supported}
                className="nj-chamber__btn"
                aria-pressed={voice.listening}
              >
                {voice.listening ? "Stop waiting for the name" : "Wait for the name"}
              </button>

              <button
                type="button"
                role="checkbox"
                aria-checked={speakReplies}
                onClick={() => onSpeakReplies(!speakReplies)}
                className="nj-chamber__btn"
              >
                <span className={`nj-box ${speakReplies ? "is-on" : ""}`} aria-hidden>
                  <Icon.Check width={9} height={9} />
                </span>
                Speak answers aloud
              </button>
            </div>

            {!voice.supported && (
              <p className="nj-chamber__note">
                This browser cannot listen. Chrome, Edge and Safari can — everything else here still works.
              </p>
            )}
            {voice.error && <p className="nj-chamber__err">{voice.error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
