// ---------------------------------------------------------------------------
// 24/7 agents — work that outlives the tab it was asked for in.
//
// In Queue answers "what do I want done next?". That works when a person is
// going to read it. It does not work for the jobs that need a MACHINE: Flux on
// Pinokio, a Blender render, an Unreal build. Those can only run where the GPU
// is, and the GPU is asleep most of the day. Asking for one from a phone used
// to mean a refusal.
//
// A 24/7 agent is the answer: a GOAL that is stored, not a command that is
// sent. Nothing is pushed to the PC — the PC is off, and a browser cannot
// reach it anyway. Instead every runner that wakes up (Claude Code on the
// laptop, the VPS, a cloud tab) asks what it can help with, and is handed the
// next step it is actually capable of running. Open the laptop and its work
// resumes by itself, because the work was never on the laptop; it was here,
// waiting for a machine that could do it.
//
// Three rules hold the whole design up:
//
//   1. CAPABILITY, not location. An agent says what it needs ("pinokio"), a
//      runner says what it has. A runner is never handed a step it cannot run,
//      so "wherever it can finish" is literally true rather than aspirational.
//
//   2. RESUME, not restart. Every runner leaves a handoff note before it goes,
//      and the next one is given that note first. Without this an agent that
//      spans two sessions does its first step forever.
//
//   3. ONE runner at a time, by LEASE. Two machines claiming one agent would
//      render the same frame twice and overwrite each other. A claim is a
//      lease with an expiry, so a laptop that is closed mid-step frees the
//      work by itself instead of blocking it until someone notices.
//
// Everything here is pure. The server store, the API route, the connector and
// the browser hook all fold through these functions, so they cannot disagree
// about what an agent is.
// ---------------------------------------------------------------------------

/** What a machine must be able to do before it can take a step. */
export type AgentNeed =
  /** WanGP / Flux / any Pinokio app — the owner's own GPU. */
  | "pinokio"
  | "blender"
  | "unreal"
  | "ffmpeg"
  /** Any GPU at all, when the tool does not matter. */
  | "gpu"
  /** A shell and the repo. Any Claude Code session has this. */
  | "shell";

export const ALL_NEEDS: AgentNeed[] = ["pinokio", "blender", "unreal", "ffmpeg", "gpu", "shell"];

/** What each need is called on screen, in the owner's words rather than ours. */
export const NEED_LABEL: Record<AgentNeed, string> = {
  pinokio: "Pinokio (your GPU)",
  blender: "Blender",
  unreal: "Unreal Engine",
  ffmpeg: "ffmpeg",
  gpu: "A graphics card",
  shell: "A terminal",
};

/**
 * `waiting` — nothing is working on it; the next capable runner takes it.
 * `running` — a runner holds the lease right now.
 * `blocked` — it needs the owner (a key, an answer, a decision).
 * `paused`  — the owner stopped it; no runner may take it.
 * `done`    — the goal is met.
 */
export type AgentStatus = "waiting" | "running" | "blocked" | "paused" | "done";

export interface AgentStep {
  id: string;
  text: string;
  done: boolean;
  /** When it finished, and which runner finished it. */
  at?: string;
  by?: string;
  /** One line on what came of it. */
  note?: string;
}

export type LogKind = "filed" | "started" | "progress" | "blocked" | "handoff" | "done" | "stopped";

export interface AgentLogLine {
  at: string;
  by: string;
  text: string;
  kind: LogKind;
}

/** What the last runner left for the next one. The feature's whole point. */
export interface Handoff {
  at: string;
  by: string;
  /** Where it got to and what the next runner should do first. */
  text: string;
}

/**
 * How a standing agent keeps going.
 *
 * `once` finishes for good. The others make it a 24/7 agent in the full sense:
 * when a round is done it rests, then goes again with the last round's result
 * as its starting note — a research agent that checks for new EAs every day
 * instead of once.
 */
export type AgentRepeat = "once" | "hourly" | "daily" | "weekly";

