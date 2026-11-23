"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getColor, getGarment, SIDE_LABEL } from "@/lib/dtf/garments";
import { activeZone, layerBounds, sideLayers } from "@/lib/dtf/project";
import { layerOutsideZone } from "@/lib/dtf/readiness";
import { drawLayers, loadDrawable } from "@/lib/dtf/render";
import type { Layer, SideId, TextLayer } from "@/lib/dtf/types";
import { photoExtent, photoFor } from "@/lib/dtf/mockups";
import { photoMaps, pressPrint, tinted, type PhotoMaps } from "../mockup/photoRender";
import { useStudio } from "./useStudio";

interface Props {
  side: SideId;
  /** Picture-in-picture: no handles, no chrome; a click hands focus back to the parent. */
  compact?: boolean;
  onActivate?: () => void;
  /** 1 = the whole garment; above 1 the view closes in on the print area. */
  zoom?: number;
}

type Drag =
  | { kind: "move"; id: string; startX: number; startY: number; px: number; py: number }
  | { kind: "resize"; id: string; sx: number; sy: number; start: Layer; ox: number; oy: number; free: boolean }
  | { kind: "rotate"; id: string; cx: number; cy: number; start: number; a0: number };

const SNAP_CM = 0.6;

export default function FlatEditor({ side, compact, onActivate, zoom = 1 }: Props) {
  const s = useStudio();
  const { project, selectedId, setSelectedId, dispatch, beginGesture, endGesture, mode } = s;
  const garment = getGarment(project.garmentId);
  const color = getColor(garment, project.colorId);
  const photo = photoFor(project.garmentId, side);
  const ext = useMemo(() => (photo ? photoExtent(photo) : garment.extents[side]), [photo, garment, side]);
  const zone = activeZone(project, side);
  const [maps, setMaps] = useState<PhotoMaps | null>(null);
  useEffect(() => {
    let live = true;
    setMaps(null);
    if (!photo) return;
    void photoMaps(photo.src, { flip: photo.flip }).then((m) => live && setMaps(m));
    return () => {
      live = false;
    };
  }, [photo]);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const [dropping, setDropping] = useState(false);
  const editing = mode === "edit" && !compact;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // cm ↔ px
  const view = useMemo(() => {
    if (!ext || !size.w || !size.h) return null;
    // A photo has margin around the cloth already, so it can fill the stage.
    const fit = Math.min(size.w / ext.w, size.h / ext.h) * (compact ? 0.98 : photo ? 1 : 0.92);
    const z = compact ? 1 : Math.max(1, zoom);
    const k = fit * z;
    const minX = ext.x - ext.w / 2;
    const maxY = ext.y + ext.h / 2;
    // Zoomed: keep the print area in the middle of the stage.
    const fx = z > 1 && zone ? zone.rect.x : ext.x;
    const fy = z > 1 && zone ? zone.rect.y : ext.y;
    const offX = size.w / 2 - (fx - minX) * k;
    const offY = size.h / 2 - (maxY - fy) * k;
    return {
      k,
      toPx: (x: number, y: number) => ({ x: offX + (x - minX) * k, y: offY + (maxY - y) * k }),
      toCm: (px: number, py: number) => ({ x: minX + (px - offX) / k, y: maxY - (py - offY) / k }),
    };
  }, [ext, size, compact, photo, zoom, zone]);

  const layers = sideLayers(project, side);

  // ----- draw -----
  const raf = useRef(0);
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!view || !ext) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = canvas.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(size.w * dpr);
      const h = Math.round(size.h * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // Draw the artwork in the canvas's own pixel space: the extent mapped to
      // the fitted rectangle, exactly as toPx() does.
      const tl = view.toPx(ext.x - ext.w / 2, ext.y + ext.h / 2);
      const off = (offscreen.current ??= document.createElement("canvas"));
      const ow = Math.max(1, Math.round(ext.w * view.k * dpr));
      const oh = Math.max(1, Math.round(ext.h * view.k * dpr));
      if (off.width !== ow || off.height !== oh) {
        off.width = ow;
        off.height = oh;
      }
      const missing = drawLayers(off.getContext("2d")!, layers, { extent: ext, pxPerCm: view.k * dpr, background: null });
      if (photo && maps) {
        // The real garment, recoloured, with the print pressed into it.
        ctx.imageSmoothingQuality = "high";
        // While editing, a faint ghost of any artwork that falls off the cloth
        // (drawn first, so the garment covers the part that lands on it).
        if (editing) {
          ctx.globalAlpha = 0.22;
          ctx.drawImage(off, tl.x * dpr, tl.y * dpr);
          ctx.globalAlpha = 1;
        }
        ctx.drawImage(tinted(maps, color.hex, Boolean(color.heather)), tl.x * dpr, tl.y * dpr, ow, oh);
        pressPrint(ctx, maps, off, tl.x * dpr, tl.y * dpr, ow, oh);
      } else if (!photo) {
        ctx.drawImage(off, tl.x * dpr, tl.y * dpr);
      }
      if (missing.length) {
        Promise.all(layers.filter((l) => l.kind === "image").map((l) => loadDrawable((l as { src: string }).src))).then(() => setSize((x) => ({ ...x })));
      }
    });
    return () => cancelAnimationFrame(raf.current);
  }, [view, ext, layers, size, photo, maps, color, editing]);

  // ----- hit testing -----
  const hit = useCallback(
    (cx: number, cy: number): Layer | null => {
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        const t = (-l.rotation * Math.PI) / 180;
        // Rotate the point into the layer's frame (side space is y-up; the
        // layer's clockwise screen rotation is counter-clockwise here).
        const dx = cx - l.x;
        const dy = cy - l.y;
        const lx = dx * Math.cos(-t) - dy * Math.sin(-t);
        const ly = dx * Math.sin(-t) + dy * Math.cos(-t);
        if (Math.abs(lx) <= l.w / 2 + 0.2 && Math.abs(ly) <= l.h / 2 + 0.2) return l;
      }
      return null;
    },
    [layers],
  );

  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (compact) return;
    if (!view || mode !== "edit") return;
    const { px, py } = local(e);
    const p = view.toCm(px, py);
    const l = hit(p.x, p.y);
    if (!l) {
      setSelectedId(null);
      return;
    }
    setSelectedId(l.id);
    if (l.locked) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    beginGesture();
    setDrag({ kind: "move", id: l.id, startX: l.x, startY: l.y, px: p.x, py: p.y });
  };

  const onHandleDown = (e: React.PointerEvent, kind: "resize" | "rotate", sx = 0, sy = 0) => {
    e.stopPropagation();
    const l = layers.find((x) => x.id === selectedId);
    if (!l || l.locked || !view) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    beginGesture();
    const c = view.toPx(l.x, l.y);
    if (kind === "rotate") {
      const { px, py } = local(e);
      setDrag({ kind: "rotate", id: l.id, cx: c.x, cy: c.y, start: l.rotation, a0: Math.atan2(py - c.y, px - c.x) });
      return;
    }
    // Opposite corner, screen px (y down; rotation clockwise-positive).
    const th = (l.rotation * Math.PI) / 180;
    const vx = (-sx * l.w * view.k) / 2;
    const vy = (-sy * l.h * view.k) / 2;
    const ox = c.x + vx * Math.cos(th) - vy * Math.sin(th);
    const oy = c.y + vx * Math.sin(th) + vy * Math.cos(th);
    setDrag({ kind: "resize", id: l.id, sx, sy, start: l, ox, oy, free: e.shiftKey && l.kind === "image" });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !view) return;
    const { px, py } = local(e);
    if (drag.kind === "move") {
      const p = view.toCm(px, py);
      let x = drag.startX + (p.x - drag.px);
      let y = drag.startY + (p.y - drag.py);
      const g = { x: false, y: false };
      if (zone && !e.altKey) {
        if (Math.abs(x - zone.rect.x) < SNAP_CM) {
          x = zone.rect.x;
          g.x = true;
        }
        if (Math.abs(y - zone.rect.y) < SNAP_CM) {
          y = zone.rect.y;
          g.y = true;
        }
      }
      setGuides(g);
      dispatch([{ op: "move", layerId: drag.id, x: round(x), y: round(y) }], { history: false });
    } else if (drag.kind === "rotate") {
      const a = Math.atan2(py - drag.cy, px - drag.cx);
      let deg = drag.start + ((a - drag.a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snap) < 3) deg = snap;
      dispatch([{ op: "rotate", layerId: drag.id, rotation: deg }], { history: false });
    } else {
      const l0 = drag.start;
      const th = (l0.rotation * Math.PI) / 180;
      const dx = px - drag.ox;
      const dy = py - drag.oy;
      // Into the layer frame.
      const lx = dx * Math.cos(-th) - dy * Math.sin(-th);
      const ly = dx * Math.sin(-th) + dy * Math.cos(-th);
      const w0 = l0.w * view.k;
      const h0 = l0.h * view.k;
      let w = Math.max(6, Math.abs(lx));
      let h = Math.max(6, Math.abs(ly));
      const free = drag.free || (e.shiftKey && l0.kind === "image");
      if (!free) {
        const sc = Math.max(w / w0, h / h0);
        w = w0 * sc;
        h = h0 * sc;
      }
      const hx = (drag.sx * w) / 2;
      const hy = (drag.sy * h) / 2;
      const cx = drag.ox + hx * Math.cos(th) - hy * Math.sin(th);
      const cy = drag.oy + hx * Math.sin(th) + hy * Math.cos(th);
      const c = view.toCm(cx, cy);
      if (l0.kind === "text") {
        const sc = w / w0;
        dispatch(
          [
            { op: "set-text", layerId: l0.id, fontSizeCm: Math.max(0.2, (l0 as TextLayer).fontSizeCm * sc) },
            { op: "move", layerId: l0.id, x: round(c.x), y: round(c.y) },
          ],
          { history: false },
        );
      } else {
        dispatch(
          [
            { op: "resize", layerId: l0.id, w: round(w / view.k), h: round(h / view.k) },
            { op: "move", layerId: l0.id, x: round(c.x), y: round(c.y) },
          ],
          { history: false },
        );
      }
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    setGuides({ x: false, y: false });
    endGesture();
  };

  // ----- overlay geometry -----
  const sel = layers.find((l) => l.id === selectedId) ?? null;

  const zonePx = zone && view ? { a: view.toPx(zone.rect.x - zone.rect.w / 2, zone.rect.y + zone.rect.h / 2), w: zone.rect.w * view.k, h: zone.rect.h * view.k } : null;
  const selPx = sel && view ? { c: view.toPx(sel.x, sel.y), w: sel.w * view.k, h: sel.h * view.k } : null;
  const outside = sel ? layerOutsideZone(project, side, sel.id) : false;

  if (!ext) return null;

  return (
    <div
      ref={wrap}
      className={`relative h-full w-full select-none ${compact ? "cursor-pointer" : ""}`}
      onPointerDown={compact ? undefined : onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={compact ? onActivate : undefined}
      onDragOver={(e) => {
        if (compact) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (compact) return;
        e.preventDefault();
        setDropping(false);
        if (e.dataTransfer.files.length) void s.addFiles(e.dataTransfer.files, side);
      }}
      role={compact ? "button" : "application"}
      aria-label={compact ? `Open the flat ${SIDE_LABEL[side]} artboard` : `${SIDE_LABEL[side]} artboard. Arrow keys nudge the selected layer.`}
    >

      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Print boundary — editing only, never in the customer preview */}
      {editing && zonePx && (
        <div
          className="pointer-events-none absolute"
          style={{ left: zonePx.a.x, top: zonePx.a.y, width: zonePx.w, height: zonePx.h, border: `1.5px dashed ${photo ? "rgba(11,143,176,0.75)" : "rgba(94,225,255,0.55)"}`, borderRadius: 3 }}
        >
          <span className={`mono absolute -top-5 left-0 whitespace-nowrap text-[10px] ${photo ? "text-[#0a7f9c]" : "text-[var(--accent)] opacity-80"}`}>
            {zone!.label} · {zone!.rect.w}×{zone!.rect.h} cm
          </span>
        </div>
      )}
      {editing && zonePx && guides.x && <div className="pointer-events-none absolute w-px bg-[var(--accent)]" style={{ left: zonePx.a.x + zonePx.w / 2, top: zonePx.a.y - 8, height: zonePx.h + 16 }} />}
      {editing && zonePx && guides.y && <div className="pointer-events-none absolute h-px bg-[var(--accent)]" style={{ top: zonePx.a.y + zonePx.h / 2, left: zonePx.a.x - 8, width: zonePx.w + 16 }} />}

      {/* Selection */}
      {editing && sel && selPx && (
        <div
          className="pointer-events-none absolute"
          style={{ left: selPx.c.x, top: selPx.c.y, width: 0, height: 0, transform: `rotate(${sel.rotation}deg)` }}
        >
          <div
            className="absolute"
            style={{
              left: -selPx.w / 2,
              top: -selPx.h / 2,
              width: selPx.w,
              height: selPx.h,
              outline: `1.5px solid ${outside ? "var(--warn)" : photo ? "#0b9fc4" : "var(--accent)"}`,
              outlineOffset: 1,
              borderRadius: 2,
            }}
          />
          {!sel.locked && (
            <>
              {[
                [-1, -1],
                [1, -1],
                [1, 1],
                [-1, 1],
              ].map(([sx, sy]) => (
                <span
                  key={`${sx}${sy}`}
                  className="dtf-handle pointer-events-auto"
                  style={{ left: (sx * selPx.w) / 2, top: (sy * selPx.h) / 2, cursor: sx === sy ? "nwse-resize" : "nesw-resize" }}
                  onPointerDown={(e) => onHandleDown(e, "resize", sx, sy)}
                />
              ))}
              <span className="pointer-events-none absolute w-px bg-[var(--accent)]" style={{ left: 0, top: -selPx.h / 2 - 22, height: 16 }} />
              <span
                className="dtf-handle pointer-events-auto"
                style={{ left: 0, top: -selPx.h / 2 - 26, borderRadius: 99, cursor: "grab" }}
                onPointerDown={(e) => onHandleDown(e, "rotate")}
                aria-label="Rotate"
              />
            </>
          )}
        </div>
      )}

      {/* Live measurement */}
      {editing && sel && selPx && drag && (
        <div className="mono pointer-events-none absolute rounded-md bg-black/80 px-2 py-1 text-[11px] text-white" style={{ left: selPx.c.x + 12, top: selPx.c.y + selPx.h / 2 + 14 }}>
          {drag.kind === "rotate" ? `${Math.round(sel.rotation)}°` : drag.kind === "move" ? `${fmt(sel.x)}, ${fmt(-sel.y)} cm` : `${fmt(sel.w)} × ${fmt(sel.h)} cm`}
        </div>
      )}

      {photo && !maps && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="dtf-pulse text-[11px] tracking-[0.2em] text-[#8a8f99]">LOADING GARMENT</div>
        </div>
      )}
      {editing && !layers.length && maps && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12.5px] text-[#6b707a]">Drop artwork on the shirt — or use Upload</div>
      )}
      {dropping && (
        <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-2xl border border-dashed border-[var(--accent)] bg-[rgba(94,225,255,0.06)] text-[13px] text-[var(--accent)]">
          Drop to place on the {SIDE_LABEL[side].toLowerCase()}
        </div>
      )}
    </div>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Bounds helper re-exported for the inspector's "fit to zone". */
export { layerBounds };
