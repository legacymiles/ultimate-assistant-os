import { ASPECTS, STYLES, type Aspect, type Brief, type StyleId } from "./types";

/** Validate a brief coming from the browser. Unknown values fall back to defaults. */
export function parseBrief(raw: unknown): Brief {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const style = STYLES.some((s) => s.id === b.style) ? (b.style as StyleId) : "stylized-3d";
  const aspect = ASPECTS.includes(b.aspect as Aspect) ? (b.aspect as Aspect) : "16:9";
  const len = typeof b.lengthSec === "number" && Number.isFinite(b.lengthSec) ? Math.round(b.lengthSec) : 30;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : undefined);
  return { style, aspect, lengthSec: Math.min(300, Math.max(6, len)), mood: text(b.mood), audience: text(b.audience) };
}
