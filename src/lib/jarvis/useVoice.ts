"use client";

// ---------------------------------------------------------------------------
// Talking to Jarvis, and Jarvis talking back.
//
// Listening uses the browser's own speech recognition (Chrome, Edge, Safari):
// free, no key, no audio ever leaves the device until it is text. Speaking
// prefers the owner's fish.audio voice through /api/tts, and falls back to the
// browser's built-in voice when no key is set.
//
// Both halves report an `amplitude` 0–1, which is what makes the memory ball
// breathe: a real analyser while listening and while playing fish.audio, and a
// synthesised envelope for the browser voice, which exposes no audio stream.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseVoice {
  supported: boolean;
  state: VoiceState;
  /** What has been heard so far this turn, including the interim words. */
  transcript: string;
  amplitude: number;
  error: string;
  startListening: () => Promise<void>;
  /** Stop listening and return the final transcript. */
  stopListening: () => string;
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  setState: (s: VoiceState) => void;
}

export function useVoice(): UseVoice {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(false);

  const recog = useRef<SpeechRecognitionLike | null>(null);
  const finalText = useRef("");
  const audioCtx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef<number | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      stream.current?.getTracks().forEach((t) => t.stop());
      void audioCtx.current?.close();
      recog.current?.abort();
    };
  }, []);

  /** Follow a live audio source and publish its loudness. */
  const meter = useCallback((node: AudioNode, ctx: AudioContext) => {
    const a = ctx.createAnalyser();
    a.fftSize = 256;
    node.connect(a);
    analyser.current = a;
    const data = new Uint8Array(a.frequencyBinCount);
    const tick = () => {
      a.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      // Ease towards the peak so the ball swells rather than flickers.
      setAmplitude((prev) => prev + (Math.min(1, peak * 2.2) - prev) * 0.35);
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const stopMeter = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setAmplitude(0);
  }, []);

  const startListening = useCallback(async () => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("This browser can't listen. Chrome, Edge or Safari can.");
      return;
    }
    setError("");
    finalText.current = "";
    setTranscript("");

    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      meter(ctx.createMediaStreamSource(stream.current), ctx);
    } catch {
      // Recognition can still work without our own meter; the ball just won't
      // react to the owner's voice.
      setError("");
    }

    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i];
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) finalText.current += text;
        else interim += text;
      }
      setTranscript((finalText.current + interim).trim());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") setError("Microphone permission was refused.");
      else if (e.error !== "aborted" && e.error !== "no-speech") setError(`Microphone error: ${e.error}`);
    };
    recog.current = r;
    r.start();
    setState("listening");
  }, [meter]);

  const stopListening = useCallback((): string => {
    recog.current?.stop();
    recog.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    stopMeter();
    void audioCtx.current?.close();
    audioCtx.current = null;
    const text = transcript.trim() || finalText.current.trim();
    setState("idle");
    return text;
  }, [stopMeter, transcript]);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    audioEl.current?.pause();
    audioEl.current = null;
    stopMeter();
    setState("idle");
  }, [stopMeter]);

  const speak = useCallback(
    async (text: string) => {
      const say = text.trim();
      if (!say) return;
      setState("speaking");

      // Server voice first (fish.audio, or a self-hosted backend).
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: say.slice(0, 2000) }),
        });
        const type = res.headers.get("content-type") ?? "";
        if (res.ok && type.startsWith("audio")) {
          const url = URL.createObjectURL(await res.blob());
          const el = new Audio(url);
          audioEl.current = el;
          const ctx = new AudioContext();
          audioCtx.current = ctx;
          const src = ctx.createMediaElementSource(el);
          src.connect(ctx.destination);
          meter(src, ctx);
          await el.play();
          await new Promise<void>((resolve) => {
            el.onended = () => resolve();
            el.onerror = () => resolve();
          });
          URL.revokeObjectURL(url);
          stopMeter();
          void ctx.close();
          audioEl.current = null;
          setState("idle");
          return;
        }
      } catch {
        // Fall through to the browser voice.
      }

      // Browser voice. It gives no audio stream, so the ball is driven by a
      // synthesised envelope instead — honest enough for a mouth moving.
      if (typeof window === "undefined" || !window.speechSynthesis) {
        setState("idle");
        return;
      }
      const u = new SpeechSynthesisUtterance(say);
      u.rate = 1.03;
      u.pitch = 0.95;
      const start = performance.now();
      const tick = () => {
        const t = (performance.now() - start) / 1000;
        setAmplitude(0.35 + Math.sin(t * 11) * 0.18 + Math.sin(t * 3.3) * 0.12);
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      await new Promise<void>((resolve) => {
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      });
      stopMeter();
      setState("idle");
    },
    [meter, stopMeter],
  );

  return {
    supported,
    state,
    transcript,
    amplitude,
    error,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    setState,
  };
}

/** Did the owner say yes? Used only to confirm a prepared action by voice. */
export function isYes(text: string): boolean {
  return /^\s*(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|send it|confirm|please do)\b/i.test(text);
}

/** Did the owner say no? Anything that is neither yes nor no leaves it pending. */
export function isNo(text: string): boolean {
  return /^\s*(no|nope|don'?t|stop|cancel|not now|leave it|never mind|nevermind)\b/i.test(text);
}
