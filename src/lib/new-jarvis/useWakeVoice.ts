"use client";

// ---------------------------------------------------------------------------
// Always listening.
//
// The old voice was a modal you pressed a button to open. This one runs from
// the moment it is switched on: it waits for its name, captures the sentence
// after it, hands that over as a command, speaks the answer, and goes back to
// waiting — and it can be talked over at any point.
//
// Four things make that work, and all four are the difference between this and
// a demo:
//
//   1. Chrome ENDS a continuous session on its own, every minute or so, and
//      instantly on some errors. It has to be restarted, with a backoff, or
//      the microphone quietly dies after a minute and nobody notices until
//      they have said "Jarvis" four times.
//   2. The speaker feeds back into the microphone. Without the echo test in
//      wake.ts, the assistant answers its own answer and the loop never ends.
//   3. A pause mid-sentence is not the end of a sentence. Endpointing is on
//      silence with a timeout, not on Chrome's idea of a final result.
//   4. The wake word arrives in an INTERIM result, long before the final one.
//      Waiting for final adds a second of dead air to every single turn.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_WAKE_WORDS,
  detectWake,
  isEcho,
  isInterruption,
  restartDelayMs,
  shouldEndpoint,
} from "./wake";

export type VoiceState = "off" | "waiting" | "hearing" | "thinking" | "speaking";

interface RecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseWakeVoice {
  supported: boolean;
  state: VoiceState;
  /** On = the microphone is live and waiting for the wake word. */
  listening: boolean;
  /** What is being heard right now, including interim words. */
  heard: string;
  /** 0–1, for the meter. Real while listening and while speaking aloud. */
  level: number;
  error: string;
  wakeWords: string[];
  setWakeWords: (w: string[]) => void;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => void;
  speak: (text: string) => Promise<void>;
  /** Cut it off mid-sentence. */
  hush: () => void;
  setState: (s: VoiceState) => void;
}

export interface WakeVoiceOptions {
  /** Called with the instruction once the owner has finished saying it. */
  onCommand: (text: string) => void;
  /** Called when they talk over the assistant. */
  onInterrupt?: () => void;
  /** Speak answers aloud. Off means listen-only. */
  speakReplies?: boolean;
}

