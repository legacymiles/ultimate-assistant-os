// ---------------------------------------------------------------------------
// The build, told in the Chat Intake.
//
// A build used to take over the page: a Building screen in place of the site,
// then a trip to Admin to paste the preview address and press ship. Now the
// site stays where it is and the build is narrated in the chat beside it, the
// way Claude Code narrates its own work — one line per thing it touches, its
// own words between them. When it finishes, the preview it printed is put on
// the version and the site reloads once, by itself.
//
// These are the pure halves of that, so the rules can be tested without a
// bridge: what the feed shows, and what a finished thread means.
// ---------------------------------------------------------------------------

import { resultLinks, type BuildPhase } from "@/lib/app-builder/build";
import type { ThreadView, ToolRow } from "@/lib/new-jarvis/harness/types";
import { buildLinks } from "./autoBuild";

export type FeedItem =
  | { kind: "tool"; id: string; verb: string; target: string; status: ToolRow["status"] }
  | { kind: "say"; id: string; text: string; live: boolean }
  | { kind: "you"; id: string; text: string };

/** The path's last few segments: enough to recognise the file, short enough for one line. */
export function shortPath(path: string, keep = 3): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > keep ? `…/${parts.slice(-keep).join("/")}` : parts.join("/");
}

const VERB: Record<ToolRow["kindOf"], string> = { read: "Read", write: "Edit", run: "Run", other: "" };

/** One tool call as a verb and what it touched. */
export function toolLine(t: ToolRow): { verb: string; target: string } {
  const verb = VERB[t.kindOf] || t.name || "Tool";
  if (t.path) return { verb, target: shortPath(t.path) };
  if (t.command) return { verb, target: t.command.split("\n")[0].trim().slice(0, 140) };
  // The title often already starts with the verb ("Read foo.ts"); don't say it twice.
  const title = t.title.trim();
  const rest = verb && title.toLowerCase().startsWith(verb.toLowerCase() + " ") ? title.slice(verb.length + 1) : title;
  return { verb, target: rest === verb ? "" : rest.slice(0, 140) };
}

/** The two machine lines the brief asks for are links, not prose; the feed shows them as such. */
function stripLinkLines(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*(PR|Preview):\s*\S+\s*$/i.test(l))
    .join("\n")
    .trim();
}

/**
 * Everything the build did, in order, newest last — capped so a two-hour build
 * doesn't put two thousand rows in a floating panel.
 *
 * The first turn's prompt is the brief itself (pages of instructions the owner
 * never typed), so it is never shown. A resume prompt is the same brief again,
 * wrapped in the bridge's own <resuming> envelope, and is just as much not
 * something the owner typed. Later prompts are theirs, and are.
 */
export function feedItems(view: ThreadView, limit = 80): FeedItem[] {
  const out: FeedItem[] = [];
  view.turns.forEach((turn, i) => {
    const prompt = turn.prompt.trim();
    const resume = prompt.includes("<resuming>");
    if (i > 0 && prompt && !resume) out.push({ kind: "you", id: `${turn.id}-you`, text: prompt });
    for (const t of turn.tools) {
      const { verb, target } = toolLine(t);
      out.push({ kind: "tool", id: `${turn.id}-${t.callId}`, verb, target, status: t.status });
    }
    const said = stripLinkLines(turn.text);
    if (said) out.push({ kind: "say", id: `${turn.id}-say`, text: said, live: turn.status === "running" });
  });
  return out.slice(-limit);
}

/**
 * How long a version just opened may have no thread recorded before it counts
 * as stuck. Recording the thread is a second round trip after the build
 * starts, so a fresh build has a moment where the row looks like a dead one.
 */
export const START_GRACE_MS = 2 * 60_000;

/** Is anything actually building this version? */
export type Standing =
  /** There is a thread on this PC: the feed tells the story. */
  | { kind: "watching" }
  /** Opened a moment ago; the PC has not reported in yet. */
  | { kind: "starting" }
  /** Marked building with nothing behind it. Say so, and offer the way out. */
  | { kind: "stalled"; why: string };

