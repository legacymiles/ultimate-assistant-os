import { describe, expect, it } from "vitest";
import { NO_SIGNALS, phoneLine, readSignals } from "./phoneStatus";

const since = (t: number) => `@${t}`;
const MIN = 60_000;

describe("phoneLine", () => {
  it("says nothing has come when the phone never made contact", () => {
    expect(phoneLine(NO_SIGNALS, since)).toEqual({ text: "iPhone hasn't sent a photo yet", warn: false });
  });

  it("shows the last photo when the last contact was a send", () => {
    const l = phoneLine({ ...NO_SIGNALS, lastPush: 100 * MIN, lastCheckIn: 99 * MIN }, since);
    expect(l.text).toBe(`last photo from iPhone @${100 * MIN}`);
    expect(l.warn).toBe(false);
  });

  it("treats a check-in in the same run as the send as that send", () => {
    const l = phoneLine({ ...NO_SIGNALS, lastPush: 100 * MIN, lastCheckIn: 102 * MIN }, since);
    expect(l.text).toBe(`last photo from iPhone @${100 * MIN}`);
  });

  it("says the Shortcut ran but found nothing", () => {
    const l = phoneLine({ ...NO_SIGNALS, lastCheckIn: 200 * MIN }, since);
    expect(l.text).toContain("checked in");
    expect(l.text).toContain("found no new photos");
    expect(l.warn).toBe(true);
  });

  it("is calm about finding nothing when photos have come before", () => {
    const l = phoneLine({ ...NO_SIGNALS, lastPush: 10 * MIN, lastCheckIn: 200 * MIN }, since);
    expect(l.text).toContain(`last photo @${10 * MIN}`);
    expect(l.warn).toBe(false);
  });

  it("names an out-of-date link when that was the newest contact", () => {
    const l = phoneLine({ ...NO_SIGNALS, lastPush: 10 * MIN, refusedAt: 50 * MIN }, since);
    expect(l.text).toContain("old link");
    expect(l.warn).toBe(true);
  });

  it("forgets an old refusal once the phone gets through", () => {
    const l = phoneLine({ ...NO_SIGNALS, refusedAt: 50 * MIN, lastPush: 60 * MIN }, since);
    expect(l.text).toBe(`last photo from iPhone @${60 * MIN}`);
  });

  it("passes on what was wrong with a send", () => {
    const l = phoneLine({ ...NO_SIGNALS, problem: { at: 70 * MIN, message: "no photo came through" } }, since);
    expect(l.text).toBe(`your iPhone tried @${70 * MIN}: no photo came through`);
    expect(l.warn).toBe(true);
  });
});

describe("readSignals", () => {
  it("reads the server's dates and drops junk", () => {
    const s = readSignals({
      lastPush: "2026-10-25T21:00:00.000Z",
      lastCheckIn: "nope",
      problem: { at: "2026-10-25T21:05:00.000Z", message: "x" },
      refusedAt: null,
    });
    expect(s.lastPush).toBe(Date.parse("2026-10-25T21:00:00.000Z"));
    expect(s.lastCheckIn).toBeNull();
    expect(s.problem?.message).toBe("x");
    expect(s.refusedAt).toBeNull();
  });

  it("drops a problem with no message", () => {
    expect(readSignals({ problem: { at: "2026-10-25T21:05:00.000Z" } }).problem).toBeNull();
  });
});
