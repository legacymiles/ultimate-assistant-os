"use client";

// ---------------------------------------------------------------------------
// Installing Baby No Scroll as an app — one store for the whole page.
//
// Chrome fires `beforeinstallprompt` once, and its prompt can be shown once.
// Two components listening on their own would each hold a copy, and the second
// to press Install would get nothing. So the event lives here, captured as soon
// as this module loads (often before React has mounted anything), and every
// component reads the same one.
//
// This is also where the service worker is registered, because without it
// Chrome may never fire the event at all — see public/baby-no-scroll-sw.js.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallState {
  prompt: InstallPromptEvent | null;
  justInstalled: boolean;
}

const SERVER: InstallState = { prompt: null, justInstalled: false };
let state: InstallState = SERVER;
const subscribers = new Set<() => void>();
let wired = false;

function set(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
}

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    // Held, not shown: the browser's own banner would turn up at a random
    // moment, and the parent is already looking at an Install button.
    e.preventDefault();
    set({ prompt: e as InstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => set({ prompt: null, justInstalled: true }));
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/baby-no-scroll-sw.js", { scope: "/apps/baby-no-scroll" })
      .catch(() => {
        // No worker (private mode, an old browser): the page still works, it
        // just may not install as a full app.
      });
  }
}

wire();

export function useInstall() {
  const s = useSyncExternalStore(
    (fn) => {
      wire();
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => state,
    () => SERVER,
  );

  const install = async () => {
    const p = state.prompt;
    if (!p) return;
    await p.prompt();
    const choice = await p.userChoice.catch(() => null);
    set({ prompt: null, justInstalled: choice?.outcome === "accepted" || state.justInstalled });
  };

  return { canPrompt: !!s.prompt, justInstalled: s.justInstalled, install };
}
