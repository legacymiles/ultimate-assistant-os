// ---------------------------------------------------------------------------
// Mockups, stage two: the supporting pages and the journeys between them.
//
// Stage one is one screen — the main design, three ways, pick one. That is
// where every mockup in this hub has stopped, and it is why an approved look
// still left the build guessing at what the other pages were. Stage two is the
// rest of the site: the screens, what each one is FOR, what you can press on
// it and where that takes you, and the states each screen has when it is
// loading, empty, finished or broken.
//
// Three rules this file exists to enforce:
//
//   1. A flow is a GRAPH, not a gallery. Every link points at a screen that
//      exists, and every screen can be reached from home. `checkFlows` fails
//      the plan otherwise, so "a pile of unrelated screenshots" cannot be
//      approved by accident.
//   2. The states are part of the design. A screen that lists things has an
//      empty state and a loading state, or it is not designed yet.
//   3. A picture is not a flow. The plan is the brief for the ROUTES to build
//      — `flowsBrief` writes them out — and the real navigation, state and
//      behaviour are implemented in the build, never implied by an image.
//
// Engine-agnostic on purpose: the screens can be written here with no model at
// all (`draftFlows`), by the vision/writing model, or by a design engine that
// returns screens of its own. Whatever produces them, they arrive in this
// shape and are checked by the same rules.
//
// Pure: no React, no fetch, no storage.
// ---------------------------------------------------------------------------

import type { Feature, Understanding } from "@/lib/app-builder/types";

/** Which screen a journey starts from. Exactly one screen is the entry. */
export const HOME_ID = "home";

/** The states every screen can be drawn in. `ready` is the screen itself. */
export type ScreenState = "ready" | "loading" | "empty" | "success" | "error";

export const STATE_LABEL: Record<ScreenState, string> = {
  ready: "Ready",
  loading: "Loading",
  empty: "Nothing yet",
  success: "Done",
  error: "Something went wrong",
};

/**
 * The same states as the build is told them. A person judging a mockup reads
 * "Nothing yet"; an engineer building the page reads "empty" — and a brief
 * that says "States to build: nothing yet, done" is a brief nobody can act on.
 */
export const BUILD_STATE: Record<ScreenState, string> = {
  ready: "ready",
  loading: "loading",
  empty: "empty",
  success: "success",
  error: "error",
};

/** A press on a screen, and where it goes. */
export interface FlowLink {
  label: string;
  /** The id of the screen it opens. Must exist — `checkFlows` enforces it. */
  to: string;
  /** The main action on this screen, drawn as the primary button. */
  primary?: boolean;
}

export interface FlowScreen {
  id: string;
  name: string;
  /** What this screen is for, in one line. */
  purpose: string;
  /** The route it will be built at: "/", "/book", "/account/orders". */
  route: string;
  /** What fills it, in its own words — the sections or the rows. */
  content: string[];
  links: FlowLink[];
  /** The states this screen genuinely has. `ready` is always one of them. */
  states: ScreenState[];
  /** The feature ids this screen serves, so the build knows what it is for. */
  features?: string[];
  /** The owner's note on this screen, when they asked for a change. */
  note?: string;
}

/** One journey through the site, as a list of screen ids. */
export interface Journey {
  id: string;
  name: string;
  /** Why someone walks it. */
  goal: string;
  steps: string[];
}

export interface FlowPlan {
  /** Where the screens came from. */
  engine: "offline" | "ai" | "stitch";
  screens: FlowScreen[];
  journeys: Journey[];
  /** The one design system every screen is drawn in — the approved look. */
  look: string;
  /** Set once the owner approved it; the build reads the routes from here. */
  approvedAt?: string;
}

// ----- writing a plan with no model at all ------------------------------------------

const WORD = /[^a-z0-9]+/g;

export function routeOf(name: string, home = false): string {
  if (home) return "/";
  const slug = name.toLowerCase().replace(WORD, "-").replace(/^-|-$/g, "");
  return `/${slug || "page"}`;
}

export function idOf(name: string, taken: Set<string> = new Set()): string {
  const base = name.toLowerCase().replace(WORD, "-").replace(/^-|-$/g, "") || "screen";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
}

/** A screen that lists or loads things needs the states that go with that. */
function statesFor(purpose: string, isHome: boolean): ScreenState[] {
  const p = purpose.toLowerCase();
  const lists = /\b(list|browse|history|results|search|feed|orders|bookings|messages|gallery|library)\b/.test(p);
  const submits = /\b(book|buy|pay|send|submit|sign|register|contact|checkout|request|apply)\b/.test(p);
  const states: ScreenState[] = ["ready"];
  if (lists || submits || !isHome) states.push("loading");
  if (lists) states.push("empty");
  if (submits) states.push("success");
  if (lists || submits) states.push("error");
  return states;
}

