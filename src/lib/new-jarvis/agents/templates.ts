// ---------------------------------------------------------------------------
// Starting points for a 24/7 agent.
//
// A blank goal box is the hardest way to describe an agent that researches,
// hands results to an app and keeps going. A template fills in the shape —
// steps, where results go, how often it runs — and the owner edits the words.
// `{app}` is replaced with the app picked in the form, so one "App improver"
// template serves every app in the hub.
// ---------------------------------------------------------------------------

import type { AgentRepeat, ShipMode } from "./agents";

export interface AgentTemplate {
  id: string;
  name: string;
  /** One line under the name. */
  blurb: string;
  goal: string;
  steps: string[];
  /** Fixed targets ("app:ea-world"); `{app}` means the app chosen in the form. */
  sendsTo: string[];
  edits: string[];
  ship: ShipMode;
  repeat: AgentRepeat;
  /** True when it needs an app picked before it makes sense. */
  needsApp: boolean;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "ea-scout",
    name: "EA scout → EA World",
    blurb: "Finds the newest, most promising MT4/MT5 EAs and sends the top 10 to EA World to test.",
    goal:
      "Research the newest and most promising MT4 and MT5 Expert Advisors. Rank them on evidence, not marketing: " +
      "verified live or forward-test results (Myfxbook, FXBlue, MQL5 signals), max drawdown, months of history, " +
      "and how recently it was released or updated. Send the top 10 to EA World so it can test them and log the results.",
    steps: [
      "Search MQL5 Market, MQL5 signals, Myfxbook, Forex Factory and recent forum threads for EAs released or updated in the last 90 days",
      "Drop anything without verifiable results; note why for the ones that came close",
      "Rank the rest by drawdown-adjusted return and length of verified history",
      "Send the top 10 to EA World: name, platform (MT4/MT5), link, verified-results link, drawdown, months live, and why it made the list",
    ],
    sendsTo: ["app:ea-world"],
    edits: [],
    ship: "review",
    repeat: "weekly",
    needsApp: false,
  },
  {
    id: "researcher",
    name: "Research agent",
    blurb: "Keeps an app ahead: new competitors, features people ask for, what changed this week.",
    goal:
      "Research what is new around {app}: competitors, features people are asking for, and anything that changed this week. " +
      "Send {app} the three ideas most worth building, each with the evidence behind it.",
    steps: [
      "Search for {app}'s competitors and anything launched in the last two weeks",
      "Collect the features people ask for most, with links",
      "Pick the three ideas most worth building and send them to {app}'s queue",
    ],
    sendsTo: ["{app}"],
    edits: [],
    ship: "review",
    repeat: "weekly",
    needsApp: true,
  },
  {
    id: "marketer",
    name: "Marketing agent",
    blurb: "Writes this week's posts and a launch note for an app, filed in its queue.",
    goal:
      "Write this week's marketing for {app}: five short social posts, one longer post, and a launch note for the newest feature. " +
      "Match the app's own voice and send them to {app}'s queue for the owner to use.",
    steps: [
      "Read {app}'s page and latest changes to find what is new",
      "Write five short posts and one longer post",
      "Write a launch note for the newest feature",
      "Send all of it to {app}'s queue",
    ],
    sendsTo: ["{app}"],
    edits: [],
    ship: "review",
    repeat: "weekly",
    needsApp: true,
  },
  {
    id: "improver",
    name: "App improver",
    blurb: "Builds the top idea waiting in an app's queue, through the harness, for you to review.",
    goal:
      "Take the highest-value request waiting in {app}'s In Queue folder and build it. Keep the app's look and patterns, " +
      "run its typecheck and tests, and leave the change ready to land.",
    steps: [
      "Read {app}'s queue folder and pick the request with the most value for the least risk",
      "Build it in {app}'s code, following its existing patterns",
      "Run the typecheck and the tests that cover it",
    ],
    sendsTo: [],
    edits: ["{app}"],
    ship: "review",
    repeat: "daily",
    needsApp: true,
  },
];

/** The template with `{app}` filled in: the slug for wiring, the name for words. */
export function fillTemplate(
  t: AgentTemplate,
  app: { slug: string; name: string } | null,
): Pick<AgentTemplate, "goal" | "steps" | "sendsTo" | "edits" | "ship" | "repeat"> {
  const name = app?.name ?? "the app";
  const words = (s: string) => s.replaceAll("{app}", name);
  const wire = (xs: string[], prefix: string) =>
    xs.flatMap((x) => (x === "{app}" ? (app ? [prefix + app.slug] : []) : [x]));
  return {
    goal: words(t.goal),
    steps: t.steps.map(words),
    sendsTo: wire(t.sendsTo, "app:"),
    edits: wire(t.edits, ""),
    ship: t.ship,
    repeat: t.repeat,
  };
}
