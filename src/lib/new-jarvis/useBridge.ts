"use client";

// ---------------------------------------------------------------------------
// Whether this PC is reachable, kept current.
//
// The bridge is off most of the time — it is a process on one laptop and the
// site is open on a phone as often as not. So this hook's job is less "connect"
// than "tell the truth continuously", because every panel on the surface greys
// itself out from what it reports.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { BRIDGE_OFFLINE, call, claimPairedToken, forgetToken, probe, readToken, saveToken, type BridgeHealth } from "./bridge";

/** Quiet enough not to matter, frequent enough that starting it feels instant. */
const POLL_MS = 6_000;

export interface UseBridge {
  health: BridgeHealth;
  /** True once the first probe has answered — before that, show nothing. */
  ready: boolean;
  hasToken: boolean;
  refresh: () => void;
  pair: (token: string) => Promise<BridgeHealth>;
  unpair: () => void;
  /** One call, with the token attached. Throws a readable BridgeError. */
  run: (route: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function useBridge(): UseBridge {
  const [health, setHealth] = useState<BridgeHealth>(BRIDGE_OFFLINE);
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const check = useCallback(async () => {
    const h = await probe();
    if (!alive.current) return;
    setHealth(h);
    setReady(true);
  }, []);

  useEffect(() => {
    alive.current = true;
    // pair.cmd hands the token over in the URL fragment; take it before the
    // first probe so the very first answer already says "paired".
    if (claimPairedToken()) setHasToken(true);
    else setHasToken(readToken().length > 0);

    const tick = async () => {
      await check();
      if (alive.current) timer.current = setTimeout(tick, POLL_MS);
    };
    void tick();

    // A laptop that was asleep comes back with a stale answer on screen.
    const wake = () => void check();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);

    // pair.cmd opens the hub at #pair=… . When that tab is ALREADY open here,
    // the browser changes the fragment and does not reload, so mount never
    // runs again — and the one-button pairing silently does nothing, which
    // looks exactly like a broken agent. Claim it on the hash change too.
    const onHash = () => {
      if (claimPairedToken()) {
        setHasToken(true);
        void check();
      }
    };
    window.addEventListener("hashchange", onHash);

    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("hashchange", onHash);
    };
  }, [check]);

  const pair = useCallback(
    async (token: string) => {
      saveToken(token);
      setHasToken(token.trim().length > 0);
      const h = await probe();
      setHealth(h);
      setReady(true);
      return h;
    },
    [],
  );

  const unpair = useCallback(() => {
    forgetToken();
    setHasToken(false);
    void check();
  }, [check]);

  const run = useCallback(
    (route: string, args: Record<string, unknown> = {}) => call<Record<string, unknown>>(route, args),
    [],
  );

  return { health, ready, hasToken, refresh: () => void check(), pair, unpair, run };
}
