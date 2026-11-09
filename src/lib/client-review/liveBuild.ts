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

import type { BuildPhase } from "@/lib/app-builder/build";
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
 * never typed), so it is never shown. Later prompts are the owner's own
 * messages to the build, and are.
 */
export function feedItems(view: ThreadView, limit = 80): FeedItem[] {
  const out: FeedItem[] = [];
  view.turns.forEach((turn, i) => {
    if (i > 0 && turn.prompt.trim()) out.push({ kind: "you", id: `${turn.id}-you`, text: turn.prompt.trim() });
    for (const t of turn.tools) {
      const { verb, target } = toolLine(t);
      out.push({ kind: "tool", id: `${turn.id}-${t.callId}`, verb, target, status: t.status });
    }
    const said = stripLinkLines(turn.text);
    if (said) out.push({ kind: "say", id: `${turn.id}-say`, text: said, live: turn.status === "running" });
  });
  return out.slice(-limit);
}

/** What a build's end means for the page. */
export type Finish =
  | { kind: "running" }
  /** Built, with a preview: put it on the version and reload the site. */
  | { kind: "publish"; url: string; pr?: string }
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
  // `Preview: none` is followed by one sentence saying why; that sentence is the answer.
  const after = /^\s*Preview:\s*none\b[^\n]*\n?([\s\S]*)$/im.exec(text);
  const why = (after?.[1] ?? "").trim().split("\n")[0] || "It finished without printing a preview address.";
  return { kind: "no-preview", why, ...(pr ? { pr } : {}) };
}
