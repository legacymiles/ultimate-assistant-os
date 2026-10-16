"use client";

// ---------------------------------------------------------------------------
// The Deck's living background.
//
// A field of drifting points, linked when they come close, that leans toward
// the cursor — and a radar sweep turning out of the reactor core that lights
// every point it passes. Rings pulse out from the core while Jarvis is busy.
//
// Cheap on purpose: one canvas, point count scaled to the area and capped,
// device pixel ratio capped at 1.5, and the loop stops whenever the tab is
// hidden. Under prefers-reduced-motion it draws one still frame.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";

interface Props {
  /** The element the sweep turns around — the reactor core. */
  originRef: React.RefObject<HTMLElement | null>;
  /** True while Jarvis is working: the sweep speeds up and rings pulse. */
  busy?: boolean;
}

interface Pt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lit: number;
}

const ARC = [71, 232, 255];
const PLASMA = [139, 124, 255];

export function HudField({ originRef, busy = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0;
    let h = 0;
    let pts: Pt[] = [];
    const mouse = { x: -9999, y: -9999, on: false };
    let angle = -Math.PI / 2;
    let rings: { r: number; a: number }[] = [];
    let lastRing = 0;
    let raf = 0;
    let last = performance.now();

    const seed = () => {
      const n = Math.min(120, Math.max(40, Math.round((w * h) / 14000)));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        lit: 0,
      }));
    };

    const size = () => {
      // The canvas covers what is VISIBLE of the scrolling Deck, not its full
      // height: it is sticky, so a long page never allocates a giant bitmap.
      const r = host.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, Math.min(r.height, window.innerHeight));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const origin = () => {
      const o = originRef.current?.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      if (!o) return { x: w * 0.12, y: h * 0.15 };
      return { x: o.left + o.width / 2 - c.left, y: o.top + o.height / 2 - c.top };
    };

    const frame = (now: number) => {
      const dt = Math.min(48, now - last) / 16.67;
      last = now;
      const o = origin();
      const speed = busyRef.current ? 0.035 : 0.012;
      angle = (angle + speed * dt) % (Math.PI * 2);

      ctx.clearRect(0, 0, w, h);

      // Sweep wedge.
      const reach = Math.hypot(Math.max(o.x, w - o.x), Math.max(o.y, h - o.y));
      const sweep = ctx.createConicGradient ? ctx.createConicGradient(angle - 0.55, o.x, o.y) : null;
      if (sweep) {
        sweep.addColorStop(0, "rgba(71,232,255,0)");
        sweep.addColorStop(0.085, "rgba(71,232,255,0.10)");
        sweep.addColorStop(0.088, "rgba(71,232,255,0)");
        sweep.addColorStop(1, "rgba(71,232,255,0)");
        ctx.fillStyle = sweep;
        ctx.beginPath();
        ctx.arc(o.x, o.y, reach, 0, Math.PI * 2);
        ctx.fill();
      }

      // Range rings around the core.
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        ctx.strokeStyle = `rgba(71,232,255,${0.07 - i * 0.012})`;
        ctx.beginPath();
        ctx.arc(o.x, o.y, i * 140, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Pulses while busy.
      if (busyRef.current && now - lastRing > 1400) {
        rings.push({ r: 30, a: 0.5 });
        lastRing = now;
      }
      rings = rings.filter((r) => r.a > 0.01);
      for (const r of rings) {
        r.r += 3.2 * dt;
        r.a *= 0.985;
        ctx.strokeStyle = `rgba(71,232,255,${r.a})`;
        ctx.beginPath();
        ctx.arc(o.x, o.y, r.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Points.
      for (const p of pts) {
        if (mouse.on) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 160 * 160) {
            const f = (1 - Math.sqrt(d2) / 160) * 0.035;
            p.vx += dx * f * 0.02;
            p.vy += dy * f * 0.02;
          }
        }
        p.vx *= 0.985;
        p.vy *= 0.985;
        // A little drift so the field never settles.
        p.vx += (Math.random() - 0.5) * 0.01;
        p.vy += (Math.random() - 0.5) * 0.01;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;

        // Lit by the sweep's leading edge.
        let a = Math.atan2(p.y - o.y, p.x - o.x) - angle;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        if (a < 0 && a > -0.08) p.lit = 1;
        p.lit *= 0.975;
      }

      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 120 * 120) continue;
          const near = mouse.on ? Math.max(0, 1 - Math.hypot(mouse.x - a.x, mouse.y - a.y) / 220) : 0;
          const al = (1 - Math.sqrt(d2) / 120) * (0.1 + near * 0.35 + Math.max(a.lit, b.lit) * 0.3);
          ctx.strokeStyle = `rgba(${ARC[0]},${ARC[1]},${ARC[2]},${al})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      for (const p of pts) {
        const c = p.lit > 0.2 ? ARC : PLASMA;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.35 + p.lit * 0.65})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.2 + p.lit * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // The cursor's own glow.
      if (mouse.on) {
        const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 180);
        g.addColorStop(0, "rgba(71,232,255,0.07)");
        g.addColorStop(1, "rgba(71,232,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(mouse.x - 180, mouse.y - 180, 360, 360);
      }

      if (!reduce && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.on = mouse.x >= 0 && mouse.y >= 0 && mouse.x <= w && mouse.y <= h;
    };
    const onLeave = () => (mouse.on = false);
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    size();
    const ro = new ResizeObserver(size);
    ro.observe(host);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [originRef]);

  return <canvas ref={canvasRef} className="deck-field" aria-hidden />;
}

/**
 * The reactor core: segmented rings turning at different speeds around a
 * pulsing heart. Spins faster while Jarvis is working.
 */
export function Reactor({ busy, size = 112 }: { busy?: boolean; size?: number }) {
  const ticks = Array.from({ length: 48 }, (_, i) => i);
  return (
    <svg className="deck-reactor" data-busy={busy} width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <defs>
        <radialGradient id="deck-heart" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="35%" stopColor="#47e8ff" />
          <stop offset="100%" stopColor="#47e8ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="deck-reactor__ticks">
        {ticks.map((i) => (
          <line
            key={i}
            x1="60"
            y1="3"
            x2="60"
            y2={i % 4 === 0 ? 10 : 7}
            stroke="#47e8ff"
            strokeOpacity={i % 4 === 0 ? 0.8 : 0.35}
            strokeWidth="1"
            transform={`rotate(${i * 7.5} 60 60)`}
          />
        ))}
      </g>
      <g className="deck-reactor__a">
        <circle cx="60" cy="60" r="44" fill="none" stroke="#47e8ff" strokeWidth="2" strokeDasharray="38 8 12 8" strokeOpacity="0.9" />
      </g>
      <g className="deck-reactor__b">
        <circle cx="60" cy="60" r="35" fill="none" stroke="#ffb547" strokeWidth="1.5" strokeDasharray="2 5" />
      </g>
      <g className="deck-reactor__c">
        <circle cx="60" cy="60" r="27" fill="none" stroke="#8b7cff" strokeWidth="3" strokeDasharray="20 22" strokeOpacity="0.85" />
      </g>
      <circle cx="60" cy="60" r="19" fill="#06121f" stroke="#47e8ff" strokeOpacity="0.6" />
      <circle className="deck-reactor__heart" cx="60" cy="60" r="16" fill="url(#deck-heart)" />
    </svg>
  );
}
