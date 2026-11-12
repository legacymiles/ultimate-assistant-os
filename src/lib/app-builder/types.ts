// ---------------------------------------------------------------------------
// App Builder — shared types.
//
// One App Builder project is one app idea on its way to being built: what the
// owner typed, the super agent's questions and their answers, what the agent
// understood the app is FOR, and the feature list the owner accepts, denies
// and edits. The UI, the API route and the pure engine all speak these.
// ---------------------------------------------------------------------------

import type { LookChoice } from "@/lib/mockup/types";

export type { LookChoice };

export type AppType = "webapp" | "website" | "mobile" | "saas" | "marketplace" | "tool" | "game";

export const APP_TYPE_LABEL: Record<AppType, string> = {
  webapp: "Web app",
  website: "Website",
  mobile: "Phone app",
  saas: "SaaS product",
  marketplace: "Marketplace",
  tool: "Tool / dashboard",
  game: "Game",
};

/** The kind of feature, which is also its ring in the orbit. */
export type FeatureKind = "core" | "experience" | "growth" | "trust" | "automation" | "money";

export const KIND_LABEL: Record<FeatureKind, string> = {
  core: "Core",
  experience: "Experience",
  growth: "Growth",
  trust: "Trust & safety",
  automation: "Automation",
  money: "Money",
};

export const KINDS: FeatureKind[] = ["core", "experience", "growth", "money", "automation", "trust"];

export type FeatureStatus = "proposed" | "accepted" | "denied";
export type Effort = "S" | "M" | "L";

/** How a scenario is proven: a Vitest unit test, a browser test, or a screenshot pair. */
export type Proof = "unit" | "browser" | "manual";

/**
 * One checkable moment in a feature — the thing that was missing from every
 * plan this app has ever written.
 *
 * A feature used to be a title, what it does and why, and nothing in it said
 * how anyone would KNOW it works. So every build ticket got the same generic
 * acceptance criteria, the brief asked for "a test per feature" without saying
 * what the test must show, and the build agent ended up grading its own work.
 *
 * A scenario is the fix, in the shape OpenSpec uses: WHEN something happens,
 * THEN something you can SEE happens. Text on screen, a row in a table, an
 * email sent, a redirect. Never "works well" or "feels premium" — those are
 * blocked by ./planCheck.ts before the build can start.
 */
export interface Scenario {
  /** "f3.s1" — the feature's id, then the scenario's number within it. */
  id: string;
  name: string;
  /** Optional starting state: "a logged-out visitor on /contact". */
  given?: string;
  when: string;
  then: string;
  proof: Proof;
  /** Written or reworded by the owner, so the agent never rewrites it. */
  source?: "agent" | "you";
}

export interface Feature {
  id: string;
  title: string;
  /** How it serves the app's purpose — the reason it was proposed. */
  why: string;
  /** What it actually does, concretely. */
  detail: string;
  kind: FeatureKind;
  /** 1 = nice, 2 = strong, 3 = makes the app. */
  impact: 1 | 2 | 3;
  effort: Effort;
  status: FeatureStatus;
  /** Who put it on the list. */
  source: "agent" | "you";
  /** Changed by the owner after the agent proposed it. */
  edited?: boolean;
  /** Build-checklist codes it closes (R2, L1…). */
  checklist?: string[];
  /**
   * How anyone tells this feature works. Every ACCEPTED feature needs at least
   * one — `planCheck` blocks Build it until it has one, and the brief, the
   * board cards and the gate all read these rather than inventing their own.
   */
  scenarios?: Scenario[];
}

export interface Question {
  id: string;
  label: string;
  hint?: string;
  /** Chips; the first is the recommended one. */
  options: string[];
  multi?: boolean;
  /** Also allow typing an answer. */
  free?: boolean;
}

export type Answers = Record<string, string | string[]>;

/** What the super agent understood the app is, and is for. */
export interface Understanding {
  name: string;
  oneLiner: string;
  appType: AppType;
  /** Why it exists, from the user's side. */
  purpose: string;
  audience: string;
  /** Felix: the end goal, and the goal beyond it. */
  endGoal: string;
  beyond: string;
  /** How it makes money, when it does. */
  model: string;
  /** The design skill that drives the look, and why. */
  designSkill: string;
  designWhy: string;
  /** Outside judges: 2–5 checkable lines. */
  judge: string[];
}

export interface ChatMsg {
  id: string;
  role: "you" | "agent";
  text: string;
  at: string;
  /** What the agent changed in reply, in plain words. */
  changes?: string[];
}

export type Stage = "idea" | "interview" | "features";

