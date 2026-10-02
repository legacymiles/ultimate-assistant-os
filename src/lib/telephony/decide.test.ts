import { describe, expect, it } from "vitest";
import {
  decide,
  DECLINE_REASON,
  defaultPolicy,
  describeVerdict,
  emptyCallState,
  inQuietHours,
  recordCall,
  urgencyOf,
  type CallPolicy,
  type CallState,
} from "./decide";
import type { JarvisUpdate, UpdateSource } from "@/lib/jarvis/updates";

/** Midday, so the default quiet hours are not in play unless a test wants them. */
const NOW = new Date("2026-10-02T12:00:00").getTime();

const update = (patch: Partial<JarvisUpdate> & { id: string; source: UpdateSource }): JarvisUpdate => ({
  title: patch.id,
  detail: "",
  at: new Date(NOW).toISOString(),
  when: "now",
  ...patch,
});

/** A calendar row starting `mins` from now. */
const soon = (mins: number, id = "cal"): JarvisUpdate =>
  update({ id, source: "calendar", title: "Dentist", startsAt: new Date(NOW + mins * 60_000).toISOString() });

const policy = (patch: Partial<CallPolicy> = {}): CallPolicy => ({
  ...defaultPolicy(),
  enabled: true,
  ...patch,
});

const run = (updates: JarvisUpdate[], patch: Partial<CallPolicy> = {}, state: CallState = emptyCallState(), extra = {}) =>
  decide({ updates, policy: policy(patch), state, now: NOW, providerReady: true, ...extra });

describe("urgency — steep on purpose, so a call stays rare", () => {
  it("rises as an appointment gets closer", () => {
    expect(urgencyOf(soon(15), NOW)).toBeGreaterThan(urgencyOf(soon(40), NOW));
    expect(urgencyOf(soon(40), NOW)).toBeGreaterThan(urgencyOf(soon(120), NOW));
  });

  it("is zero for something that has already started, which a call cannot help", () => {
    expect(urgencyOf(soon(-5), NOW)).toBe(0);
  });

  it("is zero for a calendar row with no start time at all", () => {
    expect(urgencyOf(update({ id: "x", source: "calendar" }), NOW)).toBe(0);
  });

  it("treats a pending action as worth interrupting for", () => {
    expect(urgencyOf(update({ id: "a", source: "actions" }), NOW)).toBeGreaterThan(0.6);
  });

  it("only cares about the spend row that stops everything working", () => {
    const outOfCredit = update({ id: "s1", source: "spend", title: "Out of credit" });
    const ordinary = update({ id: "s2", source: "spend", title: "Spent 40p today" });
    expect(urgencyOf(outOfCredit, NOW)).toBeGreaterThan(0.6);
    expect(urgencyOf(ordinary, NOW)).toBeLessThan(0.3);
  });

  it("never thinks a photo or a list item is worth a phone call", () => {
    for (const source of ["photos", "lists", "memory"] as UpdateSource[]) {
      expect(urgencyOf(update({ id: source, source }), NOW)).toBeLessThan(defaultPolicy().minUrgency);
    }
  });
});

describe("quiet hours", () => {
  it("handles a window that crosses midnight", () => {
    // Getting this wrong means either never calling, or calling at 4am.
    expect(inQuietHours(22, 21, 8)).toBe(true);
    expect(inQuietHours(3, 21, 8)).toBe(true);
    expect(inQuietHours(12, 21, 8)).toBe(false);
    expect(inQuietHours(8, 21, 8)).toBe(false);
    expect(inQuietHours(21, 21, 8)).toBe(true);
  });

  it("handles an ordinary daytime window too", () => {
    expect(inQuietHours(10, 9, 17)).toBe(true);
    expect(inQuietHours(20, 9, 17)).toBe(false);
  });

  it("treats an empty window as no quiet hours", () => {
    expect(inQuietHours(3, 9, 9)).toBe(false);
  });
});

describe("deciding to call", () => {
  it("rings about the one imminent thing", () => {
    const v = run([soon(15)]);
    expect(v.call?.id).toBe("cal");
    expect(v.reason).toBeNull();
  });

  it("stays silent when nothing is urgent enough", () => {
    const v = run([soon(300)]);
    expect(v.call).toBeNull();
    expect(v.judged[0].decline).toBe("not-urgent");
  });

  it("calls about ONE thing, and says the others lost", () => {
    // A digest of five things read down the phone is worse than no call.
    const v = run([soon(15, "a"), soon(18, "b"), update({ id: "c", source: "actions" })]);
    expect(v.call?.id).toBe("a");
    const others = v.judged.filter((j) => j.update.id !== "a");
    expect(others.every((j) => j.decline === "outranked")).toBe(true);
  });

  it("decides the same way twice on the same feed", () => {
    const feed = [soon(15, "b"), soon(15, "a")];
    expect(run(feed).call?.id).toBe(run(feed).call?.id);
  });
});

