// ---------------------------------------------------------------------------
// App Builder → a real build, on the owner's own PC.
//
// "Build it" used to file a request in In Queue and stop. That was never what
// the button said it did: the owner pressed Build and nothing was built, and
// nothing would be until they remembered to go and tell Claude Code to work
// the queue. So the queue is no longer the path. The bridge on 127.0.0.1
// already runs Claude Code as a long-lived thread — it is what the Website
// Redesigner's bake-off drives — and this is App Builder's side of it.
//
// What is different here from every other harness thread: a new app exists
// nowhere yet, so there is no repository to cut a worktree from. The thread
// asks the bridge for a PROJECT instead (`project: <slug>`), which makes a real
// folder under ~/Projects with a repository of its own.
//
// Everything in this file is pure, so the brief the PC receives, the phase the
// panel draws and the tests all read the same rules.
// ---------------------------------------------------------------------------

import { masterPrompt } from "./engine";
import { slugOf } from "./plan";
import type { BuilderProject } from "./types";
import type { ThreadSummary, ThreadView } from "@/lib/new-jarvis/harness/types";

/** The folder the app is built in, under the projects root on the PC. */
export function projectSlug(p: BuilderProject): string {
  return slugOf(p.understanding?.name ?? p.idea);
}

/**
 * Is this being built FOR someone else?
 *
 * The review link's client name is the signal, because that is the one place
 * the owner has already said who it is for. A client build is kept in its own
 * folder so the thing handed over is obviously theirs, with none of the
 * owner's work beside it.
 */
export function isForClient(p: BuilderProject): boolean {
  return Boolean(p.handoff?.review?.clientName?.trim() || p.edit?.clientName?.trim());
}

/** What the thread is called in the bridge's own thread list. */
export function threadTitle(p: BuilderProject): string {
  return (p.understanding?.name ?? p.idea).slice(0, 48) || "New app";
}

/**
 * The message the PC's Claude Code receives.
 *
 * `masterPrompt` already carries the goal, the features in the owner's words,
 * the declined ones, the depth, the skill pipeline, the checklist and the
 * Client Review hand-off. This adds only what Claude cannot see from here:
 * that it is standing in an empty folder that is already a git repository, and
 * what finishing means.
 */
export function buildBrief(p: BuilderProject): string {
  const name = p.understanding?.name ?? "this app";
  return [
    "<where_you_are>",
    `You are in an empty folder that is already a git repository on its own \`main\` branch — this is ${name}'s own project, not part of any other codebase. Build it here. It has no node_modules and no keys: install what you need, and keep it working with no keys set (a visible demo mode, never a crash).`,
    "Do not reach into any other repository on this machine to take files from it; read one only if you need it as a reference.",
    "</where_you_are>",
    "",
    masterPrompt(p),
    "",
    "<finish>",
    "When every accepted feature is real and wired end to end: commit, create a GitHub repository for it and push, then deploy it and test it live.",
    "Report against the judge with real numbers, including anything that missed. Say the repository and the live address in your last message, each on its own line, as `Repo: <url>` and `Live: <url>`, so App Builder can save them without guessing.",
    "</finish>",
  ].join("\n");
}

// ----- reading the thread back -----------------------------------------------------

export type BuildPhase = "starting" | "working" | "asking" | "done" | "failed" | "stopped" | "lost";

export const PHASE_LABEL: Record<BuildPhase, string> = {
  starting: "Starting the build",
  working: "Building now",
  asking: "Waiting on your answer",
  done: "Built",
  failed: "The build didn’t run",
  stopped: "Stopped",
  lost: "This build is no longer running",
};

/**
 * Where the build is, from the thread the bridge reports.
 *
 * A gate outranks everything: when Claude is blocked asking permission, the
 * panel must say that and nothing else, because it is the one state where the
 * build is waiting on the owner rather than on itself.
 */
/**
 * A turn that ended having said nothing, used no tools and cost nothing.
 *
 * The headless agent returns this shape when it cannot run at all — most often
 * because Claude Code is not signed in on that PC. It looks identical to a
 * finished build unless you check, so it is checked.
 */
export function stalled(view: ThreadView): boolean {
  if (!view.turns.length) return false;
  const did = view.turns.some((t) => t.text.trim() || t.tools.length || t.error);
  return !did && view.usd === 0;
}

/** Why nothing happened, in words the owner can act on. */
export function stalledWhy(): string {
  return "Claude Code answered without doing anything, which almost always means it is not signed in on that PC. Open a terminal there, run `claude`, and sign in with /login — then press Build it again.";
}

export function phaseOf(summary: ThreadSummary | null, view: ThreadView, missing = false): BuildPhase {
  // The agent has never heard of this thread — it restarted, and threads do
  // not survive that. Without this the panel sits on "Starting the build"
  // forever, which is the exact loading-screen-with-nothing-behind-it the
  // whole build panel exists to abolish; worse, "starting" counts as in
  // flight, so the button that would fix it is disabled.
  if (missing) return "lost";
  if (!summary) return "starting";
  if (view.liveGate) return "asking";
  switch (summary.status) {
    case "starting":
      return "starting";
    case "thinking":
      return "working";
    case "waiting":
      return "asking";
    case "ended":
      if (view.turns.some((t) => t.status === "failed") || stalled(view)) return "failed";
      return "done";
    case "ready":
    case "idle":
      // Idle with nothing behind it means it has only just opened.
      if (!view.turns.length) return "starting";
      // Idle with a turn that produced NOTHING is not a finished build. It is
      // the agent answering without working — which on this machine means
      // Claude Code is not signed in. Calling that "Built" would be exactly
      // the lie the old spinner told.
      return stalled(view) ? "failed" : "done";
    default:
      return "working";
  }
}

/** The last thing Claude actually said, for the one-line "what it's doing now". */
export function latestWord(view: ThreadView): string {
  for (let i = view.turns.length - 1; i >= 0; i--) {
    const t = view.turns[i];
    const text = t.text.trim();
    if (text) return text.split(/\n\s*\n/).pop()!.trim().slice(0, 400);
    const tool = [...t.tools].reverse().find((x) => x.title);
    if (tool) return tool.title;
  }
  return "";
}

/** What it has done so far, as a count the panel can show without a wall of log. */
export function tally(view: ThreadView): { reads: number; changes: number; runs: number; asked: number } {
  let reads = 0;
  let changes = 0;
  let runs = 0;
  let asked = 0;
  for (const t of view.turns) {
    for (const tool of t.tools) {
      if (tool.kindOf === "read") reads++;
      else if (tool.kindOf === "write") changes++;
      else if (tool.kindOf === "run") runs++;
    }
    asked += t.gates.length;
  }
  return { reads, changes, runs, asked };
}

/**
 * The repository and live address Claude was asked to print at the end.
 *
 * Read from its own last words rather than guessed, and only accepted as
 * http(s), so a half-finished sentence never becomes a link the owner clicks.
 */
export function resultLinks(view: ThreadView): { repo?: string; url?: string } {
  const text = view.turns.map((t) => t.text).join("\n");
  const pick = (label: string) => {
    const matches = [...text.matchAll(new RegExp(`^\\s*${label}:\\s*(\\S+)\\s*$`, "gim"))];
    const last = matches.at(-1)?.[1];
    if (!last) return undefined;
    const clean = last.replace(/[)\].,;]+$/, "");
    return /^https?:\/\/\S+$/i.test(clean) ? clean : undefined;
  };
  return { repo: pick("Repo"), url: pick("Live") };
}
