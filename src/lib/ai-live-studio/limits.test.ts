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

  it("honours a custom cap, and a cap changed while running", () => {
    const r = new RateLimit(2);
    r.record(0);
    r.record(1);
    expect(r.allowed(2)).toBe(false);
    r.maxPerMinute = 3;
    expect(r.allowed(2)).toBe(true);
  });
});
