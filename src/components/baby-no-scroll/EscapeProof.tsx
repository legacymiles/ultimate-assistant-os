"use client";

// ---------------------------------------------------------------------------
// Make it escape-proof — the two steps that take away what a web page cannot.
//
// In a browser tab, fullscreen belongs to the browser: Chrome on Android says
// "swipe down to exit", and one swipe from the top does exactly that, with the
// status bar, the notification shade and every other app right there. No page
// can stop it. What can:
//
//   1. Installing the page as an app. It opens as the whole screen, with no
//      address bar and no browser fullscreen to leave.
//   2. The phone's own lock — Screen Pinning or Guided Access — which is what
//      makes the swipe home, the shade and the app switcher do nothing.
//
// This panel says which of those this device has done and how to do the rest,
// in that phone's own words. It replaces the old "What this cannot do" note,
// which told a parent the limits without telling them the fix.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  PIN_GUIDES,
  detectPlatform,
  installRoute,
  type Platform,
} from "@/lib/baby-no-scroll/device";
import { runningInstalled } from "@/lib/baby-no-scroll/useScreenLock";

/** Chrome's install prompt, which is not in the DOM typings. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  ios: "iPhone / iPad",
  android: "Android",
  desktop: "Computer",
};

export function EscapeProof() {
  const [platform, setPlatform] = useState<Platform>("android");
  const [detected, setDetected] = useState<Platform | null>(null);
  const [installed, setInstalled] = useState(false);
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [justInstalled, setJustInstalled] = useState(false);

  useEffect(() => {
    const p = detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
    setPlatform(p);
    setDetected(p);
    setInstalled(runningInstalled());

    const onPrompt = (e: Event) => {
      // Held, not shown: the browser's own banner would appear at a random
      // moment, and this panel is where the parent is already looking.
      e.preventDefault();
      setPromptEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setJustInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") setJustInstalled(true);
    setPromptEvent(null);
  };

  // The install state is about THIS device, so another platform's tab shows
  // its manual steps rather than this device's status.
  const here = platform === detected;
  const route = installRoute(platform, here && installed, here && !!promptEvent);
  const guide = PIN_GUIDES[platform];
  const pinTitle = platform === "desktop" ? "Use Chrome or Edge" : `Turn on ${guide.name}`;

  return (
    <section className="rounded-xl border border-line bg-panel p-4" aria-labelledby="bns-escape">
      <h2
        id="bns-escape"
        className="text-[11px] font-medium uppercase tracking-wide text-ink-faint"
      >
        Make it escape-proof
      </h2>
      <p className="mt-1 text-[11px] leading-snug text-ink-faint">
        In a browser tab, a swipe down from the top ends fullscreen and the phone&rsquo;s own
        gestures still work. No web page can block those. These two steps do.
      </p>

      <div
        className="mt-3 flex overflow-hidden rounded-lg border border-line"
        role="tablist"
        aria-label="Which device"
      >
        {(["ios", "android", "desktop"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={platform === p}
            onClick={() => setPlatform(p)}
            className={`flex-1 px-2 py-1.5 text-[11px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${
              platform === p ? "bg-elevated text-ink" : "text-ink-faint hover:text-ink"
            }`}
          >
            {PLATFORM_LABEL[p]}
            {detected === p && <span className="sr-only"> (this device)</span>}
          </button>
        ))}
      </div>

      <ol className="mt-3 space-y-3">
        <Step
          n={1}
          title="Install it as an app"
          done={route.kind === "installed" || (here && justInstalled)}
        >
          <p>
            It then opens as the whole screen: no address bar, no tabs and no &ldquo;swipe down to
            exit&rdquo;.
          </p>
          {route.kind === "installed" ? (
            <p className="text-core">Running as an app on this device.</p>
          ) : here && justInstalled ? (
            <p className="text-core">Installed. Open it from the new icon and lock from there.</p>
          ) : route.kind === "prompt" ? (
            <button
              type="button"
              onClick={install}
              className="mt-1 rounded-lg border border-amber-400/50 bg-amber-400/15 px-3 py-1.5 text-[12px] font-semibold text-amber-300 transition hover:bg-amber-400/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            >
              Install Baby No Scroll
            </button>
          ) : (
            <p className="text-ink-muted">{route.steps}</p>
          )}
        </Step>

        <Step n={2} title={pinTitle}>
          <ul className="space-y-1 text-ink-muted">
            {guide.setup.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Row label="Each time">{guide.start}</Row>
          <Row label="Stops">{guide.blocks}</Row>
          <Row label="To get out">{guide.leave}</Row>
        </Step>
      </ol>

      <p className="mt-3 border-t border-line-soft pt-3 text-[11px] leading-snug text-ink-faint">
        Without them the lock still holds: if fullscreen is lost, the next touch puts it back, and a
        reload comes back locked. Only the padlock opens it.
      </p>
    </section>
  );
}

function Step({
  n,
  title,
  done = false,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums ${
          done ? "bg-core/20 text-core" : "bg-amber-400/20 text-amber-300"
        }`}
        aria-hidden
      >
        {done ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 6.5 5 9l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          n
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 text-[11px] leading-snug text-ink-faint">
        <h3 className="text-[12px] font-medium text-ink">
          {title}
          {done && <span className="sr-only"> — done</span>}
        </h3>
        {children}
      </div>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="font-medium text-ink-muted">{label}:</span> {children}
    </p>
  );
}
