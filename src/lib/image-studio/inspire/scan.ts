// ---------------------------------------------------------------------------
// Prompt Scan — the pure half of Inspire's signature effect.
//
// Every picture has its prompt underneath it. In the hero the picture is first
// drawn out of its own prompt words; the pointer paints a trail (the hub's
// webgl-trail-reveal engine, src/lib/viral-studio/trail.ts) that scans the
// real picture through. On a gallery card it runs the other way: hovering
// scans the picture away to show the prompt beneath.
//
// Both layers come from the same frame, so they are pixel-aligned by
// construction — the words texture is drawn at the stage's own size.
// ---------------------------------------------------------------------------

import { pushPoint, type TrailPoint } from "@/lib/viral-studio/trail";

/** The prompt as one endless uppercase stream, ready to tile a stage. */
export function wordStream(prompt: string, minChars = 6000): string {
  const one = prompt.replace(/\s+/g, " ").trim().toUpperCase();
  if (!one) return "";
  const unit = `${one} · `;
  return unit.repeat(Math.max(1, Math.ceil(minChars / unit.length)));
}

/**
 * Where the idle scanner is at time `t` (seconds): a slow, wandering
 * Lissajous loop that stays inside the frame and never repeats exactly, so a
 * phone (no pointer) and an idle desktop still see the picture surface.
 */
export function sweepPoint(t: number): [number, number] {
  const x = 0.5 + 0.36 * Math.sin(t * 0.53) * Math.cos(t * 0.11);
  const y = 0.5 + 0.3 * Math.sin(t * 0.37 + 1.3);
  return [Math.min(0.97, Math.max(0.03, x)), Math.min(0.97, Math.max(0.03, y))];
}

/**
 * The still trail shown under reduced motion: one deliberate diagonal sweep,
 * head fresh and tail aged, so the standout is legible without moving.
 */
export function stillTrail(): TrailPoint[] {
  let pts: TrailPoint[] = [];
  const n = 20;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const x = 0.22 + 0.56 * k;
    const y = 0.38 + 0.2 * Math.sin(k * Math.PI);
    pts = pushPoint(pts, x, y, 0.001);
  }
  return pts.map((p, i) => ({ ...p, age: 0.75 * (1 - i / (pts.length - 1)) }));
}

/**
 * Where a point of the image (fractions, y down) lands on a stage the image
 * cover-fits. Returns stage fractions, or null when the crop hides it.
 */
export function pinOnStage(x: number, y: number, imgW: number, imgH: number, stageW: number, stageH: number, margin = 0.04): [number, number] | null {
  if (!imgW || !imgH || !stageW || !stageH) return null;
  const scale = Math.max(stageW / imgW, stageH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  const sx = (x * w - (w - stageW) / 2) / stageW;
  const sy = (y * h - (h - stageH) / 2) / stageH;
  if (sx < margin || sx > 1 - margin || sy < margin || sy > 1 - margin) return null;
  return [sx, sy];
}

/** Font size (CSS px) for the words layer: dense on a card, readable in the hero. */
export function wordSize(stageW: number, mode: "hero" | "card"): number {
  if (mode === "card") return stageW < 260 ? 8 : 9.5;
  return stageW < 520 ? 10 : stageW < 1000 ? 12 : 13.5;
}
