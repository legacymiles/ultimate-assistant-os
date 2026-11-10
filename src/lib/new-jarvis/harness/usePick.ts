"use client";

// ---------------------------------------------------------------------------
// The "Powered by" pick, remembered, plus what the PC can run right now.
//
// The pick is remembered per device so the last choice is the default next
// time. The route states come from the bridge once per mount; with the PC off
// they stay null ("unknown"), which PoweredBy reads as "don't grey anything".
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";

import { call } from "../bridge";
import { DEFAULT_PICK, PICK_KEY, cleanPick, routeStates, type PickRoute, type RouteState } from "./models";
import type { HarnessChoice } from "./types";

export function readPick(): string {
  try {
    return cleanPick(window.localStorage.getItem(PICK_KEY)) || DEFAULT_PICK;
  } catch {
    return DEFAULT_PICK;
  }
}

export function writePick(v: string): void {
  try {
    window.localStorage.setItem(PICK_KEY, v);
  } catch {
    /* private window — the pick still applies to this screen */
  }
}

export function usePick(): [string, (v: string) => void] {
  const [pick, setPick] = useState(DEFAULT_PICK);
  useEffect(() => setPick(readPick()), []);
  const choose = useCallback((v: string) => {
    const clean = cleanPick(v) || DEFAULT_PICK;
    setPick(clean);
    writePick(clean);
  }, []);
  return [pick, choose];
}

/** Ask the PC which routes it can run. Never throws; null = unknown. */
export function usePickRoutes(enabled = true): Record<PickRoute, RouteState | null> {
  const [choices, setChoices] = useState<HarnessChoice[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const ctl = new AbortController();
    call<{ harnesses: HarnessChoice[] }>("harness/list", {}, { signal: ctl.signal })
      .then((d) => setChoices(d.harnesses ?? []))
      .catch(() => setChoices(null));
    return () => ctl.abort();
  }, [enabled]);
  return routeStates(choices);
}
