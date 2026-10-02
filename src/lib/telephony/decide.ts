// ---------------------------------------------------------------------------
// Whether to ring the owner's phone.
//
// A phone call is the most interruptive channel there is. A notification can be
// ignored; a ringing phone cannot. So this module is almost entirely about
// RESTRAINT, and it is written to be read as a set of reasons not to call.
//
// Every candidate is judged and the verdict kept, including the ones that come
// to nothing. That log — the calls it did NOT make, and why — is the whole
// point of the feature shipping dormant: with no provider key at all the owner
// can watch what it would have done for a week, and tune the rules before
// spending anything. Trust in something allowed to ring your phone is built by
// watching it decline to.
//
// One call carries ONE reason. A phone call is singular — a digest of five
// things is an email, and reading a list down the phone is worse than not
// calling at all. The most urgent candidate wins and the rest are logged as
// having lost to it.
// ---------------------------------------------------------------------------

import type { JarvisUpdate, UpdateSource } from "@/lib/jarvis/updates";

export type Decline =
  /** The owner has not allowed calls about this kind of thing. */
  | "source-off"
  /** Real, but not urgent enough to interrupt a person for. */
  | "not-urgent"
  /** Inside the hours the owner said not to ring. */
  | "quiet-hours"
  /** Another call went out too recently. */
  | "cooldown"
  /** Already used up today's allowance. */
  | "daily-cap"
  /** This exact thing has already been called about. */
  | "already-called"
  /** The owner was looking at Jarvis a moment ago, so they have seen it. */
  | "you-were-here"
  /** Something more urgent won. */
  | "outranked"
  /** No telephony provider is configured. */
  | "no-provider";

export interface Judged {
  update: JarvisUpdate;
  /** Null when this is the one to call about. */
  decline: Decline | null;
  /** 0..1 — how much this warrants interrupting someone. */
  urgency: number;
}

export interface CallPolicy {
  enabled: boolean;
  /** Which sources may ever cause a call. Empty means none. */
  sources: UpdateSource[];
  /** Local hour (0-23) the quiet period starts, and the hour it ends. */
  quietFrom: number;
  quietUntil: number;
  maxPerDay: number;
  cooldownMinutes: number;
  /**
   * Do not call if Jarvis was open in the last few minutes.
   *
   * The commonest false positive by a distance: ringing someone about a thing
   * that is on the screen in front of them.
   */
  skipIfRecentlySeen: boolean;
  seenWithinMinutes: number;
  /** Below this, nothing is worth a phone call. */
  minUrgency: number;
}

export function defaultPolicy(): CallPolicy {
  return {
    enabled: false,
    // Calendar and pending actions only, to begin with. A new list item is not
    // a reason to ring anybody, and starting permissive is how a feature like
    // this gets switched off for good after one bad week.
    sources: ["calendar", "actions"],
    quietFrom: 21,
    quietUntil: 8,
    maxPerDay: 3,
    cooldownMinutes: 45,
    skipIfRecentlySeen: true,
    seenWithinMinutes: 10,
    minUrgency: 0.6,
  };
}

export interface CallState {
  /** ISO of each call placed, newest first. Trimmed by the caller. */
  placedAt: string[];
  /** Update ids already called about. */
  calledAbout: string[];
}

export function emptyCallState(): CallState {
  return { placedAt: [], calledAbout: [] };
}

// --- urgency ---------------------------------------------------------------

/**
 * How much a thing warrants interrupting a person, 0..1.
 *
 * Deliberately steep. Almost everything should fall below the threshold —
 * these numbers exist to make a call rare, not to rank a feed.
 */
export function urgencyOf(update: JarvisUpdate, now: number): number {
  switch (update.source) {
    case "calendar": {
      if (!update.startsAt) return 0;
      const minutes = (Date.parse(update.startsAt) - now) / 60_000;
      // Something already begun cannot be helped by a phone call.
      if (Number.isNaN(minutes) || minutes < 0) return 0;
      // The band where a call genuinely helps: close enough to matter, far
      // enough that knowing changes what you do.
      if (minutes <= 20) return 0.95;
      if (minutes <= 45) return 0.75;
      if (minutes <= 90) return 0.5;
      return 0.2;
    }
    case "actions":
      // Something is waiting on a yes and cannot proceed without it.
      return 0.8;
    case "spend":
      // Only the one that stops everything working.
      return /credit|out of|exhaust/i.test(`${update.title} ${update.detail}`) ? 0.85 : 0.2;
    case "memory":
      return 0.15;
    case "lists":
      return 0.2;
    case "photos":
      return 0.05;
    default:
      return 0.1;
  }
}

// --- the quiet hours -------------------------------------------------------

/**
 * True when `hour` falls inside the quiet period.
 *
 * Handles the ordinary case of a window that crosses midnight — 21:00 to 08:00
 * is two ranges, and getting this wrong means either never calling or calling
 * at four in the morning.
 */
