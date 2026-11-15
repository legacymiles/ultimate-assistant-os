// ---------------------------------------------------------------------------
// Website Studio — how much machinery an edit gets, and the checklist it shows.
//
// "Change the colour to blue" took 24 minutes. The build log says why: a
// one-line edit was handed the new-app road — felix, prompt-enhancer, design
// intelligence, software-factory, a security scan, the whole 4,989-test suite,
// a full production build, two design-check crawls, screenshots, then minutes
// polling CI and the preview before merging — and once it was live the Studio
// said Software Factory into the same thread on top. None of that is what an
// edit to a live site needs.
//
// So an edit has a lane:
//
//   quick — the default for an edit. Find the code, change it, typecheck,
//           merge. CI runs the full gate on main after the merge, the PC checks
//           the page in a browser after the agent's last word, and Vercel only
//           promotes a build that succeeds, so nothing it skips is unguarded.
//   full  — the old road, plus Software Factory after it is live. What a NEW
//           website gets, and one switch in the side panel for an edit that is
//           really a feature.
//
// The checklist is what the owner watches while it works: Claude's own task
// list when it keeps one (the bridge relays TodoWrite / TaskCreate as `plan`
// events), otherwise the lane's steps, ticked off from the tools it has run.
//
// Pure: no React, no fetch, no storage.
// ---------------------------------------------------------------------------

import type { ThreadView, ToolRow } from "@/lib/new-jarvis/harness/types";

export type Lane = "quick" | "full";

export function laneFor(factory: boolean): Lane {
  return factory ? "full" : "quick";
}

/**
 * The tag only a quick edit's brief carries. Reading the lane off the thread
 * itself means every device watching it agrees, and a reload cannot forget.
 */
export const QUICK_MARK = "<speed>";

/** Which lane a running thread is on. A thread with no quick brief is the full road. */
export function laneOf(view: ThreadView): Lane {
  return view.turns.some((t) => t.prompt.includes(QUICK_MARK)) ? "quick" : "full";
}

/**
 * Should the Studio say Software Factory into this thread once it is live?
 * Never on a quick edit — that follow-up after every edit was most of why an
 * edit "kept running" long after it was live. A new website, or an edit the
 * owner switched the factory on for, gets it as before.
 */
export function wantsFactory(view: ThreadView): boolean {
  return laneOf(view) === "full";
}

export type CheckState = "done" | "now" | "todo";

export interface CheckItem {
  text: string;
  state: CheckState;
}

interface Step {
  text: string;
  /** Has a tool that proves this step happened run (and not failed)? */
  done: (tools: ToolRow[]) => boolean;
}

const ran = (tools: ToolRow[], re: RegExp) => tools.some((t) => t.status === "ok" && re.test(`${t.command}\n${t.title}`));
const wrote = (tools: ToolRow[]) => tools.some((t) => t.kindOf === "write" && t.status === "ok");

const QUICK: Step[] = [
  { text: "Read your edit", done: (t) => t.length > 0 },
  { text: "Find the code", done: (t) => wrote(t) || t.some((x) => x.kindOf === "read" && /\bsrc\//.test(x.path || x.title)) },
  { text: "Make the change", done: wrote },
  { text: "Check it compiles", done: (t) => ran(t, /\btsc\b/) },
  { text: "Commit and push", done: (t) => ran(t, /\bgit\s+push\b/) },
  { text: "Merge to main", done: (t) => ran(t, /\bgh\s+pr\s+merge\b/) },
];

const FULL: Step[] = [
  { text: "Read your edit", done: (t) => t.length > 0 },
  { text: "Make the change", done: wrote },
  { text: "Test it", done: (t) => ran(t, /\b(vitest|npm\s+(run\s+)?test|tsc)\b/) },
  { text: "Check the design", done: (t) => ran(t, /design-check|JARVIS_DESIGN_CHECK|browser_take_screenshot/) },
  { text: "Open the pull request", done: (t) => ran(t, /\bgh\s+pr\s+create\b/) },
  { text: "Merge to main", done: (t) => ran(t, /\bgh\s+pr\s+merge\b/) },
];

const LIVE = "Live on the site";

function agentPlan(view: ThreadView): { text: string; status: string }[] {
  for (let i = view.turns.length - 1; i >= 0; i--) {
    const plan = view.turns[i].plan;
    if (plan?.length) return plan;
  }
  return [];
}

function stateOf(status: string): CheckState {
  const s = status.toLowerCase();
  if (s === "completed" || s === "done") return "done";
  if (s === "in_progress" || s === "in-progress" || s === "active") return "now";
  return "todo";
}

/**
 * The checklist for a build that is running (or just finished).
 *
 * `live` is whether the version is on the site yet — the one step no tool in
 * the thread can prove, because Vercel finishes it after the agent is done.
 * `running` puts a "now" on the first unfinished step when the agent's own
 * list has none.
 */
export function editChecklist(view: ThreadView, lane: Lane, opts: { live: boolean; running: boolean }): CheckItem[] {
  const plan = agentPlan(view);
  let items: CheckItem[];
  if (plan.length) {
    items = plan.map((p) => ({ text: p.text, state: stateOf(p.status) }));
  } else {
    const tools = view.turns.flatMap((t) => t.tools);
    items = (lane === "quick" ? QUICK : FULL).map((s) => ({ text: s.text, state: s.done(tools) ? "done" : "todo" }));
    // A later step proves the earlier ones: a merge means it was pushed.
    const last = items.map((i) => i.state).lastIndexOf("done");
    items = items.map((it, i) => (i < last ? { ...it, state: "done" } : it));
  }
  items.push({ text: LIVE, state: opts.live ? "done" : "todo" });
  if (opts.live) items = items.map((it) => ({ ...it, state: "done" }));
  if (opts.running && !items.some((i) => i.state === "now")) {
    const first = items.findIndex((i) => i.state !== "done");
    if (first >= 0) items[first] = { ...items[first], state: "now" };
  }
  return items;
}
