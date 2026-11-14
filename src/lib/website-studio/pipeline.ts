// ---------------------------------------------------------------------------
// Website Studio — the one stage order every website build runs.
//
// The owner's eight stages, in their words and their order:
//   Felix → Prompt Enhancer → Mockups → Commercial → Design Skill →
//   Impeccable → Software Factory → Claude Security
//
// and the one rule about WHEN they run: the first working website goes live
// before Software Factory starts. Backend depth (database, auth, APIs,
// production readiness) is the factory's job, done on a site people can
// already open, never a reason the first site is late.
//
// Before this file the order was written by hand in five places (the build
// brief, the queue line, the on-screen strip, a chat sentence and the board
// tickets) and every one of them put the factory BEFORE the site was live.
// They all read this now, so they cannot disagree again.
//
// Pure: no React, no fetch, no storage.
// ---------------------------------------------------------------------------

export type StageId =
  | "felix"
  | "prompt-enhancer"
  | "mockups"
  | "commercial"
  | "design-skill"
  | "impeccable"
  | "software-factory"
  | "claude-security";

/** Which stretch of the build a stage belongs to. */
export type Phase = "plan" | "first-site" | "after-live";

export interface StudioStage {
  id: StageId;
  label: string;
  phase: Phase;
  /** One plain line: what this stage is responsible for. */
  does: string;
}

/** The eight stages, in the owner's order. This is what the strip shows. */
export const STAGES: readonly StudioStage[] = [
  { id: "felix", label: "Felix", phase: "plan", does: "The end goal and the goal beyond it, before anything is drawn." },
  { id: "prompt-enhancer", label: "Prompt Enhancer", phase: "plan", does: "Turns the idea and the answers into a sharp brief." },
  { id: "mockups", label: "Mockups", phase: "plan", does: "The main design first, then the supporting pages as a clickable flow." },
  { id: "commercial", label: "Commercial", phase: "first-site", does: "Apple-standard look, first-run and growth, with the foundation in demo mode." },
  { id: "design-skill", label: "Design Skill", phase: "first-site", does: "The picked design skills own the look of every page." },
  { id: "impeccable", label: "Impeccable", phase: "first-site", does: "The closing craft pass on every screen and every state." },
  { id: "software-factory", label: "Software Factory", phase: "after-live", does: "Backend, database, sign-in, APIs and production readiness, once the site is live." },
  { id: "claude-security", label: "Claude Security", phase: "after-live", does: "A check before the first deploy, then the deep backend scan after the factory." },
];

export const PHASE_LABEL: Record<Phase, string> = {
  plan: "Plan",
  "first-site": "First site",
  "after-live": "After it's live",
};

/**
 * The order things actually execute in. It differs from STAGES in exactly two
 * ways, both asked for: Mockups is two reviews (main design, then pages and
 * flows), and Claude Security is two passes (a check before the first deploy,
 * the deep scan after the factory). `live` is the moment the owner has a link.
 */
export type RunStep =
  | "felix"
  | "prompt-enhancer"
  | "mockups-main"
  | "mockups-flows"
  | "commercial"
  | "design-skill"
  | "impeccable"
  | "security-check"
  | "live"
  | "software-factory"
  | "security-deep";

export const RUN_ORDER: readonly RunStep[] = [
  "felix",
  "prompt-enhancer",
  "mockups-main",
  "mockups-flows",
  "commercial",
  "design-skill",
  "impeccable",
  "security-check",
  "live",
  "software-factory",
  "security-deep",
];

/** True when `a` runs before `b`. The rule the tests hold the briefs to. */
export function runsBefore(a: RunStep, b: RunStep): boolean {
  return RUN_ORDER.indexOf(a) < RUN_ORDER.indexOf(b);
}

// ----- what the PC is told ---------------------------------------------------------------

/** The role lines for the stages whose timing changed. One wording, used by every brief. */
export const ROLE = {
  commercialFirstSite:
    "For the first site, build the foundation in demo mode (every route, table and setting exists and works with no keys). Software Factory makes it production-grade after the site is live — do not hold the first site for it.",
  securityCheck:
    "Before the first deploy, a fast check of what ships now: no secret in the browser bundle, every input validated on the server, owner and client boundaries on each route that exists, dependencies audited. Fix anything high or critical before it goes live.",
  softwareFactory:
    "ONLY AFTER the first working site is live and you have reported its address — never before, and never a reason the first site is late. Then split the deeper engineering into Backlog cards (one PR under ~400 lines each) and run super-board: backend architecture, database design, authentication, API integrations, data models, performance and scalability, production readiness. A human approves every merge; each merged card redeploys the site by itself.",
  securityDeep:
    "After Software Factory: the deep scan of the backend it built — sign-in, row-level security, API routes, data handling. Fix every high or critical finding in its own PR before production.",
} as const;