export const ALL_REPEATS: AgentRepeat[] = ["once", "hourly", "daily", "weekly"];

export const REPEAT_LABEL: Record<AgentRepeat, string> = {
  once: "Once",
  hourly: "Every hour",
  daily: "Every day",
  weekly: "Every week",
};

export const REPEAT_MS: Record<Exclude<AgentRepeat, "once">, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/**
 * What happens to code an agent changed.
 *
 * `review` — the run leaves its work on a branch in the harness and stops at
 *            "ready for you"; nothing reaches an app until you land it.
 * `auto`   — the run lands its own branch and pushes it, so the change goes
 *            live by itself. Opt-in per agent, never the default.
 */
export type ShipMode = "review" | "auto";

/** The harness thread an agent's last code-changing run left behind. */
export interface AgentThread {
  id: string;
  branch: string;
  at: string;
  /** What came of it. "ready" means waiting for the owner to review and land. */
  outcome: "ready" | "landed" | "pushed" | "nothing" | "failed";
  why?: string;
}

export interface AgentLease {
  by: string;
  /** ISO. After this the agent is free again even if the runner never came back. */
  until: string;
}

export interface Agent {
  id: string;
  /** What done looks like, in the owner's words. */
  goal: string;
  /** What it needs a machine to be able to do. Empty = any runner. */
  needs: AgentNeed[];
  /** The In Queue row it belongs to, when it came from one. */
  folder?: string;
  status: AgentStatus;
  steps: AgentStep[];
  handoff?: Handoff;
  lease?: AgentLease;
  log: AgentLogLine[];
  createdAt: string;
  updatedAt: string;
  /** Who filed it: "you", "image-lane", a connector client name. */
  from: string;
  /** Why it is blocked, in plain English. Shown verbatim (R3). */
  blockedWhy?: string;
  /** Downscaled JPEG data URLs the agent should work from. */
  images: string[];
  /**
   * "Powered by": which Claude runs it and who pays (harness/models.ts).
   * "" means the default — Opus 5.5 on the owner's plan.
   */
  pick: string;
  /**
   * Apps (catalog slugs) this agent may change. Non-empty means every run
   * goes through the Jarvis harness, in a worktree of its own.
   */
  edits: string[];
  /**
   * Where its results go: "app:<slug>" files them in that app's In Queue
   * folder, "a-xxxxxx" hands them to another 24/7 agent, "inbox" the Inbox.
   */
  sendsTo: string[];
  ship: ShipMode;
  repeat: AgentRepeat;
  /** A repeating agent rests until this ISO time before its next round. */
  nextRunAt?: string;
  /** Rounds finished so far. */
  rounds: number;
  thread?: AgentThread;
}

export interface AgentsDoc {
  agents: Agent[];
}

export const EMPTY_AGENTS: AgentsDoc = { agents: [] };

export const MAX_GOAL = 2000;
export const MAX_STEPS = 40;
export const MAX_LOG = 60;
export const MAX_IMAGES = 4;
/** Keep a finished agent around this long so "did that get done?" has an answer. */
export const DONE_DAYS = 14;

/**
 * How long a claim holds before anyone else may take the agent.
 *
 * Long enough that a real step (a Blender render, a cold Flux load) does not
 * lose its lease mid-way; short enough that a closed laptop frees the work
 * within a coffee break rather than at the next person's prompting. A runner
 * that is still going renews it.
 */
export const LEASE_MS = 20 * 60 * 1000;

// --- making one -----------------------------------------------------------

/** A short id, readable when a runner quotes it back ("a-7k2m9x"). */
export function agentId(seed = ""): string {
  const rand = seed || Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `a-${rand.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase()}`;
}

