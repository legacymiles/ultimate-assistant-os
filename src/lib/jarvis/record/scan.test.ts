import { describe, expect, it } from "vitest";
import { cleanProposals } from "./extract";
import { describeReview, review, summarise } from "./diff";
import type { GroupEntry, LifeRecord } from "./types";

// ---------------------------------------------------------------------------
// The real thing, end to end.
//
// This fixture is not invented: it is the exact JSON the extractor returned for
// a screenshot of a clinic intake form, captured while building the feature.
// Hand-written proposals test what you imagined the model does; this tests what
// it actually did, including the shapes that only turn up in practice —
// "O negative" arriving as the choice value `O-`, a middle initial with its
// full stop, a phone number in brackets.
// ---------------------------------------------------------------------------

const MODEL_REPLY = {
  document: "Patient intake form",
  note: "",
  fields: [
    { key: "legal_last", value: "OKAFOR", because: "printed 'OKAFOR, JAMES T.'" },
    { key: "legal_first", value: "JAMES", because: "printed 'OKAFOR, JAMES T.'" },
    { key: "legal_middle", value: "T.", because: "printed 'OKAFOR, JAMES T.'" },
    { key: "dob", value: "1988-03-14", because: "'Date of birth: 14 March 1988'" },
    { key: "phone_mobile", value: "(555) 204-9981", because: "'Mobile: (555) 204-9981'" },
    { key: "email", value: "james.okafor@example.com", because: "'Email: james.okafor@example.com'" },
    { key: "address_line1", value: "1180 Castle Rd", because: "'Home address: 1180 Castle Rd'" },
    { key: "city", value: "Leeds", because: "'City / State: Leeds / Yorkshire'" },
    { key: "state", value: "Yorkshire", because: "'City / State: Leeds / Yorkshire'" },
    { key: "postal_code", value: "LS7 3QW", because: "'Postal code: LS7 3QW'" },
    { key: "blood_type", value: "O-", because: "'Blood type: O negative'" },
    { key: "insurance_carrier", value: "Pinnacle Health", because: "'Insurance carrier: Pinnacle Health'" },
    { key: "insurance_member_id", value: "PH-4482-11", because: "'Member ID: PH-4482-11'" },
    { key: "insurance_group", value: "GRP-99120", because: "'Group number: GRP-99120'" },
    { key: "allergies", value: "Penicillin (rash)", because: "'Allergies: Penicillin (rash)'" },
    { key: "emergency_name", value: "Ada Okafor", because: "'Emergency contact: Ada Okafor, sister'" },
    { key: "emergency_relation", value: "sister", because: "'Emergency contact: Ada Okafor, sister'" },
    { key: "emergency_phone", value: "(555) 771-0043", because: "'Emergency contact: … (555) 771-0043'" },
  ],
  entries: [
    {
      group: "jobs",
      values: { employer: "Kroger", title: "Cashier", start: "April 2023" },
      because: "'Employer: Kroger - Cashier, since April 2023'",
    },
  ],
};

const record = (fields: Record<string, string> = {}, groups: Record<string, GroupEntry[]> = {}): LifeRecord => ({
  version: 1,
  fields: Object.fromEntries(
    Object.entries(fields).map(([k, value]) => [k, { value, updatedAt: "2026-10-02T00:00:00Z", source: "you" as const }]),
  ),
  groups,
  updatedAt: "2026-10-02T00:00:00Z",
});

