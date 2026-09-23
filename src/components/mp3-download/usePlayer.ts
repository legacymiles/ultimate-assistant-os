"use client";

// ---------------------------------------------------------------------------
// One audio element for the whole app.
//
// Every stage plays something — a preview while you scan results, the same
// preview while you confirm, a candidate file while you decide whether it is
// the right take. One element means starting anything stops everything else,
// which is the only behaviour that is ever right here.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

export interface Playing {
  /** The row currently sounding, or null. */
  id: string | null;
  playing: boolean;
  /** Seconds. */
  position: number;
  duration: number;
  loading: boolean;
  error: string | null;
}

const IDLE: Playing = { id: null, playing: false, position: 0, duration: 0, loading: false, error: null };

export function usePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<Playing>(IDLE);

  // Created lazily so the element only exists once something is played, and
  // torn down on unmount so navigating away actually stops the sound.
  const element = useCallback(() => {
    if (!audio.current) {
      const el = new Audio();
      el.preload = "none";
      el.crossOrigin = "anonymous";
      el.addEventListener("timeupdate", () =>
        setState((s) => ({ ...s, position: el.currentTime })),
      );
      el.addEventListener("durationchange", () =>
        setState((s) => ({ ...s, duration: Number.isFinite(el.duration) ? el.duration : 0 })),
      );
      el.addEventListener("playing", () => setState((s) => ({ ...s, playing: true, loading: false })));
      el.addEventListener("pause", () => setState((s) => ({ ...s, playing: false })));
      el.addEventListener("ended", () => setState((s) => ({ ...s, playing: false, position: 0 })));
      el.addEventListener("error", () =>
        setState((s) => ({
          ...s,
          playing: false,
          loading: false,
          error: "This source would not play in the browser. The download may still work.",
        })),
      );
      audio.current = el;
    }
    return audio.current;
  }, []);

  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );

  /** Play `url` as row `id`, or pause it if it is already the one sounding. */
  const toggle = useCallback(
    (id: string, url: string) => {
      const el = element();
      if (state.id === id) {
        if (el.paused) void el.play().catch(() => undefined);
        else el.pause();
        return;
      }
      el.pause();
      el.src = url;
      setState({ id, playing: false, position: 0, duration: 0, loading: true, error: null });
      void el.play().catch(() =>
        setState((s) => ({
          ...s,
          loading: false,
          error: "This source would not play in the browser. The download may still work.",
        })),
      );
    },
    [element, state.id],
  );

  const seek = useCallback((seconds: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = seconds;
    setState((s) => ({ ...s, position: seconds }));
  }, []);

  const stop = useCallback(() => {
    audio.current?.pause();
    setState(IDLE);
  }, []);

  return { ...state, toggle, seek, stop };
}