export function inQuietHours(hour: number, from: number, until: number): boolean {
  if (from === until) return false;
  return from < until ? hour >= from && hour < until : hour >= from || hour < until;
}

function callsToday(state: CallState, now: number): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return state.placedAt.filter((iso) => {
    const at = Date.parse(iso);
    return !Number.isNaN(at) && at >= start.getTime();
  }).length;
}

function minutesSinceLastCall(state: CallState, now: number): number {
  const last = state.placedAt
    .map((iso) => Date.parse(iso))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => b - a)[0];
  return last === undefined ? Infinity : (now - last) / 60_000;
}

// --- the decision ----------------------------------------------------------

export interface Verdict {
  /** The one thing worth a call, or null. */
  call: JarvisUpdate | null;
  /** Everything considered, with why it did or did not win. The log that builds trust. */
  judged: Judged[];
  /** Why no call is being placed, when none is. */
  reason: Decline | null;
}

export interface DecideInput {
  updates: JarvisUpdate[];
  policy: CallPolicy;
  state: CallState;
  now: number;
  /** ISO of the last time Jarvis was open in front of the owner. */
  lastSeenAt?: string | null;
  /** False when no provider is configured. */
  providerReady: boolean;
}

export function decide(input: DecideInput): Verdict {
  const { updates, policy, state, now, providerReady } = input;
  const judged: Judged[] = [];

  // Conditions that apply to the whole run rather than to one candidate.
  const hour = new Date(now).getHours();
  const quiet = inQuietHours(hour, policy.quietFrom, policy.quietUntil);
  const capped = callsToday(state, now) >= policy.maxPerDay;
  const tooSoon = minutesSinceLastCall(state, now) < policy.cooldownMinutes;
  const seenAt = input.lastSeenAt ? Date.parse(input.lastSeenAt) : NaN;
  const present =
    policy.skipIfRecentlySeen && !Number.isNaN(seenAt) && (now - seenAt) / 60_000 < policy.seenWithinMinutes;

  const blanket: Decline | null = !providerReady
    ? "no-provider"
    : !policy.enabled
      ? "source-off"
      : quiet
        ? "quiet-hours"
        : capped
          ? "daily-cap"
          : tooSoon
            ? "cooldown"
            : present
              ? "you-were-here"
              : null;

  const called = new Set(state.calledAbout);
  const ranked: Judged[] = [];

  for (const update of updates) {
    const urgency = urgencyOf(update, now);
    // Per-candidate reasons first, so the log says the most specific true
    // thing rather than always blaming the blanket condition.
    let decline: Decline | null = null;
    if (called.has(update.id)) decline = "already-called";
    else if (!policy.sources.includes(update.source)) decline = "source-off";
    else if (urgency < policy.minUrgency) decline = "not-urgent";
    else decline = blanket;

    const row: Judged = { update, decline, urgency };
    judged.push(row);
    if (!decline) ranked.push(row);
  }

  // Most urgent first; a tie goes to whatever starts soonest, then to the id so
  // the same feed always decides the same way.
  ranked.sort(
    (a, b) =>
      b.urgency - a.urgency ||
      (Date.parse(a.update.startsAt ?? a.update.at) || 0) - (Date.parse(b.update.startsAt ?? b.update.at) || 0) ||
      a.update.id.localeCompare(b.update.id),
  );

  const winner = ranked[0] ?? null;
  for (const row of ranked.slice(1)) row.decline = "outranked";

  return {
    call: winner?.update ?? null,
    judged,
    reason: winner ? null : (blanket ?? (judged.length ? "not-urgent" : null)),
  };
}

// --- recording -------------------------------------------------------------

const REMEMBER = 200;

export function recordCall(state: CallState, update: JarvisUpdate, now: number): CallState {
  return {
    placedAt: [new Date(now).toISOString(), ...state.placedAt].slice(0, REMEMBER),
    calledAbout: [update.id, ...state.calledAbout.filter((id) => id !== update.id)].slice(0, REMEMBER),
  };
}

// --- words -----------------------------------------------------------------

export const DECLINE_REASON: Record<Decline, string> = {
  "source-off": "you have not allowed calls about this",
  "not-urgent": "not urgent enough to interrupt you",
  "quiet-hours": "inside your quiet hours",
  cooldown: "another call went out too recently",
  "daily-cap": "today's call limit is used up",
  "already-called": "you have already been called about this",
  "you-were-here": "Jarvis was open in front of you",
  outranked: "something more urgent won",
  "no-provider": "no phone service is connected",
};

/** One honest line about a run, for the log's header. */
export function describeVerdict(verdict: Verdict): string {
  if (verdict.call) return `Would ring you about: ${verdict.call.title}`;
  const considered = verdict.judged.length;
  if (!considered) return "Nothing to consider.";
  if (verdict.reason) return `No call — ${DECLINE_REASON[verdict.reason]}.`;
  return "No call.";
}