export function clip(text: unknown, max: number): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export interface NewAgentInput {
  goal: string;
  needs?: AgentNeed[];
  steps?: string[];
  folder?: string;
  from?: string;
  images?: string[];
  at?: string;
  id?: string;
  pick?: string;
  edits?: string[];
  sendsTo?: string[];
  ship?: ShipMode;
  repeat?: AgentRepeat;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
const AGENT_ID = /^a-[a-z0-9]{1,12}$/;

/** App slugs only, de-duplicated. "app:ea-world" and "ea-world" are the same. */
export function cleanEdits(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const slug = String(x).trim().toLowerCase().replace(/^app:/, "");
    if (SLUG.test(slug) && !out.includes(slug)) out.push(slug);
  }
  return out.slice(0, 12);
}

/** "app:<slug>", "a-xxxxxx" or "inbox"; anything else is dropped. */
export function cleanSendsTo(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = String(x).trim().toLowerCase();
    const ok = t === "inbox" || AGENT_ID.test(t) || (t.startsWith("app:") && SLUG.test(t.slice(4)));
    if (ok && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 12);
}

export function cleanShip(v: unknown): ShipMode {
  return v === "auto" ? "auto" : "review";
}

export function cleanRepeat(v: unknown): AgentRepeat {
  return ALL_REPEATS.includes(v as AgentRepeat) ? (v as AgentRepeat) : "once";
}

/** The pick's shape only; harness/models.ts owns which ones are offered. */
export function cleanAgentPick(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (s === "deepseek") return s;
  if (/^claude-subscription:[a-z0-9][\w.-]{1,80}$/i.test(s)) return s;
  if (/^openrouter:[a-z0-9][\w.-]*\/[\w.:-]{1,80}$/i.test(s)) return s;
  return "";
}

export function newAgent(input: NewAgentInput): Agent {
  const at = input.at || new Date().toISOString();
  const goal = clip(input.goal, MAX_GOAL);
  return {
    id: input.id || agentId(),
    goal,
    needs: cleanNeeds(input.needs),
    folder: input.folder || undefined,
    status: "waiting",
    // An agent with no steps used to be untakeable forever (takeable() wants
    // an unfinished step), so the goal itself is the first step.
    steps: (input.steps?.length ? input.steps : [goal]).slice(0, MAX_STEPS).map((text, i) => ({
      id: `s${i + 1}`,
      text: clip(text, 400),
      done: false,
    })),
    log: [{ at, by: input.from || "you", text: "Filed.", kind: "filed" }],
    createdAt: at,
    updatedAt: at,
    from: input.from || "you",
    images: (input.images || []).slice(0, MAX_IMAGES),
    pick: cleanAgentPick(input.pick),
    edits: cleanEdits(input.edits),
    sendsTo: cleanSendsTo(input.sendsTo),
    ship: cleanShip(input.ship),
    repeat: cleanRepeat(input.repeat),
    rounds: 0,
  };
}

/** Only needs we know about, de-duplicated, order kept. */
export function cleanNeeds(needs: unknown): AgentNeed[] {
  if (!Array.isArray(needs)) return [];
  const out: AgentNeed[] = [];
  for (const n of needs) {
    const need = String(n).trim().toLowerCase() as AgentNeed;
    if (ALL_NEEDS.includes(need) && !out.includes(need)) out.push(need);
  }
  return out;
}

// --- capability matching --------------------------------------------------

/**
 * Can this machine run this agent?
 *
 * A GPU tool implies a GPU: a runner that reports Pinokio or Blender plainly
 * has a graphics card, and making it list "gpu" as well would be a footgun
 * that silently parks work forever.
 */
export function machineCan(have: AgentNeed[]): Set<AgentNeed> {
  const set = new Set<AgentNeed>(cleanNeeds(have));
  if (set.has("pinokio") || set.has("blender") || set.has("unreal")) set.add("gpu");
  return set;
}

export function canRun(agent: Agent, have: AgentNeed[]): boolean {
  const can = machineCan(have);
  return agent.needs.every((n) => can.has(n));
}

/** What this machine is missing for this agent, for a plain-English reason. */
export function missingFor(agent: Agent, have: AgentNeed[]): AgentNeed[] {
  const can = machineCan(have);
  return agent.needs.filter((n) => !can.has(n));
}

// --- the lease ------------------------------------------------------------

