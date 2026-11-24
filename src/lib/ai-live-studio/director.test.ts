import { describe, expect, it } from "vitest";
import { Director, IDLE_MS } from "./director";
import type { AgentEvent } from "./events";
import { PRIORITY } from "./priority";

let n = 0;
const ev = (over: Partial<AgentEvent>): AgentEvent => ({
  id: `e${(n += 1)}`,
  kind: "comment",
  handle: "a",
  user: "A",
  text: "hello",
  ts: 0,
  ...over,
});

const make = (extra = {}) => new Director({ characterName: "Alex", fillers: ["f1", "f2"], ...extra });

describe("Director — answering", () => {
  it("returns nothing when the queue is empty and it is not yet idle", () => {
    expect(make().next(0)).toBeNull();
  });

  it("answers the highest-priority event first, not the oldest", () => {
    const d = make();
    d.enqueue(ev({ text: "nice stream", handle: "x" }));
    d.enqueue(ev({ kind: "gift", handle: "g", text: "Rose" }));
    const turn = d.next(0);
    expect(turn?.kind === "answer" && turn.event.handle).toBe("g");
  });

  it("breaks a priority tie by taking the older event", () => {
    const d = make();
    d.enqueue(ev({ handle: "first", ts: 1 }));
    d.enqueue(ev({ handle: "second", ts: 2 }));
    const turn = d.next(0);
    expect(turn?.kind === "answer" && turn.event.handle).toBe("first");
  });

  it("drops a repeated question instead of answering it twice", () => {
    const d = make();
    d.enqueue(ev({ text: "where are you from?", handle: "one" }));
    expect(d.next(0)?.kind).toBe("answer");
    d.markSpoken(0);
    d.enqueue(ev({ text: "Where are you FROM?", handle: "two" }));
    expect(d.next(1000)).toBeNull();
  });

  it("forgets queued events that have gone stale", () => {
    const d = make({ fillers: [] });
    d.enqueue(ev({ text: "old news", ts: 0 }));
    expect(d.next(5 * 60_000)).toBeNull();
  });
});

describe("Director — what never reaches the air", () => {
  it("refuses the same message id twice (D5)", () => {
    const d = make();
    const e = ev({ id: "same" });
    expect(d.enqueue(e).status).toBe("queued");
    expect(d.enqueue({ ...e }).status).toBe("duplicate");
    expect(d.size).toBe(1);
  });

  it("blocks harassment and links before they are queued", () => {
    const d = make();
    expect(d.enqueue(ev({ text: "kys" }))).toEqual({ status: "blocked", reason: "harassment" });
    expect(d.enqueue(ev({ text: "free followers at getfollowz.com" }))).toEqual({ status: "blocked", reason: "link" });
    expect(d.size).toBe(0);
  });

  it("applies the owner's word list, including changes mid-stream", () => {
    const d = make();
    expect(d.enqueue(ev({ text: "you are a banana" })).status).toBe("queued");
    d.setOptions({ blocklist: ["banana"] });
    expect(d.enqueue(ev({ text: "banana again" })).status).toBe("blocked");
  });

  it("drops everything from a muted viewer, queued and future", () => {
    const d = make();
    d.enqueue(ev({ handle: "troll", text: "one" }));
    d.muteViewer("troll");
    expect(d.size).toBe(0);
    expect(d.enqueue(ev({ handle: "troll", text: "two" })).status).toBe("muted");
  });
});

