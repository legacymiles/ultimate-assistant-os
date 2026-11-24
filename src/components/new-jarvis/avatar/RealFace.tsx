"use client";

// ---------------------------------------------------------------------------
// The real-looking agent: the second face Jarvis can wear, beside the
// Three.js avatar (owner, 2026-11-24: "so users can switch between the
// three.js voice agent and this real looking voice agent"; the picked mockup
// put a 3D | Real switch under the face).
//
// It is the AI Live Studio host's portrait, performed rather than rendered:
// it breathes and sways, a warm key light follows Jarvis's own voice while
// he speaks, and a cool ring follows YOUR voice while he listens. It reads the
// same analyser the 3D head reads (`voice.analyser` — Jarvis's voice while
// speaking, the microphone while hearing), every frame, writing two CSS
// variables — opacity and transform only, never layout.
//
// The lips don't move: a still photograph can't, honestly. Real lip sync is
// LiveTalking's job and runs only on the owner's PC (AI Live Studio).
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import type { AvatarVariant, AvatarVoice } from "./AvatarScene";

/** The real face. Shared with AI Live Studio's host. */
export const REAL_FACE_SRC = "/ai-live-studio/alex.jpg";

export function RealFace({ voice, variant, reduced }: { voice: AvatarVoice | null; variant: AvatarVariant; reduced: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const stateRef = useRef(voice?.state ?? "off");
  stateRef.current = voice?.state ?? "off";

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
    <div className={`jrf jrf--${variant}`} ref={root}>
      <span className="jrf-light" aria-hidden />
      <span className="jrf-ring" aria-hidden />
      <span className="jrf-frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small local still, shown at three sizes */}
        <img className="jrf-photo" src={REAL_FACE_SRC} alt="" width={900} height={1612} draggable={false} decoding="async" />
      </span>
    </div>
  );
}