describe("a real screen scan", () => {
  const extracted = cleanProposals(MODEL_REPLY);

  it("keeps every field the model read, because they are all real record keys now", () => {
    // Before the health section existed, blood type vanished entirely and the
    // insurance member ID was forced into the MEDICAID id field — the model
    // puts a value in the nearest slot it is offered, so a missing field is
    // not a gap, it is a wrong answer.
    expect(extracted.proposals).toHaveLength(19);
    const keys = extracted.proposals.filter((p) => p.kind === "field").map((p) => p.key);
    expect(keys).toContain("blood_type");
    expect(keys).toContain("insurance_carrier");
    expect(keys).toContain("insurance_member_id");
    expect(keys).not.toContain("medicaid_id");
  });

  it("marks the member ID sensitive, so it is never pre-ticked or shown in the clear", () => {
    const id = extracted.proposals.find((p) => p.kind === "field" && p.key === "insurance_member_id");
    expect(id && id.kind === "field" && id.sensitive).toBe(true);
  });

  it("offers everything when the profile is empty", () => {
    const summary = summarise(review(extracted.proposals, record()));
    expect(summary.fresh).toBe(19);
    expect(summary.conflicts).toBe(0);
    expect(summary.known).toBe(0);
  });

  it("goes quiet on a second scan of the same screen — the whole point", () => {
    // "Of course it will know my name, address, DOB." A scanner that proposes
    // those back every time is one nobody reads.
    const filled = record(
      Object.fromEntries(
        extracted.proposals.filter((p) => p.kind === "field").map((p) => [p.key, p.kind === "field" ? p.value : ""]),
      ),
      { jobs: [{ id: "j1", values: { employer: "Kroger", title: "Cashier" }, updatedAt: "", source: "you" }] },
    );
    const summary = summarise(review(extracted.proposals, filled));
    expect(summary.fresh).toBe(0);
    expect(summary.conflicts).toBe(0);
    // The job is an ADDITION, not a repeat: the record has the employer and
    // title, and the screen also carries a start date it does not.
    expect(summary.additions).toBe(1);
    expect(summary.known).toBe(18);
  });

  it("stays quiet even when the profile wrote the same facts differently", () => {
    // The record holds a plain phone number, an ISO-free date and a spelled-out
    // street; the form shows brackets, a written month and an abbreviation.
    const differently = record({
      phone_mobile: "5552049981",
      dob: "14/03/1988",
      address_line1: "1180 Castle Road",
      email: "James.Okafor@Example.com",
    });
    const result = review(extracted.proposals, differently);
    const byKey = new Map(result.map((r) => [r.proposal.kind === "field" ? r.proposal.key : "", r.verdict]));
    expect(byKey.get("phone_mobile")).toBe("same");
    expect(byKey.get("dob")).toBe("same");
    expect(byKey.get("address_line1")).toBe("same");
    expect(byKey.get("email")).toBe("same");
  });

  it("raises a real disagreement, and does not pre-tick it", () => {
    const moved = record({ city: "Manchester", postal_code: "LS7 3QW" });
    const result = review(extracted.proposals, moved);
    const city = result.find((r) => r.proposal.kind === "field" && r.proposal.key === "city")!;
    expect(city.verdict).toBe("conflict");
    expect(city.current).toBe("Manchester");
    expect(city.chosen).toBe(false);
    // And the postcode it already has is not raised at all.
    const post = result.find((r) => r.proposal.kind === "field" && r.proposal.key === "postal_code")!;
    expect(post.verdict).toBe("same");
  });

  it("does not add a second copy of a job it already has", () => {
    const withJob = record({}, { jobs: [{ id: "j1", values: { employer: "KROGER", title: "cashier" }, updatedAt: "", source: "you" }] });
    const job = review(extracted.proposals, withJob).find((r) => r.proposal.kind === "entry")!;
    // Matched, so it UPDATES rather than duplicating — and because it only
    // brings a start date the entry lacks, it is an addition, not a conflict.
    expect(job.matchedId).toBe("j1");
    expect(job.verdict).toBe("adds");
    expect(job.chosen).toBe(true);
  });

  it("drops any key that is not a real record field, so a password has nowhere to land", () => {
    // Safety by construction rather than by filtering: there is no password
    // field among the Record's keys, so a credential cannot become a proposal
    // however the model phrases it.
    const sneaky = cleanProposals({
      document: "a login page",
      fields: [
        { key: "password", value: "hunter2", because: "the password box" },
        { key: "passwd", value: "hunter2", because: "the password box" },
        { key: "city", value: "Leeds", because: "the city box" },
      ],
    });
    expect(sneaky.proposals).toHaveLength(1);
    expect(sneaky.proposals[0].kind === "field" && sneaky.proposals[0].key).toBe("city");
  });
});
