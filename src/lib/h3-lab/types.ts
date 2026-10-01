// H3 Experiments — the shape of a video experiment.
//
// The point of this app is to answer one question honestly: for the SAME brief,
// which skill actually produces the better film? That only works if every run
// records what it was given and what came back, so the comparison is between
// skills rather than between half-remembered attempts.

import type { Method } from "./methods";

/** How a finished run was judged. Null until somebody actually watches it. */
export type Verdict = "good" | "mixed" | "bad" | null;

/** One rendered film, made by one skill, from one brief. */
export interface Run {
  id: string;
  /** The method that made it — matches Method.id. This is its folder. */
  skill: string;
  /** Which brief this was rendering, so runs line up across skills. */
  briefId: string;
  /** When it finished, ISO. */
  renderedAt: string;
  /** Path the local film API can serve, e.g. "muormijnfq2i/film-cut.mp4". */
  file: string;
  /** Seconds of finished film. */
  durationSec: number;
  /** Shot count, so a 12-cut film is distinguishable from a 3-scene one. */
  shots: number;
  /** The render settings that actually applied — steps, resolution, phases. */
  settings: string;
  verdict: Verdict;
  /** What was actually wrong or right. The most valuable field here. */
  notes: string;
  /** Defects seen on the grid, as short tags: "style break", "dead shot", "drift". */
  defects: string[];
}

/**
 * A brief is the controlled variable. Every skill renders the SAME one, which is
 * the only way the comparison means anything.
 */
export interface Brief {
  id: string;
  title: string;
  /** The story in plain words, exactly as it would be handed to any skill. */
  text: string;
  /** Target length. The owner's standard is a 20-second story. */
  seconds: number;
  createdAt: string;
}

export interface LabState {
  briefs: Brief[];
  runs: Run[];
  /** Skills the owner wants tested but which have no run yet, per brief. */
  dismissedGaps: string[];
}

export const EMPTY_LAB: LabState = { briefs: [], runs: [], dismissedGaps: [] };

export const LAB_KEY = "h3lab:v1";

/** A gap is one skill x brief pair with no run. This is the work queue. */
export interface Gap {
  skill: string;
  briefId: string;
  briefTitle: string;
}

export function gapId(skill: string, briefId: string): string {
  return `${skill}::${briefId}`;
}

/**
 * Every skill x brief pair that has never been rendered, minus the ones waved
 * off. Showing the gap is the whole reason the owner asked for this app: work
 * that has not been done should be visible rather than remembered.
 */
export function openGaps(state: LabState, methods: Method[]): Gap[] {
  const done = new Set(state.runs.map((r) => gapId(r.skill, r.briefId)));
  const waved = new Set(state.dismissedGaps);
  const gaps: Gap[] = [];
  for (const brief of state.briefs) {
    for (const method of methods) {
      const id = gapId(method.id, brief.id);
      if (done.has(id) || waved.has(id)) continue;
      gaps.push({ skill: method.id, briefId: brief.id, briefTitle: brief.title });
    }
  }
  return gaps;
}

/** Runs for one skill, newest first. */
export function runsForSkill(state: LabState, skill: string): Run[] {
  return state.runs
    .filter((r) => r.skill === skill)
    .sort((a, b) => b.renderedAt.localeCompare(a.renderedAt));
}

/** A skill's record at a glance: how many films, how many were any good. */
export function skillScore(state: LabState, skill: string): { runs: number; good: number; bad: number; rated: number } {
  const runs = state.runs.filter((r) => r.skill === skill);
  const rated = runs.filter((r) => r.verdict !== null);
  return {
    runs: runs.length,
    good: runs.filter((r) => r.verdict === "good").length,
    bad: runs.filter((r) => r.verdict === "bad").length,
    rated: rated.length,
  };
}

/**
 * Defects counted across every run of a skill. A skill that produces the same
 * defect five times has a pattern, and the pattern is what gets fixed.
 */
export function defectTally(state: LabState, skill?: string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const run of state.runs) {
    if (skill && run.skill !== skill) continue;
    for (const d of run.defects) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