/** A repeating agent between rounds. */
export function resting(agent: Agent, now: number): boolean {
  return Boolean(agent.nextRunAt) && Date.parse(agent.nextRunAt as string) > now;
}

export function leaseHeld(agent: Agent, now: number): boolean {
  if (!agent.lease) return false;
  return Date.parse(agent.lease.until) > now;
}

/**
 * Is this agent free for a runner to take right now?
 *
 * `blocked` is deliberately takeable: what blocks an agent is usually a
 * missing key or an answer, and a different machine may well have it.
 */
export function takeable(agent: Agent, have: AgentNeed[], now: number): boolean {
  if (agent.status === "paused" || agent.status === "done") return false;
  if (leaseHeld(agent, now)) return false;
  if (resting(agent, now)) return false;
  if (!agent.steps.some((s) => !s.done)) return false;
  return canRun(agent, have);
}

/**
 * The agent this runner should pick up, or null.
 *
 * Longest-waiting first, so nothing starves behind a steady drip of newer
 * work — the owner's "works ASAP" means the oldest unmet goal moves first,
 * not that the newest one jumps the line.
 */
export function nextFor(doc: AgentsDoc, have: AgentNeed[], now: number): Agent | null {
  const free = doc.agents.filter((a) => takeable(a, have, now));
  if (!free.length) return null;
  return free.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))[0];
}

// --- changing one ---------------------------------------------------------

function touch(agent: Agent, at: string): Agent {
  return { ...agent, updatedAt: at };
}

function withLog(agent: Agent, line: AgentLogLine): Agent {
  return { ...agent, log: [...agent.log, line].slice(-MAX_LOG) };
}

/** Replace one agent, leaving the rest alone. */
export function mapAgent(doc: AgentsDoc, id: string, change: (a: Agent) => Agent): AgentsDoc {
  return { agents: doc.agents.map((a) => (a.id === id ? change(a) : a)) };
}

export interface ClaimResult {
  doc: AgentsDoc;
  agent: Agent | null;
  /** Why nothing was handed over, when nothing was. Plain English (R3). */
  why?: string;
}

/**
 * Take the next agent this machine can run, and hold it.
 *
 * Returns the agent WITH its handoff note, because resuming is the point: a
 * runner that is not told where the last one got to will start again.
 */
export function claimNext(doc: AgentsDoc, by: string, have: AgentNeed[], now: number): ClaimResult {
  const pick = nextFor(doc, have, now);
  if (!pick) {
    return { doc, agent: null, why: whyNothing(doc, have, now) };
  }
  const at = new Date(now).toISOString();
  let claimed: Agent | null = null;
  const next = mapAgent(doc, pick.id, (a) => {
    claimed = touch(
      withLog({ ...a, status: "running", lease: { by, until: new Date(now + LEASE_MS).toISOString() } }, {
        at,
        by,
        text: a.handoff ? "Picked it back up." : "Started.",
        kind: "started",
      }),
      at,
    );
    return claimed;
  });
  return { doc: next, agent: claimed };
}

/** The one sentence shown when a runner asked for work and there was none. */
function whyNothing(doc: AgentsDoc, have: AgentNeed[], now: number): string {
  const live = doc.agents.filter((a) => a.status !== "done");
  if (!live.length) return "No 24/7 agents are waiting.";

  const busy = live.filter((a) => leaseHeld(a, now));
  const paused = live.filter((a) => a.status === "paused");
  const finishedSteps = live.filter((a) => !a.steps.some((s) => !s.done) && a.status !== "paused");
  const cantRun = live.filter((a) => !canRun(a, have) && !leaseHeld(a, now) && a.status !== "paused");

  if (cantRun.length) {
    const missing = new Set<string>();
    for (const a of cantRun) for (const n of missingFor(a, have)) missing.add(NEED_LABEL[n]);
    return `${cantRun.length} waiting, but this machine hasn't got ${[...missing].join(" or ")}.`;
  }
  if (busy.length) return `${busy.length} already being worked on by another machine.`;
  const rest = live.filter((a) => resting(a, now) && a.status !== "paused");
  if (rest.length) return `${rest.length} resting until their next round.`;
  if (finishedSteps.length) return `${finishedSteps.length} have run out of steps — they need a next step or finishing.`;
  if (paused.length) return `${paused.length} paused.`;
  return "No 24/7 agents are waiting.";
}

