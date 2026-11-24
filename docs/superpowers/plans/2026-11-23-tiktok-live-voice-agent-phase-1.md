# TikTok Live voice agent — phase 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TikTok LIVE stream where a photoreal character reads the comments, answers out loud in Phonon's voice, and moves its mouth to its own speech.

**Architecture:** A thin Python process holds the only Python-only dependency (TikTokLive) and writes one JSON line per event to stdout. A Node relay forwards those lines over a websocket. **Every piece of logic lives in TypeScript under `src/lib/tiktok-agent/` and runs in the browser**, inside a Next route that is also the OBS browser source — so the pure modules are tested with vitest like the rest of this repo, consumed by the page with no bundling step, and sit in the same process as the `AnalyserNode` and canvas they drive. Audio comes from the existing `POST /api/tts`; the mouth comes from the existing `visemes.ts`.

**Tech Stack:** TypeScript, Next.js App Router, vitest, Python 3.10+ with `uv` (the `tools/phonon-tts` pattern), TikTokLive, Phonon TTS via `/api/tts`, WanGP via `tools/wangp-image`, OBS.

**Spec:** `docs/superpowers/specs/tiktok-live-voice-agent.md`

---

## Why the logic is in the browser, not the relay

`tools/film3d-render` esbuild-bundles `capture.ts` because it needs repo TypeScript inside plain Node. Phase 1 avoids that entirely: the stage page must exist anyway (it is the OBS source, and it owns the `AnalyserNode` and canvas), so putting the director there means `src/lib/tiktok-agent/*` is imported natively by Next and needs no build step. The relay stays dumb plumbing with nothing worth testing.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/tiktok-agent/events.ts` | `AgentEvent` type; parse one raw JSON line into it, or reject it |
| `src/lib/tiktok-agent/priority.ts` | One number per event — gifts beat followers beat mentions beat questions beat chatter |
| `src/lib/tiktok-agent/limits.ts` | Question normalizing, the 5-minute dedupe window, the 8-per-minute cap |
| `src/lib/tiktok-agent/director.ts` | The queue. Picks the next turn, emits idle filler, decides interrupts |
| `src/lib/tiktok-agent/plates.ts` | `{open, wide, round}` → which of 9 mouth plates to draw |
| `tools/tiktok-live-agent/ingest.py` | TikTokLive → one JSON line per event on stdout. No logic |
| `tools/tiktok-live-agent/start.mjs` | Makes the venv, spawns the Python, relays stdout to a websocket |
| `src/app/api/tiktok-agent/reply/route.ts` | The brain. Comment in, reply line out, via `src/lib/ai/provider.ts` |
| `src/app/stage/tiktok-agent/page.tsx` | The OBS surface: websocket → director → `/api/tts` → analyser → visemes → canvas |
| `tools/tiktok-live-agent/plates.mjs` | Renders the character and 9 mouth plates through `tools/wangp-image` |
| `src/lib/tiktok-agent/fixtures/stream.jsonl` | A recorded comment stream, for testing with nothing live |

Everything in `src/lib/tiktok-agent/` is pure: no timers, no `Date.now()` inside, no fetch. Time is always a parameter. That is what makes the director testable.

---

# Part A — the engine (pure TypeScript, vitest)

## Task 1: Event normalization

**Files:**
- Create: `src/lib/tiktok-agent/events.ts`
- Test: `src/lib/tiktok-agent/events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tiktok-agent/events.test.ts
import { describe, expect, it } from "vitest";
import { parseEvent } from "./events";

