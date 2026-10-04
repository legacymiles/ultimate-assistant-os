"use client";

// ---------------------------------------------------------------------------
// The dock — one status line across the bottom, where the right column was.
//
// That column cost 300px of the widest thing on the surface to say two things
// the owner needs about once a session: is voice on, and can it reach this PC.
// A console is read left to right across its full width; a permanent column on
// the right is a tax on every block, every table and every screenshot. So the
// two facts move to a strip that is one line tall and the whole width, and the
// detail behind them is one click away rather than permanently on screen.
//
// It is not a decoration. The rim takes the colour of whoever is talking, so
// the ROOM changes while Jarvis answers and not just a widget in the corner —
// and when it cannot reach the PC it says which capability is missing and what
// to run, because that is the moment the detail is worth the space.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import { BridgePanel } from "./SidePanels";
import type { BridgeHealth } from "@/lib/new-jarvis/bridge";
import type { UseWakeVoice } from "@/lib/new-jarvis/useWakeVoice";

const CAP_KEYS = ["browser", "shell", "files", "system"] as const;

interface Props {
  voice: UseWakeVoice;
  health: BridgeHealth;
  ready: boolean;
  hasToken: boolean;
  onPair: (token: string) => void;
  onUnpair: () => void;
  onRefresh: () => void;
  /** Blocks currently running, so the dock can say so without a tab change. */
  running: number;
  /** Rows in the queue that are not finished. The one number worth a glance. */
  queued: number;
  onQueue: () => void;
}

export function StatusDock({
  voice,
  health,
  ready,
  hasToken,
  onPair,
  onUnpair,
  onRefresh,
  running,
  queued,
  onQueue,
}: Props) {
  const [open, setOpen] = useState(false);
  const caps = health.capabilities;
  const usable = health.up && health.paired;
  const readyCount = caps ? CAP_KEYS.filter((k) => caps[k] === true).length : 0;

  const pc = !ready
    ? "checking this PC"
    : !health.up
      ? "PC not reachable"
      : !health.paired
        ? "PC not paired"
        : `${readyCount} of 4 ready on this PC`;

  return (
    <div className="nj-dock" data-state={voice.state}>
      {/* The expanded half sits ABOVE the line, so opening it never moves the
          line itself — the thing you just clicked stays under your cursor. */}
      {open && (
        <div className="nj-dock__sheet">
          <BridgePanel
            health={health}
            ready={ready}
            hasToken={hasToken}
            onPair={onPair}
            onUnpair={onUnpair}
            onRefresh={onRefresh}
          />
        </div>
      )}

      <div className="nj-dock__line">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="nj-dock__btn"
        >
          <span className={`nj-dot ${usable ? "bg-core" : "bg-ink-faint/50"}`} aria-hidden />
          <span className="nj-dock__label" data-num>
            {pc}
          </span>
          <Icon.Chevron
            width={10}
            height={10}
            className={`text-ink-faint transition-transform ${open ? "-rotate-90" : "rotate-90"}`}
            aria-hidden
          />
        </button>

        <span className="nj-dock__rule" aria-hidden />

        {/* Voice state as a word, not only a dot. The orb carries the live
            picture; this carries the fact, for anyone reading rather than
            watching. */}
        <span className="nj-dock__item">
          <span
            className={`nj-dot ${voice.listening ? "bg-core" : "bg-ink-faint/50"}`}
            data-live={voice.state === "hearing" || voice.state === "speaking" ? "true" : undefined}
            aria-hidden
          />
          <span className="nj-dock__label">
            {voice.state === "off"
              ? "voice off"
              : voice.state === "waiting"
                ? "waiting for its name"
                : voice.state === "hearing"
                  ? "listening"
                  : voice.state === "thinking"
                    ? "thinking"
                    : "speaking"}
          </span>
        </span>

        {running > 0 && (
          <>
            <span className="nj-dock__rule" aria-hidden />
            <span className="nj-dock__item">
              <span className="nj-dot bg-brand-2" data-live="true" aria-hidden />
              <span className="nj-dock__label" data-num>
                {running} running
              </span>
            </span>
          </>
        )}

        <button
          type="button"
          onClick={onQueue}
          className="nj-dock__btn nj-dock__queue"
          title="Open In Queue"
        >
          <span className="nj-pip nj-pip-wip" aria-hidden />
          <span className="nj-dock__label" data-num>
            {queued} in the queue
          </span>
        </button>
      </div>
    </div>
  );
}
