"use client";

// ---------------------------------------------------------------------------
// The password gate — the parent's way off a locked screen.
//
// Two locks in series, each one aimed at a different small person:
//
//   1. A steel key-button in a corner that must be HELD for over a second
//      before anything happens. A baby taps and slaps; a baby does not press
//      and wait. A tap gives one small wiggle and nothing else, so there is no
//      reward for finding it.
//   2. A number pad the app draws itself, asking for the password the parent
//      set before handing over. The phone's own keyboard never opens. Three
//      wrong guesses and the pad makes you wait — 30 s, then longer — which is
//      a speed bump for a fumbling parent and a wall for a mashing hand.
//
// The pad closes itself after 20 s untouched, so if a toddler does manage the
// hold, what they find is a dark panel that quietly goes away again.
//
// Triple-tapping the key moves it to the next corner, the same as the padlock.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { lockAnchor, nextCorner, TRIPLE_WINDOW_MS } from "@/lib/baby-no-scroll/lock";
import { lockoutMs } from "@/lib/baby-no-scroll/password";
import { refuse, tone, unlatch, wakeAudio } from "@/lib/baby-no-scroll/audio";
import type { Corner } from "@/lib/baby-no-scroll/types";

interface Props {
  corner: Corner;
  size: "small" | "large";
  /** Digits in the stored password, so the pad checks the moment the last one lands. */
  passLength: number;
  check: (pin: string) => Promise<boolean>;
  onMoveCorner: (next: Corner) => void;
  onUnlock: () => void;
}

/** Long enough that no slap is a hold; short enough that a parent does not wonder. */
const HOLD_MS = 1200;
const PAD_IDLE_MS = 20_000;
const FAILS_KEY = "baby-no-scroll:fails";

interface Fails {
  count: number;
  until: number;
}

function readFails(): Fails {
  try {
    const raw = JSON.parse(sessionStorage.getItem(FAILS_KEY) ?? "null") as Partial<Fails> | null;
    if (raw && typeof raw.count === "number" && typeof raw.until === "number") return raw as Fails;
  } catch {}
  return { count: 0, until: 0 };
}

function writeFails(f: Fails): void {
  try {
    if (f.count === 0) sessionStorage.removeItem(FAILS_KEY);
    else sessionStorage.setItem(FAILS_KEY, JSON.stringify(f));
  } catch {}
}

export function PasswordGate({ corner, size, passLength, check, onMoveCorner, onUnlock }: Props) {
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [holding, setHolding] = useState(false);
  const [wiggle, setWiggle] = useState(0);
  const [open, setOpen] = useState(false);

  const holdTimer = useRef<number | null>(null);
  const taps = useRef(0);
  const tapTimer = useRef<number | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    const read = () =>
      setVp({
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

  const puck = size === "large" ? 76 : 56;
  const at = lockAnchor(corner, vp.w || 1, vp.h || 1, puck / 2 + 16);

  const cancelHold = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHolding(false);
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    wakeAudio();
    opened.current = false;
    setHolding(true);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      opened.current = true;
      setHolding(false);
      tone(523.25, { type: "sine", duration: 0.25, gain: 0.18, reverb: 0 });
      setOpen(true);
    }, HOLD_MS);
  };

  const onUp = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const wasHold = opened.current;
    cancelHold();
    if (wasHold) return;
    // A tap: one wiggle, and count it towards a triple-tap.
    setWiggle((n) => n + 1);
    taps.current += 1;
    if (tapTimer.current) window.clearTimeout(tapTimer.current);
    if (taps.current >= 3) {
      taps.current = 0;
      onMoveCorner(nextCorner(corner));
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      taps.current = 0;
    }, TRIPLE_WINDOW_MS);
  };

  useEffect(
    () => () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
    },
    [],
  );

  return (
    <div className="bns-lock-layer">
      <button
        type="button"
        data-baby-lock="1"
        aria-label="Parent lock — press and hold to enter the password"
        className={`bns-gate ${holding ? "is-holding" : ""}`}
        key={`w${wiggle}`}
        style={{
          left: at.x,
          top: at.y,
          width: puck,
          height: puck,
          // Hidden until the screen has been measured, so it never glides in
          // from the top-left on the first frame.
          visibility: vp.w ? "visible" : "hidden",
          ["--hold" as string]: `${HOLD_MS}ms`,
        }}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg className="bns-gate__ring" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="46" pathLength={100} />
        </svg>
        <svg className="bns-gate__icon" viewBox="0 0 24 24" aria-hidden>
          <path d="M7 10V7.5a5 5 0 0 1 10 0V10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <rect x="4.5" y="10" width="15" height="11" rx="3" fill="currentColor" />
          <circle cx="12" cy="15" r="1.6" fill="#1b1f27" />
          <path d="M12 16v2.2" stroke="#1b1f27" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <Keypad
          passLength={passLength}
          check={check}
          onClose={() => setOpen(false)}
          onUnlock={onUnlock}
        />
      )}
    </div>
  );
}

