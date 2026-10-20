// ---------------------------------------------------------------------------
// Improvements — Jarvis's ideas for the person using it.
//
// The self-audit in `improve.ts` looks at Jarvis's own setup (tabs, security,
// notes). This looks at the PERSON: what they keep asking, what they are
// working through, what keeps going wrong — and turns that into four kinds of
// idea:
//
//   life      something for their life, drawn from what they are going through
//   workflow  a repeated chore Jarvis could take over or a routine worth setting
//   app       an app or tool worth building or adding to their hub
//   jarvis    a change that would make Jarvis itself easier to use
//
// The same two rules as the auditor hold here:
//
//   PROPOSE ONLY. An idea never does anything by itself. Its buttons add a
//   to-do, hand a prompt to chat, or put it away.
//
//   EVIDENCE OR SILENCE. Every idea names what it noticed. An idea with
//   nothing behind it is dropped, because generic advice trains people to
//   stop reading the widget.
//
// Everything in this file is pure so it can be tested without a browser.
// ---------------------------------------------------------------------------

export type IdeaKind = "life" | "workflow" | "app" | "jarvis";

export const IDEA_KINDS: { id: IdeaKind; label: string; blurb: string }[] = [
  { id: "life", label: "Life", blurb: "For what you're going through" },
  { id: "workflow", label: "Workflows", blurb: "Things Jarvis could take off your plate" },
  { id: "app", label: "Apps", blurb: "Tools worth building or adding" },
  { id: "jarvis", label: "Jarvis", blurb: "Ways Jarvis could be easier to use" },
];

export type IdeaEffort = "minutes" | "hours" | "a session";

export interface Idea {
  /** Deterministic from kind + title, so "not for me" sticks across refreshes. */
  id: string;
  kind: IdeaKind;
  title: string;
  /** Why it would help, in plain words, addressed to the person. */
  why: string;
  /** One concrete thing to do first. */
  firstStep: string;
  effort: IdeaEffort;
  /** What Jarvis noticed. Never empty. */
  evidence: string[];
  /** A message the person can send to Jarvis chat to start on it. */
  prompt: string;
  /** Where it came from: the chat reader, or the system self-audit. */
  origin: "chat" | "audit";
  /** ISO, when it was first suggested. */
  at: string;
}

export interface IdeasState {
  ideas: Idea[];
  /** ISO of the last time ideas were generated, or "". */
  generatedAt: string;
  /** How many chat messages had been seen at that time, so "anything new?" is cheap. */
  seenMessages: number;
  /** Ids put away with "Not for me". Never suggested again. */
  dismissed: string[];
  /** Ids marked done. */
  done: string[];
  /** Ids saved for later — kept even when a refresh no longer suggests them. */
  saved: string[];
}

export function emptyIdeasState(): IdeasState {
  return { ideas: [], generatedAt: "", seenMessages: 0, dismissed: [], done: [], saved: [] };
}

const REMEMBER = 400;
const tail = (list: string[]) => (list.length > REMEMBER ? list.slice(list.length - REMEMBER) : list);

// --- ids -------------------------------------------------------------------

/** Lower-case words only, so "Set up a budget!" and "set up a budget" are one idea. */
export function ideaId(kind: IdeaKind, title: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 10)
    .join("-");
  return `${kind}:${stem || "idea"}`;
}

// --- validating what the model sends back -----------------------------------

const KINDS = new Set<IdeaKind>(["life", "workflow", "app", "jarvis"]);
const EFFORTS = new Set<IdeaEffort>(["minutes", "hours", "a session"]);

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * One idea from untrusted JSON, or null.
 *
 * The model's answer is data, not instructions: anything without a kind, a
 * title, a reason and at least one piece of evidence is dropped rather than
 * repaired, because a half-idea is exactly the generic filler this widget
 * exists to avoid.
 */
export function coerceIdea(raw: unknown, now: number, origin: Idea["origin"] = "chat"): Idea | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = typeof r.kind === "string" && KINDS.has(r.kind as IdeaKind) ? (r.kind as IdeaKind) : null;
  const title = str(r.title, 90);
  const why = str(r.why, 400);
  if (!kind || !title || !why) return null;
  const evidence = (Array.isArray(r.evidence) ? r.evidence : [])
    .map((e) => str(e, 200))
    .filter(Boolean)
    .slice(0, 4);
  if (!evidence.length) return null;
  const effort = typeof r.effort === "string" && EFFORTS.has(r.effort as IdeaEffort) ? (r.effort as IdeaEffort) : "hours";
  const firstStep = str(r.firstStep, 240) || "Talk it through with Jarvis.";
  const prompt = str(r.prompt, 400) || `Help me with this idea: ${title}`;
  return {
    id: ideaId(kind, title),
    kind,
    title,
    why,
    firstStep,
    effort,
    evidence,
    prompt,
    origin,
    at: typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? r.at : new Date(now).toISOString(),
  };
}

export function coerceIdeas(raw: unknown, now: number, origin: Idea["origin"] = "chat"): Idea[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: Idea[] = [];
  for (const item of list) {
    const idea = coerceIdea(item, now, origin);
    if (!idea || seen.has(idea.id)) continue;
    seen.add(idea.id);
    out.push(idea);
  }
  return out;
}