/** A video or picture the owner gave the agent to reverse-engineer. */
export interface MediaSource {
  id: string;
  kind: "video" | "image";
  name: string;
  /** Small preview (≈ 240 px). */
  thumb: string;
  /** Seconds, for a video. */
  duration?: number;
  /** How many frames the agent looked at. */
  frames: number;
  hasSound?: boolean;
  at: string;
}

/** Recreate what the recording shows, or change it to the owner's request. */
export type TeardownMode = "recreate" | "change";

/**
 * What the agent took apart from the recording: the screens, the flow, the
 * behaviour, the data behind it — the spec a rebuild is written from.
 */
export interface Teardown {
  mode: TeardownMode;
  /** What the recording shows, in two or three sentences. */
  summary: string;
  screens: { name: string; purpose: string; elements: string[] }[];
  /** The workflow, step by step, as the user in the video does it. */
  flow: string[];
  /** Behaviour worth keeping: interactions, states, automations, edge cases. */
  behaviours: string[];
  /** Data it must be storing (entities and fields), as best seen. */
  dataModel: string[];
  /** Best guess at how it is built, or "". */
  stackGuess: string;
  /** What the owner asked to change, kept in their words. */
  changes: string[];
  /** What a recording can't show — to check with the full video or the owner. */
  unknowns: string[];
}

/**
 * How far the build goes beyond the four stages — see ./depth.ts. Chosen for
 * the app, overridable by the owner, and written into the build brief so the
 * PC runs the right `commercial` steps.
 */
export type Depth = "plain" | "commercial" | "commercial-2x";

/**
 * The Client Review project this build posts itself to. App Builder opens it at
 * hand-off, so the moment Claude Code deploys the app it appears on a private
 * link where the owner (or whoever they send it to) can tap anything on the
 * page and ask for a change — and that change comes back here as an App Builder
 * edit (checklist C6).
 */
export interface ReviewLink {
  /** Client Review project id — `review_id` in the queue request. */
  id: string;
  /** The version being built — `version_id` in the queue request. */
  versionId: string;
  /** The private link's secret: /apps/client-review?site=<token>. */
  token: string;
  /** "v1", "v2" … */
  number: string;
  clientName?: string;
  at: string;
}

/**
 * The finished app: where it ended up once the build on the PC was done.
 * Saved on the project, so App Builder's list shows shipped apps rather than
 * only briefs, and so the link survives closing the tab.
 */
export interface BuiltApp {
  /** The GitHub repository the build created and pushed to. */
  repo?: string;
  /** Where it is live. */
  url?: string;
  /** The folder on the PC it was built in. */
  path?: string;
  at: string;
}

export interface Handoff {
  at: string;
  /**
   * The harness thread on the owner's PC that is building this — the build
   * itself, not a request for one. Kept here rather than in the hook so
   * closing the tab, or picking the phone up mid-build, comes back to it.
   */
  thread?: { id: string; at: string };
  /** Set once the build finished and said where it put things. */
  built?: BuiltApp;
  /**
   * Moving this app INTO the hub: the thread doing it, and the pull request it
   * opened. The standalone repository is untouched until `retiredAt`, so a
   * move that goes wrong costs a branch and nothing else.
   */
  absorb?: { threadId: string; at: string; prUrl?: string; retiredAt?: string };
  /** Only when the owner chose to file it for later instead of building now. */
  queueId?: string;
  cards?: { number: number; url?: string; title: string }[];
  /** The review link opened for this build, when there is one. */
  review?: ReviewLink;
  /** Client Review couldn't be opened; the build still runs. Plain English. */
  reviewError?: string;
}

/** One approved client edit, with where the client pointed. */
export interface ClientEditItem {
  /** The feature it became on the list. */
  featureId: string;
  requestId: string;
  /** What gets built (the owner's rewording when there is one). */
  text: string;
  /** The client's own words, when the owner reworded them. */
  clientText?: string;
  /** Where on the visible screen, as fractions, and the screen's width in px. */
  pin?: { x: number; y: number; viewport: number };
}

/**
 * An App Builder project that came from Client Review: approved edits to a
 * client's existing site, built on a branch of their repo and posted back to
 * their review link as the next version.
 */
export interface ClientEdit {
  reviewId: string;
  batchId: string;
  siteName: string;
  clientName: string;
  /** The version the client asked against, and its address. */
  fromVersion: string;
  fromUrl: string;
  /** The version being built. */
  version: string;
  versionId: string;
  repo?: string;
  vercelProject?: string;
  /**
   * One of the owner's own hub apps: its route ("/apps/cook-connect"). The
   * edit is to that app inside the hub repo, and the preview posted back is
   * the branch preview at this path.
   */
  appPath?: string;
  /** Branch from this (the branch on the client's screen, or main); build on that. */
  baseBranch: string;
  branch: string;
  /** The owner's approved build brief. */
  brief: string;
  items: ClientEditItem[];
}