// --- the pad ----------------------------------------------------------------

function Keypad({
  passLength,
  check,
  onClose,
  onUnlock,
}: {
  passLength: number;
  check: (pin: string) => Promise<boolean>;
  onClose: () => void;
  onUnlock: () => void;
}) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [fails, setFails] = useState<Fails>({ count: 0, until: 0 });
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement | null>(null);
  const idle = useRef<number | null>(null);
  // The digits live in a ref as well as state: the check must start exactly
  // once per attempt, and a side effect inside a state updater runs twice in
  // React's strict mode — which counted one wrong guess as two.
  const typed = useRef("");
  const checking = useRef(false);

  const waitMs = Math.max(0, fails.until - now);
  const waiting = waitMs > 0;

  useEffect(() => {
    setFails(readFails());
    root.current?.focus();
  }, []);

  // The countdown only ticks while there is one.
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [waiting]);

  const bump = useCallback(() => {
    if (idle.current) window.clearTimeout(idle.current);
    idle.current = window.setTimeout(onClose, PAD_IDLE_MS);
  }, [onClose]);

  useEffect(() => {
    bump();
    return () => {
      if (idle.current) window.clearTimeout(idle.current);
    };
  }, [bump]);

  const submit = useCallback(
    async (candidate: string) => {
      if (checking.current) return;
      checking.current = true;
      setBusy(true);
      const ok = await check(candidate);
      checking.current = false;
      setBusy(false);
      if (ok) {
        writeFails({ count: 0, until: 0 });
        setDone(true);
        unlatch();
        window.setTimeout(onUnlock, 420);
        return;
      }
      refuse();
      setShake((n) => n + 1);
      typed.current = "";
      setPin("");
      const count = readFails().count + 1;
      const next = { count, until: Date.now() + lockoutMs(count) };
      writeFails(next);
      setFails(next);
      setNow(Date.now());
    },
    [check, onUnlock],
  );

  const press = useCallback(
    (d: string) => {
      bump();
      if (busy || done || waiting) return;
      tone(880 + Number(d) * 24, { type: "sine", duration: 0.07, gain: 0.08, reverb: 0 });
      if (checking.current) return;
      const next = (typed.current + d).slice(0, 8);
      typed.current = next;
      setPin(next);
      // Checks the moment the last digit lands, so there is no Enter key for
      // a small hand to find.
      if (passLength > 0 && next.length === passLength) void submit(next);
    },
    [bump, busy, done, waiting, passLength, submit],
  );

  const back = useCallback(() => {
    bump();
    typed.current = typed.current.slice(0, -1);
    setPin(typed.current);
  }, [bump]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      press(e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      back();
    }
  };

  // Pointer, not click: the lock swallows a second touchend inside 320 ms
  // (double-tap zoom), and a click that never fires is a key that does nothing
  // for a parent typing quickly.
  const hit = (fn: () => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  const dots = Math.max(passLength, pin.length, 4);

  return (
    <div
      ref={root}
      className={`bns-pad ${done ? "is-done" : ""}`}
      data-baby-lock="1"
      tabIndex={-1}
      role="dialog"
      aria-label="Enter the parent password"
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        // A touch on the dimmed backdrop closes it; a touch on the card does not.
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bns-pad__card" key={`s${shake}`} data-shake={shake > 0 ? "1" : undefined}>
        <svg className="bns-pad__lock" viewBox="0 0 24 24" aria-hidden>
          <path
            className="bns-pad__shackle"
            d="M7 10V7.5a5 5 0 0 1 10 0V10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <rect x="4.5" y="10" width="15" height="11" rx="3" fill="currentColor" />
        </svg>
        <p className="bns-pad__title">{done ? "Unlocked" : "Parent password"}</p>
        <div className="bns-pad__dots" aria-live="polite" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: dots }, (_, i) => (
            <span key={i} className={i < pin.length ? "is-on" : ""} />
          ))}
        </div>
        <p className="bns-pad__note" aria-live="polite">
          {waiting
            ? `Too many tries — wait ${Math.ceil(waitMs / 1000)} s`
            : fails.count > 0
              ? "Not that one. Try again."
              : " "}
        </p>

        <div className={`bns-pad__grid ${waiting ? "is-waiting" : ""}`}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} type="button" tabIndex={-1} onPointerDown={hit(() => press(d))}>
              {d}
            </button>
          ))}
          <button type="button" tabIndex={-1} className="is-quiet" aria-label="Close" onPointerDown={hit(onClose)}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" tabIndex={-1} onPointerDown={hit(() => press("0"))}>
            0
          </button>
          <button type="button" tabIndex={-1} className="is-quiet" aria-label="Delete" onPointerDown={hit(back)}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path
                d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7 6-7zM12 9l6 6M18 9l-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        {passLength === 0 && (
          <button type="button" tabIndex={-1} className="bns-pad__enter" onPointerDown={hit(() => void submit(pin))}>
            Unlock
          </button>
        )}
      </div>
    </div>
  );
}