/** The block every new-site brief carries, so the order is a rule and not a hint. */
export function shipFirstBlock(): string {
  return [
    "<ship_first>",
    "Get the first working website live as fast as it can be done well. Real pages, real routes, real navigation and working interactions, on a deployed address the owner can open.",
    "Software Factory does NOT run during this first build. Backend architecture, database design, production authentication, third-party API integrations and scaling work wait until the site is live; until then anything that needs them runs in a visible demo mode with no keys.",
    "The moment the site is live and tested, report its address (the finish lines below). The Studio then sends the next message itself, starting Software Factory and the deep security scan on the live site. Do not start them on your own, and do not wait for them before reporting.",
    "</ship_first>",
  ].join("\n");
}

/** The short form of the order, for the queue line (In Queue holds 4,000 characters). */
export const SHIP_FIRST_LINE =
  "Ship first: get the first working site LIVE and report its address before software-factory starts; backend depth and the deep security scan come after.";

/**
 * The message said into the same build thread once the first site is live.
 * This is what makes "Software Factory runs after the site is live" a thing
 * that happens rather than a sentence in a brief.
 */
export function factoryBrief(input: { name: string; liveUrl: string; repo?: string }): string {
  const name = input.name.trim() || "the site";
  return [
    "<after_live>",
    `${name} is live at ${input.liveUrl}${input.repo ? ` (repository ${input.repo})` : ""}. The owner is already using it, so from here every change must leave it working.`,
    "Now run the stages that were held back, in this order:",
    `1. software-factory — ${ROLE.softwareFactory.replace(/^ONLY AFTER[^.]*\. Then s/, "S")}`,
    `2. claude-security — ${ROLE.securityDeep}`,
    "Work in small pull requests. After each one merges, confirm the live site still opens and say what it added in one plain line.",
    "Finish with `Factory: done` on its own line, then a list of what was added and anything that still needs a key or a decision from the owner.",
    "</after_live>",
  ].join("\n");
}

/** The line that ends the after-live turn, read back by the Studio. */
export const FACTORY_DONE = /^\s*Factory:\s*done\b/im;

// ----- where a project stands ------------------------------------------------------------

export type StageState = "done" | "now" | "wait";

/** What is known about one project. Every field is a plain fact, read off its data. */
export interface StageFacts {
  /** The idea has been understood (Felix's questions answered). */
  understood: boolean;
  /** At least one feature is accepted. */
  planned: boolean;
  /** A main design was picked. */
  lookPicked: boolean;
  /** The supporting pages and flows were approved. */
  flowsApproved: boolean;
  /** A build thread is running or has run. */
  buildStarted: boolean;
  /** The first site has an address. */
  live: boolean;
  /** The after-live message was sent. */
  factoryStarted: boolean;
  /** The after-live turn ended with `Factory: done`. */
  factoryDone: boolean;
  /** Plain depth: there is no commercial stage to run. */
  plain?: boolean;
  /**
   * Nothing is building right now.
   *
   * A site that has been live for weeks with no thread running has not got
   * Software Factory "starting now" — it has got nothing happening, and the
   * after-live work begins with the next build. Saying otherwise is the kind
   * of hopeful status line nobody can act on.
   */
  idle?: boolean;
}

/**
 * Each of the eight stages as done / now / waiting. Exactly one is "now"
 * unless everything is done, so the strip always shows where the build is.
 */
export function stageStates(f: StageFacts): { stage: StudioStage; state: StageState; note: string }[] {
  const done: Record<StageId, boolean> = {
    felix: f.understood,
    "prompt-enhancer": f.planned,
    mockups: f.lookPicked && f.flowsApproved,
    commercial: f.live || Boolean(f.plain),
    "design-skill": f.live,
    impeccable: f.live,
    "software-factory": f.factoryDone,
    "claude-security": f.factoryDone,
  };
  const note: Record<StageId, string> = {
    felix: "end goal first",
    "prompt-enhancer": "sharp brief",
    mockups: f.lookPicked ? (f.flowsApproved ? "approved" : "pages and flows next") : "main design first",
    commercial: f.plain ? "not needed" : "demo-mode foundation",
    "design-skill": "owns the look",
    impeccable: "closing craft pass",
    "software-factory": f.live
      ? f.factoryStarted
        ? "deepening the live site"
        : f.idle
          ? "with the next build"
          : "starts now"
      : "after it's live",
    "claude-security": f.live ? "deep scan after the factory" : "check before deploy",
  };
  let nowGiven = false;
  return STAGES.map((stage) => {
    if (done[stage.id]) return { stage, state: "done" as const, note: note[stage.id] };
    // The first-site stages only begin once a build has; before that the
    // owner is still planning, and showing "Commercial: now" would be a lie.
    // The after-live stages need a build running to be happening at all.
    const blocked =
      (stage.phase === "first-site" && !f.buildStarted) ||
      (stage.phase === "after-live" && (!f.live || (Boolean(f.idle) && !f.factoryStarted)));
    if (!nowGiven && !blocked) {
      nowGiven = true;
      return { stage, state: "now" as const, note: note[stage.id] };
    }
    return { stage, state: "wait" as const, note: note[stage.id] };
  });
}

/** Whether the Studio should now send the after-live message. Never twice, never early. */
export function shouldStartFactory(f: Pick<StageFacts, "live" | "factoryStarted" | "factoryDone">): boolean {
  return f.live && !f.factoryStarted && !f.factoryDone;
}
