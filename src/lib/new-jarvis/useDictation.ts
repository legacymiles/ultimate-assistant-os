"use client";

// ---------------------------------------------------------------------------
// Talk to type. Tap the mic, say what you want, and the words land in the box
// you are typing in, so you can check them before pressing Start or Send. Tap
// again to stop. Uses the browser's own speech recognition (Chrome, Edge,
// Safari): free, no key, nothing leaves the device until it is text.
//
// Unlike Chat's wake-word mic, this never sends anything by itself.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionLike {
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

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** What was already in the box, plus what has been heard, with one space between. */
export function joinDictation(base: string, heard: string): string {
  const said = heard.replace(/\s+/g, " ").trim();
  if (!said) return base;
  if (!base) return said;
  return /\s$/.test(base) ? `${base}${said}` : `${base} ${said}`;
}

/** Plain-English reasons, never the browser's error codes. */
export function dictationError(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed")
    return "The microphone is blocked. Allow it for this site in your browser settings, then tap the mic again.";
  if (code === "no-speech") return "I didn't hear anything. Tap the mic and try again.";
  if (code === "audio-capture") return "No microphone was found on this device.";
  if (code === "network") return "Speech needs an internet connection. Check it and try again.";
  return "The mic stopped. Tap it to try again.";
}

export interface Dictation {
  supported: boolean;
  on: boolean;
  error: string;
  toggle: () => void;
  stop: () => void;
}

export function useDictation(getText: () => string, setText: (text: string) => void): Dictation {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const [error, setError] = useState("");
  const rec = useRef<RecognitionLike | null>(null);
  const base = useRef("");
  const finals = useRef("");
  const getRef = useRef(getText);
  const setRef = useRef(setText);
  getRef.current = getText;
  setRef.current = setText;

  useEffect(() => setSupported(recognitionCtor() !== null), []);

  const stop = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    if (r) {
      r.onresult = null;
      r.onend = null;
      r.onerror = null;
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
    }
    setOn(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("This browser can't listen. Chrome, Edge or Safari can.");
      return;
    }
    setError("");
    base.current = getRef.current();
    finals.current = "";
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const words = res[0]?.transcript ?? "";
        if (res.isFinal) finals.current = `${finals.current} ${words}`;
        else interim += ` ${words}`;
      }
      setRef.current(joinDictation(base.current, `${finals.current} ${interim}`));
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(dictationError(e.error));
      stop();
    };
    // Safari ends a session after a pause; keep the words, turn the mic off.
    r.onend = () => {
      rec.current = null;
      setOn(false);
    };
    rec.current = r;
    try {
      r.start();
      setOn(true);
    } catch {
      rec.current = null;
      setError(dictationError(""));
    }
  }, [stop]);

  const toggle = useCallback(() => (rec.current ? stop() : start()), [start, stop]);

  useEffect(() => () => stop(), [stop]);

  return { supported, on, error, toggle, stop };
}
