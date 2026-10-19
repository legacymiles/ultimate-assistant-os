// ---------------------------------------------------------------------------
// Sending things to the super-board.
//
// Anything worth building — a Goal check brief, an Improvements idea, an
// unfinished In Queue row, a logged crash — becomes a Felix-format card in
// Backlog. The card builders are pure (tested); `sendToBoard` is the one call.
// ---------------------------------------------------------------------------

import { draftBrief, ticketFrom, type BoardTicket } from "./felix";
import type { Idea } from "./ideas";
import type { QueueRow } from "./queue";
import type { ErrorEntry } from "../site-errors/log";

export interface BoardResult {
  ok: boolean;
  number?: number;
  url?: string;
  onBoard?: boolean;
  /** Plain-English: what happened, or what to do. */
  message: string;
}

export async function sendToBoard(ticket: BoardTicket): Promise<BoardResult> {
  try {
    const res = await fetch("/api/new-jarvis/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ticket),
    });
    const data = (await res.json()) as { number?: number; url?: string; onBoard?: boolean; notice?: string; error?: string };
    if (!res.ok || !data.number) return { ok: false, message: data.error || "Couldn't send that to the board." };
    return {
      ok: true,
      number: data.number,
      url: data.url,
      onBoard: data.onBoard,
      message: data.notice || `Card #${data.number} is in Backlog. Move it to Ready when you want it built.`,
    };
  } catch {
    return { ok: false, message: "Couldn't reach Jarvis. Check your connection and try again." };
  }
}

/** An Improvements idea as a card. Jarvis ideas are plugins/changes to Jarvis; app ideas are apps. */
export function ticketForIdea(idea: Idea): BoardTicket {
  const topic = idea.kind === "jarvis" || idea.kind === "workflow" ? "plugin" : "app";
  const brief = draftBrief(idea.prompt || idea.title, topic, {
    goal: idea.why,
    features: idea.firstStep,
  });
  brief.title = brief.title.replace(/\] .*/, `] ${idea.kind}: ${idea.title}`).slice(0, 70);
  const t = ticketFrom(brief, idea.prompt || idea.title, idea.kind === "jarvis" ? "Jarvis" : undefined);
  t.body = `${t.body}\n\n## Evidence\n${idea.evidence.map((e) => `- ${e}`).join("\n")}`;
  return t;
}

/** An unfinished In Queue row as a card: finish it, with its own evidence as the gap list. */
export function ticketForQueueRow(row: QueueRow): BoardTicket {
  const missing = row.evidence.filter((e) => !e.met).map((e) => e.label);
  const brief = draftBrief(`Finish ${row.name}`, row.kind === "skill" ? "content" : "app", {
    goal: `${row.name} is finished: ${row.blurb}`,
    features: [row.note, ...missing.map((m) => `close: ${m}`)].filter(Boolean).join("; "),
  });
  brief.title = `🧹 [tech-debt] ${row.kind}: finish ${row.name}`.slice(0, 70);
  const t = ticketFrom(brief, `Finish ${row.name}`, row.href);
  t.labels = ["tech-debt", "felix"];
  return t;
}

/** A logged crash as a bug card, written the way super-board wants bugs. */
export function ticketForError(e: ErrorEntry): BoardTicket {
  const brief = draftBrief(e.message, "fix", {
    goal: `${e.message} (on ${e.site})`,
    often: e.count > 3 ? "Every time" : "Sometimes",
    rung: "Fix it and stop it happening again",
    success: ["A test that failed now passes", "No new logged errors for a week"],
  });
  brief.title = `🐛 [bug] ${e.site}: ${e.message}`.slice(0, 70);
  const t = ticketFrom(brief, e.message, e.urls[0]);
  t.body = `${t.body}\n\n## Evidence\n| Field | Value |\n|---|---|\n| Site | ${e.site} |\n| Kind | ${e.kind} |\n| Count | ${e.count} |\n| First seen | ${e.firstSeen} |\n| Last seen | ${e.lastSeen} |\n| Pages | ${e.urls.join(", ") || "n/a — not recorded"} |\n| Browsers | ${e.agents.join(", ") || "n/a — not recorded"} |\n\n\`\`\`\n${e.stack.slice(0, 2_000) || "no stack recorded"}\n\`\`\``;
  t.labels = ["bug", "felix"];
  return t;
}
