"use client";

// ---------------------------------------------------------------------------
// The one surface every canvas game draws on.
//
// A game here is a plain object made by a factory — closure state, a frame
// function and three pointer callbacks — and never touches React. That is a
// performance rule, not a style one: thirty particles at 60fps through React
// state is two thousand reconciliations a second on the cheapest tablet in the
// house, which is the one a baby gets.
//
// What this component owns so no game has to:
//   - a full-screen canvas at a capped device-pixel ratio, resized with the
//     screen (a baby rotates a tablet constantly)
//   - one requestAnimationFrame loop with a clamped dt, paused while the tab is
//     hidden so a backgrounded game does not "catch up" in one jump
//   - every finger as its own pointer, so two palms are two touches
//   - waking the audio on the first touch, which is the only moment a browser
//     lets sound start
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { wakeAudio } from "@/lib/baby-no-scroll/audio";

export interface GamePointer {
  id: number;
  x: number;
  y: number;
  /** Seconds since this finger went down. */
  held: number;
}

export interface GameEnv {
  /** prefers-reduced-motion: keep the feedback, drop the ambient swirl. */
  reduced: boolean;
  /** Current size in CSS pixels. Read it each frame; it changes on rotate. */
  size(): { w: number; h: number };
}

export interface CanvasGame {
  /** Called once with the first size, then on every resize. */
  resize?(w: number, h: number): void;
  /** Draw one frame. dt is seconds (clamped to 1/20), t is seconds since start. */
  frame(ctx: CanvasRenderingContext2D, dt: number, t: number, w: number, h: number): void;
  down?(p: GamePointer): void;
  move?(p: GamePointer): void;
  up?(p: GamePointer): void;
  dispose?(): void;
}

export function GameCanvas({
  create,
  className = "",
}: {
  create: (env: GameEnv) => CanvasGame;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // The factory is captured once: a game is a world, and re-creating it on a
  // parent re-render would wipe the sky mid-pop.
  const factory = useRef(create);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let w = el.clientWidth || window.innerWidth;
    let h = el.clientHeight || window.innerHeight;
    const env: GameEnv = { reduced, size: () => ({ w, h }) };
    const game = factory.current(env);

    // A 3x phone is three times the fill rate for an edge nobody can see.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => {
      w = el.clientWidth || window.innerWidth;
      h = el.clientHeight || window.innerHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      game.resize?.(w, h);
    };
    size();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : null;
    ro?.observe(el);
    window.addEventListener("resize", size);

    // --- pointers ---------------------------------------------------------
    const downAt = new Map<number, number>();
    const at = (e: PointerEvent): GamePointer => {
      const r = el.getBoundingClientRect();
      const since = downAt.get(e.pointerId);
      return {
        id: e.pointerId,
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        held: since === undefined ? 0 : (performance.now() - since) / 1000,
      };
    };
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      wakeAudio();
      // Touch captures the gesture to the canvas already; releasing nothing
      // here keeps a dragged hand reporting moves across the whole screen.
      downAt.set(e.pointerId, performance.now());
      game.down?.(at(e));
    };
    const onMove = (e: PointerEvent) => {
      // A mouse hovering is not a baby touching. Only pressed pointers move.
      if (!downAt.has(e.pointerId)) return;
      e.preventDefault();
      // Coalesced events: a fast swipe on a 120Hz screen reports several
      // positions per frame, and a trail drawn from only the last one has gaps.
      const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      if (list.length > 1) for (const c of list) game.move?.(at(c));
      else game.move?.(at(e));
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt.has(e.pointerId)) return;
      const p = at(e);
      downAt.delete(e.pointerId);
      game.up?.(p);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onUp);
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener("contextmenu", noMenu);

    // --- the loop ---------------------------------------------------------
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      try {
        game.frame(ctx, dt, (now - t0) / 1000, w, h);
      } catch (err) {
        // One bad frame must never take the nursery down to a white screen.
        console.error("[baby-no-scroll] game frame", err);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const onVis = () => {
      last = performance.now();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", size);
      document.removeEventListener("visibilitychange", onVis);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onUp);
      el.removeEventListener("contextmenu", noMenu);
      game.dispose?.();
    };
  }, []);

  return <canvas ref={ref} className={`bns-canvas ${className}`} aria-hidden />;
}
