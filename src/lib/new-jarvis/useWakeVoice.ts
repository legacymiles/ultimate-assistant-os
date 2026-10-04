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

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
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
  /**
   * 0–1 overall loudness, updated about ten times a second.
   *
   * Deliberately slow. This is for anything that wants a React value; a
   * visualiser wants `analyser` and its own frame loop instead, because
   * pushing a number into React state sixty times a second re-renders
   * everything that reads it, every frame, for no benefit.
   */
  level: number;
  /**
   * Whichever analyser is live — the microphone while listening, Jarvis's own
   * output while speaking, or null when neither is.
   *
   * A ref, so a canvas can read `getByteFrequencyData` straight out of it on
   * its own schedule without this hook re-rendering anything.
   */
  analyser: MutableRefObject<AnalyserNode | null>;
  /**
   * `performance.now()` of the last time the wake word was heard.
   *
   * The wake word is detected a full second before anything is captured, and
   * nothing on screen used to move at that moment. This is what lets the
   * reactor ignite the instant it hears its name.
   */
  wakeAt: MutableRefObject<number>;
  /** `performance.now()` of the last real sound. Drives the idle wind-down. */
  lastSoundAt: MutableRefObject<number>;
  /** Milliseconds from the owner finishing speaking to the answer arriving, or null. */
  latencyMs: number | null;
  error: string;
  wakeWords: string[];
  setWakeWords: (w: string[]) => void;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => void;
  /**
   * Push to talk: arm the capture now, without the wake word, starting the
   * microphone first if it is off. What the floating voice button calls.
   */
  talk: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  /** Cut it off mid-sentence. */
  hush: () => void;
  setState: (s: VoiceState) => void;
  /** Tell the hook the answer has arrived, so it can report the round trip. */
  markAnswered: () => void;
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

  // The analyser the visualiser reads. Swapped between the microphone and
  // Jarvis's own output as the conversation turns, so the picture on screen is
  // always of whoever is actually talking.
  const analyser = useRef<AnalyserNode | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const ttsAnalyser = useRef<AnalyserNode | null>(null);
  const ttsSource = useRef<MediaElementAudioSourceNode | null>(null);

  const wakeAt = useRef(0);
  const lastSoundAt = useRef(0);
  const askedAt = useRef(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

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

  /**
   * Build an analyser for a source and hand it back.
   *
   * fftSize 512 rather than 256: twice the frequency resolution for the same
   * trivial cost, and the extra bins are what let the log-spaced bands at the
   * bottom end be distinct rather than all reading the same bucket.
   *
   * It no longer runs its own frame loop. The old one called `setLevel` sixty
   * times a second, which re-rendered every component reading it on every
   * frame; the visualiser now reads this analyser directly on its own
   * schedule, and `level` is sampled slowly below for anyone who wants a plain
   * React number.
   */
  const makeAnalyser = useCallback((node: AudioNode, ctx: AudioContext): AnalyserNode => {
    const a = ctx.createAnalyser();
    a.fftSize = 512;
    a.smoothingTimeConstant = 0.72;
    node.connect(a);
    return a;
  }, []);

  const stopMeter = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setLevel(0);
  }, []);

  /**
   * A slow sample of the live analyser, for React consumers.
   *
   * Ten times a second is plenty for a text label or a progress-style readout,
   * and it costs a thousandth of what the old sixty-per-second state write did.
   * It also keeps `lastSoundAt` current, which is what tells the reactor the
   * room has gone quiet.
   */
  useEffect(() => {
    const data = new Uint8Array(256);
    const timer = setInterval(() => {
      const a = analyser.current;
      if (!a) {
        setLevel((prev) => (prev > 0.001 ? prev * 0.5 : 0));
        return;
      }
      const bins = Math.min(data.length, a.frequencyBinCount);
      a.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < bins; i += 1) {
        const v = Math.abs(data[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      const next = Math.min(1, peak * 2.4);
      if (next > 0.05) lastSoundAt.current = performance.now();
      setLevel((prev) => prev + (next - prev) * 0.5);
    }, 100);
    return () => clearInterval(timer);
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

          // Route Jarvis's own voice through the analyser.
          //
          // This is the bug the whole visualiser was built on top of: the
          // element used to be played directly, connected to nothing, so while
          // Jarvis was talking the meter was still reading the MICROPHONE —
          // the room, and the speaker bleeding back into it. The picture was
          // of the wrong sound entirely.
          //
          // `createMediaElementSource` may be called only once per element,
          // which is fine because each utterance gets a fresh one; and once an
          // element is routed into a context it is NO LONGER audible on its
          // own, so connecting to `destination` is what keeps it audible.
          try {
            const ctx = audioCtx.current ?? new AudioContext();
            audioCtx.current = ctx;
            if (ctx.state === "suspended") await ctx.resume().catch(() => {});

            // Resume FIRST, and only route if it actually worked.
            //
            // `createMediaElementSource` is irreversible — once an element is
            // routed into a context it is no longer audible on its own, and it
            // can never be un-routed. So routing into a context that is still
            // suspended (speaking with the mic never switched on, so no gesture
            // has unlocked audio) would silence Jarvis completely. An
            // unanalysed voice the owner can hear beats a measured one they
            // cannot.
            if (ctx.state === "running") {
              const src = ctx.createMediaElementSource(el);
              ttsSource.current = src;
              const a = makeAnalyser(src, ctx);
              src.connect(ctx.destination);
              ttsAnalyser.current = a;
              analyser.current = a;
            } else {
              analyser.current = null;
            }
          } catch {
            // No context, or the element could not be routed. It still plays;
            // the reactor falls back to its synthesised envelope and says so.
            analyser.current = null;
          }

          await el.play();
          await new Promise<void>((done) => {
            el.onended = () => done();
            el.onerror = () => done();
          });
          URL.revokeObjectURL(url);
          audioEl.current = null;
          try {
            ttsSource.current?.disconnect();
          } catch {
            /* already gone */
          }
          ttsSource.current = null;
          ttsAnalyser.current = null;
          // Back to the microphone, which is what is live again now.
          analyser.current = micAnalyser.current;
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
      // speechSynthesis speaks through the system and exposes no audio node
      // whatsoever, so there is genuinely nothing to analyse here. Clearing the
      // analyser is what tells the reactor to synthesise an envelope instead of
      // drawing a flat line under a voice the owner can plainly hear.
      analyser.current = null;
      const u = new SpeechSynthesisUtterance(say);
      u.rate = 1.04;
      u.pitch = 0.96;
      await new Promise<void>((done) => {
        u.onend = () => done();
        u.onerror = () => done();
        window.speechSynthesis.speak(u);
      });
      analyser.current = micAnalyser.current;
      speakingText.current = "";
      if (stateRef.current === "speaking") setState(wantOn.current ? "waiting" : "off");
    },
    [speakReplies, makeAnalyser],
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
    askedAt.current = performance.now();
    setLatencyMs(null);
    onCommandRef.current(text);
  }, []);

  const arm = useCallback(() => {
    armed.current = true;
    buffer.current = "";
    // The moment it hears its name. Stamped here rather than when the sentence
    // finishes, because that is a full second later and the point is to show
    // the recognition itself.
    wakeAt.current = performance.now();
    lastSoundAt.current = performance.now();
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

  /**
   * The answer has arrived.
   *
   * Called by whoever owns the round trip rather than measured in here,
   * because this hook has no idea when an answer is "ready" — it only knows
   * when it starts reading one aloud, which on a long answer is seconds later.
   */
  const markAnswered = useCallback(() => {
    if (!askedAt.current) return;
    setLatencyMs(performance.now() - askedAt.current);
    askedAt.current = 0;
  }, []);

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
      const ctx = audioCtx.current ?? new AudioContext();
      audioCtx.current = ctx;
      // A context created before any gesture starts suspended, and a suspended
      // analyser reports pure silence for ever — which looks exactly like a
      // broken microphone. `start` is always reached from a click, so this is
      // the right moment to resume it.
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      micAnalyser.current = makeAnalyser(ctx.createMediaStreamSource(micStream.current), ctx);
      analyser.current = micAnalyser.current;
    } catch {
      // Recognition can still work without our meter; the wave just stays flat.
    }
    begin();
  }, [begin, makeAnalyser]);

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
    try {
      ttsSource.current?.disconnect();
    } catch {
      /* already gone */
    }
    ttsSource.current = null;
    ttsAnalyser.current = null;
    micAnalyser.current = null;
    analyser.current = null;
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

  /**
   * Push to talk: capture the next sentence without being asked for the name.
   *
   * The wake word exists so the microphone can be left on all day without
   * every passing remark becoming a command. It is the wrong contract when the
   * owner has deliberately reached for a button that says "talk to Jarvis" —
   * saying his name to a thing you just pressed is theatre. So this arms the
   * same capture the wake word arms, starting the microphone first if it was
   * off, and if he is mid-sentence it cuts him off, because pressing the
   * button is itself an interruption.
   */
  const talk = useCallback(async () => {
    if (stateRef.current === "speaking") {
      hush();
      onInterruptRef.current?.();
    }
    if (!wantOn.current) {
      await start();
      // start() may have failed (permission refused, no recognition in this
      // browser); arming then would show "LISTENING" over a dead microphone.
      if (!wantOn.current) return;
    }
    arm();
  }, [arm, hush, start]);

  // Unmount must release the microphone, or the tab keeps the recording dot
  // lit after the owner has navigated away.
  useEffect(() => () => stop(), [stop]);

  return {
    supported,
    state,
    listening: state !== "off",
    heard,
    level,
    analyser,
    wakeAt,
    lastSoundAt,
    latencyMs,
    error,
    wakeWords,
    setWakeWords,
    start,
    stop,
    toggle,
    talk,
    speak,
    hush,
    setState,
    markAnswered,
  };
}
