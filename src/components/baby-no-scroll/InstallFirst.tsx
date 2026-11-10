"use client";

// ---------------------------------------------------------------------------
// Install first — what Hand it over shows on a phone that is still in a tab.
//
// Locking in a Chrome tab cannot be made right: Chrome shows "swipe down to
// exit full screen" every time and brings its bar back on one swipe, on every
// website, and no page can turn either off. The owner tried the tab lock, saw
// both, and called it broken (2026-11-09) — fairly. So on a phone the tab lock
// is no longer the default: this screen stops the hand-over and sends the
// parent to the installed app, where the page is the whole screen and only the
// padlock opens it. Locking in the tab anyway is still one tap, because a
// parent with a crying baby must never be stuck behind a setup step.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { installRoute, type Platform } from "@/lib/baby-no-scroll/device";
import { useInstall } from "@/lib/baby-no-scroll/useInstall";

interface Props {
  platform: Platform;
  onLockAnyway: () => void;
  onClose: () => void;
}

export function InstallFirst({ platform, onLockAnyway, onClose }: Props) {
  const { canPrompt, justInstalled, install } = useInstall();
  const primary = useRef<HTMLButtonElement | null>(null);
  const route = installRoute(platform, false, canPrompt);

  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bns-install-title"
        className="w-full max-w-md rounded-t-2xl border border-line bg-panel p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,0.45)] sm:rounded-2xl sm:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="bns-install-title" className="text-base font-semibold text-ink">
          Full screen needs the app
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          In a browser tab, Chrome always shows &ldquo;swipe down to exit full screen&rdquo; and
          brings its bar back on a swipe. No website can turn that off &mdash; YouTube&rsquo;s website
          gets the same message; the YouTube app does not.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          Installed, Baby No Scroll opens from its own icon as the whole screen: no bar, no message,
          and only the padlock opens it.
        </p>

        <div className="mt-4 rounded-xl border border-line bg-canvas/60 p-3.5">
          {justInstalled ? (
            <p className="text-[13px] leading-relaxed text-core">
              Installed. Close Chrome, open <strong>No Scroll</strong> from your home screen, and
              press Hand it over there.
            </p>
          ) : route.kind === "prompt" ? (
            <button
              ref={primary}
              type="button"
              onClick={install}
              className="bns-handover w-full rounded-xl px-4 py-3 text-sm font-semibold"
            >
              Install Baby No Scroll
            </button>
          ) : (
            <p className="text-[13px] leading-relaxed text-ink">
              {route.kind === "manual" ? route.steps : null} Then press Hand it over in the app.
            </p>
          )}
          {platform === "android" && !justInstalled && (
            <p className="mt-2.5 text-[11px] leading-snug text-ink-faint">
              Already added an icon and it still opens with Chrome&rsquo;s bar? That one is a plain
              shortcut. Long-press it, remove it, and install again from here.
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            ref={route.kind === "prompt" && !justInstalled ? undefined : primary}
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-[12px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onLockAnyway}
            className="rounded-lg border border-line px-3 py-2 text-[12px] text-ink-faint transition hover:border-ink-faint hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            Lock in this tab anyway
          </button>
        </div>
      </div>
    </div>
  );
}