describe("Director — pacing", () => {
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

  it("takes a new cap from the sliders mid-stream", () => {
    const d = make({ maxPerMinute: 1 });
    d.enqueue(ev({ text: "a" }));
    d.next(0);
    d.markSpoken(0);
    d.enqueue(ev({ text: "b" }));
    expect(d.next(1)).toBeNull();
    d.setOptions({ maxPerMinute: 5 });
    expect(d.next(2)?.kind).toBe("answer");
  });

  it("speaks unprompted after the idle time, counted from the stream start", () => {
    const d = make();
    d.start(1_000_000);
    expect(d.next(1_000_000 + IDLE_MS - 1)).toBeNull();
    expect(d.next(1_000_000 + IDLE_MS + 1)).toEqual({ kind: "filler", text: "f1" });
  });

  it("does not repeat a filler, and stops when they are used up", () => {
    const d = make();
    d.next(IDLE_MS + 1);
    d.markSpoken(IDLE_MS + 1);
    expect(d.next(2 * IDLE_MS + 2)).toEqual({ kind: "filler", text: "f2" });
    d.markSpoken(2 * IDLE_MS + 2);
    expect(d.next(9 * IDLE_MS)).toBeNull();
  });

  it("prefers a real event over filler even when idle", () => {
    const d = make();
    d.enqueue(ev({ text: "hi" }));
    expect(d.next(IDLE_MS + 1)?.kind).toBe("answer");
  });

  it("interrupts for a gift but not for chatter or an equal", () => {
    const d = make();
    expect(d.shouldInterrupt(ev({ kind: "gift", text: "" }), PRIORITY.chatter)).toBe(true);
    expect(d.shouldInterrupt(ev({ text: "nice" }), PRIORITY.chatter)).toBe(false);
    expect(d.shouldInterrupt(ev({ kind: "gift", text: "" }), PRIORITY.gift)).toBe(false);
  });
});

describe("Director — the owner's hand", () => {
  it("puts a typed line first, even past the cap", () => {
    const d = make({ maxPerMinute: 1 });
    d.enqueue(ev({ kind: "gift", text: "Rose" }));
    d.next(0);
    d.markSpoken(0);
    d.say("  Thanks for watching everyone  ");
    expect(d.next(1)).toEqual({ kind: "say", text: "Thanks for watching everyone" });
  });

  it("answers a promoted comment before a gift, even a stale repeat", () => {
    const d = make();
    d.enqueue(ev({ text: "hi", handle: "first" }));
    d.next(0);
    d.markSpoken(0);
    const repeat = ev({ text: "hi", handle: "again", ts: 0 });
    d.enqueue(repeat);
    d.enqueue(ev({ kind: "gift", handle: "g", text: "Rose" }));
    expect(d.promote(repeat.id)).toBe(true);
    const turn = d.next(5 * 60_000);
    expect(turn?.kind === "answer" && turn.event.id).toBe(repeat.id);
    expect(turn?.kind === "answer" && turn.priority).toBe(PRIORITY.operator);
  });

  it("lets the owner's Answer now through the per-minute cap, and nothing else", () => {
    const d = make({ maxPerMinute: 1 });
    d.enqueue(ev({ text: "first", handle: "a" }));
    d.next(0);
    d.markSpoken(0);
    const waiting = ev({ text: "please answer me", handle: "b" });
    d.enqueue(waiting);
    d.enqueue(ev({ kind: "gift", handle: "g", text: "Rose" }));
    expect(d.next(1)).toBeNull(); // capped: not even the gift
    d.promote(waiting.id);
    const turn = d.next(2);
    expect(turn?.kind === "answer" && turn.event.id).toBe(waiting.id);
    expect(d.next(3)).toBeNull(); // the gift still waits for the cap
  });

  it("skips a comment the owner dropped", () => {
    const d = make({ fillers: [] });
    const e = ev({ text: "skip me" });
    d.enqueue(e);
    expect(d.drop(e.id)).toBe(true);
    expect(d.next(1)).toBeNull();
  });

  it("reports every comment it passed over, and why, exactly once", () => {
    const d = make({ fillers: [] });
    const stale = ev({ text: "old", ts: 0 });
    d.enqueue(stale);
    d.enqueue(ev({ text: "hi", handle: "x", ts: 200_000 }));
    d.next(200_000);
    d.markSpoken(200_000);
    const repeat = ev({ text: "HI!", handle: "y", ts: 200_001 });
    d.enqueue(repeat);
    d.next(200_002);
    expect(d.drainDiscarded()).toEqual([
      { id: stale.id, reason: "stale" },
      { id: repeat.id, reason: "repeat" },
    ]);
    expect(d.drainDiscarded()).toEqual([]);
  });

  it("lists what is waiting in answer order", () => {
    const d = make();
    d.enqueue(ev({ text: "chat", handle: "c" }));
    d.enqueue(ev({ kind: "follow", handle: "f", text: "" }));
    expect(d.pending(0).map((e) => e.handle)).toEqual(["f", "c"]);
  });
});

