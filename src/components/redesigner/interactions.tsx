"use client";

// ---------------------------------------------------------------------------
// Redesigner — interaction primitives.
//
// All of these mutate the DOM inside a rAF loop and never set React state per
// frame. All of them no-op on coarse pointers and under prefers-reduced-motion,
// so the page keeps working as a plain form.
// ---------------------------------------------------------------------------

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/** Live — a user can flip the OS setting while the page is open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setFine(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return fine;
}

/**
 * A ring that trails the pointer and collapses to a hard square over anything
 * interactive — targeting, not decoration. Delegated listeners, so controls
 * that appear later (the skill menu, the result cards) are covered too.
 */
export function CustomCursor({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let x = mx;
    let y = my;
    let seen = false;

    function onMove(e: PointerEvent) {
      mx = e.clientX;
      my = e.clientY;
      if (!seen) {
        seen = true;
        x = mx;
        y = my;
        el!.style.opacity = "1";
      }
      const t = e.target as Element | null;
      const hot = t?.closest?.("a, button, label, [data-cursor='hot']");
      const text = t?.closest?.("input, textarea");
      el!.classList.toggle("is-hot", !!hot && !text);
      el!.classList.toggle("is-text", !!text);
    }
    function onLeave() {
      el!.style.opacity = "0";
      seen = false;
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    let raf = 0;
    const tick = () => {
      x += (mx - x) * 0.19;
      y += (my - y) * 0.19;
      el!.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    document.documentElement.classList.add("rdx-cursor-on");
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.documentElement.classList.remove("rdx-cursor-on");
    };
  }, [enabled]);

  if (!enabled) return null;
  return <div ref={ref} className="rdx-cursor" style={{ opacity: 0 }} aria-hidden />;
}

/**
 * Magnetic pull with a real spring (stiffness/damping integrated per frame),
 * so a target overshoots and settles instead of easing linearly home.
 */
export function useMagnetic<T extends HTMLElement>(
  enabled: boolean,
  strength = 0.32,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    let raf = 0;
    let running = false;

    function step() {
      // Spring: stiff enough to feel snappy, damped enough to settle fast.
      const k = 0.14;
      const d = 0.74;
      vx = (vx + (tx - x) * k) * d;
      vy = (vy + (ty - y) * k) * d;
      x += vx;
      y += vy;
      el!.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      const still =
        Math.abs(vx) < 0.01 &&
        Math.abs(vy) < 0.01 &&
        Math.abs(tx - x) < 0.05 &&
        Math.abs(ty - y) < 0.05;
      if (still) {
        el!.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
        x = tx;
        y = ty;
        running = false;
        return;
      }
      raf = requestAnimationFrame(step);
    }
    function kick() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(step);
    }

    function onMove(e: PointerEvent) {
      const r = el!.getBoundingClientRect();
      tx = (e.clientX - (r.left + r.width / 2)) * strength;
      ty = (e.clientY - (r.top + r.height / 2)) * strength;
      kick();
    }
    function onLeave() {
      tx = 0;
      ty = 0;
      kick();
    }

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.style.transform = "";
    };
  }, [enabled, strength]);

  return ref;
}

/** 3D tilt toward the pointer, with the same spring settle on leave. */
export function useTilt<T extends HTMLElement>(enabled: boolean, max = 6) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    let trx = 0;
    let tryy = 0;
    let rx = 0;
    let ry = 0;
    let raf = 0;
    let running = false;

    function step() {
      rx += (trx - rx) * 0.12;
      ry += (tryy - ry) * 0.12;
      el!.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      if (Math.abs(trx - rx) < 0.02 && Math.abs(tryy - ry) < 0.02) {
        if (trx === 0 && tryy === 0) el!.style.transform = "";
        running = false;
        return;
      }
      raf = requestAnimationFrame(step);
    }
    function kick() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(step);
    }

    function onMove(e: PointerEvent) {
      const r = el!.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      tryy = px * max * 2;
      trx = -py * max * 2;
      kick();
    }
    function onLeave() {
      trx = 0;
      tryy = 0;
      kick();
    }

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.style.transform = "";
    };
  }, [enabled, max]);

  return ref;
}

/** Adds `.is-in` once the element scrolls into view. Idempotent, one-shot. */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const style = delay ? ({ transitionDelay: `${delay}ms` } as CSSProperties) : undefined;
  return (
    <Tag ref={ref as never} className={`rdx-reveal ${className}`} style={style}>
      {children}
    </Tag>
  );
}
