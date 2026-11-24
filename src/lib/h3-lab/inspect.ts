// ---------------------------------------------------------------------------
// Continuity Inspector — evidence first.
//
// Measured issues come from ffmpeg numbers (scene changes, SSIM jumps,
// freezes, exposure, camera motion). Judged issues come from a vision model
// that was SHOWN the frames (and the previous scene's frames) and had to name
// which frame shows the problem. A change the spec marks intentional (someone
// walking across the room = "position") is never flagged as a defect.
// ---------------------------------------------------------------------------

import type { ClipMetrics, InspectionIssue, IssueKind, ShotSpec, Strategy } from "./model";
import { cameraMatch, suddenDrop } from "./score";

const KINDS: IssueKind[] = [
  "character-morph",
  "identity-change",
  "wardrobe-change",
  "body-change",
  "position-wrong",
  "environment-change",
  "furniture-moved",
  "object-missing",
  "lighting-jump",
  "camera-wrong",
  "movement-broken",
  "action-wrong",
  "unintended-cut",
  "frozen",
  "duplicate-subject",
];

/** Which intentional change makes an issue kind expected rather than a defect. */
const EXCUSED_BY: Partial<Record<IssueKind, ShotSpec["intentionalChanges"][number]>> = {
  "position-wrong": "position",
  "lighting-jump": "lighting",
  "wardrobe-change": "wardrobe",
  "environment-change": "environment",
  "furniture-moved": "environment",
  "object-missing": "props",
};

function nearestFrame(times: number[], t: number | null): number[] {
  if (t === null || !times.length) return [];
  let best = 0;
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
  return [best];
}

export function measuredIssues(m: ClipMetrics, spec: ShotSpec, structure: Strategy["structure"], previous?: ClipMetrics | null): InspectionIssue[] {
  const out: InspectionIssue[] = [];
  const allowed = structure === "timed-cuts" ? Math.max(0, spec.beats.length - 1) : 0;

  m.cuts.slice(allowed).forEach((c) =>
    out.push({
      kind: "unintended-cut",
      severity: "high",
      confidence: Math.min(0.95, 0.5 + c.score / 60),
      at: c.t,
      evidence: `Scene change detected at ${c.t.toFixed(1)}s (score ${c.score.toFixed(0)}) in a shot meant to be continuous.`,
      source: "measured",
      recommendation: "H3 cut inside the shot. Keep one action and one camera move, drop timing words, or set Shot structure to Timed cuts if a cut was wanted.",
      frames: nearestFrame(m.sampleTimes, c.t),
    }),
  );

  const cutNear = (t: number) => m.cuts.some((c) => Math.abs(c.t - t) < 0.6);
  const spike = suddenDrop(m);
  if (spike >= 0.5 && !cutNear(m.ssimMinAt)) {
    out.push({
      kind: "character-morph",
      severity: spike >= 0.75 ? "high" : "medium",
      confidence: spec.camera.speed === "fast" ? 0.3 : 0.45,
      at: m.ssimMinAt,
      evidence: `Frame-to-frame similarity drops to ${m.ssimMin.toFixed(2)} at ${m.ssimMinAt.toFixed(1)}s against this clip's mean of ${m.ssimAdjacent.toFixed(2)}, with no detected cut — something in frame transformed suddenly.`,
      source: "measured",
      recommendation: "Compare the frames either side. If a face or body changed: add a reference photo (fully_preserved) or switch Identity handling to an anchor clause; shorten the shot.",
      frames: nearestFrame(m.sampleTimes, m.ssimMinAt),
    });
  }

  const frozen = m.freezes.filter((f) => f.end - f.start >= 0.6);
  for (const f of frozen) {
    out.push({
      kind: "frozen",
      severity: f.end - f.start > 1.5 ? "high" : "medium",
      confidence: 0.8,
      at: f.start,
      evidence: `Picture frozen from ${f.start.toFixed(1)}s to ${f.end.toFixed(1)}s.`,
      source: "measured",
      recommendation: f.start < 0.8 ? "A warm-up freeze: start the action mid-event in frame one, or trim the head in the edit." : f.end > m.durationSec - 0.8 ? "A landing freeze: plan the shot longer than its slot and trim the tail." : "Mid-shot freeze: too many events packed in — one dominant action per cut, or supply an audio guide to keep motion going.",
      frames: nearestFrame(m.sampleTimes, f.start),
    });
  }

  for (let i = 1; i < m.luma.length; i++) {
    const jump = Math.abs(m.luma[i] - m.luma[i - 1]);
    if (jump > 28) {
      out.push({
        kind: "lighting-jump",
        severity: jump > 50 ? "high" : "medium",
        confidence: 0.6,
        at: m.sampleTimes[i] ?? null,
        evidence: `Mean brightness jumps ${m.luma[i - 1].toFixed(0)} → ${m.luma[i].toFixed(0)} between ${m.sampleTimes[i - 1]?.toFixed(1)}s and ${m.sampleTimes[i]?.toFixed(1)}s.`,
        source: "measured",
        recommendation: "Name the light sources and their direction once in the set description and keep them; avoid describing a lighting change unless it is intended.",
        frames: [i - 1, i],
      });
      break;
    }
  }

  const cam = cameraMatch(spec.camera.move, m.measuredMove);
  if (cam && cam.value <= 3) {
    out.push({
      kind: "camera-wrong",
      severity: "medium",
      confidence: 0.5,
      at: null,
      evidence: `Camera motion estimate: ${cam.why}.`,
      source: "measured",
      recommendation: "One camera sentence from the vocabulary, nothing else about the camera. If it was ignored, try the Plain & big camera wording or reduce subject travel competing with the move.",
      frames: [0, Math.max(0, m.sampleTimes.length - 1)],
    });
  }

  if (FAMILY_STILL.has(spec.camera.move) && m.ssimFirstLast < 0.35) {
    out.push({
      kind: "environment-change",
      severity: "medium",
      confidence: 0.35,
      at: null,
      evidence: `Locked-off camera, yet the first and last frames are only ${(m.ssimFirstLast * 100).toFixed(0)}% similar.`,
      source: "measured",
      recommendation: "Check the set in the first vs last frame. If furniture or walls changed: describe the layout explicitly and attach a set plate as partially_preserved.",
      frames: [0, Math.max(0, m.sampleTimes.length - 1)],
    });
  }

  if (previous && previous.luma.length && m.luma.length) {
    const a = previous.luma[previous.luma.length - 1];
    const b = m.luma[0];
    if (Math.abs(a - b) > 30) {
      out.push({
        kind: "lighting-jump",
        severity: "medium",
        confidence: 0.55,
        at: 0,
        evidence: `Across the join: previous scene ends at brightness ${a.toFixed(0)}, this one starts at ${b.toFixed(0)}.`,
        source: "measured",
        recommendation: "Match exposure at the cut (gain within ±10%) or carry the same lighting line into this scene's prompt.",
        frames: [0],
      });
    }
  }

  return out.filter((i) => !excused(i.kind, spec));
}

