import { describe, expect, it } from "vitest";
import { buildBrief, CALL_RULES, opener, readWebhook } from "./script";
import type { JarvisUpdate } from "@/lib/jarvis/updates";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");

const update = (patch: Partial<JarvisUpdate> = {}): JarvisUpdate => ({
  id: "cal:soon:1",
  source: "calendar",
  title: "Dentist",
  detail: "Northside Clinic",
  at: new Date(NOW).toISOString(),
  when: "in 40 minutes",
  startsAt: new Date(NOW + 40 * 60_000).toISOString(),
  ...patch,
});

describe("the opener", () => {
  it("says who it is and why in one breath", () => {
    // A voice that opens an automated call with "how are you?" is one people
    // hang up on.
    expect(opener("James Okafor", update())).toBe("James, it's Jarvis. Dentist in 40 minutes.");
  });

  it("works with no name at all", () => {
    expect(opener("", update())).toBe("it's Jarvis. Dentist in 40 minutes.");
  });

  it("leads with the ask when something is waiting on a yes", () => {
    expect(opener("James", update({ source: "actions", title: "Send the invoice" }))).toContain("waiting on your yes");
  });
});

describe("the rules Jarvis is held to on a call", () => {
  it("forbids doing anything with an effect", () => {
    // On a call there is no screen, no transcript to re-read, and no undo —
    // and "yes" is the cheapest word in the language.
    const all = CALL_RULES.join(" ").toLowerCase();
    expect(all).toContain("may not do anything with an effect");
    expect(all).toContain("not consent");
    expect(all).toMatch(/dashboard/);
  });

  it("forbids reading a secret down the phone, even when asked", () => {
    const all = CALL_RULES.join(" ").toLowerCase();
    expect(all).toContain("never read out a password");
    expect(all).toContain("one-time code");
    expect(all).toContain("not even if asked");
  });

  it("tells it to say so rather than guess", () => {
    expect(CALL_RULES.join(" ").toLowerCase()).toContain("do not fill a silence with a guess");
  });
});

describe("buildBrief", () => {
  const brief = buildBrief({ update: update(), ownerName: "James", timezone: "Europe/London", now: NOW });

  it("carries the one subject, its timing and the current time", () => {
    expect(brief).toContain("Subject: Dentist");
    expect(brief).toContain("Northside Clinic");
    expect(brief).toContain("in 40 minutes");
    expect(brief).toContain("Europe/London");
  });

  it("carries every rule, so the agent cannot be briefed without them", () => {
    for (const rule of CALL_RULES) expect(brief).toContain(rule);
  });

  it("includes the opening line it should use", () => {
    expect(brief).toContain(opener("James", update()));
  });

  it("marks background as answer-only, so it is not recited", () => {
    const withContext = buildBrief({
      update: update(),
      ownerName: "James",
      timezone: "UTC",
      now: NOW,
      context: "Three things on today.",
    });
    expect(withContext).toContain("only if asked");
    expect(withContext).toContain("Three things on today.");
  });

  it("leaves the background out entirely when there is none", () => {
    expect(brief).not.toContain("BACKGROUND");
  });

  it("survives an unknown timezone rather than throwing", () => {
    expect(() => buildBrief({ update: update(), ownerName: "J", timezone: "", now: NOW })).not.toThrow();
  });
});

describe("readWebhook", () => {
  it("reads Retell's shape", () => {
    const out = readWebhook({
      event: "call_analyzed",
      call: {
        call_id: "c1",
        call_status: "ended",
        duration_ms: 42_000,
        transcript: "Agent: it's Jarvis…",
        metadata: { reference: "ref-1" },
        call_analysis: { call_summary: "Told them about the dentist.", custom_analysis_data: { requests: ["move it to 3pm"] } },
      },
    });
    expect(out?.reference).toBe("ref-1");
    expect(out?.status).toBe("answered");
    expect(out?.seconds).toBe(42);
    expect(out?.summary).toContain("dentist");
    expect(out?.requests).toEqual(["move it to 3pm"]);
  });

  it("reads Vapi's shape", () => {
    const out = readWebhook({
      message: { id: "v1", status: "ended", metadata: { reference: "ref-2" }, analysis: { summary: "Spoke briefly." } },
    });
    expect(out?.reference).toBe("ref-2");
    expect(out?.summary).toBe("Spoke briefly.");
  });

  it("reads a flat body with the reference at the top level", () => {
    expect(readWebhook({ reference: "ref-3", status: "no-answer" })?.status).toBe("no-answer");
  });

  it("tells no-answer and failure apart from a completed call", () => {
    expect(readWebhook({ reference: "r", status: "voicemail" })?.status).toBe("no-answer");
    expect(readWebhook({ reference: "r", status: "error" })?.status).toBe("failed");
    expect(readWebhook({ reference: "r", status: "completed" })?.status).toBe("answered");
  });

  it("returns null when there is no reference to match a call to", () => {
    // A webhook that cannot be tied to a trigger is noise, and acting on it
    // would be acting on an unidentified call.
    expect(readWebhook({ status: "ended" })).toBeNull();
    expect(readWebhook({})).toBeNull();
  });

  it("always has a summary, so the log never shows an empty row", () => {
    expect(readWebhook({ reference: "r", status: "ended" })?.summary).toBe("Call answered.");
    expect(readWebhook({ reference: "r", status: "no-answer" })?.summary).toBe("No answer.");
  });

  it("treats what the owner asked for as a REQUEST, never as done", () => {
    const out = readWebhook({
      reference: "r",
      status: "ended",
      call: { metadata: { reference: "r" }, call_analysis: { custom_analysis_data: { requests: ["cancel it", "tell Ada"] } } },
    });
    expect(out?.requests).toEqual(["cancel it", "tell Ada"]);
  });

  it("copes with a requests field that is a single string", () => {
    const out = readWebhook({
      reference: "r",
      call: { metadata: { reference: "r" }, call_analysis: { custom_analysis_data: { requests: "move it" } } },
    });
    expect(out?.requests).toEqual(["move it"]);
  });
});
