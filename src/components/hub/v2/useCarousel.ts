"use client";

// ---------------------------------------------------------------------------
// Hub v2 — the carousel's motion model.
//
// The look comes from two numbers working together, and neither is a constant:
//
//   SQUEEZE — how tightly the whole ring is packed. Always fairly tight, so the
//             panels either side of the front read as the spread pages of an
//             open book rather than a row of separate flat cards; tighter still
//             while the ring is moving.
//   WEDGE   — a gap opened at the focus only. That is the spine of the book:
//             one page held open and readable, everything else stacked close.
//
// So the resting layout is not a uniform ring with a gap in it. Spacing near
// the focus is dominated by the wedge; spacing away from it by the squeeze.
// That difference is the whole effect.
//
// Nothing here is a CSS transition: a transition runs to a timeline, and this
// layout is a function of live velocity.
//
// Everything is in DEGREES. Rotation grows to the right.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

export interface CarouselTuning {
  /** Panels in the ring. */
  count: number;
  /** Ring packing when stopped. Below 1 so off-focus pages stay tight. */
  restSqueeze: number;
  /** Ring packing at full speed — the flick-through blur. */
  spinSqueeze: number;
  /** Half-width of the wedge opened around the focused panel, in degrees. */
  push: number;
  /** Speed (deg/frame) at which the fan is fully squeezed. */
  fullSpeed: number;
  /** Velocity retention per 60fps frame while coasting. */
  friction: number;
  /** Spring pulling the ring onto the nearest slot once it is slow. */
  snapStiffness: number;
}

export const DEFAULT_TUNING: Omit<CarouselTuning, "count"> = {
  restSqueeze: 0.55,
  spinSqueeze: 0.3,
  // Big on purpose. This is what tips the pages either side of the focus onto
  // a steep angle so they read as the EDGES of a stack rather than as smaller
  // flat cards you could almost read. It also means the fan self-limits: past
  // roughly six panels a side the shove carries them past 90 degrees and
  // backface culling retires them, which is exactly how an open book looks.
  push: 42,
  fullSpeed: 2.6,
  friction: 0.94,
  snapStiffness: 0.16,
};

export interface CarouselState {
  rotation: number;
  velocity: number;
  /** 0 = flat out, 1 = stationary. Drives squeeze and the wedge. */
  rest: number;
  /** Index of the panel nearest the front. */
  focus: number;
  /** True once the ring has stopped AND landed on a slot. */
  settled: boolean;
  dragging: boolean;
}

/** Wrap a delta into (-180, 180]. */
export function wrapSigned(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/**
 * Where a panel sits on screen, given its index and the live state.
 * Called for every panel every frame, so it stays pure arithmetic.
 */
export function panelAngle(
  index: number,
  state: Pick<CarouselState, "rotation" | "rest">,
  tuning: CarouselTuning,
): number {
  const base = 360 / tuning.count;
  const d = wrapSigned(index * base - state.rotation);
  const squeeze = tuning.spinSqueeze + (tuning.restSqueeze - tuning.spinSqueeze) * state.rest;
  // tanh saturates fast, so the wedge is a near-constant shove applied to
  // everything that is not the focus — it opens ONE gap instead of spreading
  // the whole ring. The focus sits at d≈0 where tanh is ≈0, so it never moves.
  const wedge = tuning.push * state.rest * Math.tanh(d / 9);
  return d * squeeze + wedge;
}

interface Options {
  count: number;
  /** Degrees of rotation per pixel of drag. */
  sensitivity?: number;
  tuning?: Partial<Omit<CarouselTuning, "count">>;
}

export interface CarouselApi {
  state: CarouselState;
  tuning: CarouselTuning;
  /**
   * Callback ref for the stage element.
   *
   * Wheel is bound natively rather than through React so the listener can be
   * passive:false and call preventDefault — React's synthetic wheel handler is
   * always passive and cannot. It has to be a CALLBACK ref: an effect reading
   * `ref.current` on mount runs before the node is assigned, so the listener
   * would attach to null and the wheel would silently do nothing.
   */
  attachStage: (el: HTMLElement | null) => void;
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onPointerLeave: (e: React.PointerEvent) => void;
  };
  /** Advance exactly n slots. Repeated calls queue: 1, 2, 3, 4 … */
  nudge: (slots: number) => void;
  /** Take the shortest way round to a specific panel. */
  goTo: (index: number) => void;
  /** True when a pointer moved far enough that the release is a drag, not a click. */
  wasDragged: () => boolean;
}

