"use client";

// ---------------------------------------------------------------------------
// The reel wall — the seven studios, as panels on a monitor wall.
//
// The mechanic: ONLY THE PANEL NEAREST THE POINTER PLAYS. Move the pointer and
// playback travels across the wall; the panel being left behind decays instead
// of stopping dead, so it reads as a light moving over a rack of monitors
// rather than seven videos fighting each other. That is also the performance
// rule — one decoding <video> at a time — which is why the constraint and the
// feel agree instead of trading off, the same bargain the hub carousel struck
// with its one live iframe.
//
// Three smaller things reward poking at it: HOLDING a panel scrubs its clip to
// how long you have held it, so you can see the whole loop without waiting;
// sweeping the pointer FAST leaves a tape-head smear on what it crossed; and
// after eight seconds of stillness playback starts WANDERING on its own, so the
// wall breathes on standby. Clicking does not cut — the panel grows into the
// pane with its clip still running.
//
// None of it is load-bearing. With prefers-reduced-motion, or on a touch
// screen where "nearest the pointer" means nothing, every panel holds its
// poster, the spines stay open so the breadth is still countable, and a play
// button is the way in. The studios are reachable either way.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STUDIOS, type Studio, type StudioId } from "@/lib/studio/studios";
import { Icon } from "../icons";
import "./studio-hub.css";

/** How long a panel keeps its decaying frame after playback has left it. */
const DECAY_MS = 700;
/** Pointer stillness before the wall starts wandering on its own. */
const IDLE_MS = 8000;
/** How long the wall dwells on each panel while wandering. */
const WANDER_MS = 2600;
/** px/ms of pointer travel that counts as a sweep. */
const SMEAR_SPEED = 1.5;
/** A full scrub of the clip, in ms of holding. */
const SCRUB_MS = 1400;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return reduced;
}

interface Opening {
  id: StudioId;
  /** The panel's rect at the moment of the click — the FLIP's "first". */
  from: { top: number; left: number; width: number; height: number };
  arrived: boolean;
}