/** Keep the lease while a long step runs. */
export function renew(doc: AgentsDoc, id: string, by: string, now: number): AgentsDoc {
  return mapAgent(doc, id, (a) =>
    a.lease?.by === by ? { ...a, lease: { by, until: new Date(now + LEASE_MS).toISOString() } } : a,
  );
}

export function note(doc: AgentsDoc, id: string, by: string, text: string, at: string): AgentsDoc {
  return mapAgent(doc, id, (a) => touch(withLog(a, { at, by, text: clip(text, 600), kind: "progress" }), at));
}

/** Tick a step off and say what came of it. */
export function finishStep(doc: AgentsDoc, id: string, stepId: string, by: string, result: string, at: string): AgentsDoc {
  return mapAgent(doc, id, (a) => {
    const steps = a.steps.map((s) =>
      s.id === stepId && !s.done ? { ...s, done: true, at, by, note: clip(result, 400) || undefined } : s,
    );
    return touch(withLog({ ...a, steps }, { at, by, text: clip(result, 600) || "Step done.", kind: "progress" }), at);
  });
}

/** Add work discovered while running. An agent that learns more to do is normal. */
export function addSteps(doc: AgentsDoc, id: string, texts: string[], at: string): AgentsDoc {
  return mapAgent(doc, id, (a) => {
    const room = MAX_STEPS - a.steps.length;
    if (room <= 0) return a;
    const extra = texts.slice(0, room).map((text, i) => ({
      id: `s${a.steps.length + i + 1}`,
      text: clip(text, 400),
      done: false,
    }));
    return touch({ ...a, steps: [...a.steps, ...extra] }, at);
  });
}

/**
 * Put the agent down, leaving the next runner a note.
 *
 * This is what makes an agent survive a closed laptop: the lease is dropped,
 * the status goes back to waiting, and the note that says where it got to is
 * the first thing the next machine is handed.
 */
export function handOff(doc: AgentsDoc, id: string, by: string, text: string, at: string): AgentsDoc {
  return mapAgent(doc, id, (a) =>
    touch(
      withLog(
        { ...a, status: "waiting", lease: undefined, handoff: { at, by, text: clip(text, 1200) } },
        { at, by, text: clip(text, 600), kind: "handoff" },
      ),
      at,
    ),
  );
}

/** It needs the owner. Says so on the row until they deal with it. */
export function block(doc: AgentsDoc, id: string, by: string, why: string, at: string): AgentsDoc {
  return mapAgent(doc, id, (a) =>
    touch(
      withLog({ ...a, status: "blocked", lease: undefined, blockedWhy: clip(why, 400) }, { at, by, text: clip(why, 600), kind: "blocked" }),
      at,
    ),
  );
}

export function finish(doc: AgentsDoc, id: string, by: string, result: string, at: string): AgentsDoc {
  return mapAgent(doc, id, (a) =>
    a.repeat !== "once" ? nextRound(a, by, result, at) : touch(
      withLog(
        {
          ...a,
          status: "done",
          lease: undefined,
          blockedWhy: undefined,
          steps: a.steps.map((s) => (s.done ? s : { ...s, done: true, at, by })),
        },
        { at, by, text: clip(result, 600) || "Done.", kind: "done" },
      ),
      at,
    ),
  );
}

/**
 * A repeating agent finished a round: rest, then go again.
 *
 * The steps reset so the next round has work to take, and the result becomes
 * the handoff, so round two builds on round one ("these 10 were already sent
 * to EA World") instead of repeating it.
 */
