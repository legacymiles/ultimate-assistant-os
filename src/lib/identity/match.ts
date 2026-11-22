"use client";

// ---------------------------------------------------------------------------
// Who is in this picture? — resolving an image the owner hands Jarvis to the
// enrolled identities, with the same matcher and thresholds Camera Autopilot
// uses. Only people whose face recognition is on can be found; everyone else
// is an unidentified face, never a guess.
// ---------------------------------------------------------------------------

import { getFaceSettings } from "./settings";
import { identityCardsNow, recognitionCast } from "./sync";

export interface FaceMatch {
  identityId: string;
  name: string;
  confidence: number;
}

export interface ImageIdentity {
  /** At or above the auto-assign threshold. */
  sure: FaceMatch[];
  /** Between the thresholds — ask before treating them as this person. */
  unsure: FaceMatch[];
  /** Faces matching nobody enrolled. */
  unidentified: number;
  /** False when nobody is enrolled or recognition is off — nothing was sent. */
  ran: boolean;
}

const NONE: ImageIdentity = { sure: [], unsure: [], unidentified: 0, ran: false };

export async function identifyImage(image: Blob | string): Promise<ImageIdentity> {
  if (!identityCardsNow().some((c) => c.enrolled)) return NONE;
  const settings = await getFaceSettings();
  if (!settings.enabled) return NONE;
  const cast = await recognitionCast();
  if (!cast.people.length) return NONE;
  const [{ analyzePhoto, buildContactSheet }, { gateFaces }] = await Promise.all([
    import("@/lib/recall/photos/vision"),
    import("@/lib/recall/photos/pipeline"),
  ]);
  const blob = typeof image === "string" ? await (await fetch(image)).blob() : image;
  const sheet = await buildContactSheet(cast.people, []);
  const raw = await analyzePhoto({ blob, name: "photo.jpg", sheet, folderPaths: [], existingTags: [] });
  if (raw.engine !== "ai") return NONE;
  const a = gateFaces(raw, settings);
  const byPerson = new Map(cast.people.map((p) => [p.id, p]));
  const toMatch = (h: { personId: string; confidence: number }): FaceMatch | null => {
    const p = byPerson.get(h.personId);
    return p?.identityId ? { identityId: p.identityId, name: p.name, confidence: h.confidence } : null;
  };
  const sure = a.people.map(toMatch).filter((x): x is FaceMatch => x !== null);
  const unsure = (a.uncertain ?? []).map(toMatch).filter((x): x is FaceMatch => x !== null);
  return { sure, unsure, unidentified: Math.max(0, a.unknownPeople - unsure.length), ran: true };
}

/** One line for an LLM prompt describing what recognition found. */
export function describeIdentity(r: ImageIdentity): string {
  if (!r.ran) return "";
  const parts: string[] = [];
  if (r.sure.length) parts.push(`recognised ${r.sure.map((m) => `${m.name} [identity ${m.identityId}] (${Math.round(m.confidence * 100)}%)`).join(", ")}`);
  if (r.unsure.length) parts.push(`possibly ${r.unsure.map((m) => `${m.name} [identity ${m.identityId}] (${Math.round(m.confidence * 100)}%, not sure — ask before assuming)`).join(", ")}`);
  if (r.unidentified) parts.push(`${r.unidentified} face${r.unidentified === 1 ? "" : "s"} nobody enrolled matches (unidentified — do not guess)`);
  return parts.length ? `[Face recognition on the attached photo: ${parts.join("; ")}.]` : "[Face recognition on the attached photo: no faces of enrolled people.]";
}