describe("Director — peek, so the next reply can be fetched early", () => {
  it("names what next() will answer, without taking it", () => {
    const d = make({ maxPerMinute: 100 });
    d.enqueue(ev({ text: "chat", handle: "c" }));
    d.enqueue(ev({ kind: "gift", handle: "g", text: "Rose" }));
    const peeked = d.peek(0);
    expect(peeked?.handle).toBe("g");
    expect(d.size).toBe(2);
    const turn = d.next(0);
    expect(turn?.kind === "answer" && turn.event.id).toBe(peeked?.id);
  });

  it("skips a repeat without recording it as discarded", () => {
    const d = make({ maxPerMinute: 100 });
    d.enqueue(ev({ text: "hi there", handle: "a" }));
    d.next(0);
    d.markSpoken(0);
    d.enqueue(ev({ text: "Hi there!", handle: "b" }));
    const fresh = ev({ text: "something new", handle: "c" });
    d.enqueue(fresh);
    expect(d.peek(1)?.id).toBe(fresh.id);
    expect(d.drainDiscarded()).toEqual([]);
  });

  it("returns nothing when a typed line is waiting, or the queue is empty", () => {
    const d = make();
    expect(d.peek(0)).toBeNull();
    d.enqueue(ev({ text: "x" }));
    d.say("hello");
    expect(d.peek(0)).toBeNull();
  });
});

describe("Director — a busy room never starves anyone", () => {
  it("lets a question that has waited outrank a fresh gift", () => {
    // The first question of the stream, still waiting 45 s later while gifts pour in.
    const d = make({ maxPerMinute: 100 });
    const first = ev({ text: "What's your name?", handle: "mike", ts: 0 });
    d.enqueue(first);
    d.enqueue(ev({ kind: "gift", handle: "g", text: "Rose", ts: 45_000 }));
    const turn = d.next(45_000);
    expect(turn?.kind === "answer" && turn.event.id).toBe(first.id);
  });

  it("still thanks a gift first when the question has only just arrived", () => {
    const d = make({ maxPerMinute: 100 });
    d.enqueue(ev({ text: "What's your name?", handle: "mike", ts: 40_000 }));
    d.enqueue(ev({ kind: "gift", handle: "g", text: "Rose", ts: 41_000 }));
    const turn = d.next(42_000);
    expect(turn?.kind === "answer" && turn.event.handle).toBe("g");
  });

  it("reports what the event IS, not its aged rank, so interrupts stay honest", () => {
    const d = make({ maxPerMinute: 100 });
    d.enqueue(ev({ text: "old question?", ts: 0 }));
    const turn = d.next(60_000);
    expect(turn?.kind === "answer" && turn.priority).toBe(PRIORITY.question);
  });

  it("never lets ageing lift a comment above the owner's Answer now", () => {
    const d = make({ maxPerMinute: 100 });
    d.enqueue(ev({ text: "ancient", handle: "old", ts: 0 }));
    const chosen = ev({ text: "this one", handle: "pick", ts: 100_000 });
    d.enqueue(chosen);
    d.promote(chosen.id);
    const turn = d.next(110_000);
    expect(turn?.kind === "answer" && turn.event.id).toBe(chosen.id);
  });
});

