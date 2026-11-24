// The queue, and every decision about what to say next. This is the module
// that decides whether the stream feels like a person or a text-to-speech
// reader: who gets answered first, what never gets read aloud, when to fill a
// silence, when to cut itself off — and, above all of it, the owner's hand.
//
// Pure: `now` is always a parameter and nothing here starts a timer, so every
// rule is testable without waiting.

import type { AgentEvent } from "./events";
import { Dedupe, MAX_PER_MINUTE, RateLimit } from "./limits";
import { moderate, type BlockReason } from "./moderation";
import type { CueKind } from "./command";
import type { Emotion } from "./performance";
import { PRIORITY, priorityOf } from "./priority";

/** Silence longer than this and the stream feels dead. */
export const IDLE_MS = 20_000;
/** A comment older than this has scrolled away; answering it is confusing. */
export const STALE_MS = 2 * 60_000;
/** Remembered ids, so the same message arriving twice is one message (D5). */
const MAX_SEEN = 5_000;
/**
 * Priority a waiting comment gains per second. Without it, a busy room
 * starves plain questions forever: every new gift or mention cuts in line,
 * and the first question of the stream expires unanswered. At 1.5/s a
 * question (40) catches a fresh follow (80) in ~27 s and a fresh gift (100)
 * in 40 s — gifts are still thanked fast, and nobody waits forever.
 */
export const AGE_PER_SECOND = 1.5;
/** Ageing never lifts a comment past the owner's own "Answer now". */
const AGE_CAP = 300;

/** What the director asked to be done with a particular viewer's next answer. */
export interface Direction {
  /** "Tell them that's a ridiculous question." Private — shapes the reply, never read out. */
  note?: string;
  /** The face for this answer ("smile when you answer Sarah"). */
  expression?: Emotion;
}

/** A line the director asked for that isn't an answer to a comment. */
export interface Cue {
  kind: CueKind;
  /** Private: what to do, in the director's words. The brain writes the line. */
  intent: string;
  /** Who it's for, when it's for someone. */
  about?: { handle: string; user: string; text?: string };
}

export type Turn =
  | { kind: "answer"; event: AgentEvent; priority: number; direction?: Direction }
  | { kind: "filler"; text: string }
  | { kind: "say"; text: string }
  | { kind: "cue"; cue: Cue };

/** Why a queued comment was passed over — shown to the owner, never silent. */
export interface Discarded {
  id: string;
  reason: "repeat" | "stale";
}

export type Disposition =
  | { status: "queued"; watched?: Direction & { promoted: boolean } }
  | { status: "duplicate" }
  | { status: "blocked"; reason: BlockReason }
  | { status: "muted" };

export interface DirectorOptions {
  characterName: string;
  /** Said when nothing is happening. Each is used at most once a stream. */
  fillers: string[];
  maxPerMinute?: number;
  idleMs?: number;
  blocklist?: string[];
}

interface Queued {
  event: AgentEvent;
  /** Set by the owner's "Answer now": beats everything, ignores staleness. */
  boost: number;
  direction?: Direction;
}

/** "Respond to Mike" before Mike has said anything: act the moment he does. */
interface Watch {
  name: string;
  direction: Direction;
  promote: boolean;
  skip: boolean;
  until: number;
}

/** A watch for someone who never shows up lapses after this. */
export const WATCH_MS = 10 * 60_000;

const normName = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");

export class Director {
  private queue: Queued[] = [];
  private seenIds = new Set<string>();
  private dedupe = new Dedupe();
  private rate: RateLimit;
  private usedFillers = new Set<string>();
  private lastSpokeAt = 0;
  private sayQueue: string[] = [];
  private muted = new Set<string>();
  private discarded: Discarded[] = [];
  private cues: Cue[] = [];
  private watches: Watch[] = [];
  private holdUntil = 0;
  private opts: Required<DirectorOptions>;

  constructor(opts: DirectorOptions) {
    this.opts = { maxPerMinute: MAX_PER_MINUTE, idleMs: IDLE_MS, blocklist: [], ...opts };
    this.rate = new RateLimit(this.opts.maxPerMinute);
  }

  /** Settings changed mid-stream: rate, idle, name and word list apply at once. */
  setOptions(patch: Partial<DirectorOptions>): void {
    this.opts = { ...this.opts, ...patch };
    this.rate.maxPerMinute = this.opts.maxPerMinute;
  }

  /** A stream is starting: the idle clock counts from now, not from 1970. */
  start(now: number): void {
    this.lastSpokeAt = now;
  }

