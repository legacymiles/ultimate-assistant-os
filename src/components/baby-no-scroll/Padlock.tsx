"use client";

// ---------------------------------------------------------------------------
// The padlock — the only thing on a locked screen that answers to a touch.
//
// It is machined steel sitting in a warm nursery, and that is a security
// decision rather than a styling one: a baby reaches for saturated warm colour
// and reads cool grey metal as furniture. The brightest thing on the screen is
// always the balloon or the video, never the way out.
//
// Three gestures, one object:
//
//   tap           two dotted paths appear, along two edges of the screen
//   triple tap    the lock arcs to the next corner, uncovering what it was over
//   drag          along the first dotted path, round the corner, then along the
//                 second one to the far corner — and it opens
//
// The angle is the whole safeguard (owner, Nov 2026: "so its not easy for
// babies to follow and do"). A thumb dragged across a phone travels one way
// and stops; it does not turn a corner on purpose.
//
// Nothing lights up while it is being dragged, and nothing is drawn behind the
// puck (owner, Nov 2026: "it shouldnt glow and show the line while
// unlocking"). The dots are the only mark on the screen, they do not change,
// and the drag has to follow them within a fingertip — stray off, and the lock
// goes home. Letting go anywhere at all, on the puck or off it, sends it home
// too: the window hears the release, not just the puck, so a finger that slips
// off the edge of the screen can never leave the lock parked mid-path.
//
// The geometry and the thresholds all live in src/lib/baby-no-scroll/lock.ts,
// where they are tested; what is here is the gesture and the drawing of it.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DRAG_SLOP_PX,
  HOLD_MS,
  RAIL_IDLE_MS,
  START,
  TRIPLE_WINDOW_MS,
  advance,
  distance,
  isDone,
  nextCorner,
  pathFor,
  pointAt,
  tapAction,
  type Step,
  type Vec,
} from "@/lib/baby-no-scroll/lock";
import { refuse, unlatch } from "@/lib/baby-no-scroll/audio";
import type { Corner } from "@/lib/baby-no-scroll/types";

interface Props {
  corner: Corner;
  onMoveCorner: (next: Corner) => void;
  onUnlock: () => void;
  holdToConfirm: boolean;
  size: "small" | "large";
}

/** A keyboard hold has to be longer than a drag-hold: it is one key, not a journey. */
const KEY_HOLD_MS = HOLD_MS * 2;

