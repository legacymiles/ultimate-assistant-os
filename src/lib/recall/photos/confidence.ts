// ---------------------------------------------------------------------------
// Camera Autopilot's confidence score — how sure Jarvis is that its guess is
// where the owner wants this photo, and it teaches itself.
//
// The vision model rates its own guess (0-1). That number is then calibrated
// against what the owner actually did with past guesses (the shared engine in
// lib/confidence/calibrate.ts): a destination the owner keeps re-routing drops,
// one they file as guessed rises. Things the queue already knows lower it too
// — not read by AI, looks like a duplicate, a stranger in the shot, a guess a
// destination couldn't verify.
//
// The score never files anything. Every photo still waits for "File it"
// (owner's rule, Oct 2026: everything is approved, whatever the score). It
// sorts and filters the queue so the owner can clear the sure ones fast and
// look hard at the unsure ones.
//
// Pure, apart from reading the destination registry for the "unverified" flag.
// ---------------------------------------------------------------------------

import { calibrate, type Confidence, type Outcome } from "@/lib/confidence/calibrate";
import { destinationById } from "@/lib/dashboard/destinations/registry";
import type { PendingPhoto } from "./types";

/** What kind of guess this is, for the track record: "Folders › Receipts", "Calendar". */
export function photoKind(p: PendingPhoto, where: string): string {
  const parts = where.split(" › ").filter(Boolean);
  // People folders are told apart by who is in them; everything else by its app/top folder.
  const depth = parts[0] === "Photos" ? 2 : 1;
  return `${p.analysis?.route ?? "info"}:${parts.slice(0, depth).join(" › ") || "Inbox"}`;
}

/** The model's own number before calibration, with the queue's own doubts applied. */
export function rawConfidence(p: PendingPhoto): number {
  const a = p.analysis;
  if (!a) return 0;
  if (a.engine === "heuristic") return 0.15;
  let raw = typeof a.confidence === "number" ? a.confidence : 0.6;
  if (p.duplicateOf && !p.keepDuplicate) raw *= 0.6;
  if ((a.unknownPeople ?? 0) > 0 && a.route === "people") raw *= 0.8;
  if (a.destination) {
    const d = destinationById(a.destination.id);
    const f = d?.parse(a.destination.fields);
    if (d && f && d.preview(f).unverified) raw *= 0.75;
    if (d && !f) raw *= 0.5;
  }
  if (a.route === "event" && !a.event?.date) raw *= 0.6;
  return Math.max(0, Math.min(1, raw));
}

/** The score for one waiting photo, or null while it is still being read. */
export function photoConfidence(p: PendingPhoto, where: string, outcomes: Outcome[]): Confidence | null {
  if (p.status !== "ready" || !p.analysis) return null;
  // The owner put it there by hand: it is where they want it.
  if (p.overridden) return { score: 99, band: "high", why: "You chose this place yourself.", basis: 0 };
  const c = calibrate(rawConfidence(p), photoKind(p, where), outcomes, where);
  // The owner's own words steer the guess; a guess that followed them is worth more.
  if (p.userPrompt && c.score < 85) return { ...c, score: Math.max(c.score, 85), band: "high", why: "Following what you told Jarvis about this photo." };
  const modelWhy = p.analysis.confidenceWhy;
  return modelWhy && c.basis < 2 ? { ...c, why: modelWhy } : c;
}
