"use client";

// ---------------------------------------------------------------------------
// The "no scroll" half of Baby No Scroll: everything the browser will let a web
// page take away.
//
// Be honest about the ceiling. A web page cannot disable the home button, the
// power button, or the gesture that switches apps, and it cannot stop Escape
// leaving fullscreen. For a device that must be truly unattended, the operating
// system's own Guided Access (iOS) or Screen Pinning (Android) is the real tool,
// and the setup screen says so. What this hook does cover is everything else,
// and that is the difference between a baby ending up in the YouTube search box
// and a baby watching a video:
//
//   · fullscreen, which is the only thing that genuinely hides browser chrome
//   · scrolling, bouncing, pull-to-refresh, pinch-zoom and double-tap-zoom
//   · text selection, long-press menus, drag-and-drop of the picture
//   · the back gesture, swallowed by keeping a sentinel history entry in front
//   · every key, because a laptop keyboard under a palm is a thousand shortcuts
//   · the screen going to sleep, via the Wake Lock API where it exists
//
// Leaving fullscreen is not treated as unlocking. The lock is this app's, not
// the browser's — so when fullscreen is lost, the next touch anywhere puts it
// back. That touch is usually the baby's, which is the nicest part of it: the
// repair is invisible.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", fn: () => void): void;
}

interface WakeLockNavigator {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> };
}

export interface ScreenLockOptions {
  active: boolean;
  fullscreen: boolean;
  keepAwake: boolean;
}

export interface ScreenLockState {
  /** Whether the document is really in fullscreen right now. */
  isFullscreen: boolean;
  /** True once a fullscreen request has been refused, so the UI can say so. */
  fullscreenRefused: boolean;
  /** Ask for fullscreen again. Must be called inside a user gesture. */
  restoreFullscreen: () => void;
}

export function useScreenLock({
  active,
  fullscreen,
  keepAwake,
}: ScreenLockOptions): ScreenLockState {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenRefused, setRefused] = useState(false);
  const wake = useRef<WakeLockSentinel | null>(null);

  const requestFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) return;
    const el = document.documentElement;
    const req = el.requestFullscreen?.bind(el);
    if (!req) {
      setRefused(true);
      return;
    }
    // navigationUI: "hide" is honoured on Android Chrome and ignored elsewhere,
    // which is the only reason it is worth asking for.
    req({ navigationUI: "hide" }).catch(() => setRefused(true));
  }, []);

  // --- fullscreen -----------------------------------------------------------
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (!active) {
      setRefused(false);
      if (typeof document !== "undefined" && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      return;
    }
    if (fullscreen) requestFullscreen();
  }, [active, fullscreen, requestFullscreen]);

  // --- wake lock ------------------------------------------------------------
  useEffect(() => {
    if (!active || !keepAwake || typeof navigator === "undefined") return;
    let cancelled = false;
    const nav = navigator as Navigator & WakeLockNavigator;

    const take = () => {
      nav.wakeLock
        ?.request("screen")
        .then((s) => {
          if (cancelled) {
            void s.release();
            return;
          }
          wake.current = s;
        })
        .catch(() => {
          // No wake lock here (Safari, an insecure origin, a refused request).
          // The screen will dim on its own schedule, which is a smaller problem
          // than anything else this hook is for.
        });
    };
    take();

    // A tab that goes to the background loses the lock silently, so it is
    // retaken when the tab comes back rather than being quietly gone.
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!wake.current || wake.current.released)) {
        take();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      const s = wake.current;
      wake.current = null;
      if (s && !s.released) void s.release();
    };
  }, [active, keepAwake]);

  // --- the inert page -------------------------------------------------------
  useEffect(() => {
    if (!active || typeof window === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const saved = {
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyTouch: body.style.touchAction,
      bodySelect: body.style.userSelect,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    body.style.userSelect = "none";
    body.style.overscrollBehavior = "none";

    const swallow = (e: Event) => e.preventDefault();

    // Zoom. Two separate mechanisms: Safari's gesture events for pinch, and a
    // ctrl-wheel for a trackpad pinch everywhere else.
    const onWheel = (e: WheelEvent) => e.preventDefault();

    // Multi-touch is pinch on every platform, so it never reaches a game. A
    // single touch does, because the games are played with it.
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };

    // Double-tap-to-zoom, which fires as a second touchend inside ~300ms and
    // cannot be told apart from a baby hitting the same key twice except by
    // the time between the taps.
    let lastTouchEnd = 0;
    const onTouchEnd = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 320) e.preventDefault();
      lastTouchEnd = now;
    };

    // Every key. A laptop under a forearm is Ctrl+W, F5, Alt+Left and the
    // address bar all at once. Escape is deliberately not swallowed: the
    // browser owns it, and pretending otherwise would be a lie about safety.
    //
    // Two things do get through, because a lock with no keyboard route out is
    // not a lock, it is a trap for anyone who cannot drag. Tab is harmless —
    // the padlock is the only focusable thing on a locked screen — and Enter or
    // Space reach the padlock itself, where they have to be HELD to open it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "F11" || e.key === "F12") return;
      if (e.key === "Tab") return;
      const target = e.target as HTMLElement | null;
      const onLock = !!target?.closest?.('[data-baby-lock="1"]');
      if (onLock && (e.key === "Enter" || e.key === " ")) return;
      e.preventDefault();
      e.stopPropagation();
    };

    // The back gesture. A sentinel entry is pushed in front of the real one, so
    // a back swipe lands on it; the handler then pushes another. Going back is
    // therefore a no-op for as long as the screen is locked.
    const SENTINEL = { babyNoScroll: true };
    history.pushState(SENTINEL, "");
    const onPop = () => history.pushState(SENTINEL, "");

    // A reload or a closed tab would drop the baby back on the setup screen
    // with the video gone, so the browser is asked to confirm it.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: false });
    window.addEventListener("gesturestart", swallow as EventListener, { passive: false });
    window.addEventListener("gesturechange", swallow as EventListener, { passive: false });
    window.addEventListener("gestureend", swallow as EventListener, { passive: false });
    document.addEventListener("contextmenu", swallow);
    document.addEventListener("selectstart", swallow);
    document.addEventListener("dragstart", swallow);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("popstate", onPop);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      html.style.overflow = saved.htmlOverflow;
      html.style.overscrollBehavior = saved.htmlOverscroll;
      body.style.overflow = saved.bodyOverflow;
      body.style.touchAction = saved.bodyTouch;
      body.style.userSelect = saved.bodySelect;
      body.style.overscrollBehavior = saved.bodyOverscroll;
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("gesturestart", swallow as EventListener);
      window.removeEventListener("gesturechange", swallow as EventListener);
      window.removeEventListener("gestureend", swallow as EventListener);
      document.removeEventListener("contextmenu", swallow);
      document.removeEventListener("selectstart", swallow);
      document.removeEventListener("dragstart", swallow);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active]);

  return { isFullscreen, fullscreenRefused, restoreFullscreen: requestFullscreen };
}