/** Repair a half-written or older stored blob rather than throwing. */
export function coerceIdeasState(raw: unknown): IdeasState {
  const r = (raw ?? {}) as Partial<IdeasState>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const ideas = Array.isArray(r.ideas)
    ? coerceIdeas(r.ideas, Date.now()).map((idea, i) => ({
        ...idea,
        origin: (r.ideas as Partial<Idea>[])[i]?.origin === "audit" ? ("audit" as const) : idea.origin,
      }))
    : [];
  return {
    ideas,
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : "",
    seenMessages: typeof r.seenMessages === "number" && r.seenMessages >= 0 ? r.seenMessages : 0,
    dismissed: tail(strings(r.dismissed)),
    done: tail(strings(r.done)),
    saved: tail(strings(r.saved)),
  };
}

// --- what the idea-maker is shown -----------------------------------------

/** One thing the person said, with when. */
export interface Said {
  text: string;
  at: number;
  /** Set when Jarvis could not do what was asked, so "Jarvis" ideas can see the friction. */
  failed?: string;
}

export interface DigestInput {
  said: Said[];
  /** Titles of things Jarvis remembers about them. */
  memories: string[];
  /** The system self-audit's current findings, by title. */
  audit: string[];
  /** Ideas already shown or put away, so the model does not repeat them. */
  known: string[];
  /** Ideas the person said no to, so the model avoids that direction. */
  rejected: string[];
  /**
   * What has actually been built in their apps lately, one line per change,
   * newest first (Projects Timeline › App edits). Optional.
   */
  appEdits?: string;
}

/** How much chat the model is shown. Enough to see patterns, not a whole history. */
export const DIGEST_MESSAGES = 80;
const DIGEST_CHARS = 14_000;

/**
 * The text the model reads.
 *
 * Only what the PERSON said goes in — never Jarvis's own answers, which would
 * teach the model to suggest more of what Jarvis already said. Newest first,
 * trimmed, and capped so one long paste cannot crowd out a month of patterns.
 */
export function buildDigest(input: DigestInput): string {
  const said = [...input.said]
    .filter((s) => s.text.trim())
    .sort((a, b) => b.at - a.at)
    .slice(0, DIGEST_MESSAGES);

  const lines: string[] = [];
  lines.push(`## What they said to Jarvis (newest first, ${said.length} messages)`);
  for (const s of said) {
    const day = new Date(s.at).toISOString().slice(0, 10);
    const text = s.text.replace(/\s+/g, " ").trim().slice(0, 300);
    lines.push(`- [${day}] ${text}${s.failed ? `  (Jarvis could not do this: ${s.failed.slice(0, 120)})` : ""}`);
  }
  if (input.memories.length) {
    lines.push("", "## Things Jarvis remembers about them");
    for (const m of input.memories.slice(0, 40)) lines.push(`- ${m.slice(0, 140)}`);
  }
  if (input.appEdits?.trim()) {
    lines.push("", "## What has been built in their apps lately (Projects Timeline › App edits, newest first)");
    lines.push(input.appEdits.trim());
  }
  if (input.audit.length) {
    lines.push("", "## Jarvis's own setup problems already found (do not repeat these)");
    for (const a of input.audit.slice(0, 12)) lines.push(`- ${a}`);
  }
  if (input.known.length) {
    lines.push("", "## Ideas already suggested (do not repeat)");
    for (const k of input.known.slice(0, 40)) lines.push(`- ${k}`);
  }
  if (input.rejected.length) {
    lines.push("", "## Ideas they said were not for them (avoid this direction)");
    for (const k of input.rejected.slice(0, 30)) lines.push(`- ${k}`);
  }

  let text = lines.join("\n");
  if (text.length > DIGEST_CHARS) text = `${text.slice(0, DIGEST_CHARS)}\n…(cut for length)`;
  return text;
}

/**
 * Enough to be worth asking: a handful of things said. Fewer than that and
 * any "pattern" would be invented.
 */
export const MIN_MESSAGES = 3;

/** Ideas refresh by themselves at most this often. The button refreshes any time. */
export const AUTO_REFRESH_HOURS = 24;

/** Should the widget ask for fresh ideas on its own? */
export function shouldAutoRefresh(state: IdeasState, messageCount: number, now: number): boolean {
  if (messageCount < MIN_MESSAGES) return false;
  if (!state.generatedAt) return true;
  const age = now - Date.parse(state.generatedAt);
  if (Number.isNaN(age)) return true;
  // Only when there is something new to read — re-asking about the same chat
  // spends money to get the same list back.
  return age >= AUTO_REFRESH_HOURS * 3_600_000 && messageCount > state.seenMessages;
}

// --- the self-audit, as ideas ------------------------------------------------

export interface AuditProposalLike {
  id: string;
  title: string;
  why: string;
  how: string;
  effort: IdeaEffort;
  evidence: string[];
}

