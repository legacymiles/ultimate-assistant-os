import { describe, expect, it } from "vitest";
import { recordDigest, fillTokens, hasTokens } from "./digest";
import { cleanProposals } from "./extract";
import {
  addEntry,
  coerceRecord,
  completeness,
  gaps,
  maskValue,
  removeEntry,
  setField,
  updateEntry,
} from "./store";
import { emptyRecord, FIELD_BY_KEY, isSensitive, labelForKey, parseKey, type LifeRecord } from "./types";

function filled(): LifeRecord {
  let r = emptyRecord();
  r = setField(r, "legal_first", "James");
  r = setField(r, "legal_last", "Okafor");
  r = setField(r, "dob", "1991-04-02");
  r = setField(r, "ssn", "123-45-6789");
  r = addEntry(r, "jobs", { employer: "Kroger", title: "Cashier", start: "2023-04-01" });
  return r;
}

describe("the record store", () => {
  it("drops keys that are not in the catalog", () => {
    const r = setField(emptyRecord(), "favourite_colour", "blue");
    expect(r.fields.favourite_colour).toBeUndefined();
  });

  it("removes a value rather than storing an empty string", () => {
    let r = setField(emptyRecord(), "city", "Phoenix");
    expect(r.fields.city.value).toBe("Phoenix");
    r = setField(r, "city", "   ");
    expect(r.fields.city).toBeUndefined();
  });

  it("keeps only group fields that exist, and can update and remove an entry", () => {
    let r = addEntry(emptyRecord(), "jobs", { employer: "Kroger", nonsense: "x" });
    const entry = r.groups.jobs[0];
    expect(entry.values.employer).toBe("Kroger");
    expect(entry.values.nonsense).toBeUndefined();

    r = updateEntry(r, "jobs", entry.id, { title: "Cashier" });
    expect(r.groups.jobs[0].values.title).toBe("Cashier");

    r = removeEntry(r, "jobs", entry.id);
    expect(r.groups.jobs).toHaveLength(0);
  });

  it("survives a corrupt stored blob", () => {
    const r = coerceRecord({ fields: { dob: 7, legal_first: { value: "Ada" } }, groups: { jobs: "nope" } });
    expect(r.fields.legal_first.value).toBe("Ada");
    expect(r.fields.dob).toBeUndefined();
    expect(r.groups.jobs).toBeUndefined();
  });
});

describe("gaps and completeness", () => {
  it("never counts an optional field as a gap", () => {
    const missing = gaps(emptyRecord());
    expect(missing.some((g) => g.key === "preferred_name")).toBe(false);
    expect(missing.some((g) => g.key === "legal_first")).toBe(true);
  });

  it("scopes to the kind of application, but always keeps core fields", () => {
    const job = gaps(emptyRecord(), "job");
    expect(job.some((g) => g.key === "desired_pay")).toBe(true);
    // A benefits-only field is not a job application's problem.
    expect(job.some((g) => g.key === "household_monthly_gross")).toBe(false);
    // Core is everyone's problem.
    expect(job.some((g) => g.key === "legal_last")).toBe(true);
  });

  it("reports an empty group as one gap, not one per field", () => {
    const benefits = gaps(emptyRecord(), "benefits");
    const household = benefits.filter((g) => g.key === "household_members");
    expect(household).toHaveLength(1);
  });

  it("counts a filled record as more complete than an empty one", () => {
    expect(completeness(filled()).filled).toBeGreaterThan(completeness(emptyRecord()).filled);
    expect(completeness(emptyRecord()).percent).toBe(0);
  });
});

describe("sensitive values", () => {
  it("treats an unknown key as sensitive", () => {
    expect(isSensitive("ssn")).toBe(true);
    expect(isSensitive("legal_first")).toBe(false);
    expect(isSensitive("whatever_this_is")).toBe(true);
  });

  it("shows only the last four of an SSN", () => {
    const def = FIELD_BY_KEY.get("ssn")!.field;
    expect(maskValue(def, "123-45-6789")).toBe("••• •• 6789");
  });

  it("never puts a sensitive value in the prompt", () => {
    const text = recordDigest(filled());
    expect(text).not.toContain("123-45-6789");
    expect(text).toContain("{{ssn}}");
    // The non-sensitive ones are there in full — that is the whole point.
    expect(text).toContain("Okafor");
  });

  it("does not put a sensitive group value in the prompt either", () => {
    const r = addEntry(filled(), "household_members", { name: "Ada Okafor", ssn: "987-65-4321" });
    const text = recordDigest(r);
    expect(text).not.toContain("987-65-4321");
    expect(text).toContain("{{household_members.1.ssn}}");
  });
});