export function StudioWall({ onOpen }: { onOpen: (id: StudioId, section?: string) => void }) {
  const reduced = useReducedMotion();
  const wallRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<StudioId, HTMLButtonElement>());
  const videoRefs = useRef(new Map<StudioId, HTMLVideoElement>());

  /** The panel that is playing. */
  const [live, setLive] = useState<StudioId | null>(null);
  /** The panel playback just left, still showing its decaying frame. */
  const [ghost, setGhost] = useState<StudioId | null>(null);
  /** The panel being held down, and how far through the scrub it is (0–1). */
  const [held, setHeld] = useState<{ id: StudioId; p: number } | null>(null);
  const [smear, setSmear] = useState(false);
  const [opening, setOpening] = useState<Opening | null>(null);
  /** Clips that 404ed or failed to decode. They fall back to poster, then motif. */
  const [broken, setBroken] = useState<Set<string>>(new Set());
  /** Posters that are not there either. */
  const [noPoster, setNoPoster] = useState<Set<string>>(new Set());
  /**
   * The panel whose preview was asked for explicitly, with the Preview button.
   *
   * It exists for the two cases where the mechanic cannot apply: motion turned
   * off, where nothing may autoplay, and a touch screen, where there is no
   * pointer to be nearest to. An explicit press is consent, so it is the one
   * thing allowed to play under prefers-reduced-motion.
   */
  const [forced, setForced] = useState<StudioId | null>(null);

  // Playback moving off a panel leaves it decaying for a beat. Tracking the
  // previous value here rather than in the move handler means a keyboard focus
  // change decays exactly like a pointer move does.
  const prevLive = useRef<StudioId | null>(null);
  useEffect(() => {
    const leaving = prevLive.current;
    prevLive.current = live;
    if (!leaving || leaving === live) return;
    setGhost(leaving);
    const t = window.setTimeout(() => {
      setGhost((g) => (g === leaving ? null : g));
    }, DECAY_MS);
    return () => window.clearTimeout(t);
  }, [live]);

  /** The panel whose centre is nearest this point. */
  const nearest = useCallback((x: number, y: number): StudioId | null => {
    let best: StudioId | null = null;
    let bestD = Infinity;
    for (const [id, el] of cardRefs.current) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height / 2);
      // Vertical distance is halved: the panels are tall, so a pointer level
      // with a panel's middle should not lose to one in the next column.
      const d = dx * dx + (dy * dy) / 4;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }, []);

  // ---- the pointer drives playback ---------------------------------------
  const lastMove = useRef({ x: 0, y: 0, t: 0 });
  const idleAt = useRef(Date.now());

  useEffect(() => {
    if (reduced) return;
    const wall = wallRef.current;
    if (!wall) return;

    let smearTimer = 0;

    const onMove = (e: PointerEvent) => {
      idleAt.current = Date.now();
      const prev = lastMove.current;
      const dt = e.timeStamp - prev.t;
      if (dt > 0 && prev.t > 0) {
        const dist = Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
        if (dist / dt > SMEAR_SPEED) {
          setSmear(true);
          window.clearTimeout(smearTimer);
          smearTimer = window.setTimeout(() => setSmear(false), 220);
        }
      }
      lastMove.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      const hit = nearest(e.clientX, e.clientY);
      if (hit) setLive(hit);
    };

    // Leaving the wall parks playback rather than freezing it mid-travel.
    const onLeave = () => setLive(null);

    wall.addEventListener("pointermove", onMove, { passive: true });
    wall.addEventListener("pointerleave", onLeave);
    return () => {
      wall.removeEventListener("pointermove", onMove);
      wall.removeEventListener("pointerleave", onLeave);
      window.clearTimeout(smearTimer);
    };
  }, [nearest, reduced]);

  // ---- idle: the wall wanders --------------------------------------------
  useEffect(() => {
    if (reduced || opening) return;
    const tick = window.setInterval(() => {
      if (Date.now() - idleAt.current < IDLE_MS) return;
      setLive((cur) => {
        const i = STUDIOS.findIndex((s) => s.id === cur);
        return STUDIOS[(i + 1) % STUDIOS.length].id;
      });
    }, WANDER_MS);
    return () => window.clearInterval(tick);
  }, [reduced, opening]);

  // ---- hold to scrub -----------------------------------------------------
  useEffect(() => {
    if (!held) return;
    const id = held.id;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = ((now - start) % SCRUB_MS) / SCRUB_MS;
      const v = videoRefs.current.get(id);
      if (v && Number.isFinite(v.duration) && v.duration > 0) {
        v.currentTime = p * v.duration;
      }
      setHeld((h) => (h && h.id === id ? { id, p } : h));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // `held.p` changes every frame; keying on the id alone is what keeps this
    // from tearing the loop down and rebuilding it sixty times a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held?.id]);

  // ---- only one video plays, and never while the tab is hidden -----------
  useEffect(() => {
    const sync = () => {
      const hidden = document.hidden;
      for (const [id, v] of videoRefs.current) {
        const shouldPlay =
          !hidden && id === live && !held && (!reduced || forced === id);
        if (shouldPlay) {
          // A refused autoplay is not an error worth surfacing — the poster is
          // already underneath, so the panel simply stays still.
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [live, held, reduced, forced]);

  // ---- opening a studio --------------------------------------------------
  const open = useCallback(
    (studio: Studio, section?: string) => {
      const el = cardRefs.current.get(studio.id);
      const wall = wallRef.current;
      if (reduced || !el || !wall) {
        onOpen(studio.id, section);
        return;
      }
      const r = el.getBoundingClientRect();
      setOpening({
        id: studio.id,
        from: { top: r.top, left: r.left, width: r.width, height: r.height },
        arrived: false,
      });
      // Two frames: one to put the panel where it already is, one to send it.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setOpening((o) => (o ? { ...o, arrived: true } : o))),
      );
      window.setTimeout(() => onOpen(studio.id, section), 500);
    },
    [onOpen, reduced],
  );

  // Arrow keys walk the wall; the focused panel is the live one, so the
  // keyboard gets the same travelling playback the pointer does.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, i: number) => {
      const go = (j: number) => {
        e.preventDefault();
        const next = STUDIOS[(j + STUDIOS.length) % STUDIOS.length];
        cardRefs.current.get(next.id)?.focus();
        setLive(next.id);
      };
      if (e.key === "ArrowRight" || e.key === "ArrowDown") go(i + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(i - 1);
    },
    [],
  );

  const target = useMemo(() => {
    const wall = wallRef.current;
    if (!wall) return null;
    const r = wall.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }, [opening?.arrived]);

  return (
    <div
      ref={wallRef}
      className={`swall${smear ? " is-smear" : ""}${opening ? " is-opening" : ""}`}
    >
      <header className="swall-head">
        <div>
          <h1 className="swall-title">Studio</h1>
          <p className="swall-sub">
            Seven studios. Each one holds the apps that make its kind of thing — and the one
            nearest your cursor is the one that is playing.
          </p>
        </div>
        <div className="swall-hint">Hold a panel to scrub it</div>
      </header>

      <div className="swall-grid" role="group" aria-label="Studios">
        {STUDIOS.map((studio, i) => {
          const isLive = live === studio.id;
          const isGhost = ghost === studio.id;
          const isOpening = opening?.id === studio.id;
          const clipBroken = broken.has(studio.id);
          const posterBroken = noPoster.has(studio.id);
          const video = studio.clip?.video;
          const poster = studio.clip?.poster;
          // Mount the <video> only for the panel that is playing and the one
          // decaying. Seven video elements, six of them idle, is exactly the
          // cost this wall is built to avoid.
          const wantsVideo =
            !!video && !clipBroken && (isLive || isGhost) && (!reduced || forced === studio.id);

          // The slot owns the studio's hue and its breathing phase; the panel
          // inside it owns only what changes while you interact with it.
          const slotStyle = {
            ["--h"]: studio.hue,
            ["--period"]: `${8 + (i % 3) * 1.6}s`,
            ["--phase"]: i * 1.4,
          } as React.CSSProperties;

          const style: React.CSSProperties = {
            ["--p"]: held?.id === studio.id ? held.p : 0,
          } as React.CSSProperties;
          if (isOpening && opening) {
            const to = opening.arrived && target ? target : opening.from;
            Object.assign(style, {
              top: `${to.top}px`,
              left: `${to.left}px`,
              width: `${to.width}px`,
              height: `${to.height}px`,
              borderRadius: opening.arrived ? "0px" : undefined,
            });
          }

          return (
            <div
              key={studio.id}
              className={[
                "swall-slot",
                isLive ? "is-live" : "",
                isOpening ? "is-source" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={slotStyle}
            >
            <button
              ref={(el) => {
                if (el) cardRefs.current.set(studio.id, el);
                else cardRefs.current.delete(studio.id);
              }}
              type="button"
              className={[
                "swall-card",
                isLive ? "is-live" : "",
                isGhost ? "is-ghost" : "",
                held?.id === studio.id ? "is-held" : "",
                isOpening ? "is-opening" : "",
                isOpening && opening?.arrived ? "is-arrived" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={style}
              aria-label={`${studio.name} — ${studio.tagline}. ${studio.sections.length} apps inside.`}
              onFocus={() => setLive(studio.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              onClick={() => open(studio)}
              onPointerDown={() => setHeld({ id: studio.id, p: 0 })}
              onPointerUp={() => setHeld(null)}
              onPointerCancel={() => setHeld(null)}
            >
              <div className="swall-media">
                {/* The motif is the floor: it is always there, so a missing
                    clip AND a missing poster still leave a panel that is this
                    studio's colour rather than a black rectangle. */}
                <div className="swall-motif" aria-hidden />
                {poster && !posterBroken && (
                  <img
                    className="swall-poster"
                    src={poster}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setNoPoster((s) => new Set(s).add(studio.id))}
                  />
                )}
                {wantsVideo && (
                  <video
                    ref={(el) => {
                      if (el) videoRefs.current.set(studio.id, el);
                      else videoRefs.current.delete(studio.id);
                    }}
                    className="swall-video"
                    src={video}
                    poster={poster}
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    onError={() => setBroken((s) => new Set(s).add(studio.id))}
                  />
                )}
                <div className="swall-dither" aria-hidden />
              </div>

              <span className="swall-scrub" aria-hidden />

              {/* The panel's name on its side, for when it is 150px wide.
                  It crossfades out as the horizontal block fades in. */}
              <div className="swall-vname" aria-hidden>
                <span>{studio.name}</span>
              </div>

              <div className="swall-body">
                <div className="swall-name">{studio.name}</div>
                <div className="swall-tag">{studio.tagline}</div>
                <div className="swall-spines">
                  {studio.sections.map((s) => {
                    const Glyph = Icon[s.icon as keyof typeof Icon] ?? Icon.Square;
                    return (
                      <span key={s.id} className="swall-spine">
                        <span className="swall-spine-dot" aria-hidden />
                        <Glyph aria-hidden />
                        {s.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            </button>
            {/* Outside the panel, not inside it: a button cannot nest in a
                button. This is the way in where "nearest the pointer" means
                nothing — a touch screen, or motion turned off. */}
            <button
              type="button"
              className="swall-play"
              aria-pressed={forced === studio.id}
              onClick={() => {
                setForced((f) => (f === studio.id ? null : studio.id));
                setLive((cur) => (cur === studio.id && forced === studio.id ? null : studio.id));
              }}
            >
              <Icon.Play aria-hidden />
              {forced === studio.id ? "Stop" : "Preview"}
            </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