describe("the reasons not to call", () => {
  it("will not ring inside quiet hours", () => {
    const night = new Date("2026-10-02T23:30:00").getTime();
    const v = decide({
      updates: [soon(15)],
      policy: policy(),
      state: emptyCallState(),
      now: night,
      providerReady: true,
    });
    expect(v.call).toBeNull();
    expect(v.reason).toBe("quiet-hours");
  });

  it("will not ring twice in quick succession", () => {
    const state: CallState = { placedAt: [new Date(NOW - 5 * 60_000).toISOString()], calledAbout: [] };
    expect(run([soon(15)], {}, state).reason).toBe("cooldown");
  });

  it("stops at the daily limit", () => {
    const state: CallState = {
      placedAt: [1, 2, 3].map((h) => new Date(NOW - h * 60 * 60_000).toISOString()),
      calledAbout: [],
    };
    expect(run([soon(15)], { maxPerDay: 3, cooldownMinutes: 0 }, state).reason).toBe("daily-cap");
  });

  it("counts only today's calls toward the limit", () => {
    const yesterday: CallState = {
      placedAt: [1, 2, 3].map((d) => new Date(NOW - d * 24 * 60 * 60_000).toISOString()),
      calledAbout: [],
    };
    expect(run([soon(15)], { maxPerDay: 3, cooldownMinutes: 0 }, yesterday).call).not.toBeNull();
  });

  it("does not ring about something already called about", () => {
    const state: CallState = { placedAt: [], calledAbout: ["cal"] };
    const v = run([soon(15)], {}, state);
    expect(v.call).toBeNull();
    expect(v.judged[0].decline).toBe("already-called");
  });

  it("DOES NOT RING when Jarvis was open in front of you", () => {
    // The commonest false positive by a distance: ringing someone about a
    // thing that is on the screen they are looking at.
    const v = run([soon(15)], {}, emptyCallState(), {
      lastSeenAt: new Date(NOW - 60_000).toISOString(),
    });
    expect(v.call).toBeNull();
    expect(v.reason).toBe("you-were-here");
  });

  it("rings again once you have been away long enough", () => {
    const v = run([soon(15)], {}, emptyCallState(), {
      lastSeenAt: new Date(NOW - 60 * 60_000).toISOString(),
    });
    expect(v.call).not.toBeNull();
  });

  it("will not ring about a source the owner has not allowed", () => {
    const v = run([update({ id: "l", source: "lists" })], { sources: ["calendar"] });
    expect(v.judged[0].decline).toBe("source-off");
  });

  it("will not ring at all while the feature is switched off", () => {
    const v = run([soon(15)], { enabled: false });
    expect(v.call).toBeNull();
  });

  it("gives the most SPECIFIC true reason, not just the blanket one", () => {
    // Inside quiet hours AND about a thing already called about: the log should
    // say the specific thing, or it teaches the owner nothing.
    const night = new Date("2026-10-02T23:30:00").getTime();
    const v = decide({
      updates: [soon(15)],
      policy: policy(),
      state: { placedAt: [], calledAbout: ["cal"] },
      now: night,
      providerReady: true,
    });
    expect(v.judged[0].decline).toBe("already-called");
  });
});

describe("dormant — the mode this ships in", () => {
  it("judges everything exactly as it would, and declines for want of a provider", () => {
    // The whole point of shipping with no key: watch what it WOULD do for a
    // week and tune the rules before spending anything.
    const v = decide({
      // An imminent appointment, a distant one, and a photo batch.
      updates: [soon(15), soon(400, "far"), update({ id: "p", source: "photos" })],
      policy: policy(),
      state: emptyCallState(),
      now: NOW,
      providerReady: false,
    });
    expect(v.call).toBeNull();
    expect(v.reason).toBe("no-provider");

    // The reasoning still happened, which is what makes the log worth reading —
    // and each row gets the most SPECIFIC true reason rather than all three
    // being blamed on the missing provider.
    expect(v.judged).toHaveLength(3);
    expect(v.judged.find((j) => j.update.id === "p")?.decline).toBe("source-off");
    expect(v.judged.find((j) => j.update.id === "far")?.decline).toBe("not-urgent");
    expect(v.judged.find((j) => j.update.id === "cal")?.decline).toBe("no-provider");
  });

  it("keeps the urgency it worked out, so the log can be read", () => {
    const v = decide({
      updates: [soon(15)],
      policy: policy(),
      state: emptyCallState(),
      now: NOW,
      providerReady: false,
    });
    expect(v.judged[0].urgency).toBeGreaterThan(0.9);
  });
});

describe("recordCall", () => {
  it("remembers when and about what", () => {
    const next = recordCall(emptyCallState(), soon(15), NOW);
    expect(next.placedAt).toHaveLength(1);
    expect(next.calledAbout).toEqual(["cal"]);
  });

  it("does not list the same thing twice", () => {
    const once = recordCall(emptyCallState(), soon(15), NOW);
    const twice = recordCall(once, soon(15), NOW);
    expect(twice.calledAbout).toEqual(["cal"]);
  });
});

describe("the words", () => {
  it("names every reason in language the owner can act on", () => {
    for (const reason of Object.keys(DECLINE_REASON) as (keyof typeof DECLINE_REASON)[]) {
      expect(DECLINE_REASON[reason].length).toBeGreaterThan(5);
      expect(DECLINE_REASON[reason]).not.toMatch(/[A-Z_]{4,}/);
    }
  });

  it("says what it would do, or why it would not", () => {
    expect(describeVerdict(run([soon(15)]))).toContain("Would ring you about");
    expect(describeVerdict(run([soon(15)], { enabled: false }))).toContain("No call");
    expect(describeVerdict(run([]))).toBe("Nothing to consider.");
  });
});

describe("the default policy", () => {
  it("starts switched off, and narrow", () => {
    // Starting permissive is how a feature like this gets switched off for
    // good after one bad week.
    const p = defaultPolicy();
    expect(p.enabled).toBe(false);
    expect(p.sources).toEqual(["calendar", "actions"]);
    expect(p.maxPerDay).toBeLessThanOrEqual(3);
    expect(p.skipIfRecentlySeen).toBe(true);
  });
});
