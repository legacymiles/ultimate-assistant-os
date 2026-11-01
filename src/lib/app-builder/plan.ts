// ---------------------------------------------------------------------------
// App Builder — what happens after "Build it".
//
// Pressing Build it files ONE request in In Queue and then... nothing visible
// happens, because the thing that builds the app is Claude Code on the owner's
// own PC, which only looks at the queue when it is asked to. A spinner is a lie
// in that situation: nothing is loading, something is WAITING, and the owner is
// the one who has to start it.
//
// So this module is the honest answer to the four questions the owner has the
// moment they press the button — what happens next, how long, where will it be,
// and is this saved if I leave — written once, as data, so the panel, the queue
// brief and the tests cannot drift apart. Checklist R5: show what it's doing
// and how far along; never spin forever.
// ---------------------------------------------------------------------------

import { depthOf } from "./depth";
import { tally } from "./engine";
import type { BuilderProject } from "./types";

/** Where the build actually is, read from In Queue (./queue.ts). */
export interface BuildState {
  /** "filing" while the request is being posted; the rest come from the queue. */
  phase: "filing" | "queued" | "working" | "done" | "gone";
  queueId?: string;
  /** When it was filed. */
  at?: string;
  /** Who picked it up ("claude-code", "vps"), and when. */
  startedBy?: string;
  startedAt?: string;
  /** Plain-English notes the agent added while working, oldest first. */
  notes?: { at: string; text: string; by: string }[];
  /** Set once it has left the queue. */
  doneAt?: string;
  doneBy?: string;
  result?: string;
  /** The last time we managed to read the queue, so the panel can say so. */
  readAt?: string;
  /** Why the last read failed, in plain English. */
  error?: string;
}

export const IDLE: BuildState = { phase: "queued" };

export type StepState = "done" | "now" | "wait";

export interface BuildStep {
  id: string;
  title: string;
  detail: string;
  state: StepState;
  /** Shown as "4 minutes ago" when the step has actually happened. */
  at?: string;
  /** This step is waiting on the owner, not on a machine. */
  yours?: boolean;
}

// ----- how long -------------------------------------------------------------------

/**
 * An honest range for the build itself, once it starts. Deliberately wide and
 * labelled as a guess: a made-up percentage that creeps to 99% and stops is
 * worse than "20–60 minutes, and you'll see every note as it goes".
 */
export function etaFor(features: number, depth: "plain" | "commercial" | "commercial-2x"): { low: number; high: number; label: string } {
  const per = depth === "commercial-2x" ? 22 : depth === "commercial" ? 15 : 8;
  const low = Math.max(10, Math.round((features * per * 0.6) / 5) * 5);
  const high = Math.max(low + 15, Math.round((features * per * 1.6) / 10) * 10);
  return { low, high, label: `${mins(low)}–${mins(high)}` };
}

function mins(n: number): string {
  if (n < 90) return `${n} min`;
  // Past an hour, half-hours are as precise as an estimate deserves to look.
  const h = Math.round(n / 30) / 2;
  return `${h % 1 === 0 ? h : h.toFixed(1)} hr`;
}

/** "just now" / "4 minutes ago" / "2 hours ago" / "Tue 14:05". */
export function relTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const secs = Math.round((now - then) / 1000);
  if (secs < 45) return "just now";
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

// ----- where it lands -------------------------------------------------------------

/** A folder name from the app's name, the way the build will slug it. */
export function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "new-app"
  );
}

/** Where the finished thing will be, in the owner's words. */
export function landsIn(p: BuilderProject): { where: string; detail: string } {
  if (p.edit) {
    return {
      where: `${p.edit.repo ?? "the client's repo"} · ${p.edit.branch}`,
      detail: `A pull request into ${p.edit.baseBranch} for you to merge. The preview goes to ${p.edit.clientName || "the client"} first — merging is what puts it live.`,
    };
  }
  const slug = slugOf(p.understanding?.name ?? p.idea);
  return {
    where: `Projects\\${slug}`,
    detail: `Its own folder on your PC and its own GitHub repo, committed and pushed — unless it clearly belongs inside the hub, which puts it at /apps/${slug} instead.`,
  };
}