/**
 * The existing self-audit's findings, shown under the "Jarvis" filter.
 *
 * They keep their own id (prefixed) so dismissing one here and in the Improve
 * pane are two separate decisions — the pane writes specs, the widget does not.
 */
export function auditAsIdeas(proposals: AuditProposalLike[], now: number): Idea[] {
  return proposals
    .filter((p) => p.evidence.length)
    .map((p) => ({
      id: `audit:${p.id}`,
      kind: "jarvis" as const,
      title: p.title,
      why: p.why,
      firstStep: p.how,
      effort: p.effort,
      evidence: p.evidence.slice(0, 4),
      prompt: `Jarvis found this about its own setup: "${p.title}". ${p.how} Walk me through doing it.`,
      origin: "audit" as const,
      at: new Date(now).toISOString(),
    }));
}

// --- merging and deciding -----------------------------------------------------

/**
 * Fresh ideas over the old list.
 *
 * Saved ideas survive a refresh even when the model no longer suggests them —
 * "save" is a promise. Everything else is replaced by the new list, so the
 * widget reflects what the person is going through NOW, not last month.
 */
export function mergeIdeas(state: IdeasState, fresh: Idea[], now: number, messageCount: number): IdeasState {
  const keep = state.ideas.filter((i) => state.saved.includes(i.id) && i.origin === "chat");
  const byId = new Map<string, Idea>();
  for (const i of keep) byId.set(i.id, i);
  for (const i of fresh) {
    const old = byId.get(i.id) ?? state.ideas.find((o) => o.id === i.id);
    // An idea suggested again keeps its first date, so "new" means new.
    byId.set(i.id, old ? { ...i, at: old.at } : i);
  }
  return { ...state, ideas: [...byId.values()], generatedAt: new Date(now).toISOString(), seenMessages: messageCount };
}

export type IdeaView = "open" | "saved" | "done";

export interface Shown {
  ideas: Idea[];
  counts: Record<IdeaKind, number>;
  /** Open ideas suggested in the last two days. */
  fresh: number;
}

const KIND_ORDER: Record<IdeaKind, number> = { life: 0, workflow: 1, app: 2, jarvis: 3 };
const EFFORT_ORDER: Record<IdeaEffort, number> = { minutes: 0, hours: 1, "a session": 2 };

/**
 * What the widget shows: the person's decisions applied, newest-and-cheapest first.
 *
 * Saved ideas sit at the top of the open list too — the person said they
 * wanted to come back to them.
 */
export function visibleIdeas(
  state: IdeasState,
  audit: Idea[],
  now: number,
  view: IdeaView = "open",
  kind: IdeaKind | "all" = "all",
): Shown {
  const dismissed = new Set(state.dismissed);
  const done = new Set(state.done);
  const saved = new Set(state.saved);

  const all = [...state.ideas, ...audit.filter((a) => !state.ideas.some((i) => i.id === a.id))];
  const pool = all.filter((i) => {
    if (dismissed.has(i.id)) return false;
    if (view === "done") return done.has(i.id);
    if (done.has(i.id)) return false;
    if (view === "saved") return saved.has(i.id);
    return true;
  });

  const counts: Record<IdeaKind, number> = { life: 0, workflow: 0, app: 0, jarvis: 0 };
  for (const i of pool) counts[i.kind] += 1;

  const twoDays = 2 * 86_400_000;
  const fresh = view === "open" ? pool.filter((i) => now - Date.parse(i.at) < twoDays && i.origin === "chat").length : 0;

  const ideas = pool
    .filter((i) => kind === "all" || i.kind === kind)
    .sort(
      (a, b) =>
        Number(saved.has(b.id)) - Number(saved.has(a.id)) ||
        Number(a.origin === "audit") - Number(b.origin === "audit") ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort] ||
        a.title.localeCompare(b.title),
    );

  return { ideas, counts, fresh };
}

export function dismissIdea(state: IdeasState, id: string): IdeasState {
  if (state.dismissed.includes(id)) return state;
  return { ...state, dismissed: tail([...state.dismissed, id]), saved: state.saved.filter((s) => s !== id) };
}

export function toggleSaved(state: IdeasState, id: string): IdeasState {
  return state.saved.includes(id)
    ? { ...state, saved: state.saved.filter((s) => s !== id) }
    : { ...state, saved: tail([...state.saved, id]) };
}

export function markDone(state: IdeasState, id: string): IdeasState {
  if (state.done.includes(id)) return state;
  return { ...state, done: tail([...state.done, id]), saved: state.saved.filter((s) => s !== id) };
}

export function reopen(state: IdeasState, id: string): IdeasState {
  return { ...state, done: state.done.filter((d) => d !== id), dismissed: state.dismissed.filter((d) => d !== id) };
}

/** Titles of everything already raised or rejected, for the digest. */
export function knownTitles(state: IdeasState): { known: string[]; rejected: string[] } {
  const dismissed = new Set(state.dismissed);
  return {
    known: state.ideas.filter((i) => !dismissed.has(i.id)).map((i) => i.title),
    rejected: state.ideas.filter((i) => dismissed.has(i.id)).map((i) => i.title),
  };
}