/**
 * A version marked "building" is not proof that a build is running. It can be
 * one that never started, or one filed in the old In Queue and left there —
 * and the page used to tell those two "waiting for your PC to report in",
 * which is the loading-screen-with-nothing-behind-it all over again. Three
 * states, from the row alone, so a client's page can say it too.
 */
export function standingOf(
  row: { threadId?: string; since: string; error?: { message: string } } | null,
  now = Date.now(),
): Standing {
  if (!row) return { kind: "starting" };
  if (row.threadId) return { kind: "watching" };
  if (row.error) return { kind: "stalled", why: `It never started. The last try said: ${row.error.message}` };
  const age = now - Date.parse(row.since);
  if (!Number.isFinite(age) || age < START_GRACE_MS) return { kind: "starting" };
  return {
    kind: "stalled",
    why: "Nothing is running behind this one. It was never started on this PC, or it was filed in the old queue and left there.",
  };
}

/** Why this browser cannot build right now. */
export type Blocker = "blocked-by-browser" | "pc-off" | "not-paired" | "repo-not-here" | "no-repo";

/**
 * What to say, and whether a button can do anything about it.
 *
 * The old words sent the owner to a button on a different app ("Press Connect
 * to this PC") and left them to find it. Everything a press can fix says so
 * here, and the press is on the same line as the sentence.
 */
export function blockerAdvice(reason: Blocker): { text: string; canConnect: boolean } {
  switch (reason) {
    case "blocked-by-browser":
      return {
        text: "Chrome blocked the direct route to your PC. Press Connect to my PC: a small Jarvis window will open and carry the connection — keep it open.",
        canConnect: true,
      };
    case "pc-off":
      return {
        text: "Jarvis's helper isn't running on this PC. Press Connect to my PC below and it will be started for you.",
        canConnect: true,
      };
    case "not-paired":
      return {
        text: "This browser and your PC haven't been introduced yet. Press Connect to my PC below — it takes a second and there is nothing to copy.",
        canConnect: true,
      };
    case "repo-not-here":
      return { text: "That site's code isn't on this PC, so it can't be built here.", canConnect: false };
    case "no-repo":
      return {
        text: "This site has no GitHub repo yet, so there's nothing to build in. Add it under Ship › Where the site lives.",
        canConnect: false,
      };
  }
}

/** What a build's end means for the page. */
export type Finish =
  | { kind: "running" }
  /** Built, with a preview: put it on the version and reload the site. */
  | { kind: "publish"; url: string; pr?: string; repo?: string }
  /** Built, but it printed no usable preview — say why, in its own words. */
  | { kind: "no-preview"; why: string; pr?: string }
  | { kind: "failed"; why: string };

export function finishOf(phase: BuildPhase, view: ThreadView): Finish {
  if (phase === "failed" || phase === "lost" || phase === "stopped") {
    const err = [...view.turns].reverse().find((t) => t.error)?.error;
    return {
      kind: "failed",
      why:
        phase === "lost"
          ? "The agent on your PC restarted and this build stopped with it."
          : phase === "stopped"
            ? "This build was stopped."
            : err || "Claude Code stopped without finishing.",
    };
  }
  if (phase !== "done") return { kind: "running" };
  const text = view.turns.map((t) => t.text).join("\n");
  const { pr, preview } = buildLinks(text);
  if (preview) return { kind: "publish", url: preview, ...(pr ? { pr } : {}) };
  // A NEW app's brief asks for `Repo:`/`Live:` instead of `PR:`/`Preview:`.
  // Same finish, read through the other pair of names.
  const app = resultLinks(view);
  if (app.url) return { kind: "publish", url: app.url, ...(app.repo ? { repo: app.repo } : {}) };
  // `Preview: none` is followed by one sentence saying why; that sentence is the answer.
  const after = /^\s*Preview:\s*none\b[^\n]*\n?([\s\S]*)$/im.exec(text);
  const why = (after?.[1] ?? "").trim().split("\n")[0] || "It finished without printing a preview address.";
  return { kind: "no-preview", why, ...(pr ? { pr } : {}) };
}
