"use client";

// ---------------------------------------------------------------------------
// The Orbit — App Builder's one toy.
//
// The app being built is a core of light. Every feature the super agent
// proposes is a body on the outer ring, placed in its kind's sector. You decide
// by throwing: drag a feature INTO the core and it docks on the inner ring
// (accepted, green); fling it out past the edge and it drops to the debris belt
// (denied, red, dimmed). A plain tap selects it, and the table below scrolls to
// its row. The core feeds on decisions — it brightens as features dock, and
// when nothing is left undecided it ignites once.
//
// Canvas 2D, no library. Capped at 2× DPR, paused when off screen or hidden,
// and fully still under prefers-reduced-motion (bodies go straight to their
// places; dragging still works). The table is the accessible way to do every
// one of these things; this canvas is aria-described, not the only control.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { KIND_LABEL, KINDS, type Feature, type FeatureKind } from "@/lib/app-builder/types";

interface Props {
  features: Feature[];
  name: string;
  /** 0..1 — how much energy the core has before features exist (typing feeds it). */
  charge?: number;
  selectedId?: string | null;
  hoverId?: string | null;
  onAccept?: (id: string) => void;
  onDeny?: (id: string) => void;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  /** Smaller rings and no sector labels. */
  compact?: boolean;
  /** Faint, non-interactive backdrop (idea / interview stages). */
  ambient?: boolean;
}

interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
}

interface Mote {
  a: number;
  d: number;
  s: number;
  life: number;
}

const COL = {
  proposed: [245, 158, 11],
  accepted: [34, 197, 94],
  denied: [239, 68, 68],
  core: [165, 170, 255],
  ink: [233, 236, 243],
  faint: [107, 115, 133],
} as const;