// ----- the steps ------------------------------------------------------------------

/**
 * The five things that happen after Build it, with the one the owner has to do
 * marked as theirs. `live` is what In Queue currently says.
 */
export function buildSteps(p: BuilderProject, live: BuildState): BuildStep[] {
  const { phase } = live;
  const filed = phase !== "filing";
  const started = phase === "working" || phase === "done";
  const done = phase === "done";
  // Out of the queue without finishing: nothing is waiting on anyone, so no
  // step may still claim to be the owner's move.
  const gone = phase === "gone";
  const t = tally(p.features);
  const { depth } = depthOf(p);
  const eta = etaFor(t.accepted, depth);
  const lands = landsIn(p);
  const notes = live.notes ?? [];
  const last = notes.at(-1);

  return [
    {
      id: "filed",
      title: gone ? "Was filed in In Queue" : filed ? "Filed in In Queue" : "Filing it in In Queue",
      detail: gone
        ? `${live.queueId ? `Request ${live.queueId}` : "The request"} is not in In Queue › App Builder any more.`
        : filed
          ? `${live.queueId ? `Request ${live.queueId}` : "The request"} is in In Queue › App Builder, on the server — ${
              p.keyframes?.length ? `with ${Math.min(4, p.keyframes.length)} frames from your recording and ` : ""
            }the whole brief.`
          : "Saving the brief and the accepted features to the server.",
      state: filed ? "done" : "now",
      at: filed ? live.at : undefined,
    },
    {
      id: "pickup",
      title: started ? `Picked up by ${live.startedBy || "Claude Code"}` : gone ? "Never picked up" : "Waiting for you to start Claude Code",
      detail: done
        ? `${live.startedBy || "Claude Code"} took it off the queue and ran the pipeline.`
        : started
        ? `${live.startedBy || "Claude Code"} has it and is working through the pipeline.`
        : gone
          ? "The request left the queue before anyone started it. Press Build it again to put it back."
          : "Nothing is running yet. Open Claude Code on your PC or VPS and say “work my Jarvis queue” — it takes this request and runs the whole pipeline on its own.",
      state: started ? "done" : gone ? "wait" : filed ? "now" : "wait",
      at: started ? live.startedAt : undefined,
      yours: !started && !gone,
    },
    {
      id: "build",
      title: done ? "Built" : started ? "Building" : "The build",
      detail: done
        ? live.result || "Finished and reported against the judge."
        : started
          ? last
            ? `Latest note: ${last.text}`
            : `Running felix → prompt-enhancer${depth === "plain" ? "" : " → commercial"} → ${p.understanding?.designSkill ?? "the design skill"} → impeccable → software-factory → claude-security. Notes appear here as they arrive.`
          : `${t.accepted} feature${t.accepted === 1 ? "" : "s"}, end to end. Usually ${eta.label} once it starts — a guess, not a promise; you’ll see each note as it lands.`,
      state: done ? "done" : started ? "now" : "wait",
    },
    {
      id: "ship",
      title: done ? "Pushed and live" : "Committed, pushed, deployed",
      detail: lands.detail,
      state: done ? "done" : "wait",
    },
    ...(p.handoff?.review
      ? [
          {
            id: "review",
            title: done ? `On the review link as ${p.handoff.review.number}` : "Posted to Client Review",
            detail: `The deployed app lands on its private review link by itself${
              p.handoff.review.clientName ? ` and ${p.handoff.review.clientName} is told` : ""
            }. Tap anything on the page there to ask for a change, and the change comes back here as an edit.`,
            state: (done ? "done" : "wait") as StepState,
          },
        ]
      : []),
  ];
}

/** The one line that answers "what do I have to do?". */
export function yourMove(live: BuildState): { say: string; note: string } | null {
  if (live.phase === "queued") {
    return { say: "work my Jarvis queue", note: "Say this to Claude Code on your PC or VPS and the build starts." };
  }
  return null;
}