export interface BuilderProject {
  id: string;
  createdAt: string;
  updatedAt: string;
  idea: string;
  stage: Stage;
  questions: Question[];
  answers: Answers;
  understanding?: Understanding;
  features: Feature[];
  chat: ChatMsg[];
  handoff?: Handoff;
  /** Videos and pictures the owner attached, newest first. */
  sources?: MediaSource[];
  /** Up to four frames kept for the build hand-off (In Queue takes four pictures). */
  keyframes?: string[];
  /** The reverse-engineered spec, when a recording was given. */
  teardown?: Teardown;
  /** Which engine wrote the last agent step. */
  engine?: "ai" | "offline";
  /** How far the build goes (./depth.ts). Unset = the depth the app earns. */
  depth?: Depth;
  /** The owner turned off opening a Client Review link at hand-off. */
  noReview?: boolean;
  /** Where the request came from. */
  origin?: "app" | "chat" | "autopilot" | "client-review" | "redesign";
  /** Set when this is a client edit from Client Review rather than a new app. */
  edit?: ClientEdit;
  /**
   * What the app does as of its last shipped build. Set by `foldSpec` when a
   * build reports done; read by the next edit so it diffs against the live
   * site instead of the original plan.
   */
  spec?: AppSpec;
  /**
   * The look the owner (or the client) picked from the mockup bake-off.
   *
   * Kept on the project because it has to outlive the tab and reach the build
   * brief: a direction chosen and then forgotten is a mockup panel that was
   * decoration. When it is set it OVERRIDES `understanding.designSkill` in the
   * brief and the skills pipeline — the owner looked at three drawings and
   * chose, which beats what the agent guessed from the idea.
   */
  look?: LookChoice;
  /** Handed over from Jarvis chat and not started yet: App Builder starts it on open. */
  pending?: boolean;
  /**
   * Set when this project is a REDESIGN of a live site (Website Redesigner).
   * The site's own content and behaviour, read from its URL: everything it
   * does is kept, only the look changes. Drives the interview, the features
   * (keep-alls first), the mockups (drawn with the site's real words) and the
   * build brief (edit the source, or recreate the front end).
   */
  redesign?: RedesignSource;
}

/** A live site to redesign, as the Redesigner read it. */
export interface RedesignSource {
  url: string;
  title: string;
  summary: string;
  nav: string[];
  ctas: string[];
  headings: string[];
  /** Colours the current site uses — the look being replaced. */
  colors: string[];
  /** What the site does, which the redesign must keep. */
  functionality: { kind: string; label: string; detail: string }[];
  /** The owner's own site: edit its source rather than recreate its front end. */
  ownSite: boolean;
  /** Repo or folder of the owner's own site. */
  sourcePath?: string;
  /** What the owner said they want from the redesign. */
  note?: string;
  /** Design skills the owner pinned in the Redesigner, first one leads. */
  skills?: string[];
  /** "low" when the page was JS-rendered and the read was thin. */
  confidence: "high" | "low";
}

/**
 * What the app DOES, as of the last build that shipped — its spec.
 *
 * The planning problem a spec solves is the second one: a website gets edited
 * for years, and every edit after the first was being written against the
 * ORIGINAL plan instead of the live site. So the accepted features and their
 * scenarios are frozen here when a build reports done, and the next edit is
 * written as a delta against this (./spec.ts): what it ADDS, MODIFIES or
 * REMOVES, with everything untouched carried along as "must still pass".
 */
export interface AppSpec {
  /** When this spec was taken (the build that shipped it). */
  at: string;
  /** The version it shipped as, when there is one ("v2"). */
  version?: string;
  /** Accepted features with their scenarios, as built. */
  features: Feature[];
}

/** One line of a change against the spec. */
export interface SpecDelta {
  kind: "added" | "modified" | "removed";
  featureId: string;
  title: string;
  /** What changed, in plain words. */
  detail?: string;
  /** Required for `removed` — OpenSpec's rule, and a good one. */
  reason?: string;
  /** Scenario ids this delta touches. */
  scenarios?: string[];
}

/** One thing the agent changes on the feature list. */
export type FeatureOp =
  | { op: "accept"; id: string }
  | { op: "deny"; id: string }
  | { op: "reset"; id: string }
  | { op: "edit"; id: string; title?: string; detail?: string; why?: string; scenarios?: Scenario[] }
  | { op: "scenario"; id: string; scenario: Partial<Scenario> & { when: string; then: string } }
  | { op: "add"; feature: Partial<Feature> & { title: string } }
  | { op: "acceptAll" }
  | { op: "denyRest" };