const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function Orbit({
  features,
  name,
  charge = 0,
  selectedId,
  hoverId,
  onAccept,
  onDeny,
  onSelect,
  onHover,
  compact,
  ambient,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Props the animation loop reads every frame without restarting.
  const live = useRef({ features, name, charge, selectedId, hoverId, onAccept, onDeny, onSelect, onHover, compact, ambient });
  live.current = { features, name, charge, selectedId, hoverId, onAccept, onDeny, onSelect, onHover, compact, ambient };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const bodies = new Map<string, Body>();
    const motes: Mote[] = Array.from({ length: still ? 0 : 70 }, () => ({
      a: Math.random() * Math.PI * 2,
      d: 0.3 + Math.random() * 0.9,
      s: 0.0006 + Math.random() * 0.0016,
      life: Math.random(),
    }));

    const pointer = { x: -9999, y: -9999, inside: false };
    let drag: { id: string; dx: number; dy: number; moved: number; lastX: number; lastY: number; vx: number; vy: number } | null = null;
    let spin = 0;
    let glow = 0;
    let ignite = 0;
    let wasAllDecided = false;
    let visible = true;
    let raf = 0;
    let last = performance.now();

    const geo = () => {
      const c = live.current.compact || w < 560;
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h);
      return {
        cx,
        cy,
        core: base * (c ? 0.085 : 0.075),
        inner: base * (c ? 0.2 : 0.19),
        outer: base * (c ? 0.4 : 0.37),
        compact: c,
      };
    };

    /** Where each feature wants to be right now. */
    const targets = (t: number) => {
      const g = geo();
      const fs = live.current.features;
      const out = new Map<string, { x: number; y: number }>();
      const sector = (Math.PI * 2) / KINDS.length;
      const byKind = new Map<FeatureKind, Feature[]>();
      for (const f of fs.filter((f) => f.status === "proposed")) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
      for (const [kind, list] of byKind) {
        const k = KINDS.indexOf(kind);
        list.forEach((f, i) => {
          const a = -Math.PI / 2 + sector * k + sector * ((i + 1) / (list.length + 1)) + spin;
          const wobble = still ? 0 : Math.sin(t / 900 + i * 1.7) * 4;
          out.set(f.id, { x: g.cx + Math.cos(a) * (g.outer + wobble), y: g.cy + Math.sin(a) * (g.outer + wobble) });
        });
      }
      const acc = fs.filter((f) => f.status === "accepted");
      acc.forEach((f, i) => {
        const a = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, acc.length) - spin * 0.6;
        out.set(f.id, { x: g.cx + Math.cos(a) * g.inner, y: g.cy + Math.sin(a) * g.inner });
      });
      const den = fs.filter((f) => f.status === "denied");
      den.forEach((f, i) => {
        const span = Math.min(w - 40, den.length * 28);
        out.set(f.id, { x: g.cx - span / 2 + (span * (i + 0.5)) / Math.max(1, den.length), y: h - 20 });
      });
      return out;
    };

    const hit = (x: number, y: number): string | null => {
      let best: string | null = null;
      let bd = Infinity;
      for (const [id, b] of bodies) {
        const d = Math.hypot(b.x - x, b.y - y);
        if (d < b.r + 10 && d < bd) {
          bd = d;
          best = id;
        }
      }
      return best;
    };

    const local = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const down = (e: PointerEvent) => {
      if (live.current.ambient) return;
      const p = local(e);
      const id = hit(p.x, p.y);
      if (!id) return;
      const b = bodies.get(id)!;
      drag = { id, dx: b.x - p.x, dy: b.y - p.y, moved: 0, lastX: p.x, lastY: p.y, vx: 0, vy: 0 };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      pointer.x = p.x;
      pointer.y = p.y;
      pointer.inside = true;
      if (drag) {
        const b = bodies.get(drag.id);
        if (b) {
          b.x = p.x + drag.dx;
          b.y = p.y + drag.dy;
          b.vx = 0;
          b.vy = 0;
        }
        drag.vx = p.x - drag.lastX;
        drag.vy = p.y - drag.lastY;
        drag.moved += Math.hypot(drag.vx, drag.vy);
        drag.lastX = p.x;
        drag.lastY = p.y;
        el.style.cursor = "grabbing";
        return;
      }
      if (live.current.ambient) return;
      const id = hit(p.x, p.y);
      el.style.cursor = id ? "grab" : "default";
      if (id !== live.current.hoverId) live.current.onHover?.(id);
    };
    const up = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      el.style.cursor = "default";
      const b = bodies.get(d.id);
      const f = live.current.features.find((x) => x.id === d.id);
      if (!b || !f) return;
      if (d.moved < 6) {
        live.current.onSelect?.(d.id);
        return;
      }
      const g = geo();
      const dist = Math.hypot(b.x - g.cx, b.y - g.cy);
      const outward = (b.x - g.cx) * d.vx + (b.y - g.cy) * d.vy > 0;
      const flung = Math.hypot(d.vx, d.vy) > 14 && outward;
      if (dist < g.core * 1.9) {
        if (f.status !== "accepted") {
          live.current.onAccept?.(d.id);
          glow = 1;
        }
      } else if (dist > g.outer + Math.min(70, g.outer * 0.3) || flung) {
        if (f.status !== "denied") live.current.onDeny?.(d.id);
        b.vx = d.vx * 0.6;
        b.vy = d.vy * 0.6;
      } else {
        // Let go in no-man's-land: it springs back to where it was.
        b.vx = d.vx * 0.3;
        b.vy = d.vy * 0.3;
      }
    };
    const leave = () => {
      pointer.inside = false;
      pointer.x = pointer.y = -9999;
      if (!drag) live.current.onHover?.(null);
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", leave);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    });
    io.observe(el);

    function frame(now: number) {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = Math.min(48, now - last);
      last = now;
      const L = live.current;
      const g = geo();
      if (!still) spin += dt * 0.00004;

      // Sync bodies with the feature list.
      const want = targets(now);
      const ids = new Set(L.features.map((f) => f.id));
      for (const id of [...bodies.keys()]) if (!ids.has(id)) bodies.delete(id);
      for (const f of L.features) {
        const t = want.get(f.id)!;
        const r = f.status === "denied" ? 10 : (g.compact ? 7 : 9) + f.impact * (g.compact ? 2 : 3);
        let b = bodies.get(f.id);
        if (!b) {
          // New ideas are born from the core and fly out to their place.
          b = still ? { id: f.id, x: t.x, y: t.y, vx: 0, vy: 0, r, alpha: 1 } : { id: f.id, x: g.cx, y: g.cy, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, r, alpha: 0 };
          bodies.set(f.id, b);
        }
        b.r = r;
        if (drag?.id === f.id) continue;
        if (still) {
          b.x = t.x;
          b.y = t.y;
          b.alpha = f.status === "denied" ? 0.45 : 1;
          continue;
        }
        // Spring toward its place, with a little pull toward the pointer.
        const k = 0.0016 * dt;
        b.vx += (t.x - b.x) * k;
        b.vy += (t.y - b.y) * k;
        if (pointer.inside && !L.ambient) {
          const pd = Math.hypot(pointer.x - b.x, pointer.y - b.y);
          if (pd < 110 && pd > 1) {
            const pull = (1 - pd / 110) * 0.06 * dt * 0.06;
            b.vx += ((pointer.x - b.x) / pd) * pull * 10;
            b.vy += ((pointer.y - b.y) / pd) * pull * 10;
          }
        }
        const damp = Math.pow(0.86, dt / 16);
        b.vx *= damp;
        b.vy *= damp;
        b.x += b.vx * (dt / 16);
        b.y += b.vy * (dt / 16);
        const aim = f.status === "denied" ? 0.4 : 1;
        b.alpha += (aim - b.alpha) * Math.min(1, dt / 240);
      }

      const decided = L.features.length > 0 && L.features.every((f) => f.status !== "proposed");
      if (decided && !wasAllDecided && !still) ignite = 1;
      wasAllDecided = decided;
      glow = Math.max(0, glow - dt / 900);
      ignite = Math.max(0, ignite - dt / 1600);

      draw(now, g);
      raf = requestAnimationFrame(frame);
    }

    function draw(now: number, g: ReturnType<typeof geo>) {
      const L = live.current;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w, h);
      const acc = L.features.filter((f) => f.status === "accepted").length;
      const power = Math.min(1, (L.features.length ? acc / Math.max(4, L.features.length * 0.6) : L.charge) * 0.9 + 0.1);
      const breathe = still ? 0 : Math.sin(now / 1400) * 0.5 + 0.5;

      // Rings.
      ctx!.lineWidth = 1;
      ctx!.setLineDash([2, 6]);
      ctx!.strokeStyle = rgba(COL.faint, L.ambient ? 0.12 : 0.28);
      ctx!.beginPath();
      ctx!.arc(g.cx, g.cy, g.outer, 0, Math.PI * 2);
      ctx!.stroke();
      ctx!.setLineDash([]);
      ctx!.strokeStyle = rgba(COL.accepted, L.ambient ? 0.06 : 0.12 + power * 0.25);
      ctx!.beginPath();
      ctx!.arc(g.cx, g.cy, g.inner, 0, Math.PI * 2);
      ctx!.stroke();

      // Sector labels on the outer ring.
      if (!g.compact && !L.ambient && L.features.length) {
        ctx!.font = "500 9.5px 'JetBrains Mono', ui-monospace, monospace";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        const sector = (Math.PI * 2) / KINDS.length;
        KINDS.forEach((k, i) => {
          const a = -Math.PI / 2 + sector * i + spin;
          const r = g.outer + 26;
          ctx!.fillStyle = rgba(COL.faint, 0.55);
          ctx!.fillText(KIND_LABEL[k].toUpperCase(), g.cx + Math.cos(a) * r, g.cy + Math.sin(a) * r);
          ctx!.strokeStyle = rgba(COL.faint, 0.25);
          ctx!.beginPath();
          ctx!.moveTo(g.cx + Math.cos(a) * (g.outer - 6), g.cy + Math.sin(a) * (g.outer - 6));
          ctx!.lineTo(g.cx + Math.cos(a) * (g.outer + 6), g.cy + Math.sin(a) * (g.outer + 6));
          ctx!.stroke();
        });
      }

      // Motes drifting into the core: the agent "thinking".
      for (const m of motes) {
        m.d -= m.s * 16 * (0.6 + power);
        if (m.d < 0.12) {
          m.d = 0.9 + Math.random() * 0.4;
          m.a = Math.random() * Math.PI * 2;
        }
        const r = m.d * g.outer;
        const x = g.cx + Math.cos(m.a + m.d) * r;
        const y = g.cy + Math.sin(m.a + m.d) * r;
        ctx!.fillStyle = rgba(COL.core, Math.min(0.5, (1 - m.d) * 0.6) * (L.ambient ? 0.6 : 1));
        ctx!.fillRect(x, y, 1.4, 1.4);
      }

      // Tethers from docked features to the core.
      for (const f of L.features) {
        if (f.status !== "accepted") continue;
        const b = bodies.get(f.id);
        if (!b) continue;
        const grad = ctx!.createLinearGradient(g.cx, g.cy, b.x, b.y);
        grad.addColorStop(0, rgba(COL.accepted, 0));
        grad.addColorStop(1, rgba(COL.accepted, 0.35 * b.alpha));
        ctx!.strokeStyle = grad;
        ctx!.beginPath();
        ctx!.moveTo(g.cx, g.cy);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }

      // The core.
      const coreR = g.core * (1 + power * 0.25 + breathe * 0.05 + glow * 0.25);
      const halo = ctx!.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, coreR * 3.2);
      halo.addColorStop(0, rgba(COL.core, 0.35 + power * 0.35 + glow * 0.3));
      halo.addColorStop(0.35, rgba([99, 102, 241], 0.18 + power * 0.15));
      halo.addColorStop(1, rgba([99, 102, 241], 0));
      ctx!.fillStyle = halo;
      ctx!.beginPath();
      ctx!.arc(g.cx, g.cy, coreR * 3.2, 0, Math.PI * 2);
      ctx!.fill();
      const body = ctx!.createRadialGradient(g.cx - coreR * 0.3, g.cy - coreR * 0.3, coreR * 0.1, g.cx, g.cy, coreR);
      body.addColorStop(0, "rgba(255,255,255,0.95)");
      body.addColorStop(0.5, rgba(COL.core, 0.9));
      body.addColorStop(1, "rgba(79,70,229,0.85)");
      ctx!.fillStyle = body;
      ctx!.beginPath();
      ctx!.arc(g.cx, g.cy, coreR, 0, Math.PI * 2);
      ctx!.fill();

      // Ignition shockwave when every feature is decided.
      if (ignite > 0) {
        const t = 1 - ignite;
        ctx!.strokeStyle = rgba(COL.accepted, ignite * 0.8);
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        ctx!.arc(g.cx, g.cy, g.core + t * g.outer * 1.4, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.lineWidth = 1;
      }

      // Feature bodies.
      for (const f of L.features) {
        const b = bodies.get(f.id);
        if (!b) continue;
        const c = COL[f.status];
        const on = f.id === L.selectedId || f.id === L.hoverId || drag?.id === f.id;
        const a = b.alpha * (L.ambient ? 0.5 : 1);
        if (f.status !== "denied") {
          const gl = ctx!.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 2.6);
          gl.addColorStop(0, rgba(c, (on ? 0.45 : 0.22) * a));
          gl.addColorStop(1, rgba(c, 0));
          ctx!.fillStyle = gl;
          ctx!.beginPath();
          ctx!.arc(b.x, b.y, b.r * 2.6, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.fillStyle = `rgba(14,16,23,${0.92 * a})`;
        ctx!.beginPath();
        ctx!.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.strokeStyle = rgba(c, (on ? 1 : 0.75) * a);
        ctx!.lineWidth = on ? 2 : 1.25;
        ctx!.stroke();
        ctx!.lineWidth = 1;
        ctx!.font = `600 ${b.r > 14 ? 10 : 9}px 'JetBrains Mono', ui-monospace, monospace`;
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillStyle = rgba(COL.ink, 0.9 * a);
        ctx!.fillText(f.id.replace("f", ""), b.x, b.y + 0.5);

        if (on && !L.ambient) {
          const label = f.title.length > 34 ? `${f.title.slice(0, 33)}…` : f.title;
          ctx!.font = "600 12px ui-sans-serif, system-ui, sans-serif";
          const tw = ctx!.measureText(label).width;
          const above = b.y > g.cy;
          const ly = above ? b.y - b.r - 22 : b.y + b.r + 8;
          const lx = Math.max(8 + tw / 2, Math.min(w - 8 - tw / 2, b.x));
          ctx!.fillStyle = "rgba(10,11,15,0.88)";
          ctx!.strokeStyle = rgba(c, 0.5);
          ctx!.beginPath();
          ctx!.roundRect(lx - tw / 2 - 8, ly - 2, tw + 16, 20, 6);
          ctx!.fill();
          ctx!.stroke();
          ctx!.fillStyle = rgba(COL.ink, 0.95);
          ctx!.textBaseline = "top";
          ctx!.fillText(label, lx, ly + 2);
        }
      }

      // The app's name under the core — drawn over the bodies, on a pill, so a
      // docked feature never hides it.
      if (!L.ambient || L.charge > 0.05) {
        const label = L.name.slice(0, 28);
        ctx!.font = `700 ${g.compact ? 12 : 14}px Syne, ui-sans-serif, system-ui, sans-serif`;
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        const tw = ctx!.measureText(label).width;
        const ly = g.cy + coreR + (g.compact ? 16 : 20);
        if (!L.ambient) {
          ctx!.fillStyle = "rgba(10,11,15,0.78)";
          ctx!.beginPath();
          ctx!.roundRect(g.cx - tw / 2 - 9, ly - 11, tw + 18, 22, 11);
          ctx!.fill();
        }
        ctx!.fillStyle = rgba(COL.ink, L.ambient ? 0.35 : 0.92);
        ctx!.fillText(label, g.cx, ly);
      }

      // While dragging: show where it will land.
      if (drag) {
        const b = bodies.get(drag.id);
        if (b) {
          const dist = Math.hypot(b.x - g.cx, b.y - g.cy);
          const intoCore = dist < g.core * 1.9;
          const outside = dist > g.outer + Math.min(70, g.outer * 0.3);
          ctx!.font = "600 10px 'JetBrains Mono', ui-monospace, monospace";
          ctx!.textAlign = "center";
          ctx!.fillStyle = intoCore ? rgba(COL.accepted, 0.95) : outside ? rgba(COL.denied, 0.95) : rgba(COL.faint, 0.8);
          ctx!.fillText(intoCore ? "RELEASE TO ACCEPT" : outside ? "RELEASE TO DENY" : "INTO THE CORE = ACCEPT · OUT = DENY", g.cx, 14);
          if (intoCore) {
            ctx!.strokeStyle = rgba(COL.accepted, 0.8);
            ctx!.setLineDash([3, 4]);
            ctx!.beginPath();
            ctx!.arc(g.cx, g.cy, g.core * 1.9, 0, Math.PI * 2);
            ctx!.stroke();
            ctx!.setLineDash([]);
          }
        }
      }
    }

    raf = requestAnimationFrame(frame);
    const wake = () => {
      if (!document.hidden && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", wake);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", wake);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);

  const counts = {
    open: features.filter((f) => f.status === "proposed").length,
    yes: features.filter((f) => f.status === "accepted").length,
    no: features.filter((f) => f.status === "denied").length,
  };

  return (
    <canvas
      ref={canvas}
      className="ab-orbit"
      role="img"
      aria-label={
        ambient
          ? `${name}, waiting for features`
          : `${name}: ${counts.yes} features accepted, ${counts.open} waiting for a decision, ${counts.no} denied. Drag a feature into the centre to accept it or out of the ring to deny it; the table below does the same with buttons.`
      }
    />
  );
}