describe("parseEvent", () => {
  it("reads a comment", () => {
    expect(
      parseEvent({ type: "comment", handle: "ana", user: "Ana", text: "hi there" }, 1000),
    ).toEqual({ kind: "comment", handle: "ana", user: "Ana", text: "hi there", ts: 1000 });
  });

  it("keeps the event's own timestamp when it has one", () => {
    const ev = parseEvent({ type: "comment", handle: "a", user: "A", text: "x", ts: 42 }, 1000);
    expect(ev?.ts).toBe(42);
  });

  it("falls back to the handle when there is no display name", () => {
    expect(parseEvent({ type: "comment", handle: "ana", text: "hi" }, 0)?.user).toBe("ana");
  });

  it("rejects an unknown kind", () => {
    expect(parseEvent({ type: "battle", handle: "a", text: "x" }, 0)).toBeNull();
  });

  it("rejects a comment with no text", () => {
    expect(parseEvent({ type: "comment", handle: "a", text: "   " }, 0)).toBeNull();
  });

  it("rejects anything that is not an object", () => {
    expect(parseEvent("nope", 0)).toBeNull();
    expect(parseEvent(null, 0)).toBeNull();
  });

  it("allows a gift with no text", () => {
    expect(parseEvent({ type: "gift", handle: "a", user: "A" }, 5)).toEqual({
      kind: "gift", handle: "a", user: "A", text: "", ts: 5,
    });
  });

  it("trims and caps very long text", () => {
    const ev = parseEvent({ type: "comment", handle: "a", text: "  " + "x".repeat(400) }, 0);
    expect(ev?.text.length).toBe(280);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tiktok-agent/events.test.ts`
Expected: FAIL — `Failed to resolve import "./events"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/tiktok-agent/events.ts
// One shape for everything that arrives, so nothing downstream knows or cares
// whether a line came from a comment, a gift or (later) a microphone.

export type EventKind = "comment" | "gift" | "follow" | "share" | "speech";

export interface AgentEvent {
  kind: EventKind;
  /** TikTok unique_id — stable, used as the memory key. */
  handle: string;
  /** Display name (nickname), what the character says out loud. */
  user: string;
  /** Comment body or transcript. Empty for gifts and follows. */
  text: string;
  ts: number;
}

const KINDS: EventKind[] = ["comment", "gift", "follow", "share", "speech"];
/** Comments longer than this are padding, not questions. */
export const MAX_TEXT = 280;
/** Kinds that mean nothing without words. */
const NEEDS_TEXT: EventKind[] = ["comment", "speech"];

export function parseEvent(raw: unknown, now: number): AgentEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const kind = KINDS.find((k) => k === r.type);
  if (!kind) return null;

  const handle = typeof r.handle === "string" ? r.handle.trim() : "";
  if (!handle) return null;

  const text = (typeof r.text === "string" ? r.text : "").trim().slice(0, MAX_TEXT);
  if (!text && NEEDS_TEXT.includes(kind)) return null;

  const user = (typeof r.user === "string" ? r.user.trim() : "") || handle;
  const ts = typeof r.ts === "number" && Number.isFinite(r.ts) ? r.ts : now;

  return { kind, handle, user, text, ts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tiktok-agent/events.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/tiktok-agent/events.ts src/lib/tiktok-agent/events.test.ts
git commit -m "TikTok Live agent: one event shape for every input source"
```

---

## Task 2: Priority

**Files:**
- Create: `src/lib/tiktok-agent/priority.ts`
- Test: `src/lib/tiktok-agent/priority.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tiktok-agent/priority.test.ts
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./events";
import { PRIORITY, priorityOf } from "./priority";

const ev = (over: Partial<AgentEvent>): AgentEvent => ({
  kind: "comment", handle: "a", user: "A", text: "hello", ts: 0, ...over,
});

describe("priorityOf", () => {
  it("ranks a gift above a follow above chatter", () => {
    expect(priorityOf(ev({ kind: "gift" }), "Lumi")).toBe(PRIORITY.gift);
    expect(priorityOf(ev({ kind: "follow" }), "Lumi")).toBe(PRIORITY.follow);
    expect(priorityOf(ev({ text: "nice stream" }), "Lumi")).toBe(PRIORITY.chatter);
    expect(PRIORITY.gift).toBeGreaterThan(PRIORITY.follow);
    expect(PRIORITY.follow).toBeGreaterThan(PRIORITY.chatter);
  });

  it("treats a named mention as a mention, case-insensitively", () => {
    expect(priorityOf(ev({ text: "lumi where are you from" }), "Lumi")).toBe(PRIORITY.mention);
    expect(priorityOf(ev({ text: "@Lumi hey" }), "Lumi")).toBe(PRIORITY.mention);
  });

  it("does not match the name inside a longer word", () => {
    expect(priorityOf(ev({ text: "illuminated" }), "Lumi")).toBe(PRIORITY.chatter);
  });

  it("treats a question mark as a question", () => {
    expect(priorityOf(ev({ text: "where are you from?" }), "Lumi")).toBe(PRIORITY.question);
  });

  it("prefers mention over question when a comment is both", () => {
    expect(priorityOf(ev({ text: "Lumi how old are you?" }), "Lumi")).toBe(PRIORITY.mention);
  });

  it("ranks a share above chatter and below a follow", () => {
    const p = priorityOf(ev({ kind: "share" }), "Lumi");
    expect(p).toBeGreaterThan(PRIORITY.chatter);
    expect(p).toBeLessThan(PRIORITY.follow);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tiktok-agent/priority.test.ts`
Expected: FAIL — `Failed to resolve import "./priority"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/tiktok-agent/priority.ts
// What gets answered first. Gifts and follows are the moments a viewer paid
// for in money or attention; answering those late is what loses them.

import type { AgentEvent } from "./events";

export const PRIORITY = {
  gift: 100,
  follow: 80,
  mention: 60,
  share: 50,
  question: 40,
  chatter: 20,
} as const;

/** Whole-word, case-insensitive, with or without a leading @. */
export function mentionsName(text: string, name: string): boolean {
  if (!name) return false;
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])@?${safe}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

export function priorityOf(ev: AgentEvent, characterName: string): number {
  if (ev.kind === "gift") return PRIORITY.gift;
  if (ev.kind === "follow") return PRIORITY.follow;
  if (ev.kind === "share") return PRIORITY.share;
  if (mentionsName(ev.text, characterName)) return PRIORITY.mention;
  if (ev.text.includes("?")) return PRIORITY.question;
  return PRIORITY.chatter;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tiktok-agent/priority.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/tiktok-agent/priority.ts src/lib/tiktok-agent/priority.test.ts
git commit -m "TikTok Live agent: rank events so gifts and follows are answered first"
```

---

## Task 3: Dedupe and rate limit

**Files:**
- Create: `src/lib/tiktok-agent/limits.ts`
- Test: `src/lib/tiktok-agent/limits.test.ts`

Live chat asks the same five questions forever, and without a cap the character talks over itself. Both are pure functions of time, so both are fully testable.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tiktok-agent/limits.test.ts
import { describe, expect, it } from "vitest";
import { DEDUPE_WINDOW_MS, Dedupe, MAX_PER_MINUTE, RateLimit, questionKey } from "./limits";

describe("questionKey", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(questionKey("Where are you FROM??")).toBe(questionKey("where are you from"));
    expect(questionKey("how  old   are you")).toBe(questionKey("How old are you?"));
  });

  it("keeps different questions apart", () => {
    expect(questionKey("where are you from")).not.toBe(questionKey("how old are you"));
  });

  it("returns empty for text with no words", () => {
    expect(questionKey("???")).toBe("");
  });
});

describe("Dedupe", () => {
  it("lets the first one through and blocks a repeat inside the window", () => {
    const d = new Dedupe();
    expect(d.isRepeat("where are you from", 0)).toBe(false);
    d.remember("where are you from", 0);
    expect(d.isRepeat("Where are you from?", 1000)).toBe(true);
  });

  it("lets it through again once the window has passed", () => {
    const d = new Dedupe();
    d.remember("hi", 0);
    expect(d.isRepeat("hi", DEDUPE_WINDOW_MS + 1)).toBe(false);
  });

  it("never blocks text with no words", () => {
    const d = new Dedupe();
    d.remember("???", 0);
    expect(d.isRepeat("!!!", 0)).toBe(false);
  });
});

describe("RateLimit", () => {
  it("allows up to the cap inside one minute", () => {
    const r = new RateLimit();
    for (let i = 0; i < MAX_PER_MINUTE; i += 1) {
      expect(r.allowed(i)).toBe(true);
      r.record(i);
    }
    expect(r.allowed(MAX_PER_MINUTE)).toBe(false);
  });

  it("frees up as the window slides", () => {
    const r = new RateLimit();
    for (let i = 0; i < MAX_PER_MINUTE; i += 1) r.record(i);
    // At 59_999 all eight are still inside the minute.
    expect(r.allowed(59_999)).toBe(false);
    // At 60_000 the one recorded at t=0 has aged out, freeing a slot.
    expect(r.allowed(60_000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tiktok-agent/limits.test.ts`
Expected: FAIL — `Failed to resolve import "./limits"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/tiktok-agent/limits.ts
// Two guards, both pure functions of time: do not answer the same question
// twice, and do not speak more than MAX_PER_MINUTE times a minute.

/** Five minutes: long enough that chat has moved on. */
export const DEDUPE_WINDOW_MS = 5 * 60_000;
/** Above this the character sounds frantic and talks over itself. */
export const MAX_PER_MINUTE = 8;

/**
 * "Near-identical" is defined as: same words, in the same order, ignoring
 * case, punctuation and runs of whitespace. Deliberately strict — a looser
 * rule silently swallows genuinely different questions.
 */
export function questionKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export class Dedupe {
  private seen = new Map<string, number>();

  isRepeat(text: string, now: number): boolean {
    const key = questionKey(text);
    if (!key) return false;
    const at = this.seen.get(key);
    return at !== undefined && now - at < DEDUPE_WINDOW_MS;
  }

  remember(text: string, now: number): void {
    const key = questionKey(text);
    if (!key) return;
    this.seen.set(key, now);
    for (const [k, at] of this.seen) {
      if (now - at >= DEDUPE_WINDOW_MS) this.seen.delete(k);
    }
  }
}

export class RateLimit {
  private spoke: number[] = [];

  allowed(now: number): boolean {
    this.trim(now);
    return this.spoke.length < MAX_PER_MINUTE;
  }

  record(now: number): void {
    this.trim(now);
    this.spoke.push(now);
  }

  private trim(now: number): void {
    this.spoke = this.spoke.filter((t) => now - t < 60_000);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tiktok-agent/limits.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/tiktok-agent/limits.ts src/lib/tiktok-agent/limits.test.ts
git commit -m "TikTok Live agent: never answer a question twice, never talk over itself"
```

---

## Task 4: The director

**Files:**
- Create: `src/lib/tiktok-agent/director.ts`
- Test: `src/lib/tiktok-agent/director.test.ts`

This is the module that decides whether the stream reads as a person or a text-to-speech reader. It holds the queue and owns every decision about *what to say next and whether to cut itself off*. It takes `now` as a parameter and starts no timers, so every behaviour below is tested without waiting.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tiktok-agent/director.test.ts
import { describe, expect, it } from "vitest";
import { Director, IDLE_MS } from "./director";
import type { AgentEvent } from "./events";
import { PRIORITY } from "./priority";

const ev = (over: Partial<AgentEvent>): AgentEvent => ({
  kind: "comment", handle: "a", user: "A", text: "hello", ts: 0, ...over,
});

const make = () => new Director({ characterName: "Lumi", fillers: ["f1", "f2"] });

describe("Director", () => {
  it("returns nothing when the queue is empty and it is not yet idle", () => {
    expect(make().next(0)).toBeNull();
  });

  it("answers the highest-priority event first, not the oldest", () => {
    const d = make();
    d.enqueue(ev({ text: "nice stream", handle: "x" }));
    d.enqueue(ev({ kind: "gift", handle: "g", text: "" }));
    const turn = d.next(0);
    expect(turn).toMatchObject({ kind: "answer" });
    if (turn?.kind === "answer") expect(turn.event.handle).toBe("g");
  });

  it("breaks a priority tie by taking the older event", () => {
    const d = make();
    d.enqueue(ev({ handle: "first", ts: 1 }));
    d.enqueue(ev({ handle: "second", ts: 2 }));
    const turn = d.next(0);
    if (turn?.kind === "answer") expect(turn.event.handle).toBe("first");
  });

  it("drops a repeated question instead of answering it twice", () => {
    const d = make();
    d.enqueue(ev({ text: "where are you from?", handle: "one" }));
    const first = d.next(0);
    expect(first?.kind).toBe("answer");
    d.markSpoken(0);
    d.enqueue(ev({ text: "Where are you FROM?", handle: "two" }));
    expect(d.next(1000)).toBeNull();
  });

  it("stays silent once the per-minute cap is hit", () => {
    const d = make();
    for (let i = 0; i < 8; i += 1) {
      d.enqueue(ev({ text: `comment ${i}`, handle: `h${i}` }));
      expect(d.next(i)).not.toBeNull();
      d.markSpoken(i);
    }
    d.enqueue(ev({ text: "one more", handle: "last" }));
    expect(d.next(9)).toBeNull();
  });

  it("speaks unprompted after IDLE_MS of nothing", () => {
    const d = make();
    const turn = d.next(IDLE_MS + 1);
    expect(turn).toEqual({ kind: "filler", text: "f1" });
  });

  it("does not repeat a filler it has already used", () => {
    const d = make();
    d.next(IDLE_MS + 1);
    d.markSpoken(IDLE_MS + 1);
    const second = d.next(2 * IDLE_MS + 2);
    expect(second).toEqual({ kind: "filler", text: "f2" });
  });

  it("stops filling once every filler has been used", () => {
    const d = make();
    for (const at of [IDLE_MS + 1, 2 * IDLE_MS + 2]) {
      d.next(at);
      d.markSpoken(at);
    }
    expect(d.next(9 * IDLE_MS)).toBeNull();
  });

  it("prefers a real event over filler even when idle", () => {
    const d = make();
    d.enqueue(ev({ text: "hi", handle: "x" }));
    expect(d.next(IDLE_MS + 1)?.kind).toBe("answer");
  });

  it("interrupts for a gift but not for chatter", () => {
    const d = make();
    expect(d.shouldInterrupt(ev({ kind: "gift", text: "" }), PRIORITY.chatter)).toBe(true);
    expect(d.shouldInterrupt(ev({ text: "nice" }), PRIORITY.chatter)).toBe(false);
  });

  it("does not interrupt for something of equal priority", () => {
    const d = make();
    expect(d.shouldInterrupt(ev({ kind: "gift", text: "" }), PRIORITY.gift)).toBe(false);
  });

  it("forgets queued events that have gone stale", () => {
    // No fillers, or the idle rule would answer with filler and mask the point.
    const d = new Director({ characterName: "Lumi", fillers: [] });
    d.enqueue(ev({ text: "old news", handle: "x", ts: 0 }));
    expect(d.next(5 * 60_000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tiktok-agent/director.test.ts`
Expected: FAIL — `Failed to resolve import "./director"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/tiktok-agent/director.ts
// The queue, and every decision about what to say next.
//
// Pure: `now` is always a parameter and nothing here starts a timer, so the
// idle, dedupe, cap and interrupt rules are all testable without waiting.

import { Dedupe, RateLimit } from "./limits";
import type { AgentEvent } from "./events";
import { priorityOf } from "./priority";

/** Silence longer than this and the stream feels dead. */
export const IDLE_MS = 20_000;
/** A comment older than this has scrolled away; answering it is confusing. */
export const STALE_MS = 2 * 60_000;

export type Turn =
  | { kind: "answer"; event: AgentEvent; priority: number }
  | { kind: "filler"; text: string };

export interface DirectorOptions {
  characterName: string;
  /** Said when nothing is happening. Each is used at most once a session. */
  fillers: string[];
}

export class Director {
  private queue: AgentEvent[] = [];
  private dedupe = new Dedupe();
  private rate = new RateLimit();
  private usedFillers = new Set<string>();
  private lastSpokeAt = 0;

  constructor(private opts: DirectorOptions) {}

  enqueue(ev: AgentEvent): void {
    this.queue.push(ev);
  }

  /** The next thing to say, or null for "stay quiet". */
  next(now: number): Turn | null {
    if (!this.rate.allowed(now)) return null;

    this.queue = this.queue.filter((e) => now - e.ts < STALE_MS);

    const ranked = this.queue
      .map((event, i) => ({ event, i, priority: priorityOf(event, this.opts.characterName) }))
      .sort((a, b) => b.priority - a.priority || a.event.ts - b.event.ts || a.i - b.i);

    for (const { event, priority } of ranked) {
      this.queue = this.queue.filter((e) => e !== event);
      if (this.dedupe.isRepeat(event.text, now)) continue;
      this.dedupe.remember(event.text, now);
      return { kind: "answer", event, priority };
    }

    if (now - this.lastSpokeAt < IDLE_MS) return null;
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
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tiktok-agent/director.test.ts`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/tiktok-agent/director.ts src/lib/tiktok-agent/director.test.ts
git commit -m "TikTok Live agent: the director that decides what to say next"
```

---

## Task 5: Plate selection

**Files:**
- Create: `src/lib/tiktok-agent/plates.ts`
- Test: `src/lib/tiktok-agent/plates.test.ts`

`visemeFromSpectrum` gives three continuous axes. Nine rendered photographs have to cover that space. Snap to the nearest, never cross-fade — blending photographs ghosts, and `approach()` already smooths the input.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tiktok-agent/plates.test.ts
import { describe, expect, it } from "vitest";
import { REST } from "@/lib/new-jarvis/avatar/visemes";
import { PLATE_IDS, plateFor } from "./plates";

describe("plateFor", () => {
  it("draws a closed mouth at rest", () => {
    expect(plateFor(REST)).toBe("rest");
  });

  it("opens wide for a loud open jaw", () => {
    expect(plateFor({ open: 0.9, wide: 0.1, round: 0 })).toBe("open");
  });

  it("spreads the lips when wide dominates", () => {
    expect(plateFor({ open: 0.8, wide: 0.9, round: 0 })).toBe("open-wide");
  });

  it("rounds the lips when round dominates", () => {
    expect(plateFor({ open: 0.8, wide: 0, round: 0.9 })).toBe("open-round");
  });

  it("uses the half-open set for a mid jaw", () => {
    expect(plateFor({ open: 0.4, wide: 0, round: 0 })).toBe("half");
    expect(plateFor({ open: 0.4, wide: 0.9, round: 0 })).toBe("half-wide");
    expect(plateFor({ open: 0.4, wide: 0, round: 0.9 })).toBe("half-round");
  });

  it("shows a closed-but-shaped mouth when the jaw is shut but lips are not", () => {
    expect(plateFor({ open: 0.05, wide: 0.9, round: 0 })).toBe("closed-wide");
    expect(plateFor({ open: 0.05, wide: 0, round: 0.9 })).toBe("closed-round");
  });

  it("only ever returns a known plate", () => {
    for (let o = 0; o <= 1; o += 0.1)
      for (let w = 0; w <= 1; w += 0.25)
        for (let r = 0; r <= 1; r += 0.25)
          expect(PLATE_IDS).toContain(plateFor({ open: o, wide: w, round: r }));
  });

  it("names exactly nine plates", () => {
    expect(PLATE_IDS).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tiktok-agent/plates.test.ts`
Expected: FAIL — `Failed to resolve import "./plates"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/tiktok-agent/plates.ts
// Nine photographs cover the {open, wide, round} space. Snap to the nearest;
// never cross-fade two photographs, which ghosts. The smoothing already
// happened in `approach()` on the way in.

import type { Viseme } from "@/lib/new-jarvis/avatar/visemes";

export const PLATE_IDS = [
  "rest",
  "closed-wide",
  "closed-round",
  "half",
  "half-wide",
  "half-round",
  "open",
  "open-wide",
  "open-round",
] as const;

export type PlateId = (typeof PLATE_IDS)[number];

/** Below this the jaw reads as shut. */
const JAW_SHUT = 0.12;
/** At or above this the jaw reads as fully open. */
const JAW_OPEN = 0.6;
/** Below this the lips read as neutral rather than spread or rounded. */
const LIP_FLAT = 0.35;

export function plateFor(v: Viseme): PlateId {
  const shape = v.wide >= LIP_FLAT && v.wide >= v.round
    ? "wide"
    : v.round >= LIP_FLAT
      ? "round"
      : "flat";

  if (v.open < JAW_SHUT) {
    if (shape === "wide") return "closed-wide";
    if (shape === "round") return "closed-round";
    return "rest";
  }

  const jaw = v.open >= JAW_OPEN ? "open" : "half";
  if (shape === "flat") return jaw;
  return `${jaw}-${shape}` as PlateId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tiktok-agent/plates.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Run the whole module's tests together and commit**

Run: `npx vitest run src/lib/tiktok-agent/`
Expected: PASS, 43 tests across 5 files

```bash
git add src/lib/tiktok-agent/plates.ts src/lib/tiktok-agent/plates.test.ts
git commit -m "TikTok Live agent: pick one of nine mouth plates from a viseme"
```

---

## Task 6: Sentence splitting

**Files:**
- Create: `src/lib/tiktok-agent/speech.ts`
- Test: `src/lib/tiktok-agent/speech.test.ts`

The spec's latency budget allows **~900 ms for one sentence** of Phonon synthesis. Phonon returns complete audio bytes, not a stream, so synthesizing a whole two-sentence reply in one call doubles that and blows the budget. Split the reply and speak the first sentence while the rest is still being made.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tiktok-agent/speech.test.ts
import { describe, expect, it } from "vitest";
import { splitSentences } from "./speech";

describe("splitSentences", () => {
  it("splits on sentence endings and keeps the punctuation", () => {
    expect(splitSentences("I'm from Leeds. Where are you?")).toEqual([
      "I'm from Leeds.",
      "Where are you?",
    ]);
  });

  it("returns one piece when there is one sentence", () => {
    expect(splitSentences("just the one")).toEqual(["just the one"]);
  });

  it("returns nothing for empty or blank text", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });

  it("does not split on a decimal point", () => {
    expect(splitSentences("It cost 3.50 in total")).toEqual(["It cost 3.50 in total"]);
  });

  it("keeps a run of terminators with its sentence", () => {
    expect(splitSentences("Really?! That's wild.")).toEqual(["Really?!", "That's wild."]);
  });

  it("merges a fragment shorter than the floor into the one before it", () => {
    expect(splitSentences("Hello there. Hi.")).toEqual(["Hello there. Hi."]);
  });

  it("never returns a blank piece", () => {
    for (const piece of splitSentences("One. Two. Three!  ")) {
      expect(piece.trim()).not.toBe("");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tiktok-agent/speech.test.ts`
Expected: FAIL — `Failed to resolve import "./speech"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/tiktok-agent/speech.ts
// Phonon returns whole audio files, so a two-sentence reply costs twice the
// latency budget in one call. Split it and speak the first piece while the
// rest is still being synthesized.

/**
 * Pieces shorter than this are not worth their own round-trip, so they are
 * merged into the sentence before them.
 */
export const MIN_PIECE = 12;

export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Split after . ! ? (including runs like "?!") when followed by whitespace
  // and a non-digit — so "3.50" stays whole.
  const raw = trimmed
    .split(/(?<=[.!?]+)\s+(?=\D)/u)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const piece of raw) {
    if (out.length && piece.length < MIN_PIECE) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tiktok-agent/speech.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/tiktok-agent/speech.ts src/lib/tiktok-agent/speech.test.ts
git commit -m "TikTok Live agent: split a reply into sentences so the first lands fast"
```

---

# Part B — the wiring

## Task 7: The Python ingest shim

**Files:**
- Create: `tools/tiktok-live-agent/ingest.py`
- Create: `tools/tiktok-live-agent/requirements.txt`

No logic lives here on purpose — it exists only because TikTokLive is Python-only. Listeners are registered **before** `run()`, because the first signed response can already carry messages.

- [ ] **Step 1: Write the requirements file**

```
# tools/tiktok-live-agent/requirements.txt
TikTokLive>=6.4.0
```

- [ ] **Step 2: Write the shim**

```python
# tools/tiktok-live-agent/ingest.py
"""TikTok LIVE events -> one JSON line per event on stdout.

Deliberately dumb: every decision belongs to the director in
src/lib/tiktok-agent/, which is TypeScript and has tests. This file only
exists because TikTokLive is Python-only.

    python ingest.py @someone

A comment's text is event.content (event.comment is an alias); the handle is
event.user.unique_id and the display name is event.user.nickname. Nested
messages are Optional, so every one is checked for None.
"""

import json
import sys
import time

from TikTokLive import TikTokLiveClient
from TikTokLive.events import (
    CommentEvent,
    ConnectEvent,
    DisconnectEvent,
    FollowEvent,
    GiftEvent,
    ShareEvent,
)


def emit(kind: str, user=None, text: str = "") -> None:
    """One JSON object per line, flushed, so the relay can read it live."""
    handle = getattr(user, "unique_id", None) if user else None
    if kind != "status" and not handle:
        return
    line = {
        "type": kind,
        "handle": handle or "",
        "user": (getattr(user, "nickname", None) if user else None) or handle or "",
        "text": text or "",
        "ts": int(time.time() * 1000),
    }
    sys.stdout.write(json.dumps(line, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: ingest.py @handle", file=sys.stderr)
        return 2

    client = TikTokLiveClient(unique_id=sys.argv[1])

    async def on_connect(event: ConnectEvent) -> None:
        print(f"[ingest] connected to @{event.unique_id}", file=sys.stderr, flush=True)
        emit("status", text="connected")

    async def on_disconnect(event: DisconnectEvent) -> None:
        print("[ingest] disconnected", file=sys.stderr, flush=True)
        emit("status", text="disconnected")

    async def on_comment(event: CommentEvent) -> None:
        if event.user is None:
            return
        emit("comment", event.user, event.content)

    async def on_gift(event: GiftEvent) -> None:
        if event.user is None:
            return
        name = getattr(event.gift, "name", "") if event.gift else ""
        emit("gift", event.user, name)

    async def on_follow(event: FollowEvent) -> None:
        if event.user is None:
            return
        emit("follow", event.user)

    async def on_share(event: ShareEvent) -> None:
        if event.user is None:
            return
        emit("share", event.user)

    # Registered before run(): the first signed response can already carry
    # messages, emitted right after ConnectEvent.
    client.add_listener(ConnectEvent, on_connect)
    client.add_listener(DisconnectEvent, on_disconnect)
    client.add_listener(CommentEvent, on_comment)
    client.add_listener(GiftEvent, on_gift)
    client.add_listener(FollowEvent, on_follow)
    client.add_listener(ShareEvent, on_share)

    client.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Commit**

```bash
git add tools/tiktok-live-agent/ingest.py tools/tiktok-live-agent/requirements.txt
git commit -m "TikTok Live agent: Python shim that turns TikTokLive events into JSON lines"
```

---

## Task 8: The relay

**Files:**
- Create: `tools/tiktok-live-agent/start.mjs`
- Modify: `package.json` — add one script

Follows the `tools/phonon-tts/start.mjs` pattern exactly: `uv` makes the venv on first run, no activate step, no global Python packages.

- [ ] **Step 1: Write the relay**

```js
#!/usr/bin/env node
// tools/tiktok-live-agent/start.mjs
//
//   npm run tiktok:agent -- @someone
//
// Makes the venv on first run, spawns ingest.py, and relays its stdout lines
// to every connected websocket client. Holds no logic: the director lives in
// src/lib/tiktok-agent/ and runs in the stage page.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const venvPython = join(here, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
const PORT = Number(process.env.TIKTOK_AGENT_PORT || 8787);

const handle = process.argv[2];
if (!handle) {
  console.error("\nusage: npm run tiktok:agent -- @handle\n");
  process.exit(2);
}

function run(cmd, args) {
  const out = spawnSync(cmd, args, { cwd: here, stdio: "inherit", shell: isWindows });
  if (out.error?.code === "ENOENT") {
    console.error(`\n[tiktok-agent] "${cmd}" is not on PATH. Install uv from https://docs.astral.sh/uv/\n`);
    process.exit(1);
  }
  if (out.status !== 0) process.exit(out.status ?? 1);
}

if (!existsSync(venvPython)) {
  console.log("[tiktok-agent] first run: creating .venv");
  run("uv", ["venv"]);
  run("uv", ["pip", "install", "-r", "requirements.txt"]);
}

const clients = new Set();
const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});
console.log(`[tiktok-agent] websocket on ws://127.0.0.1:${PORT} — open /stage/tiktok-agent`);

// client.run() returns whenever TikTok ends the connection, which it does
// often, and TikTokLive is unofficial so it can break outright. The spec
// treats reconnect as a first-class feature: respawn with backoff and keep
// the websocket (and so the stream) alive.
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
let attempt = 0;
let child = null;
let shuttingDown = false;

function broadcast(line) {
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(line);
  }
}

function startIngest() {
  const py = spawn(venvPython, ["ingest.py", handle], { cwd: here });
  child = py;
  py.stderr.pipe(process.stderr);

  let buffer = "";
  py.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      attempt = 0; // a line arrived, so the connection is healthy again
      broadcast(trimmed);
    }
  });

  py.on("exit", (code) => {
    child = null;
    if (shuttingDown) return;
    broadcast(JSON.stringify({ type: "status", text: "disconnected" }));
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    console.error(`[tiktok-agent] ingest exited (${code}); retrying in ${wait / 1000}s`);
    setTimeout(startIngest, wait);
  });
}

startIngest();

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    shuttingDown = true;
    child?.kill();
    wss.close();
    process.exit(0);
  });
}
```

- [ ] **Step 2: Add the script**

In `package.json`, in `"scripts"`, next to `"tts:phonon"`:

```json
"tiktok:agent": "node tools/tiktok-live-agent/start.mjs",
```

- [ ] **Step 3: Confirm `ws` is already a dependency**

Run: `node -e "console.log(require('ws/package.json').version)"`
Expected: a version number. If it errors with `MODULE_NOT_FOUND`, run `npm install ws` and commit the lockfile change with this task.

- [ ] **Step 4: Verify the relay starts and serves a socket**

Run: `npm run tiktok:agent -- @tiktok`
Expected: `[tiktok-agent] websocket on ws://127.0.0.1:8787 …`, then either `[ingest] connected` or, if that account is not live, an ingest error followed by `retrying in 1s`, `retrying in 2s`, `retrying in 5s` — which is the backoff working. Either outcome proves the venv built and the socket is up. Ctrl+C to stop.

- [ ] **Step 5: Commit**

```bash
git add tools/tiktok-live-agent/start.mjs package.json package-lock.json
git commit -m "TikTok Live agent: relay the Python ingest to a local websocket"
```

---

## Task 9: The brain route

**Files:**
- Create: `src/app/api/tiktok-agent/reply/route.ts`

Uses `src/lib/ai/provider.ts`, which is the one place in this repo an AI call may be made. Never a silent stream: with no key configured it returns a canned line and says so, rather than 500ing.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/tiktok-agent/reply/route.ts
import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiConfigured, aiFetch } from "@/lib/ai/provider";

/** One or two spoken sentences. Longer and the queue backs up. */
const MAX_REPLY = 240;

const CANNED = [
  "I hear you — give me a second.",
  "Good one. Keep them coming.",
  "Ha, I like that.",
];

export interface ReplyRequest {
  /** The character's own name, used in the system prompt. */
  character: string;
  /** Free-text persona description. */
  persona: string;
  /** Who said it, and what. */
  user: string;
  text: string;
  /** What kind of event it was, so a gift is thanked rather than answered. */
  kind: string;
  /** What this viewer said earlier, oldest first. */
  memory?: string[];
}

export async function POST(req: Request) {
  let body: ReplyRequest;
  try {
    body = (await req.json()) as ReplyRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const canned = CANNED[Math.floor(Math.random() * CANNED.length)];
  if (!aiConfigured()) return NextResponse.json({ reply: canned, canned: true });

  const system = [
    `You are ${body.character}, live on TikTok. ${body.persona}`,
    "You are speaking out loud, so reply in one or two short spoken sentences.",
    "No emoji, no stage directions, no markdown, no lists — only words you would say.",
    "Use the viewer's name sometimes, not every time.",
    body.kind === "gift" ? "They just sent you a gift. Thank them warmly and briefly." : "",
    body.kind === "follow" ? "They just followed you. Welcome them by name." : "",
    body.memory?.length ? `Earlier, ${body.user} said: ${body.memory.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        temperature: 0.8,
        max_tokens: 120,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${body.user}: ${body.text || "(no words)"}` },
        ],
      }),
    });

    if (!res.ok) return NextResponse.json({ reply: canned, canned: true });

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const reply = (json.choices?.[0]?.message?.content ?? "").trim().slice(0, MAX_REPLY);
    return NextResponse.json(reply ? { reply } : { reply: canned, canned: true });
  } catch {
    return NextResponse.json({ reply: canned, canned: true });
  }
}
```

- [ ] **Step 2: Verify it answers even with no key**

Run the dev server, then:

```bash
curl -s -X POST http://localhost:3000/api/tiktok-agent/reply \
  -H "Content-Type: application/json" \
  --data '{"character":"Lumi","persona":"Warm and quick.","user":"Ana","text":"where are you from?","kind":"comment"}'
```

Expected: JSON with a non-empty `reply`. With no AI key it also carries `"canned": true`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tiktok-agent/reply/route.ts
git commit -m "TikTok Live agent: the brain route, with a canned line when no key is set"
```

---

## Task 10: Render the character and the nine plates

**Files:**
- Create: `tools/tiktok-live-agent/plates.mjs`
- Create: `tools/tiktok-live-agent/plates/.gitignore`

Nine plates at ~18 s warm is about three minutes of GPU time. Assets are regenerable output, so they are gitignored.

- [ ] **Step 1: Ignore the output**

```
# tools/tiktok-live-agent/plates/.gitignore
*
!.gitignore
```

- [ ] **Step 2: Write the renderer**

```js
#!/usr/bin/env node
// tools/tiktok-live-agent/plates.mjs
//
//   node tools/wangp-image/server.mjs          # in one terminal
//   node tools/tiktok-live-agent/plates.mjs    # in another
//
// Renders the idle face plus one image per mouth shape, all from the same
// prompt stem and the same seed, so only the mouth changes between them.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "plates");
const WANGP = process.env.WANGP_URL || "http://127.0.0.1:8188";

// Keep this identical across every plate except the mouth clause.
const STEM =
  "photorealistic head-and-shoulders portrait of a friendly woman in her late twenties, " +
  "soft studio key light, plain dark background, looking straight into the camera, " +
  "head perfectly still and centred, sharp focus on the face, 85mm lens";

const MOUTHS = {
  rest: "mouth closed and relaxed, lips together",
  "closed-wide": "mouth closed but lips spread in a slight smile, teeth not showing",
  "closed-round": "mouth closed with lips pushed forward and rounded",
  half: "mouth slightly open, jaw dropped a little, lips neutral",
  "half-wide": "mouth slightly open with lips spread wide, saying 'eh'",
  "half-round": "mouth slightly open with lips rounded, saying 'oh'",
  open: "mouth open wide, jaw dropped, saying 'ah'",
  "open-wide": "mouth open with lips spread wide, saying 'ee'",
  "open-round": "mouth open with lips tightly rounded, saying 'oo'",
};

const SEED = 20261123;

async function draw(name, prompt) {
  const res = await fetch(`${WANGP}/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, seed: SEED, width: 768, height: 768 }),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(join(OUT, `${name}.png`), buf);
  console.log(`[plates] ${name}.png (${(buf.length / 1024).toFixed(0)} KB)`);
}

await mkdir(OUT, { recursive: true });
for (const [name, mouth] of Object.entries(MOUTHS)) {
  await draw(name, `${STEM}, ${mouth}`);
}
console.log(`[plates] done — ${Object.keys(MOUTHS).length} plates in ${OUT}`);
```

- [ ] **Step 3: Check the WanGP server's actual request shape before running**

Run: `grep -n -E "\"/image\"|req.url|prompt|seed|width" tools/wangp-image/server.mjs | head -20`

If the endpoint path or field names differ from `POST /image` with `{prompt, seed, width, height}`, correct `draw()` to match that server — it is the authority, not this plan.

- [ ] **Step 4: Render the plates**

Run, in two terminals:

```powershell
node tools/wangp-image/server.mjs
```

```powershell
node tools/tiktok-live-agent/plates.mjs
```

Expected: nine `.png` files in `tools/tiktok-live-agent/plates/`. The first takes ~128 s (cold), the rest ~18 s each.

- [ ] **Step 5: Look at them before going further**

Open all nine. Every one must be the same person, same framing, same lighting, with **only** the mouth differing. If the head moves between plates, lower the temperature or fix the seed harder and re-render — a drifting head makes the composite unusable, and this is cheaper to fix now than after the stage page is built.

- [ ] **Step 6: Commit**

```bash
git add tools/tiktok-live-agent/plates.mjs tools/tiktok-live-agent/plates/.gitignore
git commit -m "TikTok Live agent: render the character and nine mouth plates in WanGP"
```

---

## Task 11: The stage page

**Files:**
- Create: `src/app/stage/tiktok-agent/page.tsx`

Deliberately not under `src/app/apps/` — it is an OBS surface, not a catalog app, so it needs no `catalog.ts` entry and no `docs/apps/<slug>.md` record, and `check:records` stays green.

- [ ] **Step 1: Write the page**

```tsx
"use client";
// src/app/stage/tiktok-agent/page.tsx
//
// The OBS browser source. Holds the director, plays the audio, and draws the
// face. One source carries both audio and picture, so no virtual audio cable
// is needed.
//
// Open with ?handle=someone&character=Lumi

import { useEffect, useRef, useState } from "react";
import { REST, approach, visemeFromSpectrum, type Viseme } from "@/lib/new-jarvis/avatar/visemes";
import { Director, type Turn } from "@/lib/tiktok-agent/director";
import { parseEvent } from "@/lib/tiktok-agent/events";
import { PLATE_IDS, plateFor, type PlateId } from "@/lib/tiktok-agent/plates";
import { splitSentences } from "@/lib/tiktok-agent/speech";

const FILLERS = [
  "Still here if anyone wants to say hi.",
  "Chat's quiet — what's everyone up to?",
  "Ask me anything, I'm not shy.",
  "It's calm in here. I like it.",
];

export default function TikTokAgentStage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("starting");
  const [caption, setCaption] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const character = params.get("character") || "Lumi";
    const persona = params.get("persona") || "Warm, quick and a little cheeky.";
    const port = params.get("port") || "8787";

    const director = new Director({ characterName: character, fillers: FILLERS });
    const memory = new Map<string, string[]>();
    const plates = new Map<PlateId, HTMLImageElement>();
    const mouth: Viseme = { ...REST };

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let data = new Uint8Array(0);
    let speakingPriority = -1;
    let current: HTMLAudioElement | null = null;
    let interrupted = false;
    let stopped = false;

    for (const id of PLATE_IDS) {
      const img = new Image();
      img.src = `/tiktok-agent-plates/${id}.png`;
      plates.set(id, img);
    }

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.onopen = () => setStatus("listening");
    ws.onclose = () => setStatus("relay closed");
    ws.onerror = () => setStatus("relay unreachable");
    ws.onmessage = (msg) => {
      let raw: unknown;
      try {
        raw = JSON.parse(msg.data as string);
      } catch {
        return;
      }
      const ev = parseEvent(raw, Date.now());
      if (!ev) return;
      director.enqueue(ev);
      // A gift mid-sentence is worth cutting off; chatter is not.
      if (current && director.shouldInterrupt(ev, speakingPriority)) {
        interrupted = true;
        current.pause();
        current = null;
      }
    };

    /** One sentence -> audio bytes, or null when no TTS backend answered. */
    async function synth(text: string): Promise<Blob | null> {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, format: "wav" }),
        });
        // A JSON body means {fallback:true} or an error, never audio.
        if (!res.ok || res.headers.get("content-type")?.includes("application/json")) return null;
        return await res.blob();
      } catch {
        return null;
      }
    }

    async function play(blob: Blob): Promise<void> {
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);

      audioCtx ??= new AudioContext();
      if (!analyser) {
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.connect(audioCtx.destination);
        data = new Uint8Array(analyser.frequencyBinCount);
      }
      audioCtx.createMediaElementSource(el).connect(analyser);

      current = el;
      await el.play().catch(() => {});
      await new Promise<void>((done) => {
        el.onended = () => done();
        el.onpause = () => done();
        el.onerror = () => done();
      });
      URL.revokeObjectURL(url);
      if (current === el) current = null;
    }

    /**
     * Speaks sentence by sentence, synthesizing the NEXT one while the
     * current one plays. Phonon returns whole files, so this is what keeps
     * time-to-first-audio inside the budget on a two-sentence reply.
     */
    async function speak(text: string, priority: number) {
      const pieces = splitSentences(text);
      if (!pieces.length) return;

      interrupted = false;
      speakingPriority = priority;
      setCaption(text);

      let pending = synth(pieces[0]);
      for (let i = 0; i < pieces.length && !interrupted; i += 1) {
        const blob = await pending;
        pending = i + 1 < pieces.length ? synth(pieces[i + 1]) : Promise.resolve(null);
        if (blob) await play(blob);
      }

      speakingPriority = -1;
      setCaption("");
    }

    async function turnLoop() {
      while (!stopped) {
        const now = Date.now();
        const turn: Turn | null = current ? null : director.next(now);
        if (!turn) {
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }

        if (turn.kind === "filler") {
          await speak(turn.text, 0);
          director.markSpoken(Date.now());
          continue;
        }

        const { event, priority } = turn;
        const said = memory.get(event.handle) ?? [];
        const reply = await fetch("/api/tiktok-agent/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            character, persona, user: event.user, text: event.text,
            kind: event.kind, memory: said.slice(-3),
          }),
        })
          .then((r) => r.json() as Promise<{ reply?: string }>)
          .catch(() => ({ reply: "" }));

        if (event.text) memory.set(event.handle, [...said, event.text].slice(-5));
        if (reply.reply) await speak(reply.reply, priority);
        director.markSpoken(Date.now());
      }
    }

    let raf = 0;
    let last = performance.now();
    function frame(t: number) {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;

      let target: Viseme = REST;
      if (analyser && current && !current.paused) {
        analyser.getByteFrequencyData(data);
        target = visemeFromSpectrum(data, analyser.context.sampleRate, analyser.fftSize);
      }
      mouth.open = approach(mouth.open, target.open, 22, dt);
      mouth.wide = approach(mouth.wide, target.wide, 14, dt);
      mouth.round = approach(mouth.round, target.round, 14, dt);

      const el = canvas.current;
      const ctx = el?.getContext("2d");
      if (el && ctx) {
        const img = plates.get(plateFor(mouth));
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, el.width, el.height);
        if (img?.complete && img.naturalWidth) {
          const scale = Math.max(el.width / img.naturalWidth, el.height / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.drawImage(img, (el.width - w) / 2, (el.height - h) / 2, w, h);
        }
      }
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    void turnLoop();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ws.close();
      current?.pause();
      void audioCtx?.close();
    };
  }, []);

  return (
    <main style={{ margin: 0, background: "#000", width: "100vw", height: "100vh", position: "relative" }}>
      <canvas ref={canvas} width={1080} height={1920} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", left: 24, right: 24, bottom: 96, color: "#fff", font: "500 34px system-ui", textShadow: "0 2px 12px #000", textAlign: "center" }}>
        {caption}
      </div>
      <div style={{ position: "absolute", left: 12, top: 12, color: "#fff6", font: "400 16px system-ui" }}>{status}</div>
    </main>
  );
}
```

- [ ] **Step 2: Serve the plates**

The page loads plates from `/tiktok-agent-plates/<id>.png`, so they must sit under `public/`. Create the link once:

```powershell
New-Item -ItemType Junction -Path public\tiktok-agent-plates -Target tools\tiktok-live-agent\plates
```

Then add `public/tiktok-agent-plates` to `.gitignore` so generated output is never committed.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors. If `ws` or the `Uint8Array` generic complains, fix it here rather than casting to `any`.

- [ ] **Step 4: Commit**

```bash
git add src/app/stage/tiktok-agent/page.tsx .gitignore
git commit -m "TikTok Live agent: the OBS stage page that speaks and moves its mouth"
```

---

## Task 12: End to end against a fixture

**Files:**
- Create: `src/lib/tiktok-agent/fixtures/stream.jsonl`
- Create: `tools/tiktok-live-agent/replay.mjs`

Phase 1 can be judged without the 1,000 followers TikTok requires for a stream key. Replay a recorded stream and record the result with OBS.

- [ ] **Step 1: Write the fixture**

```
{"type":"comment","handle":"ana","user":"Ana","text":"where are you from?"}
{"type":"comment","handle":"bo","user":"Bo","text":"nice stream"}
{"type":"gift","handle":"caz","user":"Caz","text":"Rose"}
{"type":"comment","handle":"ana","user":"Ana","text":"Where are you FROM??"}
{"type":"follow","handle":"dee","user":"Dee"}
{"type":"comment","handle":"eli","user":"Eli","text":"Lumi what music do you like?"}
{"type":"comment","handle":"bo","user":"Bo","text":"lol"}
```

That fixture exercises every director rule in one pass: a question, chatter, a gift that should jump the queue, a duplicate that must be dropped, a follow, a mention, and more chatter.

- [ ] **Step 2: Write the replayer**

```js
#!/usr/bin/env node
// tools/tiktok-live-agent/replay.mjs
//
//   node tools/tiktok-live-agent/replay.mjs [secondsBetween]
//
// Serves the fixture over the same websocket the relay uses, so the stage
// page can be judged with nothing live.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const gap = Number(process.argv[2] || 4) * 1000;
const PORT = Number(process.env.TIKTOK_AGENT_PORT || 8787);