function nextRound(a: Agent, by: string, result: string, at: string): Agent {
  const rounds = a.rounds + 1;
  const wait = REPEAT_MS[a.repeat as Exclude<AgentRepeat, "once">];
  const nextRunAt = new Date(Date.parse(at) + wait).toISOString();
  const said = clip(result, 600) || "Round finished.";
  return touch(
    withLog(
      {
        ...a,
        status: "waiting",
        lease: undefined,
        blockedWhy: undefined,
        rounds,
        nextRunAt,
        steps: a.steps.map((s) => ({ ...s, done: false, at: undefined, by: undefined, note: undefined })),
        handoff: {
          at,
          by,
          text: clip(
            `Round ${rounds} finished: ${said} Start round ${rounds + 1} fresh, building on that. Do not redo what it already did or sent.`,
            1200,
          ),
        },
      },
      { at, by, text: `Round ${rounds} done: ${said}`, kind: "done" },
    ),
    at,
  );
}

/** Skip the rest and run the next round now. */
export function runNow(doc: AgentsDoc, id: string, at: string): AgentsDoc {
  return mapAgent(doc, id, (a) =>
    a.status === "done" || a.status === "paused"
      ? a
      : touch(
          withLog({ ...a, status: "waiting", nextRunAt: undefined, blockedWhy: undefined }, { at, by: "you", text: "Run now.", kind: "started" }),
          at,
        ),
  );
}

export interface AgentSettings {
  pick?: string;
  edits?: string[];
  sendsTo?: string[];
  ship?: ShipMode;
  repeat?: AgentRepeat;
}

/** Change how an agent runs without refiling it. */
export function configure(doc: AgentsDoc, id: string, change: AgentSettings, at: string): AgentsDoc {
  return mapAgent(doc, id, (a) => {
    const next: Agent = {
      ...a,
      ...(change.pick !== undefined ? { pick: cleanAgentPick(change.pick) } : {}),
      ...(change.edits !== undefined ? { edits: cleanEdits(change.edits) } : {}),
      ...(change.sendsTo !== undefined ? { sendsTo: cleanSendsTo(change.sendsTo) } : {}),
      ...(change.ship !== undefined ? { ship: cleanShip(change.ship) } : {}),
      ...(change.repeat !== undefined ? { repeat: cleanRepeat(change.repeat) } : {}),
    };
    // Switching to "once" drops a pending rest, or it would never run again.
    if (next.repeat === "once") next.nextRunAt = undefined;
    return touch(withLog(next, { at, by: "you", text: "Settings changed.", kind: "progress" }), at);
  });
}

/**
 * Another agent sent this one something to act on.
 *
 * A message wakes it: a resting or finished agent goes back to waiting with a
 * new step, so "the EA scout sent ten names" makes the tester start now rather
 * than at its next scheduled round. A paused one only logs it.
 */
export function receive(doc: AgentsDoc, id: string, from: string, text: string, at: string): AgentsDoc {
  const target = doc.agents.find((a) => a.id === id);
  if (!target) return doc;
  if (target.status === "paused") {
    return mapAgent(doc, id, (a) => withLog(a, { at, by: from, text: clip(`Sent while paused: ${text}`, 600), kind: "progress" }));
  }
  const withStep = addSteps(doc, id, [`Act on what ${from} sent: ${clip(text, 300)}`], at);
  return mapAgent(withStep, id, (a) =>
    touch(
      withLog(
        { ...a, status: a.status === "running" ? "running" : "waiting", nextRunAt: undefined, blockedWhy: undefined },
        { at, by: from, text: clip(`Sent: ${text}`, 600), kind: "progress" },
      ),
      at,
    ),
  );
}

/** Record the harness run a code-changing round left behind. */
export function recordThread(doc: AgentsDoc, id: string, thread: AgentThread, by: string): AgentsDoc {
  const said: Record<AgentThread["outcome"], string> = {
    ready: `Changes are on ${thread.branch}, waiting for you to review and land.`,
    landed: `Landed ${thread.branch}.`,
    pushed: `Landed and pushed ${thread.branch}. It's live.`,
    nothing: "The run changed no files.",
    failed: `The harness run didn't finish${thread.why ? `: ${thread.why}` : "."}`,
  };
  return mapAgent(doc, id, (a) =>
    touch(withLog({ ...a, thread }, { at: thread.at, by, text: clip(said[thread.outcome], 600), kind: "progress" }), thread.at),
  );
}