/**
 * Words a screen's name must never end on.
 *
 * Cutting a feature title to its first few words is how "Share links with
 * friends" became the screen "Share links with" — a nav item that reads as a
 * sentence someone forgot to finish, and the clearest sign a page was
 * generated rather than designed.
 */
const DANGLING = new Set(["a", "an", "the", "in", "on", "at", "to", "for", "with", "from", "of", "and", "or", "by", "your", "my", "their", "its", "into", "about"]);

/** The destination a feature becomes: "Book a slot" → "Book", short and real. */
export function screenName(title: string): string {
  const head = title.split(/[,:–—(]/)[0].trim();
  const words = head.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (out.length >= 3) break;
    if (out.join(" ").length + w.length > 22) break;
    out.push(w);
  }
  // One word, not a chain: the cut can leave at most one word hanging, and
  // popping repeatedly turns "Sign in and manage your account" into "Sign".
  if (out.length > 1 && DANGLING.has(out[out.length - 1].toLowerCase())) out.pop();
  const name = (out.join(" ") || head.slice(0, 22)).trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * A complete, checkable flow plan from the approved features alone.
 *
 * Deliberately offline: the owner can reach stage two with no key set and no
 * PC running (checklist R4), and a model that does answer is improving this
 * plan rather than being the only way to have one.
 */
export function draftFlows(u: Understanding, features: Feature[], look: string): FlowPlan {
  const accepted = features.filter((f) => f.status === "accepted");
  const feats = (accepted.length ? accepted : features.filter((f) => f.status !== "denied")).slice(0, 6);
  const taken = new Set<string>([HOME_ID]);

  const homePurpose = u.oneLiner || u.purpose || `What ${u.name} is and who it is for`;
  const home: FlowScreen = {
    id: HOME_ID,
    name: "Home",
    purpose: homePurpose,
    route: "/",
    content: [u.oneLiner || u.name, ...feats.slice(0, 3).map((f) => f.title)],
    links: [],
    // The same rule the checker applies, from the same words — a draft that
    // asks for states it did not give itself is a plan that opens complaining
    // about its own home page.
    states: statesFor(`Home ${homePurpose}`, true),
  };

  const screens: FlowScreen[] = feats.map((f, i) => {
    const name = screenName(f.title);
    const id = idOf(name, taken);
    return {
      id,
      name,
      purpose: f.detail || f.why || f.title,
      route: routeOf(name),
      content: [f.title, f.detail || f.why].filter(Boolean),
      links: [{ label: "Home", to: HOME_ID }],
      states: statesFor(`${f.title} ${f.detail}`, false),
      features: [f.id],
      ...(i === 0 ? {} : {}),
    };
  });

  home.links = screens.map((s, i) => ({ label: s.name, to: s.id, ...(i === 0 ? { primary: true } : {}) }));

  // The first screen is the one someone came for, so it is the journey the
  // site is judged on. Every other screen gets a journey of its own, which is
  // what makes "every screen is reachable" true rather than hoped for.
  const journeys: Journey[] = screens.slice(0, 3).map((s) => ({
    id: `j-${s.id}`,
    name: `${s.name} — start to finish`,
    goal: s.purpose,
    steps: [HOME_ID, s.id],
  }));

  return { engine: "offline", screens: [home, ...screens], journeys, look };
}

// ----- checking a plan ---------------------------------------------------------------

export interface FlowProblem {
  /** The screen or journey it is about. */
  where: string;
  text: string;
  /** A missing state is worth fixing; a broken link makes the plan unbuildable. */
  fatal: boolean;
}

/**
 * Is this a connected set of screens, or a pile of pictures?
 *
 * Fatal problems are what stop a plan being approved: a link to a screen that
 * does not exist, a screen nothing links to, no home. The rest are told to the
 * owner as things to fix, because a site with no empty state ships one later,
 * usually as a blank white panel a client finds first.
 */
export function checkFlows(plan: FlowPlan): FlowProblem[] {
  const out: FlowProblem[] = [];
  const ids = new Set(plan.screens.map((s) => s.id));
  const home = plan.screens.find((s) => s.id === HOME_ID);
  if (!home) out.push({ where: "the plan", text: "There is no home screen for a journey to start from.", fatal: true });

  const routes = new Map<string, string>();
  for (const s of plan.screens) {
    for (const l of s.links) {
      if (!ids.has(l.to)) out.push({ where: s.name, text: `“${l.label}” points at a screen that doesn't exist.`, fatal: true });
    }
    const already = routes.get(s.route);
    if (already) out.push({ where: s.name, text: `Shares the route ${s.route} with ${already}.`, fatal: true });
    routes.set(s.route, s.name);
    if (!s.states.includes("ready")) out.push({ where: s.name, text: "Has no ready state.", fatal: true });
    if (!s.purpose.trim()) out.push({ where: s.name, text: "Doesn't say what it is for.", fatal: false });
    const wants = statesFor(`${s.name} ${s.purpose}`, s.id === HOME_ID);
    for (const w of wants) {
      if (!s.states.includes(w)) out.push({ where: s.name, text: `No ${STATE_LABEL[w].toLowerCase()} state.`, fatal: false });
    }
  }

  // Reachability from home, walking the links. An unreachable screen is a
  // screenshot, not part of a flow.
  const seen = new Set<string>([HOME_ID]);
  const queue = [HOME_ID];
  while (queue.length) {
    const id = queue.shift()!;
    for (const l of plan.screens.find((s) => s.id === id)?.links ?? []) {
      if (!seen.has(l.to) && ids.has(l.to)) {
        seen.add(l.to);
        queue.push(l.to);
      }
    }
  }
  for (const s of plan.screens) {
    if (!seen.has(s.id)) out.push({ where: s.name, text: "Nothing links to it — it can't be reached from home.", fatal: true });
  }

  for (const j of plan.journeys) {
    for (const step of j.steps) {
      if (!ids.has(step)) out.push({ where: j.name, text: `Walks through a screen that doesn't exist (${step}).`, fatal: true });
    }
  }
  return out;
}

/** Can the owner approve this plan and send it to be built? */
export function canApprove(plan: FlowPlan): boolean {
  return plan.screens.length > 0 && !checkFlows(plan).some((p) => p.fatal);
}

// ----- changing one screen -------------------------------------------------------------

/**
 * The owner's note on one screen, kept on that screen.
 *
 * Revising a screen never redraws the others: the design system is shared and
 * the rest of the plan has already been looked at, so one changed screen is
 * one changed screen.
 */
export function noteScreen(plan: FlowPlan, screenId: string, note: string): FlowPlan {
  return {
    ...plan,
    approvedAt: undefined,
    screens: plan.screens.map((s) => (s.id === screenId ? { ...s, note: note.trim() || undefined } : s)),
  };
}

export function replaceScreen(plan: FlowPlan, screen: FlowScreen): FlowPlan {
  return {
    ...plan,
    approvedAt: undefined,
    screens: plan.screens.map((s) => (s.id === screen.id ? { ...screen, note: undefined } : s)),
  };
}

export function approve(plan: FlowPlan, at = new Date().toISOString()): FlowPlan {
  return { ...plan, approvedAt: at };
}

// ----- what the build is told ----------------------------------------------------------

/**
 * The routes to build, as the brief carries them.
 *
 * This is the half that matters: the approved pictures are a reference for the
 * LOOK, and these lines are the contract for the BEHAVIOUR. Real routes, real
 * navigation, real state — a screenshot is never the deliverable, and the
 * block says so in as many words so no build can read it the other way.
 */
export function flowsBrief(plan: FlowPlan): string {
  if (!plan.screens.length) return "";
  const lines = plan.screens.map((s) => {
    const links = s.links.length
      ? s.links.map((l) => `${l.label} → ${plan.screens.find((x) => x.id === l.to)?.route ?? l.to}`).join(", ")
      : "no outbound links";
    const states = s.states.filter((x) => x !== "ready").map((x) => BUILD_STATE[x]);
    return [
      `- ${s.route} — ${s.name}: ${s.purpose}`,
      `  Holds: ${s.content.filter(Boolean).join("; ") || s.name}`,
      `  Goes to: ${links}`,
      states.length ? `  States to build: ${states.join(", ")}` : "",
      s.note ? `  The owner asked: ${s.note}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  const journeys = plan.journeys.map(
    (j) => `- ${j.name}: ${j.steps.map((id) => plan.screens.find((s) => s.id === id)?.route ?? id).join(" → ")} (${j.goal})`,
  );
  return [
    "<pages_and_flows>",
    `The owner approved these screens and the journeys between them, all drawn in ${plan.look}. Build every one as a real route.`,
    "",
    ...lines,
    "",
    journeys.length ? "The journeys that must work end to end:" : "",
    ...journeys,
    "",
    "These are a specification, not pictures. Build the actual navigation, the actual state and the actual behaviour: every link above is a working link to a built route, every state listed is a state the page really enters, and nothing is a static screenshot or a placeholder. A journey that cannot be walked in the browser is not done.",
    "</pages_and_flows>",
  ]
    .filter((l) => l !== "" || true)
    .join("\n");
}

/** One line for the queue brief, which has 4,000 characters for everything. */
export function flowsLine(plan: FlowPlan): string {
  if (!plan.screens.length) return "";
  return `Pages approved (${plan.screens.length}): ${plan.screens.map((s) => s.route).join(" ")} — build each as a real route with working navigation and its loading/empty/error states, never a screenshot.`;
}
