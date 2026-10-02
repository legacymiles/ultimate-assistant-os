import { describe, expect, it } from "vitest";
import {
  describeReview,
  matchEntry,
  normalise,
  normaliseDate,
  normaliseMoney,
  normaliseText,
  review,
  sameValue,
  summarise,
} from "./diff";
import { FIELD_BY_KEY, type GroupEntry, type LifeRecord } from "./types";
import type { EntryProposal, FieldProposal } from "./extract";

const def = (key: string) => FIELD_BY_KEY.get(key)?.field;

const record = (fields: Record<string, string> = {}, groups: Record<string, GroupEntry[]> = {}): LifeRecord => ({
  version: 1,
  fields: Object.fromEntries(
    Object.entries(fields).map(([k, value]) => [k, { value, updatedAt: "2026-10-02T00:00:00Z", source: "you" as const }]),
  ),
  groups,
  updatedAt: "2026-10-02T00:00:00Z",
});

const field = (key: string, value: string): FieldProposal => ({
  kind: "field",
  key,
  label: key,
  value,
  because: "printed on the page",
  sensitive: false,
});

const entry = (group: string, values: Record<string, string>): EntryProposal => ({
  kind: "entry",
  group,
  groupLabel: group,
  label: group,
  values,
  because: "listed on the page",
});

const held = (id: string, values: Record<string, string>): GroupEntry => ({
  id,
  values,
  updatedAt: "2026-10-02T00:00:00Z",
  source: "you",
});

describe("normalising a phone number", () => {
  it("treats every way of writing one number as the same number", () => {
    // Without this, a scan reports the owner's own phone number as a conflict
    // on every page that shows it.
    const forms = ["(555) 123-4567", "555-123-4567", "5551234567", "+1 555 123 4567", "1-555-123-4567"];
    for (const a of forms) for (const b of forms) expect(sameValue(a, b, def("phone_mobile"))).toBe(true);
  });

  it("still tells two different numbers apart", () => {
    expect(sameValue("(555) 123-4567", "(555) 123-4568", def("phone_mobile"))).toBe(false);
  });
});

describe("normalising an address", () => {
  it("knows St is Street and Apt is Apartment", () => {
    expect(sameValue("123 Main St", "123 Main Street", def("address_line1"))).toBe(true);
    expect(sameValue("Apt 4B", "Apartment 4B", def("address_line2"))).toBe(true);
    expect(sameValue("88 N Oak Blvd", "88 North Oak Boulevard", def("address_line1"))).toBe(true);
  });

  it("is not fooled into merging two different addresses", () => {
    expect(sameValue("123 Main St", "124 Main St", def("address_line1"))).toBe(false);
  });

  it("ignores case, punctuation and doubled spaces", () => {
    expect(normaliseText("  123  MAIN st. ")).toBe("123 main street");
  });
});

describe("normalising a date", () => {
  it("reads every unambiguous format as one date", () => {
    expect(normaliseDate("1990-01-02")).toBe("1990-01-02");
    expect(normaliseDate("1990-1-2")).toBe("1990-01-02");
    expect(normaliseDate("31/01/1990")).toBe("1990-01-31");
    expect(normaliseDate("01/31/1990")).toBe("1990-01-31");
    expect(normaliseDate("2 Jan 1990")).toBe("1990-01-02");
    expect(normaliseDate("January 2, 1990")).toBe("1990-01-02");
  });

  it("REFUSES to guess between 03/04 and 04/03", () => {
    // Calling an ambiguous pair "the same" silently approves a wrong date of
    // birth. Calling it a conflict merely asks — which is the right way round.
    expect(sameValue("03/04/1990", "1990-04-03", def("dob"))).toBe(false);
  });

  it("falls back to the raw text rather than throwing on nonsense", () => {
    expect(normaliseDate("sometime in the spring")).toBe("sometime in the spring");
  });
});

describe("normalising money", () => {
  it("ignores the currency symbol, the commas and a trailing .00", () => {
    expect(normaliseMoney("$1,240.00")).toBe("1240");
    expect(sameValue("$1,240.00", "1240", def("monthly_gross"))).toBe(true);
  });

  it("keeps real pence", () => {
    expect(sameValue("1240.50", "1240", def("monthly_gross"))).toBe(false);
  });
});

describe("normalise", () => {
  it("lower-cases an email", () => {
    expect(sameValue("Jack@Example.COM", "jack@example.com", def("email"))).toBe(true);
  });

  it("treats an empty value as matching nothing, rather than matching everything", () => {
    expect(sameValue("", "", def("email"))).toBe(false);
    expect(sameValue("x", "", def("email"))).toBe(false);
  });

  it("compares a government number on its digits", () => {
    expect(sameValue("123-45-6789", "123456789", def("ssn"))).toBe(true);
  });

  it("handles a field it has never heard of without throwing", () => {
    expect(normalise("Anything", undefined)).toBe("anything");
  });
});