const lines = (await readFile(join(here, "../../src/lib/tiktok-agent/fixtures/stream.jsonl"), "utf8"))
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
console.log(`[replay] ws://127.0.0.1:${PORT} — ${lines.length} events, ${gap / 1000}s apart`);

wss.on("connection", async (ws) => {
  console.log("[replay] stage connected");
  for (const line of lines) {
    if (ws.readyState !== ws.OPEN) return;
    const ev = { ...JSON.parse(line), ts: Date.now() };
    ws.send(JSON.stringify(ev));
    console.log(`[replay] -> ${ev.type} ${ev.handle}: ${ev.text ?? ""}`);
    await new Promise((r) => setTimeout(r, gap));
  }
  console.log("[replay] fixture done — the stage should now go to idle filler");
});
```

- [ ] **Step 3: Run it**

Three terminals:

```powershell
npm run tts:phonon
```

```powershell
npm run dev
```

```powershell
node tools/tiktok-live-agent/replay.mjs 4
```

Then open `http://localhost:3000/stage/tiktok-agent?character=Lumi`.

- [ ] **Step 4: Check each rule with your eyes and ears**

Expected, in order:
- Ana's question is answered first (it beats Bo's chatter)
- Caz's gift **interrupts** whatever is being said and is thanked
- Ana's repeat is **never answered**
- Dee is welcomed by name
- Eli's mention is answered before Bo's "lol"
- About 20 s after the fixture ends, the character speaks unprompted
- Throughout: the mouth moves with the speech and is closed when silent

