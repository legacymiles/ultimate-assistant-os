"use client";

// ---------------------------------------------------------------------------
// Find My Life in the browser: the account's devices (kept fresh by itself),
// this browser's own beacon, and "ring" answering.
//
// The beacon: once this browser is registered as one of your devices, it
// reports where it is while Find My Life (or the Jarvis dashboard) is open —
// at most once a minute, or sooner when it has moved. It never asks for
// location on its own; that only happens when you tap the button.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { distanceM, ringPending, type Doc, type Fix } from "./engine";
import type { Kind } from "./kinds";

export interface View {
  doc: Doc;
  ping: string;
  pingError?: string;
  car: { configured: boolean; connected: boolean; error?: string };
  now: string;
}

const THIS_KEY = "find-my-life:this-device";
const POLL_MS = 15_000;
const BEACON_MIN_MS = 60_000;
const BEACON_MOVE_M = 25;

function readThis(): string | null {
  try {
    return localStorage.getItem(THIS_KEY);
  } catch {
    return null;
  }
}
function writeThis(id: string | null) {
  try {
    if (id) localStorage.setItem(THIS_KEY, id);
    else localStorage.removeItem(THIS_KEY);
  } catch {
    /* private mode: the beacon just won't remember between visits */
  }
}

export function makeLocalId(): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `d_${r.slice(0, 16)}`;
}

/** A guess at what this browser is, so "Make this device findable" names it well. */
export function thisDeviceGuess(): { kind: Kind; name: string } {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone/.test(ua)) return { kind: "phone", name: "My iPhone" };
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1)) return { kind: "tablet", name: "My iPad" };
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? { kind: "phone", name: "My Android phone" } : { kind: "tablet", name: "My tablet" };
  if (/Macintosh/.test(ua)) return { kind: "laptop", name: "My Mac" };
  if (/CrOS/.test(ua)) return { kind: "laptop", name: "My Chromebook" };
  if (/Windows/.test(ua)) return { kind: "laptop", name: "My PC" };
  return { kind: "laptop", name: "This computer" };
}

type BatteryManagerLike = { level: number; charging: boolean };

async function battery(): Promise<{ battery?: number; charging?: boolean }> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (!nav.getBattery) return {};
    const b = await nav.getBattery();
    return { battery: Math.round(b.level * 100) / 100, charging: b.charging };
  } catch {
    return {};
  }
}

