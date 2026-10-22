"use client";

// ---------------------------------------------------------------------------
// App Builder, opened INSIDE Jarvis.
//
// The owner's rule: when chat is asked to make an app, Jarvis pulls App
// Builder up for the user — it never just hands back a link to go find. So
// the `app_builder` tool opens this sheet the moment the project exists:
//
//   - phone: full screen (safe-area aware), one thumb to shrink or close
//   - laptop: a wide sheet over Jarvis, chat still behind it
//
// Shrinking keeps App Builder loaded (its super agent keeps working) and
// leaves a pill at the top to bring it back. "Full page" leaves Jarvis for
// /apps/app-builder in the same tab — the chat is saved, so nothing is lost.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { useTopEscape } from "./Widgets";

export interface BuilderView {
  url: string;
  name: string;
  /** Bumps each hand-off so the same project re-opened still reloads. */
  n: number;
}

export function AppBuilderSheet({
  view,
  minimized,
  onMinimize,
  onRestore,
  onClose,
}: {
  view: BuilderView;
  minimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [view.n]);

  // A phone scrolls the page behind a fixed sheet unless it is told not to.
  useEffect(() => {
    if (minimized) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [minimized]);

  return (
    <>
      {minimized && <BuilderPill name={view.name} onOpen={onRestore} onClose={onClose} />}
      <div
        className="deck z-[60] flex items-stretch justify-center sm:items-center sm:p-4"
        style={{
          // Inline on purpose: the shared .deck rule sets position:relative
          // and would otherwise drop this sheet into the page's flow.
          position: "fixed",
          inset: 0,
          background: "rgb(0 0 0 / 0.72)",
          minHeight: 0,
          // Hidden, not unmounted: the super agent inside keeps working.
          display: minimized ? "none" : undefined,
        }}
        role="dialog"
        aria-modal={!minimized}
        aria-label={`App Builder — ${view.name}`}
        onClick={(e) => e.target === e.currentTarget && onMinimize()}
      >
        {!minimized && <EscapeShrinks onEscape={onMinimize} />}
        <div
          className="deck-glass deck-ring nj-abs-sheet flex h-[100dvh] w-full flex-col overflow-hidden sm:h-[94dvh] sm:max-w-7xl"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <header className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5 sm:gap-2 sm:px-4 sm:py-2.5">
            <button
              type="button"
              onClick={onMinimize}
              aria-label="Back to chat (App Builder keeps working)"
              title="Back to chat — App Builder keeps working"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-panel-2 hover:text-ink"
            >
              <Icon.ArrowLeft width={16} height={16} aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <p className="deck-kicker truncate">
                App Builder<span className="hidden sm:inline"> · from your chat</span>
              </p>
              <h2 className="deck-display truncate text-[15px] font-semibold text-ink sm:text-[17px]">{view.name}</h2>
            </div>
            <a
              href={view.url}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] text-ink-muted hover:bg-panel-2 hover:text-ink"
              title="Open App Builder as its own page"
            >
              <Icon.Launch width={14} height={14} aria-hidden />
              <span className="hidden sm:inline">Full page</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close App Builder"
              title="Close (your project stays in App Builder)"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-panel-2 hover:text-ink"
            >
              <Icon.Close width={14} height={14} aria-hidden />
            </button>
          </header>
          <div className="relative min-h-0 flex-1" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            {!loaded && (
              <div className="absolute inset-0 grid place-items-center text-sm text-ink-muted" aria-live="polite">
                Opening App Builder…
              </div>
            )}
            <iframe
              key={view.n}
              src={view.url}
              title={`App Builder — ${view.name}`}
              className="block h-full w-full border-0"
              style={{ opacity: loaded ? 1 : 0, transition: "opacity .25s" }}
              allow="microphone; camera; clipboard-read; clipboard-write; fullscreen"
              onLoad={() => setLoaded(true)}
            />
          </div>
        </div>
      </div>
    </>
  );
}

/** Escape shrinks the sheet (never throws the project away). */
function EscapeShrinks({ onEscape }: { onEscape: () => void }) {
  useTopEscape(onEscape);
  return null;
}

/** The shrunk sheet: a pill at the top, clear of the chat box and the phone's tab bar. */
function BuilderPill({ name, onOpen, onClose }: { name: string; onOpen: () => void; onClose: () => void }) {
  return (
    <div
      className="z-[60] flex max-w-[calc(100vw-24px)] items-center gap-1 rounded-full border border-line bg-panel/95 py-1 pl-1 pr-1 shadow-lg backdrop-blur"
      style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", top: "calc(env(safe-area-inset-top) + 10px)" }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex h-10 min-w-0 items-center gap-2 rounded-full px-3 text-[13px] text-ink hover:bg-panel-2"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
        <span className="truncate">
          App Builder · <b className="font-semibold">{name}</b>
        </span>
        <span className="shrink-0 text-ink-muted">Open</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss App Builder"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-panel-2 hover:text-ink"
      >
        <Icon.Close width={12} height={12} aria-hidden />
      </button>
    </div>
  );
}
