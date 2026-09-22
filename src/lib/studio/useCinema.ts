"use client";

// ---------------------------------------------------------------------------
// The camera deck's look, shared by the Studio tab and the Chat tab.
//
// It is one setting, not two: picking "35mm Film" while browsing workflows and
// then starting in chat must arrive in chat still set. It lives in
// localStorage (this is a per-device preference, not owner data worth syncing)
// and an event keeps both tabs honest while they are mounted at the same time.
//
// The output settings (aspect ratio and clip length) ride along in the same
// store for the same reason.
//
// The camera MOVES are deliberately not here — they live in the prompt text,
// where their order is visible and editable.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { cleanOutput, cleanSelection, type CinemaOutput, type CinemaSelection } from "./cinema";

const KEY = "jarvis.cinema.v1";
const EVENT = "jarvis-cinema-change";

function read(): CinemaSelection {
  try {
    return cleanSelection(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return {};
  }
}

export function useCinemaSelection(): [CinemaSelection, (s: CinemaSelection) => void] {
  const [selection, set] = useState<CinemaSelection>({});

  useEffect(() => {
    set(read());
    const sync = () => set(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const save = useCallback((next: CinemaSelection) => {
    set(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // A blocked store only costs the owner their setting on the next reload.
    }
    window.dispatchEvent(new CustomEvent(EVENT));
  }, []);

  return [selection, save];
}

// ---------------------------------------------------------------------------
// Aspect ratio and clip length. Same store, same reasoning.
// ---------------------------------------------------------------------------

const OUT_KEY = "jarvis.cinema.output.v1";
const OUT_EVENT = "jarvis-cinema-output-change";

function readOutput(): CinemaOutput {
  try {
    return cleanOutput(JSON.parse(localStorage.getItem(OUT_KEY) ?? "{}"));
  } catch {
    return {};
  }
}

export function useCinemaOutput(): [CinemaOutput, (o: CinemaOutput) => void] {
  const [output, set] = useState<CinemaOutput>({});

  useEffect(() => {
    set(readOutput());
    const sync = () => set(readOutput());
    window.addEventListener(OUT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(OUT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const save = useCallback((next: CinemaOutput) => {
    set(next);
    try {
      localStorage.setItem(OUT_KEY, JSON.stringify(next));
    } catch {
      // Same as above: a blocked store only costs the setting on reload.
    }
    window.dispatchEvent(new CustomEvent(OUT_EVENT));
  }, []);

  return [output, save];
}
