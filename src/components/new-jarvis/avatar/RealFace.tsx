"use client";

// ---------------------------------------------------------------------------
// The real-looking agent: the second face Jarvis can wear, beside the
// Three.js avatar (owner, 2026-11-24: "so users can switch between the
// three.js voice agent and this real looking voice agent"; the picked mockup
// put a 3D | Real switch under the face).
//
// Two levels, best first:
//   1. LIP-SYNCED — LiveTalking runs on this PC and lip sync is on for this
//      device: Alex's face as a live video whose mouth says every answer
//      (liveFace.ts; Jarvis's voice is routed there by voiceSink.ts). This is
//      the same engine the TikTok Live agent uses, so talking to it proves
//      the live pipeline works.
//   2. PORTRAIT — anywhere else: the still, breathing and swaying, lit by
//      Jarvis's voice. Never a blank face.
//
// The light reads LiveTalking's own audio while lip-synced, otherwise the
// same analyser the 3D head reads. Every frame writes two CSS variables —
// opacity and transform only, never layout.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useSyncExternalStore } from "react";
import { liveFace } from "@/lib/new-jarvis/avatar/liveFace";
import type { AvatarVariant, AvatarVoice } from "./AvatarScene";

/** The real face. Shared with AI Live Studio's host. */
export const REAL_FACE_SRC = "/ai-live-studio/alex.jpg";

const OFF = { state: "off" as const, stream: null, enabled: false, asr: false };

export function useLiveFace() {
  return useSyncExternalStore(liveFace.subscribe, liveFace.get, () => OFF);
}

export function RealFace({ voice, variant, reduced }: { voice: AvatarVoice | null; variant: AvatarVariant; reduced: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const lf = useLiveFace();
  const live = lf.state === "live" && !!lf.stream;
  const stateRef = useRef(voice?.state ?? "off");
  stateRef.current = voice?.state ?? "off";

  // While a real face is on screen, LiveTalking may lip-sync it (one shared connection).
  useEffect(() => liveFace.want(), []);

  useEffect(() => {
    if (video.current) video.current.srcObject = live ? lf.stream : null;
  }, [live, lf.stream]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    let level = 0;
    const buf = new Uint8Array(512);
    const frame = () => {
      const a = voice?.analyser.current;
      const st = stateRef.current;
      let target = 0;
      if (a && (st === "speaking" || st === "hearing")) {
        const n = Math.min(buf.length, a.fftSize);
        a.getByteTimeDomainData(buf.subarray(0, n));
        let sum = 0;
        for (let i = 0; i < n; i += 1) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        target = Math.min(1, Math.sqrt(sum / n) * 4.2);
      }
      // Fast attack, slow release: syllables read, silence settles.
      level += (target - level) * (target > level ? 0.5 : 0.1);
      const shown = reduced ? (target > 0.05 ? 0.45 : 0) : level;
      el.style.setProperty("--rf-lvl", shown.toFixed(3));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [voice, reduced]);

  return (
    <div className={`jrf jrf--${variant}`} ref={root} data-live={live ? "true" : "false"}>
      <span className="jrf-light" aria-hidden />
      <span className="jrf-ring" aria-hidden />
      {live && variant !== "pill" && (
        <span className="jrf-live" aria-label="Lip sync on">
          <i aria-hidden />
          Lip sync
        </span>
      )}
      <span className="jrf-frame">
        {live ? (
          // Muted: the page has ONE audible copy of his voice (liveFace.ts), however many faces show.
          <video ref={video} className="jrf-photo jrf-video" autoPlay playsInline muted />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a small local still, shown at three sizes
          <img className="jrf-photo" src={REAL_FACE_SRC} alt="" width={900} height={1612} draggable={false} decoding="async" />
        )}
      </span>
    </div>
  );
}