const FAMILY_STILL = new Set(["static", "pov"]);

function excused(kind: IssueKind, spec: ShotSpec): boolean {
  const by = EXCUSED_BY[kind];
  return Boolean(by && spec.intentionalChanges.includes(by));
}

/** Clean up what a judge returned: known kinds only, bounded numbers, excused changes dropped. */
export function judgedIssues(
  raw: { kind: string; severity: string; confidence: number; frame: number; evidence: string; recommendation: string }[],
  spec: ShotSpec,
  sampleTimes: number[],
): InspectionIssue[] {
  return (raw ?? [])
    .filter((r) => KINDS.includes(r.kind as IssueKind))
    .map((r) => {
      const frame = Number.isFinite(r.frame) ? Math.max(0, Math.min(sampleTimes.length - 1, Math.round(r.frame))) : 0;
      return {
        kind: r.kind as IssueKind,
        severity: (["low", "medium", "high"].includes(r.severity) ? r.severity : "medium") as InspectionIssue["severity"],
        confidence: Math.max(0, Math.min(0.9, Number(r.confidence) || 0.5)),
        at: sampleTimes[frame] ?? null,
        evidence: String(r.evidence ?? "").slice(0, 400),
        source: "vision" as const,
        recommendation: String(r.recommendation ?? "").slice(0, 400),
        frames: [frame],
      };
    })
    .filter((i) => i.evidence && !excused(i.kind, spec));
}

export function severityRank(i: InspectionIssue): number {
  return (i.severity === "high" ? 3 : i.severity === "medium" ? 2 : 1) * (0.5 + i.confidence);
}

export function sortIssues(issues: InspectionIssue[]): InspectionIssue[] {
  return [...issues].sort((a, b) => severityRank(b) - severityRank(a));
}

export const ISSUE_LABEL: Record<IssueKind, string> = {
  "character-morph": "Character morphing",
  "identity-change": "Facial identity change",
  "wardrobe-change": "Clothing change",
  "body-change": "Body proportion change",
  "position-wrong": "Wrong positioning",
  "environment-change": "Environment change",
  "furniture-moved": "Furniture moved",
  "object-missing": "Missing / duplicated object",
  "lighting-jump": "Lighting inconsistency",
  "camera-wrong": "Camera inconsistency",
  "movement-broken": "Broken movement continuity",
  "action-wrong": "Incorrect action",
  "unintended-cut": "Unintended scene change",
  frozen: "Frozen / dead shot",
  "duplicate-subject": "Duplicated subject",
};