describe("the digest", () => {
  it("says so plainly when there is nothing in the record", () => {
    expect(recordDigest(emptyRecord())).toContain("is empty");
  });

  it("lists what is missing so Jarvis can ask instead of guessing", () => {
    expect(recordDigest(filled())).toContain("STILL MISSING");
  });
});

describe("token substitution", () => {
  it("puts the real value back on this device", () => {
    const out = fillTokens("SSN: {{ssn}} · Name: {{legal_last}}", filled());
    expect(out.text).toBe("SSN: 123-45-6789 · Name: Okafor");
    expect(out.unresolved).toHaveLength(0);
    expect(out.filled).toContain("Social Security number");
  });

  it("resolves a token that points into a group entry", () => {
    const out = fillTokens("Employer: {{jobs.1.employer}}", filled());
    expect(out.text).toBe("Employer: Kroger");
  });

  it("leaves a token standing when nothing is behind it, rather than blanking it", () => {
    const out = fillTokens("ID: {{medicaid_id}}", filled());
    expect(out.text).toBe("ID: {{medicaid_id}}");
    expect(out.unresolved).toEqual(["{{medicaid_id}}"]);
  });

  it("detects tokens without consuming the regex's state", () => {
    expect(hasTokens("a {{ssn}} b")).toBe(true);
    expect(hasTokens("a {{ssn}} b")).toBe(true);
    expect(hasTokens("nothing here")).toBe(false);
  });
});

describe("document extraction", () => {
  it("keeps real fields and drops invented ones", () => {
    const out = cleanProposals({
      document: "Pay stub",
      fields: [
        { key: "legal_last", value: "Okafor", because: "printed OKAFOR" },
        { key: "salary_secret", value: "nope" },
        { key: "city", value: "   " },
      ],
    });
    expect(out.proposals).toHaveLength(1);
    expect(out.document).toBe("Pay stub");
  });

  it("marks a sensitive proposal so the queue can mask it", () => {
    const out = cleanProposals({ fields: [{ key: "ssn", value: "123-45-6789", because: "SSN line" }] });
    expect(out.proposals[0]).toMatchObject({ kind: "field", sensitive: true });
  });

  it("keeps a group entry and names it, and drops one with nothing usable", () => {
    const out = cleanProposals({
      entries: [
        { group: "jobs", values: { employer: "Kroger", title: "Cashier", bogus: "x" }, because: "employment section" },
        { group: "jobs", values: { bogus: "x" } },
        { group: "not_a_group", values: { employer: "X" } },
      ],
    });
    expect(out.proposals).toHaveLength(1);
    const entry = out.proposals[0];
    expect(entry.kind).toBe("entry");
    if (entry.kind === "entry") {
      expect(entry.label).toBe("Cashier — Kroger");
      expect(entry.values.bogus).toBeUndefined();
    }
  });

  it("returns nothing rather than throwing on junk", () => {
    expect(cleanProposals(null).proposals).toHaveLength(0);
    expect(cleanProposals({ fields: "no" }).proposals).toHaveLength(0);
  });
});

describe("record keys", () => {
  it("reads a plain field key", () => {
    expect(parseKey("legal_last")).toEqual({ field: "legal_last" });
    expect(labelForKey("legal_last")).toBe("Legal last name");
  });

  it("reads a group key with no particular entry — what the matcher produces", () => {
    expect(parseKey("jobs.employer")).toEqual({ groupId: "jobs", field: "employer" });
    expect(labelForKey("jobs.employer")).toBe("Work history: Employer");
  });

  it("reads a group key naming one entry — what a fill snapshot holds", () => {
    expect(parseKey("jobs.2.employer")).toEqual({ groupId: "jobs", field: "employer", index: 2 });
    expect(labelForKey("jobs.2.employer")).toBe("Work history 2: Employer");
  });

  it("refuses a key the schema does not have", () => {
    expect(parseKey("not_a_field")).toBeNull();
    expect(parseKey("not_a_group.employer")).toBeNull();
    expect(parseKey("jobs.not_a_field")).toBeNull();
    expect(parseKey("jobs.0.employer")).toBeNull();
    expect(parseKey("jobs.1.2.employer")).toBeNull();
    expect(labelForKey("nonsense")).toBeNull();
  });
});