If the mouth looks wrong but the audio is right, the fault is in the plates or `plateFor`, not in the audio chain — check the plates first, as Task 10 Step 5 warns.

- [ ] **Step 5: Add the OBS source**

In OBS: add a **Browser** source, URL `http://localhost:3000/stage/tiktok-agent?character=Lumi`, 1080×1920, and tick **Control audio via OBS**. Confirm the OBS audio meter moves when the character speaks.

Then satisfy the spec's "never a silent stream" rule for the one failure the page cannot handle itself — the page crashing: add an **Image** source *below* the browser source in the same scene, pointing at `tools/tiktok-live-agent/plates/rest.png`. If the browser source dies, the character's resting face stays on screen instead of a black rectangle.

Record 60 s to a file and watch it back — that recording is the phase 1 deliverable.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tiktok-agent/fixtures/stream.jsonl tools/tiktok-live-agent/replay.mjs
git commit -m "TikTok Live agent: replay a recorded stream so phase 1 needs nothing live"
```

---

## Task 13: Write the tool README and run verify

**Files:**
- Create: `tools/tiktok-live-agent/README.md`
- Modify: `docs/superpowers/specs/tiktok-live-voice-agent.md` — mark phase 1 built

- [ ] **Step 1: Write the README**

Follow the shape of `tools/phonon-tts/README.md` — the numbers must be **measured on this machine**, not copied from this plan:

````markdown
# TikTok Live agent — a character that talks to chat

Reads a TikTok LIVE room's comments, answers out loud in Phonon's voice, and
draws a photoreal mouth that moves with the speech.

## Run it

```bash
npm run tts:phonon                              # the voice
npm run dev                                     # the stage page
npm run tiktok:agent -- @handle                 # the comments
```

Then point OBS at `http://localhost:3000/stage/tiktok-agent?character=<name>`
(1080x1920, Control audio via OBS).

