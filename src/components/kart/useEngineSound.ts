"use client";
// Optional WebAudio engine bed. Off by default, created only on the user's
// first toggle (browsers block autoplay), and cleaned up on unmount. Pitch and
// grit rise with kph so the ride actually sounds faster. All guarded — if
// WebAudio is unavailable we just no-op.

import { useEffect, useRef, useState } from "react";
import { useKart } from "@/lib/kart/store";

export function useEngineSound() {
  const [on, setOn] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const subRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);

  useEffect(() => {
    if (!on) {
      gainRef.current?.gain.setTargetAtTime(0, ctxRef.current?.currentTime ?? 0, 0.2);
      return;
    }
    try {
      if (!ctxRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const sub = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        sub.type = "sine";
        filter.type = "lowpass";
        filter.frequency.value = 500;
        gain.gain.value = 0;
        osc.frequency.value = 70;
        sub.frequency.value = 45;
        osc.connect(filter);
        sub.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        sub.start();
        ctxRef.current = ctx;
        oscRef.current = osc;
        subRef.current = sub;
        gainRef.current = gain;
        filterRef.current = filter;
      }
      ctxRef.current.resume();
      gainRef.current?.gain.setTargetAtTime(0.05, ctxRef.current.currentTime, 0.3);
    } catch {
      /* no audio — silent */
    }
  }, [on]);

  // modulate with kph
  useEffect(() => {
    const unsub = useKart.subscribe((s) => {
      const ctx = ctxRef.current;
      if (!ctx || !oscRef.current || !filterRef.current) return;
      const rpm = 60 + s.kph * 2.4;
      oscRef.current.frequency.setTargetAtTime(rpm, ctx.currentTime, 0.08);
      filterRef.current.frequency.setTargetAtTime(400 + s.kph * 6, ctx.currentTime, 0.1);
    });
    return unsub;
  }, []);

  useEffect(() => {
    return () => {
      try {
        ctxRef.current?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { on, toggle: () => setOn((v) => !v) };
}
