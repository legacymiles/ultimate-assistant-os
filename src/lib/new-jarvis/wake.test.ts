import { describe, expect, it } from "vitest";
import {
  detectWake,
  isEcho,
  isInterruption,
  normalise,
  restartDelayMs,
  shouldEndpoint,
  ENDPOINT_SILENCE_MS,
  MAX_UTTERANCE_MS,
} from "./wake";

describe("detectWake", () => {
  it("hears the name and hands back the instruction", () => {
    expect(detectWake("Jarvis, open my calendar")).toEqual({ woke: true, rest: "open my calendar" });
  });

  it("stays asleep when the name was never said", () => {
    expect(detectWake("open my calendar").woke).toBe(false);
  });

  it("takes the LAST name, so a retracted sentence is not acted on", () => {
    const hit = detectWake("jarvis no wait — jarvis open my calendar");
    expect(hit.woke).toBe(true);
    expect(hit.rest).toBe("open my calendar");
  });

  it("wakes on the name alone, with nothing after it", () => {
    expect(detectWake("jarvis")).toEqual({ woke: true, rest: "" });
  });

  it("forgives the ways recognition mishears the name", () => {
    for (const said of ["jervis what's next", "travis what's next", "javis what's next"]) {
      expect(detectWake(said).woke, said).toBe(true);
    }
  });

  it("does not wake on the name buried inside another word", () => {
    expect(detectWake("the jarvisian model").woke).toBe(false);
  });

  it("drops the politeness that is not part of the instruction", () => {
    expect(detectWake("jarvis can you open my calendar").rest).toBe("open my calendar");
  });

  it("honours extra wake words without losing the default", () => {
    expect(detectWake("computer, lights on", ["computer"]).rest).toBe("lights on");
    expect(detectWake("jarvis, lights on", ["computer"]).woke).toBe(true);
  });
});

describe("isEcho", () => {
  it("catches the assistant hearing its own reply", () => {
    expect(isEcho("your next meeting is at four", "Your next meeting is at four.")).toBe(true);
  });

  it("catches a fragment of the reply", () => {
    expect(isEcho("meeting is at four", "Your next meeting is at four, with Sam.")).toBe(true);
  });

  it("lets a real interruption through", () => {
    expect(isEcho("stop", "Your next meeting is at four.")).toBe(false);
    expect(isEcho("what about tomorrow", "Your next meeting is at four.")).toBe(false);
  });

  it("is not confused when nothing is being said", () => {
    expect(isEcho("anything at all", "")).toBe(false);
  });
});

describe("isInterruption", () => {
  it("knows a cut-off", () => {
    for (const w of ["stop", "wait", "cancel", "never mind", "Shut up"]) {
      expect(isInterruption(w), w).toBe(true);
    }
  });

  // "stop the timer" is a job, not an interruption, and treating it as one
  // means the one voice command nobody can ever issue is "stop the timer".
  it("does not eat a sentence that merely starts with one", () => {
    expect(isInterruption("stop the timer")).toBe(false);
    expect(isInterruption("cancel my four o'clock")).toBe(false);
  });
});

describe("shouldEndpoint", () => {
  const now = 10_000;

  it("waits through a mid-sentence pause", () => {
    expect(shouldEndpoint({ lastWordAt: now - 400, startedAt: now - 3_000, now })).toBe(false);
  });

  it("goes after the silence threshold", () => {
    expect(shouldEndpoint({ lastWordAt: now - ENDPOINT_SILENCE_MS - 1, startedAt: now - 3_000, now })).toBe(true);
  });

  it("goes eventually even if words never stop arriving", () => {
    expect(shouldEndpoint({ lastWordAt: now, startedAt: now - MAX_UTTERANCE_MS - 1, now })).toBe(true);
  });
});

describe("restartDelayMs", () => {
  it("restarts a healthy session instantly", () => {
    expect(restartDelayMs(0)).toBe(0);
  });

  it("backs off when it keeps failing, and stops growing", () => {
    expect(restartDelayMs(1)).toBe(250);
    expect(restartDelayMs(2)).toBe(500);
    expect(restartDelayMs(99)).toBe(8_000);
  });
});

describe("normalise", () => {
  it("flattens punctuation and case so every compare agrees", () => {
    expect(normalise("  Jarvis,   OPEN  my calendar!  ")).toBe("jarvis open my calendar");
  });
});
