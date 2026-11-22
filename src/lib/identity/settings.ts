// ---------------------------------------------------------------------------
// Face recognition settings — one switch and two thresholds, synced.
//
//   autoAssign   a match at or above this is filed as that person.
//   suggestFloor a match between this and autoAssign is UNCERTAIN: shown as
//                "Is this Brandy?" and used for nothing until the owner says
//                yes. Below it the face is simply unidentified.
//
// The vision route already drops anything under 0.5, so the floor cannot go
// lower than that.
// ---------------------------------------------------------------------------

import type { PersonHit } from "@/lib/recall/photos/types";

export const FACE_SETTINGS_KEY = "identity-settings:v1";
export const FACE_SETTINGS_CHANGED = "identity-settings-changed";

export interface FaceSettings {
  /** Master switch. Off: nobody is recognised, every face is unidentified. */
  enabled: boolean;
  autoAssign: number;
  suggestFloor: number;
}

export const DEFAULT_FACE_SETTINGS: FaceSettings = { enabled: true, autoAssign: 0.8, suggestFloor: 0.5 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function normalizeFaceSettings(raw: Partial<FaceSettings> | null | undefined): FaceSettings {
  const r = raw ?? {};
  const autoAssign = clamp(typeof r.autoAssign === "number" ? r.autoAssign : DEFAULT_FACE_SETTINGS.autoAssign, 0.55, 0.99);
  const suggestFloor = clamp(typeof r.suggestFloor === "number" ? r.suggestFloor : DEFAULT_FACE_SETTINGS.suggestFloor, 0.5, autoAssign);
  return { enabled: r.enabled !== false, autoAssign, suggestFloor };
}

export interface SplitHits {
  /** Sure enough to file by. */
  confirmed: PersonHit[];
  /** Ask the owner first. */
  uncertain: PersonHit[];
  /** Too weak to mention — count as an unidentified face. */
  dropped: number;
}

/** Sort recognition hits by the owner's thresholds. One hit per person, the strongest. */
export function splitHits(hits: PersonHit[], s: FaceSettings): SplitHits {
  const best = new Map<string, PersonHit>();
  for (const h of hits) {
    if (!h?.personId || typeof h.confidence !== "number") continue;
    const prev = best.get(h.personId);
    if (!prev || prev.confidence < h.confidence) best.set(h.personId, h);
  }
  const out: SplitHits = { confirmed: [], uncertain: [], dropped: 0 };
  for (const h of best.values()) {
    if (!s.enabled) out.dropped++;
    else if (h.confidence >= s.autoAssign) out.confirmed.push(h);
    else if (h.confidence >= s.suggestFloor) out.uncertain.push(h);
    else out.dropped++;
  }
  return out;
}

// --- storage (browser) -----------------------------------------------------------

export async function getFaceSettings(): Promise<FaceSettings> {
  if (typeof window === "undefined") return DEFAULT_FACE_SETTINGS;
  const { loadLocal } = await import("@/lib/sync/appState");
  return normalizeFaceSettings(loadLocal<Partial<FaceSettings> | null>(FACE_SETTINGS_KEY, null));
}

export async function saveFaceSettings(patch: Partial<FaceSettings>): Promise<FaceSettings> {
  const { saveSynced } = await import("@/lib/sync/appState");
  const next = normalizeFaceSettings({ ...(await getFaceSettings()), ...patch });
  saveSynced(FACE_SETTINGS_KEY, next);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FACE_SETTINGS_CHANGED));
  return next;
}
