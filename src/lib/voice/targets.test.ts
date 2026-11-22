import { describe, expect, it } from "vitest";
import { pickTarget, register, speakable, touch, unregister, type VoiceTarget } from "./targets";

const t = (id: string, priority: number, kind: VoiceTarget["kind"] = "chat"): VoiceTarget => ({ id, label: id, kind, priority, send: () => undefined });

describe("where a spoken sentence goes", () => {
  it("goes nowhere when nothing is listening", () => {
    expect(pickTarget(new Map())).toBeNull();
  });

  it("prefers the box the owner last used, whatever its priority", () => {
    let r = register(new Map(), t("jarvis", 30), 1);
    r = register(r, t("profiles", 10), 2);
    r = touch(r, "profiles", 5);
    expect(pickTarget(r)?.id).toBe("profiles");
    r = touch(r, "jarvis", 9);
    expect(pickTarget(r)?.id).toBe("jarvis");
  });

  it("falls back to priority, then to the newest", () => {
    let r = register(new Map(), t("page", 10), 1);
    r = register(r, t("harness", 20, "harness"), 2);
    expect(pickTarget(r)?.id).toBe("harness");
    r = register(r, t("page2", 10), 3);
    r = unregister(r, "harness");
    expect(pickTarget(r)?.id).toBe("page2");
  });

  it("keeps when it was used across a re-register (a re-render must not reset it)", () => {
    let r = register(new Map(), t("a", 10), 1);
    r = register(r, t("b", 10), 2);
    r = touch(r, "a", 3);
    r = register(r, { ...t("a", 10), label: "A again" }, 4);
    expect(pickTarget(r)?.label).toBe("A again");
  });

  it("forgets a target that left the page", () => {
    const r = unregister(register(new Map(), t("a", 10), 1), "a");
    expect(pickTarget(r)).toBeNull();
  });
});

describe("what gets read aloud", () => {
  it("drops code, marks and links", () => {
    expect(speakable("**Done.** See `x.ts` at https://example.com/a.\n```js\nconst a=1\n```")).toBe("Done. See x.ts at the link");
  });

  it("stops a long answer at a sentence and says there is more", () => {
    const long = "This is one sentence. ".repeat(60);
    const out = speakable(long, 200);
    expect(out.endsWith("There's more on screen.")).toBe(true);
    expect(out.length).toBeLessThan(240);
  });
});

import { replyFrom } from "./harnessReply";

describe("reading back a harness turn", () => {
  it("waits for a new turn, not the last one", () => {
    expect(replyFrom([{ status: "done", text: "old" }], 1, null)).toBeNull();
    expect(replyFrom([{ status: "done", text: "old" }, { status: "running", text: "" }], 1, null)).toBeNull();
    expect(replyFrom([{ status: "done", text: "old" }, { status: "done", text: "new answer" }], 1, null)).toBe("new answer");
  });

  it("says when the thread is waiting at a gate", () => {
    expect(replyFrom([], 0, { title: "Write src/x.ts" })).toMatch(/waiting for your OK: Write src\/x.ts/);
  });

  it("says when the turn failed", () => {
    expect(replyFrom([{ status: "failed", text: "", error: "no model" }], 0, null)).toBe("That stopped: no model.");
  });
});

import { shouldStopListening } from "./targets";

describe("start and stop, not always listening", () => {
  it("switches the microphone off after one request", () => {
    expect(shouldStopListening("speaking", "waiting", false)).toBe(true);
    expect(shouldStopListening("thinking", "waiting", false)).toBe(true);
    expect(shouldStopListening("hearing", "waiting", false)).toBe(true);
  });

  it("does not stop it while it is starting up", () => {
    expect(shouldStopListening("off", "waiting", false)).toBe(false);
  });

  it("keeps listening for the name only when Hands-free is on", () => {
    expect(shouldStopListening("speaking", "waiting", true)).toBe(false);
  });
});
