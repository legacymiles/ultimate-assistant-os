"use client";

// ---------------------------------------------------------------------------
// Text Inbox in the browser: the live view, the phone check, the "Jarvis Send"
// hand-off and push notifications.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { runShortcutUrl, type TextCounts, type TextItem } from "./engine";

export type TextView = Omit<TextItem, "hash">;

export interface InboxView {
  items: TextView[];
  counts: TextCounts;
  tone: string;
  learned: number;
  settings: { notifyNew: boolean; notifyReady: boolean };
  links: { incoming: string; outbox: string };
  linkError: string;
  lastPushAt: string | null;
  lastCheckInAt: string | null;
  pushDevices: number;
  vapid: string | null;
  ai: boolean;
  now: string;
}

const API = "/api/text-inbox";
/** New texts and drafts show up by themselves (checklist A1). */
const POLL_MS = 12_000;

async function call(init?: RequestInit, query = ""): Promise<InboxView> {
  let res: Response;
  try {
    res = await fetch(`${API}${query}`, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  } catch {
    throw new Error("No connection — check your internet and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as InboxView & { error?: string };
  if (!res.ok) throw new Error(body.error || "Something went wrong. Try again.");
  return body;
}

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
};

export function useTextInbox() {
  const [view, setView] = useState<InboxView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const v = await call(undefined, `?tz=${encodeURIComponent(tz())}`);
      if (alive.current) {
        setView(v);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Couldn't load your texts.");
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const t = window.setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    window.addEventListener("focus", load);
    return () => {
      alive.current = false;
      window.clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  // Drafts come back in a few seconds; check sooner while any are being written.
  const drafting = (view?.counts.drafting ?? 0) > 0;
  useEffect(() => {
    if (!drafting) return;
    const t = window.setTimeout(() => void load(), 3000);
    return () => window.clearTimeout(t);
  }, [drafting, view, load]);

  const act = useCallback(async (body: Record<string, unknown>) => {
    const v = await call({ method: "POST", body: JSON.stringify({ tz: tz(), ...body }) });
    if (alive.current) setView(v);
    return v;
  }, []);

  return { view, error, load, act, setError };
}

/** The iPhone (or iPad) — the only place the "Jarvis Send" Shortcut can run. */
export function onIphone(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPod/.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Hand every approved reply to the phone's "Jarvis Send" Shortcut; it comes back here when done. */
export function sendFromPhone(back?: string): void {
  const here = back ?? window.location.href.split("?")[0].split("#")[0];
  window.location.href = runShortcutUrl(`${here}?sent=1`);
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** True when this page was opened from the Home Screen (iOS only pushes there). */
export function installed(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Turn on notifications for THIS device. Throws a plain-English reason when
 * it can't (iPhone not added to Home Screen, blocked in settings, no keys).
 */
export async function turnOnPush(vapid: string | null, act: (b: Record<string, unknown>) => Promise<InboxView>): Promise<void> {
  if (!vapid) throw new Error("Notifications can't be set up on this server yet.");
  if (typeof Notification === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error(
      onIphone()
        ? "On iPhone, notifications only work from the Home Screen: tap Share → Add to Home Screen, open Texts from there, then tap this again."
        : "This browser can't show notifications.",
    );
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications are blocked for this site. Allow them in your settings, then try again.");
  const reg = await navigator.serviceWorker.register("/text-inbox-sw.js", { scope: "/apps/text-inbox" });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource }));
  await act({ action: "push.subscribe", subscription: sub.toJSON() });
}

export async function pushIsOn(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration("/apps/text-inbox");
    return Boolean(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