/** Below this the ring is treated as stopped. */
const STOP_EPSILON = 0.06;
/** Pixels of movement before a press counts as a drag rather than a click. */
const DRAG_SLOP = 6;

/**
 * Hover-to-spin. The middle of the stage is a dead zone so the ring can
 * actually come to rest under the cursor; past it, speed ramps quadratically
 * with distance, so the edges are quick and the approach is gentle.
 */
const DEAD_ZONE = 0.34;
const MAX_DRIFT = 1.15;

export function useCarousel({ count, sensitivity = 0.32, tuning: overrides }: Options): CarouselApi {
  const tuning: CarouselTuning = { count, ...DEFAULT_TUNING, ...overrides };
  const tuningRef = useRef(tuning);
  tuningRef.current = tuning;

  const [state, setState] = useState<CarouselState>({
    rotation: 0,
    velocity: 0,
    rest: 1,
    focus: 0,
    settled: true,
    dragging: false,
  });

  // The loop owns the numbers; React state is a throttled snapshot for render.
  const sim = useRef({
    rotation: 0,
    velocity: 0,
    rest: 1,
    dragging: false,
    /** Exact rotation the arrows / goTo are driving to, or null when coasting. */
    target: null as number | null,
    /** -1..1 hover drift from the pointer's side of the stage. */
    drift: 0,
  });
  const drag = useRef({ active: false, lastX: 0, moved: 0, pointerId: -1 });

  const step = 360 / Math.max(1, count);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    let lastPublished = -1;
    let last = performance.now();

    const frame = (now: number) => {
      if (!alive) return;
      const s = sim.current;
      const t = tuningRef.current;

      // Everything below is expressed per 60fps frame and then scaled by dt,
      // so the ring coasts for the same LENGTH OF TIME on a 60Hz laptop, a
      // 144Hz monitor and a background tab whose rAF has been throttled.
      // Frame-counted friction would make the same flick travel twice as far
      // on the 144Hz screen. Capped so returning to a long-parked tab does not
      // integrate one enormous step.
      const dt = Math.min(3, Math.max(0.2, (now - last) / (1000 / 60)));
      last = now;

      if (s.dragging) {
        // The pointer is driving; nothing else gets a say.
      } else if (s.target !== null) {
        // Arrows and click-to-focus spring onto an EXACT slot rather than
        // shoving in some velocity. A shove overshoots on a fast click and
        // stalls on a slow one, which is how "next" ends up skipping three.
        const diff = s.target - s.rotation;
        s.velocity += diff * 0.24 * dt;
        s.velocity *= Math.pow(0.7, dt);
        s.rotation += s.velocity * dt;
        if (Math.abs(diff) < 0.2 && Math.abs(s.velocity) < 0.25) {
          s.rotation = s.target;
          s.velocity = 0;
          s.target = null;
        }
      } else if (s.drift !== 0) {
        // Hover drift holds a steady speed; the fan stays compressed while it
        // does, and only settles once the cursor returns to the dead zone.
        s.velocity = s.drift * MAX_DRIFT;
        s.rotation += s.velocity * dt;
      } else {
        s.velocity *= Math.pow(t.friction, dt);
        // Once coasting has bled off, a spring finishes the job so the ring
        // always lands square on a panel instead of drifting to a stop
        // half-way between two.
        if (Math.abs(s.velocity) < 0.9) {
          const slot = Math.round(s.rotation / step) * step;
          s.velocity += (slot - s.rotation) * t.snapStiffness * dt;
          s.velocity *= Math.pow(0.72, dt);
        }
        if (Math.abs(s.velocity) < STOP_EPSILON) {
          const slot = Math.round(s.rotation / step) * step;
          if (Math.abs(slot - s.rotation) < 0.05) {
            s.rotation = slot;
            s.velocity = 0;
          }
        }
        s.rotation += s.velocity * dt;
      }

      // `rest` eases rather than snapping, so the fan opens and closes as a
      // motion of its own instead of popping the instant the ring stops.
      const speed = Math.min(1, Math.abs(s.velocity) / t.fullSpeed);
      const wanted = s.dragging ? Math.min(1 - speed, 0.25) : 1 - speed;
      s.rest += (wanted - s.rest) * Math.min(1, 0.14 * dt);

      const stopped = !s.dragging && s.drift === 0 && Math.abs(s.velocity) < STOP_EPSILON;
      const focus = ((Math.round(s.rotation / step) % count) + count) % count;
      const settled = stopped && s.rest > 0.96;

      // Publishing every frame would re-render every panel 60 times a second.
      // Transforms are written straight to the DOM by the component, so React
      // only needs to hear about changes that alter what is MOUNTED.
      const signature = focus * 4 + (settled ? 1 : 0) + (s.dragging ? 2 : 0);
      if (signature !== lastPublished) {
        lastPublished = signature;
        setState({
          rotation: s.rotation,
          velocity: s.velocity,
          rest: s.rest,
          focus,
          settled,
          dragging: s.dragging,
        });
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [count, step]);

  // ----- input -------------------------------------------------------------

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    drag.current = { active: true, lastX: e.clientX, moved: 0, pointerId: e.pointerId };
    sim.current.dragging = true;
    sim.current.velocity = 0;
    sim.current.target = null;
    sim.current.drift = 0;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (drag.current.active) {
        const dx = e.clientX - drag.current.lastX;
        drag.current.lastX = e.clientX;
        drag.current.moved += Math.abs(dx);
        // Dragging right brings the panels on the left toward you, which is a
        // NEGATIVE rotation — the direction a physical wheel turns under a
        // finger.
        const delta = -dx * sensitivity;
        sim.current.rotation += delta;
        // The pointer IS the velocity while dragging; blending stops a flick
        // inheriting one jittery frame as its whole throw.
        sim.current.velocity = sim.current.velocity * 0.6 + delta * 0.4;
        return;
      }

      // Not dragging: the cursor's side of the stage turns the ring. Touch is
      // excluded — a finger has no hover, so on a phone this would fire once
      // on tap and spin the stand for no reason.
      if (e.pointerType === "touch") return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      // -1 at the left edge, 0 dead centre, +1 at the right edge.
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const past = (Math.abs(x) - DEAD_ZONE) / (1 - DEAD_ZONE);
      const ramp = past <= 0 ? 0 : Math.min(1, past) ** 2;
      const next = Math.sign(x) * ramp;
      // Drifting overrides a pending arrow move; otherwise the two fight and
      // the ring visibly stutters between them.
      if (next !== 0) sim.current.target = null;
      sim.current.drift = next;
    },
    [sensitivity],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!drag.current.active) return;
    drag.current.active = false;
    sim.current.dragging = false;
    // Hand the accumulated pointer velocity to the coast, amplified so a flick
    // actually spins rather than dying in two frames.
    sim.current.velocity *= 2.4;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  const onPointerLeave = useCallback(() => {
    // Leaving the stage stops the drift, or the ring keeps turning under a
    // cursor that is no longer there.
    sim.current.drift = 0;
  }, []);

  const nudge = useCallback(
    (slots: number) => {
      const s = sim.current;
      // Queue off the PENDING target when there is one, so clicking Next four
      // times quickly advances four panels instead of re-aiming at the same
      // one — that is what made the arrow feel like it skipped.
      const from = s.target ?? Math.round(s.rotation / step) * step;
      s.drift = 0;
      s.target = from + slots * step;
    },
    [step],
  );

  const goTo = useCallback(
    (index: number) => {
      const s = sim.current;
      const from = s.target ?? s.rotation;
      // Shortest way round, so clicking the panel just off the left edge does
      // not send the ring the long way about.
      s.drift = 0;
      s.target = from + wrapSigned(index * step - from);
    },
    [step],
  );

  const wasDragged = useCallback(() => drag.current.moved > DRAG_SLOP, []);

  const detachWheel = useRef<(() => void) | null>(null);
  const attachStage = useCallback((el: HTMLElement | null) => {
    detachWheel.current?.();
    detachWheel.current = null;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // A trackpad's horizontal axis and a mouse's vertical one both mean
      // "turn the wheel", so take whichever is larger.
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!raw) return;
      e.preventDefault();
      sim.current.target = null;
      // Clamped because one notch of a coarse mouse wheel can report 300+,
      // which would fling the ring half a turn from a single click.
      sim.current.velocity += Math.max(-40, Math.min(40, raw)) * 0.05;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    detachWheel.current = () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => () => detachWheel.current?.(), []);

  return {
    state,
    tuning,
    attachStage,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onPointerLeave,
    },
    nudge,
    goTo,
    wasDragged,
  };
}