export function Padlock({ corner, onMoveCorner, onUnlock, holdToConfirm, size }: Props) {
  const [vp, setVp] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [railOpen, setRailOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<Step>(START);
  const [hold, setHold] = useState(0);
  const [opening, setOpening] = useState(false);
  const [knock, setKnock] = useState(false);

  const start = useRef<Vec>({ x: 0, y: 0 });
  const taps = useRef(0);
  const tapTimer = useRef<number | null>(null);
  const idleTimer = useRef<number | null>(null);
  const moved = useRef(false);
  // The drag reads where it HAS got to, so the turn cannot be undone by a
  // finger sliding back; state lags a pointermove, so it is kept here too.
  const stepRef = useRef<Step>(START);
  const setBoth = (s: Step) => {
    stepRef.current = s;
    setStep(s);
  };

  const puck = size === "large" ? 92 : 64;
  const inset = puck / 2 + 16;
  const path = pathFor(corner, vp.w || 1, vp.h || 1, inset);
  const at = pointAt(path, step);
  const atEnd = isDone(step);

  // --- the viewport, which rotates and resizes under a child ---------------
  useEffect(() => {
    const read = () =>
      setVp({
        // visualViewport is the honest number on mobile: innerHeight still
        // counts the space a collapsed browser bar is about to take back.
        w: Math.round(window.visualViewport?.width ?? window.innerWidth),
        h: Math.round(window.visualViewport?.height ?? window.innerHeight),
      });
    read();
    window.addEventListener("resize", read);
    window.visualViewport?.addEventListener("resize", read);
    return () => {
      window.removeEventListener("resize", read);
      window.visualViewport?.removeEventListener("resize", read);
    };
  }, []);

  const clearIdle = () => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = null;
  };

  const openRail = useCallback(() => {
    setRailOpen(true);
    clearIdle();
    idleTimer.current = window.setTimeout(() => setRailOpen(false), RAIL_IDLE_MS);
  }, []);

  const closeRail = useCallback(() => {
    clearIdle();
    setRailOpen(false);
  }, []);

  useEffect(() => () => {
    clearIdle();
    if (tapTimer.current) window.clearTimeout(tapTimer.current);
  }, []);

  const open = useCallback(() => {
    if (opening) return;
    setOpening(true);
    setHold(0);
    unlatch();
    // The shackle pops, the paths bloom, and only then does the stage go. The
    // parent needs to see that the lock opened rather than that the app blinked.
    window.setTimeout(onUnlock, 560);
  }, [onUnlock, opening]);

  // --- the hold at the end -------------------------------------------------
  useEffect(() => {
    if (!holdToConfirm || !dragging || !atEnd || opening) {
      setHold(0);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / HOLD_MS);
      setHold(k);
      if (k >= 1) {
        open();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [atEnd, dragging, holdToConfirm, open, opening]);

  const springBack = useCallback(() => {
    setBoth(START);
    setHold(0);
    setKnock(true);
    refuse();
    window.setTimeout(() => setKnock(false), 420);
  }, []);

  // --- the end of a drag, wherever the finger happens to be ----------------
  //
  // Owner, Nov 2026: "lock resets back to base position when it is let go".
  // Not "when it is let go ON the puck" — a drag that ends with the finger off
  // the side of the screen, a pointer the browser cancels, or the app losing
  // the window has to put the lock home just the same, or it sits parked
  // halfway along the path waiting to be nudged the rest of the way.
  const endDrag = useCallback(() => {
    if (!moved.current) return;
    moved.current = false;
    setDragging(false);
    if (opening) return;
    // With holding switched off, arriving IS finishing — the turn was the
    // test. With it on, arriving and then letting go is a thumb sliding off
    // rather than a decision, so it goes home.
    if (isDone(stepRef.current) && !holdToConfirm) open();
    else springBack();
    openRail();
  }, [holdToConfirm, open, opening, openRail, springBack]);

  useEffect(() => {
    if (!dragging) return;
    const release = () => endDrag();
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    // Backgrounded mid-drag (a call, the app switcher): the release is never
    // delivered at all, so the lock would still be out when the parent looks.
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [dragging, endDrag]);

  // --- pointer -------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (opening) return;
    e.preventDefault();
    e.stopPropagation();
    // Capture keeps the drag alive when the finger leaves the puck, which it
    // does immediately. It throws for a pointer the browser no longer knows
    // about, and a thrown handler here would leave the lock mid-gesture.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* the drag still works, it just ends if the finger leaves the element */
    }
    start.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (opening) return;
    const p = { x: e.clientX, y: e.clientY };
    if (!moved.current && distance(p, start.current) > DRAG_SLOP_PX) {
      moved.current = true;
      setDragging(true);
      openRail();
      // A drag is not a tap, so a run of taps in progress is abandoned.
      taps.current = 0;
    }
    if (!moved.current) return;
    e.preventDefault();
    setBoth(advance(path, stepRef.current, p));
    clearIdle();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* already released, or a pointer the browser has forgotten */
    }
    if (opening) return;
    // A drag is ended by endDrag, on the window — see the effect below. This
    // event bubbles up to it, so doing it here as well would do it twice.
    if (moved.current) return;

    taps.current += 1;
    const action = tapAction(taps.current);
    if (action === "show-rail") openRail();
    if (action === "move-corner") {
      taps.current = 0;
      closeRail();
      setBoth(START);
      onMoveCorner(nextCorner(corner));
    }
    if (tapTimer.current) window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => {
      taps.current = 0;
    }, TRIPLE_WINDOW_MS);
  };

  // --- keyboard ------------------------------------------------------------
  // The locked screen swallows every key except on this element, so this is the
  // whole keyboard route out: focus the lock, hold Enter. It is slower than the
  // drag on purpose — one key held is a much easier accident than a traverse.
  const keyRaf = useRef(0);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (keyRaf.current || opening) return;
    openRail();
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / KEY_HOLD_MS);
      // The key travels the same two legs, so the drawing has one story only.
      setBoth(k < 0.5 ? { leg: 0, t: k * 2 } : { leg: 1, t: (k - 0.5) * 2 });
      setHold(k);
      if (k >= 1) {
        keyRaf.current = 0;
        open();
        return;
      }
      keyRaf.current = requestAnimationFrame(tick);
    };
    keyRaf.current = requestAnimationFrame(tick);
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!keyRaf.current) return;
    cancelAnimationFrame(keyRaf.current);
    keyRaf.current = 0;
    if (!opening) springBack();
  };

  if (!vp.w) return null;

  const end = path.legs[1].to;

  return (
    <div className="bns-lock-layer" aria-live="polite">
      {/* The two dotted legs. Axis-aligned by construction, so each is a div
          and not a path — which is also why the lit part can be a gradient.
          Widely spaced dots, not a line: something to aim along rather than a
          stripe a baby can trace with a finger. */}
      {path.legs.map((leg, i) => {
        const horizontal = leg.axis === "x";
        return (
          <div
            key={i}
            className={`bns-leg ${railOpen ? "is-open" : ""} ${horizontal ? "is-x" : "is-y"}`}
            style={{
              left: horizontal ? Math.min(leg.from.x, leg.to.x) : leg.from.x,
              top: horizontal ? leg.from.y : Math.min(leg.from.y, leg.to.y),
              width: horizontal ? leg.length : undefined,
              height: horizontal ? undefined : leg.length,
            }}
            aria-hidden
          >
            <div className="bns-leg__dots" />
          </div>
        );
      })}

      {/* The corner the swipe has to turn at, and the corner it ends in. Both
          are plain unlit marks: they say where, never how far you have got. */}
      <div
        className={`bns-elbow ${railOpen ? "is-open" : ""}`}
        style={{ left: path.legs[1].from.x, top: path.legs[1].from.y }}
        aria-hidden
      />

      {/* The end. Its ring only exists while a parent's hold is being counted;
          the rest of the time it is the same dim mark as the corner. */}
      <div
        className={`bns-latch ${railOpen ? "is-open" : ""} ${hold > 0 ? "is-holding" : ""}`}
        style={{ left: end.x, top: end.y, ["--hold" as string]: hold }}
        aria-hidden
      >
        <svg viewBox="0 0 48 48" className="bns-latch__ring">
          <circle className="bns-latch__ring-fg" cx="24" cy="24" r="21" />
        </svg>
      </div>

      <button
        type="button"
        data-baby-lock="1"
        className={`bns-puck ${dragging ? "is-dragging" : ""} ${opening ? "is-open" : ""} ${
          knock ? "is-knock" : ""
        }`}
        style={{
          left: at.x,
          top: at.y,
          width: puck,
          height: puck,
          ["--hold" as string]: hold,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        aria-label={
          opening
            ? "Unlocked"
            : "Screen locked. Drag this lock along the dots to the corner, then turn and follow the second line of dots to the far corner to unlock. Or hold Enter. Triple-tap to move it to another corner."
        }
      >
        <svg viewBox="0 0 48 48" className="bns-puck__art" aria-hidden>
          {/* The shackle is its own group so it can lift and rotate on opening. */}
          <g className="bns-puck__shackle">
            <path
              d="M16 22v-5a8 8 0 0 1 16 0v5"
              fill="none"
              strokeWidth="4.5"
              strokeLinecap="round"
            />
          </g>
          <rect className="bns-puck__body" x="11" y="21" width="26" height="19" rx="5" />
          <circle className="bns-puck__keyhole" cx="24" cy="29" r="2.6" />
          <path className="bns-puck__keyhole" d="M24 30.5v5" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
        <span className="bns-puck__breathe" aria-hidden />
      </button>
    </div>
  );
}