export function pause(doc: AgentsDoc, id: string, at: string): AgentsDoc {
  return mapAgent(doc, id, (a) =>
    a.status === "done" ? a : touch(withLog({ ...a, status: "paused", lease: undefined }, { at, by: "you", text: "Paused.", kind: "stopped" }), at),
  );
}

export function resume(doc: AgentsDoc, id: string, at: string): AgentsDoc {
  return mapAgent(doc, id, (a) =>
    a.status === "paused"
      ? touch(withLog({ ...a, status: "waiting" }, { at, by: "you", text: "Started again.", kind: "started" }), at)
      : a,
  );
}

export function remove(doc: AgentsDoc, id: string): AgentsDoc {
  return { agents: doc.agents.filter((a) => a.id !== id) };
}

export function add(doc: AgentsDoc, agent: Agent): AgentsDoc {
  return { agents: [...doc.agents, agent] };
}

// --- reading one ----------------------------------------------------------

export interface Progress {
  done: number;
  total: number;
  /** 0–100, and 100 only when it really is finished. */
  pct: number;
}

export function progressOf(agent: Agent): Progress {
  const total = agent.steps.length;
  const done = agent.steps.filter((s) => s.done).length;
  if (agent.status === "done") return { done: total, total, pct: 100 };
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * One line the owner can read without opening anything.
 *
 * Deliberately says what is TRUE rather than what is hoped: an agent that
 * needs a machine nobody has turned on says so, because the alternative is a
 * row that looks busy for three days.
 */
export function statusLine(agent: Agent, now: number): string {
  if (agent.status === "done") return "Finished.";
  if (agent.status === "paused") return "Paused — it won't be picked up.";
  if (agent.status === "blocked") return agent.blockedWhy || "Waiting on you.";
  if (resting(agent, now)) {
    const ms = Date.parse(agent.nextRunAt as string) - now;
    const h = Math.round(ms / 3_600_000);
    const when = ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
    return `Round ${agent.rounds} done. Next round in ${when}.`;
  }
  if (leaseHeld(agent, now)) {
    const who = agent.lease?.by || "a machine";
    return `${who} is working on it now.`;
  }
  const { done, total } = progressOf(agent);
  const where = agent.needs.length ? agent.needs.map((n) => NEED_LABEL[n]).join(" + ") : "any machine";
  if (done > 0) return `Waiting for ${where} to carry on — ${done} of ${total} steps done.`;
  return `Waiting for ${where}.`;
}

/** Newest activity first, finished ones last — the owner reads the live work. */
export function sortAgents(agents: Agent[]): Agent[] {
  const rank = (a: Agent) => (a.status === "done" ? 1 : 0);
  return [...agents].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export function liveCount(doc: AgentsDoc): number {
  return doc.agents.filter((a) => a.status !== "done").length;
}

// --- the document ---------------------------------------------------------

function cleanStep(raw: unknown, i: number): AgentStep {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof s.id === "string" && s.id ? s.id : `s${i + 1}`,
    text: clip(s.text, 400),
    done: s.done === true,
    at: typeof s.at === "string" ? s.at : undefined,
    by: typeof s.by === "string" ? s.by : undefined,
    note: typeof s.note === "string" ? clip(s.note, 400) : undefined,
  };
}

const STATUSES: AgentStatus[] = ["waiting", "running", "blocked", "paused", "done"];

function cleanAgent(raw: unknown): Agent | null {
  const a = (raw ?? {}) as Record<string, unknown>;
  const id = typeof a.id === "string" ? a.id : "";
  const goal = clip(a.goal, MAX_GOAL);
  if (!id || !goal) return null;
  const at = typeof a.createdAt === "string" ? a.createdAt : new Date(0).toISOString();
  const status = STATUSES.includes(a.status as AgentStatus) ? (a.status as AgentStatus) : "waiting";
  return {
    id,
    goal,
    needs: cleanNeeds(a.needs),
    folder: typeof a.folder === "string" && a.folder ? a.folder : undefined,
    status,
    steps: Array.isArray(a.steps) ? a.steps.slice(0, MAX_STEPS).map(cleanStep) : [],
    handoff:
      a.handoff && typeof a.handoff === "object"
        ? {
            at: String((a.handoff as Record<string, unknown>).at || at),
            by: String((a.handoff as Record<string, unknown>).by || "a machine"),
            text: clip((a.handoff as Record<string, unknown>).text, 1200),
          }
        : undefined,
    lease:
      a.lease && typeof a.lease === "object"
        ? {
            by: String((a.lease as Record<string, unknown>).by || ""),
            until: String((a.lease as Record<string, unknown>).until || ""),
          }
        : undefined,
    log: Array.isArray(a.log)
      ? a.log.slice(-MAX_LOG).map((l) => {
          const line = (l ?? {}) as Record<string, unknown>;
          return {
            at: String(line.at || at),
            by: String(line.by || "you"),
            text: clip(line.text, 600),
            kind: (["filed", "started", "progress", "blocked", "handoff", "done", "stopped"] as LogKind[]).includes(
              line.kind as LogKind,
            )
              ? (line.kind as LogKind)
              : "progress",
          };
        })
      : [],
    createdAt: at,
    updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : at,
    from: typeof a.from === "string" && a.from ? a.from : "you",
    blockedWhy: typeof a.blockedWhy === "string" ? clip(a.blockedWhy, 400) : undefined,
    images: Array.isArray(a.images) ? a.images.filter((i) => typeof i === "string").slice(0, MAX_IMAGES) : [],
    pick: cleanAgentPick(a.pick),
    edits: cleanEdits(a.edits),
    sendsTo: cleanSendsTo(a.sendsTo),
    ship: cleanShip(a.ship),
    repeat: cleanRepeat(a.repeat),
    nextRunAt: typeof a.nextRunAt === "string" && Number.isFinite(Date.parse(a.nextRunAt)) ? a.nextRunAt : undefined,
    rounds: typeof a.rounds === "number" && a.rounds >= 0 ? Math.floor(a.rounds) : 0,
    thread: cleanThread(a.thread),
  };
}

function cleanThread(raw: unknown): AgentThread | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Record<string, unknown>;
  const outcomes: AgentThread["outcome"][] = ["ready", "landed", "pushed", "nothing", "failed"];
  if (typeof t.id !== "string" || !t.id) return undefined;
  return {
    id: t.id.slice(0, 80),
    branch: clip(t.branch, 120),
    at: typeof t.at === "string" ? t.at : new Date(0).toISOString(),
    outcome: outcomes.includes(t.outcome as AgentThread["outcome"]) ? (t.outcome as AgentThread["outcome"]) : "ready",
    why: typeof t.why === "string" ? clip(t.why, 300) : undefined,
  };
}

/** Anything the store hands back becomes a valid doc, or an empty one. */
export function normalizeDoc(raw: unknown): AgentsDoc {
  const d = (raw ?? {}) as Record<string, unknown>;
  const agents = Array.isArray(d.agents)
    ? d.agents.map(cleanAgent).filter((a): a is Agent => a !== null)
    : [];
  // One id wins, so a double POST cannot put the same agent in twice (D5).
  const seen = new Set<string>();
  return { agents: agents.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true))) };
}

/** Forget agents that finished a fortnight ago. The tab cleans itself. */
export function prune(doc: AgentsDoc, now: number): AgentsDoc {
  const cutoff = now - DONE_DAYS * 24 * 60 * 60 * 1000;
  return {
    agents: doc.agents.filter((a) => a.status !== "done" || Date.parse(a.updatedAt) >= cutoff),
  };
}