  enqueue(ev: AgentEvent): Disposition {
    if (this.seenIds.has(ev.id)) return { status: "duplicate" };
    this.seenIds.add(ev.id);
    if (this.seenIds.size > MAX_SEEN) {
      const first = this.seenIds.values().next().value;
      if (first !== undefined) this.seenIds.delete(first);
    }

    if (this.muted.has(ev.handle)) return { status: "muted" };

    if (ev.text && (ev.kind === "comment" || ev.kind === "speech")) {
      const m = moderate(ev.text, this.opts.blocklist);
      if (!m.ok) return { status: "blocked", reason: m.reason ?? "spam" };
    }

    const w = this.claimWatch(ev);
    if (w?.skip) return { status: "muted" };
    this.queue.push({ event: ev, boost: w?.promote ? PRIORITY.operator : 0, ...(w ? { direction: w.direction } : {}) });
    return w ? { status: "queued", watched: { ...w.direction, promoted: w.promote } } : { status: "queued" };
  }

  /** The next thing to say, or null for "stay quiet". */
  next(now: number): Turn | null {
    // The owner typed it, so it goes first and ignores the cap.
    const said = this.sayQueue.shift();
    if (said) return { kind: "say", text: said };

    // "Wait five seconds before answering" holds everything below a typed line.
    if (now < this.holdUntil) return null;

    // Lines the director asked for come before comments, and ignore the cap too.
    const cue = this.cues.shift();
    if (cue) return { kind: "cue", cue };

    // At the cap, only the owner's "Answer now" gets through — like a typed line.
    const capped = !this.rate.allowed(now);

    this.queue = this.queue.filter((q) => {
      const keep = q.boost > 0 || now - q.event.ts < STALE_MS;
      if (!keep) this.discarded.push({ id: q.event.id, reason: "stale" });
      return keep;
    });

    for (const r of this.ranked(now)) {
      // Promoted comments rank first, so the first unpromoted one ends the cap's exception.
      if (capped && r.boost === 0) break;
      this.queue = this.queue.filter((q) => q.event !== r.event);
      // A repeat is dropped — unless the owner explicitly asked for it.
      if (r.boost === 0 && this.dedupe.isRepeat(r.event.text, now)) {
        this.discarded.push({ id: r.event.id, reason: "repeat" });
        continue;
      }
      this.dedupe.remember(r.event.text, now);
      return { kind: "answer", event: r.event, priority: r.priority, ...(r.direction ? { direction: r.direction } : {}) };
    }

    if (capped || now - this.lastSpokeAt < this.opts.idleMs) return null;
    const filler = this.opts.fillers.find((f) => !this.usedFillers.has(f));
    if (!filler) return null;
    this.usedFillers.add(filler);
    return { kind: "filler", text: filler };
  }

  /** Call once the turn returned by `next` has actually been spoken. */
  markSpoken(now: number): void {
    this.rate.record(now);
    this.lastSpokeAt = now;
  }

  /** Whether an arriving event is worth cutting the current sentence short. */
  shouldInterrupt(ev: AgentEvent, speakingPriority: number): boolean {
    return priorityOf(ev, this.opts.characterName) > speakingPriority;
  }

  /** Owner: answer this one next — even if it is old or a repeat — optionally saying how. */
  promote(id: string, direction?: Direction): boolean {
    const q = this.queue.find((x) => x.event.id === id);
    if (!q) return false;
    q.boost = PRIORITY.operator;
    if (direction) q.direction = { ...q.direction, ...direction };
    return true;
  }

  /** Owner: when this one comes up, answer it this way — without moving it up. */
  direct(id: string, direction: Direction): boolean {
    const q = this.queue.find((x) => x.event.id === id);
    if (!q) return false;
    q.direction = { ...q.direction, ...direction };
    return true;
  }

  /** Is this comment still waiting? */
  has(id: string): boolean {
    return this.queue.some((q) => q.event.id === id);
  }

  /** Owner: never answer anything this viewer has waiting. Returns the ids dropped. */
  dropViewer(handle: string): string[] {
    const ids = this.queue.filter((q) => q.event.handle === handle).map((q) => q.event.id);
    this.queue = this.queue.filter((q) => q.event.handle !== handle);
    return ids;
  }

  /** Owner: do this, in character, before the next comment ("ask everyone where they're from"). */
  cue(cue: Cue): void {
    const intent = cue.intent.trim().slice(0, 240);
    if (intent) this.cues.push({ ...cue, intent });
  }

