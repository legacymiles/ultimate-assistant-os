import { describe, expect, it } from "vitest";
import { NO_SIGNALS, phoneLine, readSignals, sweepReport } from "./phoneStatus";

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

  it("names the URL block that has the old link", () => {
    const l = phoneLine({ ...NO_SIGNALS, refusedAt: 50 * MIN, refusedWhere: "bookmark" }, since);
    expect(l.text).toContain("top URL block");
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

describe("phoneLine — what the phone still has", () => {
  const run = (sweep: { at: number; checked: number; removed: number }) =>
    phoneLine({ ...NO_SIGNALS, lastPush: 100 * MIN, lastCheckIn: 100 * MIN, sweep }, since);

  it("says what the report covered when nothing needed deleting", () => {
    const l = run({ at: 100 * MIN, checked: 38, removed: 0 });
    expect(l.text).toBe(`last photo from iPhone @${100 * MIN} · 38 still on the phone, nothing to delete`);
    expect(l.warn).toBe(false);
  });

  it("says how many were deleted here", () => {
    expect(run({ at: 100 * MIN, checked: 38, removed: 3 }).text).toContain("38 still on the phone, 3 deleted here");
  });

  it("warns when the report is too thin to be a camera roll", () => {
    // The shape that emptied the queue: Combine Text reading one photo.
    const l = run({ at: 100 * MIN, checked: 1, removed: 0 });
    expect(l.text).toContain("only 1 photo still on it");
    expect(l.text).toContain("Combine Text");
    expect(l.warn).toBe(true);
  });

  it("ignores a report from an older run", () => {
    const l = run({ at: 80 * MIN, checked: 38, removed: 0 });
    expect(l.text).toBe(`last photo from iPhone @${100 * MIN}`);
  });

  it("keeps a refused link ahead of the report", () => {
    const l = phoneLine(
      { ...NO_SIGNALS, lastPush: 100 * MIN, refusedAt: 101 * MIN, refusedWhere: "still-on-phone", sweep: { at: 100 * MIN, checked: 1, removed: 0 } },
      since,
    );
    expect(l.text).toContain("old link");
  });

  it("reads the report off the server's payload", () => {
    const s = readSignals({ sweep: { at: "2026-10-25T21:00:00.000Z", checked: 38, removed: 2 } });
    expect(s.sweep).toEqual({ at: Date.parse("2026-10-25T21:00:00.000Z"), checked: 38, removed: 2 });
    expect(readSignals({ sweep: { at: "nope", checked: 3, removed: 0 } }).sweep).toBeNull();
  });
});

describe("sweepReport — the row Camera Autopilot shows", () => {
  const at = 100 * MIN;

  it("is nothing at all until the phone has reported", () => {
    expect(sweepReport(NO_SIGNALS, since)).toBeNull();
  });

  it("says what was still there and what went", () => {
    const r = sweepReport({ ...NO_SIGNALS, sweep: { at, checked: 38, removed: 2 } }, since);
    expect(r).toEqual({ at, warn: false, text: `Phone checked @${at} · 38 photos still on it · 2 deleted here` });
  });

  it("says so when there was nothing to delete", () => {
    expect(sweepReport({ ...NO_SIGNALS, sweep: { at, checked: 38, removed: 0 } }, since)?.text).toContain("nothing to delete");
  });

  it("warns on the report that is really a miswired Shortcut", () => {
    const r = sweepReport({ ...NO_SIGNALS, sweep: { at, checked: 1, removed: 0 } }, since);
    expect(r?.warn).toBe(true);
    expect(r?.text).toContain("Combine Text");
  });

  it("keeps an old report, because when it last ran is the answer too", () => {
    // Unlike the status line, this row is not gated on the newest run: a
    // report from yesterday still answers "did my clean-up ever work?".
    expect(sweepReport({ ...NO_SIGNALS, lastPush: 999 * MIN, sweep: { at: 1 * MIN, checked: 38, removed: 0 } }, since)?.at).toBe(1 * MIN);
  });
});
