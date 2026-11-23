"use client";

import { useEffect, useRef } from "react";
import { getColor, getGarment } from "@/lib/dtf/garments";
import { photoFor } from "@/lib/dtf/mockups";
import { sideLayers } from "@/lib/dtf/project";
import { loadDrawable } from "@/lib/dtf/render";
import type { DesignProject, SideId } from "@/lib/dtf/types";
import { renderProductMockup } from "../mockup/photoRender";

/**
 * The real garment photo in the project's colour with the artwork pressed on:
 * the same renderer as the studio stage, at thumbnail size.
 */
export default function FlatThumb({ project, side, width = 160, className = "" }: { project: DesignProject; side?: SideId; width?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const g = getGarment(project.garmentId);
  const s: SideId = side ?? (project.layers.some((l) => l.side === "front" && !l.hidden) || !project.layers.length ? "front" : (project.layers.find((l) => !l.hidden)?.side ?? "front"));
  useEffect(() => {
    let live = true;
    const photo = photoFor(project.garmentId, s) ?? photoFor(project.garmentId, "front");
    const c = ref.current;
    if (!c || !photo) return;
    const color = getColor(g, project.colorId);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const layers = sideLayers(project, s);
    const images = layers.filter((l) => l.kind === "image").map((l) => (l as { src: string }).src);
    void Promise.all(images.map((src) => loadDrawable(src)))
      .then(() => renderProductMockup(photo, color.hex, Boolean(color.heather), layers, Math.round(width * dpr), null))
      .then((out) => {
        if (!live || !out || !ref.current) return;
        const cv = ref.current;
        cv.width = out.width;
        cv.height = out.height;
        const ctx = cv.getContext("2d")!;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(out, 0, 0);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, s, width]);
  return <canvas ref={ref} className={className} style={{ width, aspectRatio: "1 / 1" }} role="img" aria-label={`${g.name}, ${s}`} />;
}