  /** Owner: hold the next answer for a few seconds. Never cuts off the current line. */
  hold(ms: number, now: number): void {
    this.holdUntil = Math.max(this.holdUntil, now + Math.min(60_000, Math.max(0, ms)));
  }

  /** Owner: about someone who hasn't commented yet — apply it the moment they do. */
  watch(name: string, now: number, opts: { direction?: Direction; promote?: boolean; skip?: boolean }): void {
    const n = normName(name);
    if (!n) return;
    this.watches = this.watches.filter((w) => w.name !== n);
    this.watches.push({ name: n, direction: opts.direction ?? {}, promote: !!opts.promote, skip: !!opts.skip, until: now + WATCH_MS });
  }

  private claimWatch(ev: AgentEvent): Watch | null {
    if (!this.watches.length) return null;
    this.watches = this.watches.filter((w) => w.until > ev.ts);
    const h = normName(ev.handle);
    const u = normName(ev.user);
    const words = ev.user.toLowerCase().split(/\s+/).map(normName);
    const i = this.watches.findIndex((w) => h === w.name || u === w.name || words.includes(w.name) || h.startsWith(w.name) || u.startsWith(w.name));
    if (i < 0) return null;
    const [w] = this.watches.splice(i, 1);
    // "Ignore Mike" before Mike arrives is a mute.
    if (w.skip) this.muted.add(ev.handle);
    return w;
  }

  /** Every watch still waiting for its viewer. */
  get watching(): string[] {
    return this.watches.map((w) => w.name);
  }

  /** Owner: never answer this one. */
  drop(id: string): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.event.id !== id);
    return this.queue.length < before;
  }

  /** Owner: make the character say exactly this, next. */
  say(text: string): void {
    const t = text.trim().slice(0, 280);
    if (t) this.sayQueue.push(t);
  }

  /** Owner: ignore this viewer for the rest of the stream. */
  muteViewer(handle: string): void {
    this.muted.add(handle);
    this.queue = this.queue.filter((q) => q.event.handle !== handle);
  }

  /**
   * The queue in answer order. `priority` is what the event IS (used for
   * interrupts); `rank` adds how long it has waited (used only for order).
   */
  private ranked(now: number) {
    return this.queue
      .map((q, i) => {
        const priority = q.boost || priorityOf(q.event, this.opts.characterName);
        const waited = Math.max(0, now - q.event.ts) / 1000;
        const rank = q.boost ? q.boost : priority + Math.min(AGE_CAP, waited * AGE_PER_SECOND);
        return { ...q, i, priority, rank };
      })
      .sort((a, b) => b.rank - a.rank || a.event.ts - b.event.ts || a.i - b.i);
  }

  /** What is waiting, in the order it would be answered at `now`. */
  pending(now: number): AgentEvent[] {
    return this.ranked(now).map((r) => r.event);
  }

  /**
   * The comment `next()` would most likely answer, without taking it — so
   * the reply can be fetched while the current line is still being spoken.
   * Changes nothing: no dequeue, no dedupe memory, no stale bookkeeping.
   * Returns null when a typed line is waiting (it needs no brain).
   */
  peek(now: number): AgentEvent | null {
    if (this.sayQueue.length || this.cues.length) return null;
    for (const r of this.ranked(now)) {
      if (r.boost === 0 && now - r.event.ts >= STALE_MS) continue;
      if (r.boost === 0 && this.dedupe.isRepeat(r.event.text, now)) continue;
      return r.event;
    }
    return null;
  }

  /** Like peek, with the director's note for it — so the reply written ahead follows it. */
  peekTurn(now: number): { event: AgentEvent; direction?: Direction } | null {
    const ev = this.peek(now);
    if (!ev) return null;
    const q = this.queue.find((x) => x.event === ev);
    return q?.direction ? { event: ev, direction: q.direction } : { event: ev };
  }

  /** Why each waiting comment is where it is: the owner moved it up, and the note for it. */
  queued(id: string): { boost: number; direction?: Direction } | null {
    const q = this.queue.find((x) => x.event.id === id);
    return q ? { boost: q.boost, ...(q.direction ? { direction: q.direction } : {}) } : null;
  }

  get size(): number {

    return this.queue.length + this.sayQueue.length + this.cues.length;
  }

  /** Comments passed over since the last call, and why. Empties the list. */
  drainDiscarded(): Discarded[] {
    const out = this.discarded;
    this.discarded = [];
    return out;
  }
}
