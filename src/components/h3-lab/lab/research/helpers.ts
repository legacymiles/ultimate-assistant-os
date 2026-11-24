"use client";

// Small shared helpers for the research sections. Everything here reads
// lab state or the browser; nothing invents a number.

import type { Generation, LabState, ShotSpec } from "@/lib/h3-lab/model";
import { estimateMinutes } from "@/lib/h3-lab/wangp";

export type Quality = "turbo" | "hi";

/** The quality a generation was rendered at, from its WanGP settings (20 steps = hi, 4 = turbo). */
export function qualityOf(g: Generation): Quality | null {
  const steps = (g.settings as { num_inference_steps?: unknown }).num_inference_steps;
  if (steps === 20) return "hi";
  if (steps === 4) return "turbo";
  return null;
}

/** What this PC has actually rendered: frames, seconds and quality of every finished render with a timing. */
export function measuredRenders(state: LabState): { frames: number; seconds: number; quality: Quality }[] {
  const out: { frames: number; seconds: number; quality: Quality }[] = [];
  for (const g of state.generations) {
    if (g.status !== "done" || !g.renderSeconds) continue;
    const q = qualityOf(g);
    const frames = Number((g.settings as { video_length?: unknown }).video_length);
    if (!q || !Number.isFinite(frames) || frames <= 0) continue;
    out.push({ frames, seconds: g.renderSeconds, quality: q });
  }
  return out;
}

/** Minutes for one render of a spec at the lab's quality, plus how the estimate was made. */
export function renderEstimate(state: LabState, spec: ShotSpec): { minutes: number | null; basis: string } {
  const measured = measuredRenders(state);
  const q = state.agent.quality;
  const n = measured.filter((m) => m.quality === q).length;
  const minutes = estimateMinutes(spec, q, measured);
  const basis = n ? `median of ${n} measured ${q} render${n === 1 ? "" : "s"} on this PC` : q === "turbo" ? "the one turbo figure measured before the lab (5.7 min / 124 frames)" : "no hi-quality render measured yet";
  return { minutes, basis };
}

/** Renders still allowed today, without mutating state (the server rolls the counter). */
export function rendersLeftToday(state: LabState): number {
  const today = new Date().toISOString().slice(0, 10);
  const used = state.counters.day === today ? state.counters.renders : 0;
  return Math.max(0, state.agent.rendersPerDay - used);
}

export function fmtMinutes(m: number | null): string {
  if (m === null) return "unmeasured";
  if (m < 60) return `${m.toFixed(m < 10 ? 1 : 0)} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${Math.round(m - h * 60)} min`;
}

/** Downscale a picked photo to a JPEG data URL (longest edge `max`). */
export function downscaleImage(file: File, max = 768, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const g = c.getContext("2d");
      URL.revokeObjectURL(url);
      if (!g) {
        reject(new Error("This browser cannot draw images."));
        return;
      }
      g.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} is not an image this browser can read.`));
    };
    img.src = url;
  });
}

/** "Title of the scenario / production scene" for a generation. */
export function generationTitle(state: LabState, g: Generation): string {
  if (g.productionId) {
    const p = state.productions.find((x) => x.id === g.productionId);
    const sc = p?.scenes.find((s) => s.id === g.sceneId);
    return p ? `${p.title} · ${sc ? `scene ${sc.order + 1}${sc.spec.title ? ` — ${sc.spec.title}` : ""}` : "scene"}` : "Production render";
  }
  const sc = state.scenarios.find((s) => s.id === g.scenarioId);
  if (sc) return sc.title;
  return g.pairKey.startsWith("single-") ? "Single test render" : "Render";
}

export function splitLines(s: string): string[] {
  return s.split("\n").map((x) => x.trim()).filter(Boolean);
}