describe("review — what is actually new", () => {
  it("offers something the record does not have, ticked", () => {
    const [r] = review([field("blood_type_unknown_key", "O+"), field("city", "Leeds")], record());
    expect(r.verdict).toBe("new");
    expect(r.chosen).toBe(true);
  });

  it("hides what it already knows, however it was written", () => {
    // The owner's whole ask: "of course it will know my name, address, DOB".
    const result = review([field("phone_mobile", "(555) 123-4567")], record({ phone_mobile: "5551234567" }));
    expect(result[0].verdict).toBe("same");
    expect(result[0].chosen).toBe(false);
  });

  it("flags a real disagreement and NEVER pre-ticks it", () => {
    // Overwriting a fact the owner typed is a decision, not a default.
    const [r] = review([field("city", "Manchester")], record({ city: "Leeds" }));
    expect(r.verdict).toBe("conflict");
    expect(r.current).toBe("Leeds");
    expect(r.chosen).toBe(false);
  });

  it("puts conflicts first, then new, then the known", () => {
    const result = review(
      [field("city", "Leeds"), field("state", "Yorkshire"), field("postal_code", "LS1 4AP")],
      record({ city: "Leeds", state: "Lancashire" }),
    );
    expect(result.map((r) => r.verdict)).toEqual(["conflict", "new", "same"]);
  });
});

describe("review — repeated entries", () => {
  const jobs = [held("j1", { employer: "Kroger", title: "Cashier", start: "2023-04-01" })];

  it("recognises a job it already has, so re-scanning does not duplicate it", () => {
    // The single most annoying failure this feature could have.
    const [r] = review([entry("jobs", { employer: "Kroger", title: "Cashier" })], record({}, { jobs }));
    expect(r.verdict).toBe("same");
    expect(r.matchedId).toBe("j1");
  });

  it("matches through a different spelling of the same employer", () => {
    const [r] = review([entry("jobs", { employer: "KROGER ", title: "cashier" })], record({}, { jobs }));
    expect(r.verdict).toBe("same");
  });

  it("offers a genuinely different job as new", () => {
    const [r] = review([entry("jobs", { employer: "Aldi", title: "Cashier" })], record({}, { jobs }));
    expect(r.verdict).toBe("new");
    expect(r.chosen).toBe(true);
  });

  it("calls an extra detail an ADDITION, not a disagreement", () => {
    // Adding a supervisor to a job you already have destroys nothing, so
    // labelling it "disagrees" would make the owner hesitate over something
    // purely additive — and teach them the word does not mean what it says.
    const [r] = review(
      [entry("jobs", { employer: "Kroger", title: "Cashier", supervisor: "Dana" })],
      record({}, { jobs }),
    );
    expect(r.verdict).toBe("adds");
    expect(r.chosen).toBe(true);
    expect(r.matchedId).toBe("j1");
    expect(r.current).toContain("Kroger");
  });

  it("still calls a CONTRADICTED detail a disagreement, and does not pre-tick it", () => {
    const [r] = review([entry("jobs", { employer: "Kroger", title: "Manager" })], record({}, { jobs }));
    expect(r.verdict).toBe("new");

    // Same job by employer alone would be a conflict on title; here the
    // identity itself differs, so it is a different job. Prove the conflict
    // path with a group identified by one field.
    const [h] = review(
      [entry("household_members", { name: "Ada", relation: "sister" })],
      record({}, { household_members: [held("h1", { name: "Ada", relation: "cousin" })] }),
    );
    expect(h.verdict).toBe("conflict");
    expect(h.chosen).toBe(false);
  });

  it("matches a household member by name and a school by school", () => {
    expect(
      matchEntry("household_members", { name: "Ada Lovelace" }, [held("h1", { name: "ada lovelace" })]),
    ).not.toBeNull();
    expect(matchEntry("education", { school: "Leeds College" }, [held("e1", { school: "Leeds College" })])).not.toBeNull();
  });

  it("does not match on nothing, when neither side has the identifying field", () => {
    expect(matchEntry("jobs", { pay: "12" }, [held("j1", { pay: "12" })])).toBeNull();
  });

  it("treats an unknown group as never matching rather than guessing", () => {
    expect(matchEntry("not_a_group", { a: "1" }, [held("x", { a: "1" })])).toBeNull();
  });
});

describe("summarise", () => {
  const result = review(
    [field("city", "Manchester"), field("postal_code", "LS1 4AP"), field("state", "Yorkshire")],
    record({ city: "Leeds", state: "Yorkshire" }),
  );

  it("separates what needs attention from what does not", () => {
    const s = summarise(result);
    expect(s.conflicts).toBe(1);
    expect(s.fresh).toBe(1);
    expect(s.known).toBe(1);
    expect(s.toShow).toHaveLength(2);
    expect(s.hidden).toHaveLength(1);
  });
});

describe("describeReview", () => {
  it("says plainly when it learned nothing, and why", () => {
    const known = review([field("city", "Leeds")], record({ city: "Leeds" }));
    expect(describeReview(summarise(known))).toContain("already knew all 1");
  });

  it("says plainly when nothing on screen was recognisable at all", () => {
    expect(describeReview(summarise([]))).toContain("matched anything it keeps");
  });

  it("counts the new and the disagreements separately", () => {
    const mixed = review(
      [field("city", "Manchester"), field("postal_code", "LS1 4AP")],
      record({ city: "Leeds" }),
    );
    const line = describeReview(summarise(mixed));
    expect(line).toContain("1 new");
    expect(line).toContain("disagrees");
  });
});