describe("the director's hand (private direction)", () => {
  const mk = () => {
    const d = new Director({ characterName: "Alex", fillers: [] });
    d.start(0);
    return d;
  };
  const c = (id: string, handle: string, text: string, ts = 1000) => ({ id, kind: "comment" as const, handle, user: handle, text, ts });

  it("carries a private note with a promoted comment, and the comment goes first", () => {
    const d = mk();
    d.enqueue(c("a", "early", "first question here", 1000));
    d.enqueue(c("b", "mike23", "are you a real person?", 2000));
    expect(d.promote("b", { note: "Tell them that's a ridiculous question", expression: "sarcastic" })).toBe(true);
    const t = d.next(3000);
    expect(t).toMatchObject({ kind: "answer", event: { id: "b" }, direction: { note: "Tell them that's a ridiculous question", expression: "sarcastic" } });
  });

  it("can direct a comment without moving it up", () => {
    const d = mk();
    d.enqueue(c("a", "early", "first", 1000));
    d.enqueue(c("b", "sarah", "hi there", 2000));
    d.direct("b", { expression: "happy" });
    expect(d.next(3000)).toMatchObject({ event: { id: "a" } });
    expect(d.next(3100)).toMatchObject({ event: { id: "b" }, direction: { expression: "happy" } });
  });

  it("serves cues before comments, past the cap", () => {
    const d = new Director({ characterName: "Alex", fillers: [], maxPerMinute: 1 });
    d.start(0);
    d.enqueue(c("a", "x", "hello", 1000));
    d.next(1000);
    d.markSpoken(1000);
    d.cue({ kind: "audience", intent: "Ask everyone where they're from" });
    expect(d.next(2000)).toEqual({ kind: "cue", cue: { kind: "audience", intent: "Ask everyone where they're from" } });
  });

  it("holds the next answer without touching what's already been said", () => {
    const d = mk();
    d.enqueue(c("a", "x", "hello there", 1000));
    d.hold(5000, 1000);
    expect(d.next(3000)).toBeNull();
    expect(d.next(6001)).toMatchObject({ kind: "answer" });
  });

  it("watches for someone who hasn't commented yet, then answers them next", () => {
    const d = mk();
    d.enqueue(c("a", "early", "first question", 1000));
    d.watch("Mike", 1000, { promote: true, direction: { note: "Tell them that's ridiculous" } });
    expect(d.watching).toEqual(["mike"]);
    const disp = d.enqueue({ id: "m", kind: "comment", handle: "mike_t", user: "Mike T", text: "am I late?", ts: 2000 });
    expect(disp).toEqual({ status: "queued", watched: { note: "Tell them that's ridiculous", promoted: true } });
    expect(d.next(2500)).toMatchObject({ event: { id: "m" }, direction: { note: "Tell them that's ridiculous" } });
    expect(d.watching).toEqual([]);
  });

  it("a watch to ignore someone mutes them on arrival", () => {
    const d = mk();
    d.watch("troll", 0, { skip: true });
    expect(d.enqueue(c("t", "troll99", "lol", 100))).toEqual({ status: "muted" });
    expect(d.enqueue(c("t2", "troll99", "hey", 200))).toEqual({ status: "muted" });
  });

  it("drops everything a viewer has waiting", () => {
    const d = mk();
    d.enqueue(c("a", "x", "one", 1000));
    d.enqueue(c("b", "x", "two", 1100));
    d.enqueue(c("c", "y", "three", 1200));
    expect(d.dropViewer("x")).toEqual(["a", "b"]);
    expect(d.has("c")).toBe(true);
  });

  it("does not guess the next reply while a cue is waiting", () => {
    const d = mk();
    d.enqueue(c("a", "x", "hello there", 1000));
    d.cue({ kind: "subject", intent: "Change the subject" });
    expect(d.peek(1500)).toBeNull();
  });
});
