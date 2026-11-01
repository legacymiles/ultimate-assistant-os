"use client";

// ---------------------------------------------------------------------------
// The reel wall — the studios, as panels on a monitor wall.
//
// The mechanic: ONLY THE PANEL NEAREST THE POINTER PLAYS. Move the pointer and
// playback travels across the wall; the panel being left behind decays instead
// of stopping dead, so it reads as a light moving over a rack of monitors
// rather than several videos fighting each other. That is also the performance
// rule — one decoding <video> at a time — which is why the constraint and the
// feel agree instead of trading off.
//
// Narrow panels only work because the one you point at opens: the live slot
// takes nearly three shares of the row and its neighbours give way. Collapsed,
// a panel shows its name set on its side, which is the only way a two-word
// studio name fits across 150px without being shrunk to nothing.
//
// Two smaller things reward poking at it: HOLDING a panel scrubs its clip to
// how long you have held it, and after eight seconds of stillness playback
// starts WANDERING on its own, so the rack breathes on standby.
//
// None of it is load-bearing. Under prefers-reduced-motion the row wraps to a
// grid, every panel holds its poster with its name and contents written out,
// and a Preview button is the way to play one. The studios are reachable
// either way, which is the only thing that matters.
// ---------------------------------------------------------------------------

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wallCards, type WallCard } from "@/lib/studio-home/wall";
import { Icon } from "../icons";
import "./studio-hub.css";

/** How long a panel keeps its decaying frame after playback has left it. */
const DECAY_MS = 700;
/** Pointer stillness before the wall starts wandering on its own. */
const IDLE_MS = 8000;
/** How long the wall dwells on each panel while wandering. */
const WANDER_MS = 2600;
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