async function call(body?: Record<string, unknown>): Promise<View> {
  const res = await fetch("/api/find-my-life", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const j = (await res.json().catch(() => ({}))) as Partial<View> & { error?: string };
  if (!res.ok || !j.doc) throw new Error(j.error || "Couldn't reach Find My Life. Check your connection and try again.");
  return j as View;
}

export type GeoState = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

export function useFindMyLife() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [thisId, setThisId] = useState<string | null>(null);
  const [here, setHere] = useState<Fix | null>(null);
  const [geo, setGeo] = useState<GeoState>("unknown");
  const lastSent = useRef<{ at: number; fix: Fix } | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    try {
      const v = await call();
      setView(v);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your devices.");
    }
  }, []);

  // First load, then keep fresh by itself (and right away when you come back to the tab).
  useEffect(() => {
    setThisId(readThis());
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  // If this browser was registered but the device was removed elsewhere, forget it.
  useEffect(() => {
    if (view && thisId && !view.doc.devices.some((d) => d.id === thisId)) {
      writeThis(null);
      setThisId(null);
    }
  }, [view, thisId]);

  // What the browser says about location permission, without prompting.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return setGeo("unsupported");
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) return setGeo("prompt");
    let status: PermissionStatus | null = null;
    perms
      .query({ name: "geolocation" as PermissionName })
      .then((s) => {
        status = s;
        setGeo(s.state as GeoState);
        s.onchange = () => setGeo(s.state as GeoState);
      })
      .catch(() => setGeo("prompt"));
    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  const act = useCallback(async (action: string, payload: Record<string, unknown> = {}, label?: string) => {
    setBusy(label ?? action);
    try {
      const v = await call({ action, ...payload });
      setView(v);
      setError(null);
      return v;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const send = useCallback(
    async (fix: Fix, force = false) => {
      const id = readThis();
      if (!id) return;
      const prev = lastSent.current;
      if (!force && prev && Date.now() - prev.at < BEACON_MIN_MS && distanceM(prev.fix, fix) < BEACON_MOVE_M) return;
      lastSent.current = { at: Date.now(), fix };
      try {
        const v = await call({ action: "fix.self", id, fix: { ...fix, ...(await battery()) } });
        setView(v);
      } catch {
        lastSent.current = prev; // try again on the next position
      }
    },
    [],
  );

  // Where this browser is, whenever location is already allowed. Reports itself if registered.
  useEffect(() => {
    if (geo !== "granted") return;
    const onPos = (p: GeolocationPosition) => {
      const fix: Fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: new Date(p.timestamp || Date.now()).toISOString(), source: "self" };
      setHere(fix);
      void send(fix);
    };
    const w = navigator.geolocation.watchPosition(onPos, () => undefined, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 });
    return () => navigator.geolocation.clearWatch(w);
  }, [geo, send]);

  /** Ask for location (the one place we prompt), then report right away. */
  const locateNow = useCallback(
    () =>
      new Promise<Fix | null>((resolve) => {
        if (!("geolocation" in navigator)) {
          setError("This browser can't share its location.");
          return resolve(null);
        }
        navigator.geolocation.getCurrentPosition(
          (p) => {
            const fix: Fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: new Date().toISOString(), source: "self" };
            setGeo("granted");
            setHere(fix);
            void send(fix, true);
            resolve(fix);
          },
          (err) => {
            if (err.code === err.PERMISSION_DENIED) {
              setGeo("denied");
              setError("Location is blocked for this site. Turn it on in your browser's site settings (on iPhone: Settings › Privacy › Location Services › Safari Websites › While Using), then tap again.");
            } else setError("Couldn't get a location fix. Step near a window or turn on Wi-Fi, then try again.");
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
        );
      }),
    [send],
  );

  /** Register this browser as one of your devices and report where it is. */
  const makeThisFindable = useCallback(
    async (name?: string, kind?: Kind) => {
      const guess = thisDeviceGuess();
      const id = readThis() ?? makeLocalId();
      const v = await act("device.add", { id, kind: kind ?? guess.kind, name: name || guess.name }, "this");
      if (!v) return;
      const real = v.doc.devices.find((d) => d.id === id);
      if (!real) return;
      writeThis(id);
      setThisId(id);
      await locateNow();
    },
    [act, locateNow],
  );

  const forgetThis = useCallback(() => {
    writeThis(null);
    setThisId(null);
  }, []);

  const me = view?.doc.devices.find((d) => d.id === thisId);
  const ringingMe = Boolean(me && ringPending(me, new Date()));

  return { view, error, setError, busy, act, load, thisId, here, geo, locateNow, makeThisFindable, forgetThis, ringingMe };
}

// --- the ring --------------------------------------------------------------------

/** A loud, unmistakable chirp pattern, made in code (no file to load). Returns stop(). */
export function startRinging(): () => void {
  let stopped = false;
  let ctx: AudioContext | null = null;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  } catch {
    ctx = null;
  }
  const chirp = () => {
    if (stopped || !ctx) return;
    const t = ctx.currentTime;
    [0, 0.16, 0.32].forEach((d, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(i === 2 ? 1760 : 1320, t + d);
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.4, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.13);
      o.connect(g).connect(ctx!.destination);
      o.start(t + d);
      o.stop(t + d + 0.14);
    });
    try {
      navigator.vibrate?.([120, 60, 120, 60, 240]);
    } catch {
      /* not every device vibrates */
    }
  };
  chirp();
  const t = setInterval(chirp, 1100);
  return () => {
    stopped = true;
    clearInterval(t);
    void ctx?.close().catch(() => undefined);
  };
}