export function useWakeVoice({ onCommand, onInterrupt, speakReplies = true }: WakeVoiceOptions): UseWakeVoice {
  const [state, setState] = useState<VoiceState>("off");
  const [heard, setHeard] = useState("");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(false);
  const [wakeWords, setWakeWords] = useState<string[]>(DEFAULT_WAKE_WORDS);

  const recog = useRef<RecognitionLike | null>(null);
  const wantOn = useRef(false);
  const failures = useRef(0);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The capture in progress, if any.
  const armed = useRef(false);
  const buffer = useRef("");
  const lastWordAt = useRef(0);
  const armedAt = useRef(0);
  const endpointTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // What is being said aloud right now — the echo test compares against it.
  const speakingText = useRef("");
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const raf = useRef<number | null>(null);

  const stateRef = useRef<VoiceState>("off");
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const onCommandRef = useRef(onCommand);
  const onInterruptRef = useRef(onInterrupt);
  useEffect(() => {
    onCommandRef.current = onCommand;
    onInterruptRef.current = onInterrupt;
  });

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
  }, []);

  // --- the meter ----------------------------------------------------------

  const meter = useCallback((node: AudioNode, ctx: AudioContext) => {
    const a = ctx.createAnalyser();
    a.fftSize = 256;
    node.connect(a);
    const data = new Uint8Array(a.frequencyBinCount);
    const tick = () => {
      a.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      setLevel((prev) => prev + (Math.min(1, peak * 2.4) - prev) * 0.32);
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const stopMeter = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setLevel(0);
  }, []);

  // --- speaking -----------------------------------------------------------

  const hush = useCallback(() => {
    speakingText.current = "";
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    if (audioEl.current) {
      audioEl.current.pause();
      audioEl.current = null;
    }
    stopMeter();
    if (stateRef.current === "speaking") setState(wantOn.current ? "waiting" : "off");
  }, [stopMeter]);

  const speak = useCallback(
    async (text: string) => {
      const say = String(text ?? "").trim();
      if (!say || !speakReplies) return;
      speakingText.current = say;
      setState("speaking");

      // The owner's own voice first (fish.audio via /api/tts), the browser's
      // as the fallback that always exists.
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: say.slice(0, 2000) }),
        });
        if (res.ok && (res.headers.get("content-type") ?? "").startsWith("audio")) {
          const url = URL.createObjectURL(await res.blob());
          const el = new Audio(url);
          audioEl.current = el;
          await el.play();
          await new Promise<void>((done) => {
            el.onended = () => done();
            el.onerror = () => done();
          });
          URL.revokeObjectURL(url);
          audioEl.current = null;
          speakingText.current = "";
          if (stateRef.current === "speaking") setState(wantOn.current ? "waiting" : "off");
          return;
        }
      } catch {
        // Fall through to the browser voice.
      }

      if (typeof window === "undefined" || !window.speechSynthesis) {
        speakingText.current = "";
        setState(wantOn.current ? "waiting" : "off");
        return;
      }
      const u = new SpeechSynthesisUtterance(say);
      u.rate = 1.04;
      u.pitch = 0.96;
      await new Promise<void>((done) => {
        u.onend = () => done();
        u.onerror = () => done();
        window.speechSynthesis.speak(u);
      });
      speakingText.current = "";
      if (stateRef.current === "speaking") setState(wantOn.current ? "waiting" : "off");
    },
    [speakReplies],
  );

  // --- the capture --------------------------------------------------------

  const fire = useCallback(() => {
    const text = buffer.current.trim();
    armed.current = false;
    buffer.current = "";
    setHeard("");
    if (endpointTimer.current) {
      clearInterval(endpointTimer.current);
      endpointTimer.current = null;
    }
    if (!text) {
      setState(wantOn.current ? "waiting" : "off");
      return;
    }
    setState("thinking");
    onCommandRef.current(text);
  }, []);

  const arm = useCallback(() => {
    armed.current = true;
    buffer.current = "";
    armedAt.current = Date.now();
    lastWordAt.current = Date.now();
    setHeard("");
    setState("hearing");
    if (endpointTimer.current) clearInterval(endpointTimer.current);
    // Endpointing runs on a clock, not on a recognition event: the last thing
    // the owner says is followed by silence, and silence produces no events.
    endpointTimer.current = setInterval(() => {
      if (!armed.current) return;
      if (shouldEndpoint({ lastWordAt: lastWordAt.current, startedAt: armedAt.current, now: Date.now() })) fire();
    }, 150);
  }, [fire]);

  // --- recognition --------------------------------------------------------

  const handle = useCallback(
    (text: string) => {
      const said = text.trim();
      if (!said) return;

      // Its own voice coming back through the speakers. Ignore it entirely, or
      // it answers itself for the rest of the session.
      if (speakingText.current && isEcho(said, speakingText.current)) return;

      if (stateRef.current === "speaking" || stateRef.current === "thinking") {
        if (isInterruption(said)) {
          hush();
          onInterruptRef.current?.();
          setState(wantOn.current ? "waiting" : "off");
          return;
        }
        // Talking over it with real words is a new instruction, not a barge-in
        // to be discarded — so it cuts the reply short and starts a capture.
        const hit = detectWake(said, wakeWords);
        if (hit.woke) {
          hush();
          onInterruptRef.current?.();
          arm();
          if (hit.rest) {
            buffer.current = hit.rest;
            lastWordAt.current = Date.now();
            setHeard(hit.rest);
          }
        }
        return;
      }

      if (armed.current) {
        buffer.current = said;
        lastWordAt.current = Date.now();
        setHeard(said);
        return;
      }

      const hit = detectWake(said, wakeWords);
      if (!hit.woke) return;
      arm();
      if (hit.rest) {
        buffer.current = hit.rest;
        lastWordAt.current = Date.now();
        setHeard(hit.rest);
      }
    },
    [arm, hush, wakeWords],
  );

  const begin = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || !wantOn.current) return;
    if (recog.current) return;

    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";

    r.onstart = () => {
      failures.current = 0;
      setError("");
    };

    r.onresult = (e) => {
      // Interim results are used deliberately: the wake word is in them a full
      // second before the final result arrives, and that second is the whole
      // difference between feeling instant and feeling broken.
      let said = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        said += e.results[i][0]?.transcript ?? "";
      }
      handle(said);
    };

    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantOn.current = false;
        setError("Microphone permission was refused. Allow it in the address bar and switch voice back on.");
        setState("off");
        return;
      }
      // "no-speech" and "aborted" are normal in a session that runs all day.
      if (e.error !== "no-speech" && e.error !== "aborted") {
        failures.current += 1;
        setError(e.error === "network" ? "Speech recognition lost its connection." : `Microphone error: ${e.error}`);
      }
    };

    r.onend = () => {
      recog.current = null;
      if (!wantOn.current) return;
      // Chrome ends a continuous session by itself. Restarting is not error
      // handling, it is the normal path — but a restart storm on a permanent
      // failure would pin a core, so failures back off.
      const delay = restartDelayMs(failures.current);
      restartTimer.current = setTimeout(begin, delay);
    };

    try {
      r.start();
      recog.current = r;
    } catch {
      // start() on an instance that is already running throws; the onend above
      // will bring us back.
      recog.current = null;
    }
  }, [handle]);

  const start = useCallback(async () => {
    if (!recognitionCtor()) {
      setError("This browser cannot listen. Chrome, Edge or Safari can.");
      return;
    }
    wantOn.current = true;
    failures.current = 0;
    setError("");
    setState("waiting");

    // The meter is a separate stream from recognition's own, so the wave moves
    // while it waits rather than only once it has decided it heard something.
    try {
      micStream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      meter(ctx.createMediaStreamSource(micStream.current), ctx);
    } catch {
      // Recognition can still work without our meter; the wave just stays flat.
    }
    begin();
  }, [begin, meter]);

  const stop = useCallback(() => {
    wantOn.current = false;
    armed.current = false;
    buffer.current = "";
    if (restartTimer.current) clearTimeout(restartTimer.current);
    if (endpointTimer.current) clearInterval(endpointTimer.current);
    endpointTimer.current = null;
    recog.current?.abort();
    recog.current = null;
    micStream.current?.getTracks().forEach((t) => t.stop());
    micStream.current = null;
    void audioCtx.current?.close();
    audioCtx.current = null;
    stopMeter();
    hush();
    setHeard("");
    setState("off");
  }, [hush, stopMeter]);

  const toggle = useCallback(() => {
    if (wantOn.current) stop();
    else void start();
  }, [start, stop]);

  // Unmount must release the microphone, or the tab keeps the recording dot
  // lit after the owner has navigated away.
  useEffect(() => () => stop(), [stop]);

  return {
    supported,
    state,
    listening: state !== "off",
    heard,
    level,
    error,
    wakeWords,
    setWakeWords,
    start,
    stop,
    toggle,
    speak,
    hush,
    setState,
  };
}
