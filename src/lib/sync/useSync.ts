"use client";

// ---------------------------------------------------------------------------
// The read half of cross-device sync.
//
// The stores push on every write (see appState.ts), but a device that has
// never seen the data still needs to pull it down once. This hook is that
// pull: it runs reconcile() at mount, which settles local against remote and
// leaves the winner in localStorage, then tells the component to re-read
// through its own normal store call.
//
// Deliberately not a state container. Each app already owns its state and its
// loader; asking them to re-read is a two-line change, whereas replacing their
// state management would be a rewrite of every app for no gain.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { reconcile } from "./appState";

/**
 * Settle `key` against the server once, then invoke `onSettled` so the caller
 * can re-read its own store.
 *
 * `onSettled` is held in a ref, so passing an inline arrow function does not
 * restart the sync on every render — the common case at call sites, and an
 * easy way to cause an accidental fetch loop.
 *
 * When Supabase is unconfigured or nobody is signed in, reconcile() is a no-op
 * and the callback still fires once, so callers can rely on it running exactly
 * one time in every configuration.
 */
export function useRemotePull(key: string, onSettled: () => void): void {
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await reconcile(key);
      // The component may have unmounted mid-flight; setting state then would
      // be a wasted render at best.
      if (!cancelled) settled.current();
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
}