export function StudioWall({ onOpenWorkflows }: { onOpenWorkflows: () => void }) {
  const cards = useMemo(wallCards, []);
  const router = useRouter();
  const reduced = useReducedMotion();
  const wallRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());

  const [live, setLive] = useState<string | null>(null);
  const [ghost, setGhost] = useState<string | null>(null);
  const [held, setHeld] = useState<{ id: string; p: number } | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [noPoster, setNoPoster] = useState<Set<string>>(new Set());
  /**
   * The panel whose preview was asked for explicitly.
   *
   * It exists for the two cases the mechanic cannot cover: motion turned off,
   * where nothing may autoplay, and a touch screen, where there is no pointer
   * to be nearest to. An explicit press is consent, so it is the one thing
   * allowed to play under prefers-reduced-motion.
   */
  const [forced, setForced] = useState<string | null>(null);

  // Playback moving off a panel leaves it decaying for a beat. Tracked here
  // rather than in the move handler so a keyboard focus change decays exactly
  // as a pointer move does.
  const prevLive = useRef<string | null>(null);
  useEffect(() => {
    const left = prevLive.current;
    prevLive.current = live;
    if (!left || left === live) return;
    setGhost(left);
    const t = window.setTimeout(() => setGhost((g) => (g === left ? null : g)), DECAY_MS);
    return () => window.clearTimeout(t);
  }, [live]);

  const nearest = useCallback((x: number, y: number): string | null => {
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, el] of cardRefs.current) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const dx = x - (r.left + r.width / 2);
      // Halved vertically: the panels are tall, so a pointer level with one
      // should not lose to the panel in the next column.
      const dy = (y - (r.top + r.height / 2)) / 2;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }, []);

  const idleAt = useRef(Date.now());

  useEffect(() => {
    if (reduced) return;
    const wall = wallRef.current;
    if (!wall) return;
    const onMove = (e: PointerEvent) => {
      idleAt.current = Date.now();
      const hit = nearest(e.clientX, e.clientY);
      if (hit) setLive(hit);
    };
    const onLeave = () => setLive(null);
    wall.addEventListener("pointermove", onMove, { passive: true });
    wall.addEventListener("pointerleave", onLeave);
    return () => {
      wall.removeEventListener("pointermove", onMove);
      wall.removeEventListener("pointerleave", onLeave);
    };
  }, [nearest, reduced]);

  useEffect(() => {
    if (reduced || leaving) return;
    const tick = window.setInterval(() => {
      if (Date.now() - idleAt.current < IDLE_MS) return;
      setLive((cur) => {
        const i = cards.findIndex((c) => c.id === cur);
        return cards[(i + 1) % cards.length].id;
      });
    }, WANDER_MS);
    return () => window.clearInterval(tick);
  }, [cards, reduced, leaving]);

  useEffect(() => {
    if (!held) return;
    const id = held.id;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = ((now - start) % SCRUB_MS) / SCRUB_MS;
      const v = videoRefs.current.get(id);
      if (v && Number.isFinite(v.duration) && v.duration > 0) v.currentTime = p * v.duration;
      setHeld((h) => (h && h.id === id ? { id, p } : h));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // Keyed on the id alone: `held.p` changes every frame, and depending on it
    // would tear this loop down and rebuild it sixty times a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held?.id]);

  // One video plays, and never while the tab is hidden: a hidden page that
  // keeps decoding is the frozen-preview bug, and it costs battery for a
  // picture nobody is looking at.
  useEffect(() => {
    const sync = () => {
      for (const [id, v] of videoRefs.current) {
        const play = !document.hidden && id === live && !held && (!reduced || forced === id);
        if (play) v.play().catch(() => {});
        else v.pause();
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [live, held, reduced, forced]);

  const open = useCallback(
    (card: WallCard) => {
      if (card.href === null) {
        onOpenWorkflows();
        return;
      }
      if (reduced) {
        router.push(card.href);
        return;
      }
      // The panel grows toward the viewer and the rest of the rack stands
      // down, then the route changes — so opening a studio is a move rather
      // than a cut, even though the destination is a different page.
      setLeaving(card.id);
      window.setTimeout(() => router.push(card.href!), 420);
    },
    [onOpenWorkflows, reduced, router],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, i: number) => {
      const go = (j: number) => {
        e.preventDefault();
        const next = cards[(j + cards.length) % cards.length];
        cardRefs.current.get(next.id)?.focus();
        setLive(next.id);
      };
      if (e.key === "ArrowRight" || e.key === "ArrowDown") go(i + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(i - 1);
    },
    [cards],
  );

  return (
    <div ref={wallRef} className={`swall${leaving ? " is-opening" : ""}`}>
      <header className="swall-head">
        <div>
          <h1 className="swall-title">Studio</h1>
          <p className="swall-sub">
            Every studio that makes something, and what each one holds. The panel nearest your
            cursor is the one that is playing.
          </p>
        </div>
        <div className="swall-hint">Hold a panel to scrub it</div>
      </header>

      <div className="swall-grid" role="group" aria-label="Studios">
        {cards.map((card, i) => {
          const isLive = live === card.id;
          const isGhost = ghost === card.id;
          const isLeaving = leaving === card.id;
          const poster = noPoster.has(card.id) ? null : card.clip.poster;
          const wantsVideo =
            !broken.has(card.id) && (isLive || isGhost) && (!reduced || forced === card.id);

          return (
            <div
              key={card.id}
              className={[
                "swall-slot",
                isLive ? "is-live" : "",
                isLeaving ? "is-source" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ ["--h"]: card.hue } as React.CSSProperties}
            >
              <button
                ref={(el) => {
                  if (el) cardRefs.current.set(card.id, el);
                  else cardRefs.current.delete(card.id);
                }}
                type="button"
                className={[
                  "swall-card",
                  isLive ? "is-live" : "",
                  isGhost ? "is-ghost" : "",
                  held?.id === card.id ? "is-held" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ ["--p"]: held?.id === card.id ? held.p : 0 } as React.CSSProperties}
                aria-label={
                  `${card.name} — ${card.tagline}. Holds ${card.inside.map((x) => x.label).join(", ")}.`
                }
                onFocus={() => setLive(card.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                onClick={() => open(card)}
                onPointerDown={() => !reduced && setHeld({ id: card.id, p: 0 })}
                onPointerUp={() => setHeld(null)}
                onPointerCancel={() => setHeld(null)}
              >
                <span className="swall-media">
                  {/* The motif is the floor: always there, so a clip that fails
                      AND a missing poster still leave a panel in this studio's
                      colour rather than a black rectangle. */}
                  <span className="swall-motif" aria-hidden />
                  {poster && (
                    <img
                      className="swall-poster"
                      src={poster}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={() => setNoPoster((s) => new Set(s).add(card.id))}
                    />
                  )}
                  {wantsVideo && (
                    <video
                      ref={(el) => {
                        if (el) videoRefs.current.set(card.id, el);
                        else videoRefs.current.delete(card.id);
                      }}
                      className="swall-video"
                      src={card.clip.video}
                      poster={card.clip.poster}
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      onError={() => setBroken((s) => new Set(s).add(card.id))}
                    />
                  )}
                  <span className="swall-dither" aria-hidden />
                </span>

                <span className="swall-scrub" aria-hidden />

                <span className="swall-vname" aria-hidden>
                  <span>{card.name}</span>
                </span>

                <span className="swall-body">
                  <span className="swall-name">{card.name}</span>
                  <span className="swall-tag">{card.tagline}</span>
                  <span className="swall-spines">
                    {card.inside.map((x) => {
                      const Glyph = Icon[x.icon] ?? Icon.Square;
                      return (
                        <span key={x.label} className="swall-spine">
                          <span className="swall-spine-dot" aria-hidden />
                          <Glyph aria-hidden />
                          {x.label}
                        </span>
                      );
                    })}
                  </span>
                </span>
              </button>

              {/* Outside the panel, because a button cannot nest in a button.
                  This is the way in where "nearest the pointer" means nothing:
                  a touch screen, or motion turned off. */}
              <button
                type="button"
                className="swall-play"
                aria-pressed={forced === card.id}
                onClick={() => {
                  setForced((f) => (f === card.id ? null : card.id));
                  setLive((cur) => (cur === card.id && forced === card.id ? null : card.id));
                }}
              >
                <Icon.Play aria-hidden />
                {forced === card.id ? "Stop" : "Preview"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
