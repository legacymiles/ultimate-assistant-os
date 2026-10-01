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
import { cleanStudioChain, DEFAULT_STUDIO_CHAIN } from "./models";

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

// ---------------------------------------------------------------------------
// The model chain — which brains plan the film, in order.
//
// Its own store rather than a rail inside the selection, because every rail in
// CinemaSelection contributes its `prompt` text to the film and this one must
// not: "use DeepSeek" is a routing decision, and a model reading it as direction
// would put the word DeepSeek into the shot. Same localStorage-and-event pattern
// as the two above, so the Studio tab and the Chat tab never disagree about it.
// ---------------------------------------------------------------------------

const MODELS_KEY = "jarvis.studio.models.v1";
const MODELS_EVENT = "jarvis-studio-models-change";

function readChain(): string[] {
  try {
    const raw = localStorage.getItem(MODELS_KEY);
    // Never stored yet is not the same as deliberately emptied: an absent key
    // means the owner has not touched this, so they get the default order.
    if (raw === null) return DEFAULT_STUDIO_CHAIN;
    return cleanStudioChain(JSON.parse(raw));
  } catch {
    return DEFAULT_STUDIO_CHAIN;
  }
}

export function useStudioModels(): [string[], (chain: string[]) => void] {
  // Starts on the default rather than empty so the first paint shows the real
  // chain instead of flashing "the router decides" and then correcting itself.
  const [chain, set] = useState<string[]>(DEFAULT_STUDIO_CHAIN);

  useEffect(() => {
    set(readChain());
    const sync = () => set(readChain());
    window.addEventListener(MODELS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(MODELS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const save = useCallback((next: string[]) => {
    const clean = cleanStudioChain(next);
    set(clean);
    try {
      localStorage.setItem(MODELS_KEY, JSON.stringify(clean));
    } catch {
      // A blocked store only costs the owner their order on the next reload.
    }
    window.dispatchEvent(new CustomEvent(MODELS_EVENT));
  }, []);

  return [chain, save];
}
