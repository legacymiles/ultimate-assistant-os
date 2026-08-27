// ---------------------------------------------------------------------------
// Blueprint — turn a raw idea into a structured overview and an optimized
// Claude Code prompt. These types are shared by the client UI, the API route
// and the heuristic (offline) engine.
// ---------------------------------------------------------------------------

export type BlueprintKind = "website" | "webapp" | "workflow";

export const KIND_LABELS: Record<BlueprintKind, string> = {
  website: "Website",
  webapp: "Web app",
  workflow: "Workflow / automation",
};

/** A single answered (or skipped) clarifying question. */
export interface Answer {
  question: string;
  answer: string;
}

/** Everything the user tells us up front. */
export interface Brief {
  idea: string;
  kind: BlueprintKind;
  audience: string;
  answers: Answer[];
  /** The named quality bar, carried from round 2 (Named + Fetchable + Comparable). */
  quality_bar?: string;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  hint?: string;
}

/** Round 2: adaptive follow-ups plus a proposed quality bar to beat. */
export interface Clarify2Result {
  questions: ClarifyingQuestion[];
  quality_bar: string;
}

export interface OverviewFeature {
  title: string;
  description: string;
}

/** A design/build skill the router recommends, with why it fits. */
export interface RecommendedSkill {
  skill: string;
  why: string;
}

/**
 * The editable heart of the app. Mirrors Projects Timeline's AnalystResult
 * (one_liner / overview / core / supporting) so it maps 1:1 onto a Project.
 */
export interface Overview {
  one_liner: string;
  purpose: string;
  /** The aesthetic/experience target in one sentence. */
  design_direction: string;
  /** The real, named reference this must beat (the gauntlet bar). */
  quality_bar: string;
  /** Which of the user's design skills to reach for, and why. */
  recommended_skills: RecommendedSkill[];
  core_features: OverviewFeature[];
  supporting_features: OverviewFeature[];
  stack: string[];
  open_questions: string[];
}

export interface GeneratedPrompt {
  prompt: string;
  engine: "ai" | "heuristic";
}

/** Which engine produced a stage's result — surfaced subtly in the UI. */
export type Engine = "ai" | "heuristic";

export const FEATURE_GROUP = {
  core: "core",
  supporting: "supporting",
} as const;

export function emptyOverview(): Overview {
  return {
    one_liner: "",
    purpose: "",
    design_direction: "",
    quality_bar: "",
    recommended_skills: [],
    core_features: [],
    supporting_features: [],
    stack: [],
    open_questions: [],
  };
}