With nothing live, swap the third command for
`node tools/tiktok-live-agent/replay.mjs 4`.

## Measured on the owner's laptop

RTX 3050 6 GB, Ryzen 5 7235HS, 32 GB RAM:

| | |
|---|---|
| Plate render, cold / warm | FILL IN s / FILL IN s each |
| Comment to first audio | FILL IN ms |
| VRAM in use while streaming | FILL IN GB |
| Mouth held up? | FILL IN — and if not, which plates were wrong |

## What breaks it

- TikTokLive is unofficial: TikTok changes break it. The relay retries with
  backoff; `ingest.py` is where to look first.
- The stage page must stay open — it IS the OBS source and holds the director.
- Plates live in `plates/` (gitignored). Re-render with `plates.mjs`.
````

Replace every `FILL IN` with a real number before committing. A README with estimates in it is worse than no README, because the next session will trust it.

- [ ] **Step 2: Update the spec**

Change the status line to `Status: **phase 1 built <date>; phases 2-3 not started.**` and move anything phase 1 proved wrong into the spec body, so the next session reads facts and not predictions.

- [ ] **Step 3: Run the full gate**

Run: `npm run verify`
Expected: PASS. This runs `check:apps`, `check:records`, `check:fonts`, `tsc --noEmit`, `npm test`, `npm run build`.

Two known traps from AGENTS.md: a `route.ts` exporting anything but a route handler passes `tsc` and fails `next build`; and `check:records` fails if any `docs/apps/<slug>.md` is stale. Neither should trigger here — nothing was added to `PROJECTS` and the stage page is outside `src/app/apps/` — but if `check:records` fails on an app this plan never touched, that failure predates this work. Say so rather than papering over it.

- [ ] **Step 4: Commit**

```bash
git add tools/tiktok-live-agent/README.md docs/superpowers/specs/tiktok-live-voice-agent.md
git commit -m "TikTok Live agent: document the tool and record what phase 1 measured"
```

---

## Out of scope for this plan

Phases 2 and 3 from the spec get their own plans:

- **Phase 2** — the owner's microphone: `faster-whisper` small int8, a new `ingest.mic`, and `speech` events. No echo gate needed, because the mic is a separate device.
- **Phase 3** — guest audio, and the echo gate that stops the character answering itself.

Also deliberately absent: voice cloning, a control UI, gift-specific animations, and any GPU face model. The spec's section 9 says why.
