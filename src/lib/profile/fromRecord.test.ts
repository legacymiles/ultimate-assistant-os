import { describe, expect, it } from "vitest";
import { basicsFromRecord, draftsFromRecord } from "./fromRecord";
import { applyDrafts, buildQueue, emptyStore, pathOf, seedNodes } from "./model";
import { redactForAi } from "./redact";
import { emptyRecord, type LifeRecord } from "@/lib/jarvis/record/types";
import type { ProfileStore } from "./types";

function record(patch: Partial<LifeRecord> = {}): LifeRecord {
  return { ...emptyRecord(), ...patch };
}

function field(value: string, source: "you" | "document" | "jarvis" = "you") {
  return { value, source, updatedAt: "2026-10-01T00:00:00.000Z" };
}

function seeded(): ProfileStore {
  return { ...emptyStore(), nodes: seedNodes() };
}

describe("basics from the life record", () => {
  it("prefers the name the owner goes by, and falls back to the legal one", () => {
    const base = emptyStore().basics;
    expect(basicsFromRecord(record({ fields: { preferred_name: field("Sam"), legal_first: field("Samuel"), legal_last: field("Reed") } }), base).name).toBe("Sam");
    expect(basicsFromRecord(record({ fields: { legal_first: field("Samuel"), legal_last: field("Reed") } }), base).name).toBe("Samuel Reed");
  });

  it("fills blanks but never overwrites what the owner already typed", () => {
    const base = { ...emptyStore().basics, name: "Jack", birthday: "1990-01-01" };
    const out = basicsFromRecord(record({ fields: { preferred_name: field("Sam"), dob: field("1985-05-05"), email: field("s@example.com") } }), base);
    expect(out.name).toBe("Jack");
    expect(out.birthday).toBe("1990-01-01");
    expect(out.email).toBe("s@example.com");
  });
});

describe("drafts from the life record", () => {
  it("files each section into its own folder", () => {
    const drafts = draftsFromRecord(record({
      fields: {
        citizenship: field("US"),
        blood_type: field("O+"),
        rent_monthly: field("1800"),
        desired_title: field("Press operator"),
      },
    }));
    const paths = drafts.map((d) => d.path.join(" › "));
    expect(paths).toEqual(expect.arrayContaining([
      "Me › Identity & Documents", "Me › Health", "Money › Household", "Work › Preferences",
    ]));
  });

  it("vaults a sensitive field instead of importing it as plain text", () => {
    const drafts = draftsFromRecord(record({ fields: { ssn: field("123-45-6789"), citizenship: field("US") } }));
    const identity = drafts.find((d) => d.path.join("/") === "Me/Identity & Documents")!;
    expect(identity.fields.find((f) => /social|ssn/i.test(f.label))!.kind).toBe("secret");
    expect(identity.fields.find((f) => /^Citizenship/.test(f.label))!.kind).not.toBe("secret");
  });

  it("keeps each value's own provenance so the owner's answers arrive confirmed", () => {
    const drafts = draftsFromRecord(record({
      fields: { citizenship: field("US", "you"), birthplace: field("Austin", "jarvis"), marital_status: field("Single", "document") },
    }));
    const f = drafts[0].fields;
    expect(f.find((x) => x.value === "US")!.source).toBe("you");
    expect(f.find((x) => x.value === "Austin")!.source).toBe("ai");
    expect(f.find((x) => x.value === "Single")!.source).toBe("import");
  });

  it("assembles the scattered address pieces into one place", () => {
    const drafts = draftsFromRecord(record({
      fields: { address_line1: field("12 Main St"), city: field("Austin"), state: field("TX"), postal_code: field("78701") },
    }));
    const home = drafts.find((d) => d.path.join("/") === "Home/Property")!;
    expect(home.pack).toBe("property");
    expect(home.fields[0].value).toBe("12 Main St Austin, TX 78701");
  });

  it("turns each job into its own typed folder", () => {
    const drafts = draftsFromRecord(record({
      groups: {
        jobs: [
          { id: "a", source: "you", updatedAt: "", values: { employer: "Acme Signs", title: "Press operator" } },
          { id: "b", source: "you", updatedAt: "", values: { employer: "Globex", title: "Packer" } },
        ],
      },
    }));
    const jobs = drafts.filter((d) => d.path[1] === "Old Jobs");
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.pack === "job")).toBe(true);
    expect(jobs.map((j) => j.path[2]).join(" ")).toMatch(/Acme Signs/);
  });

  it("drops nothing when a key is no longer in the catalogue", () => {
    const drafts = draftsFromRecord(record({ fields: { some_retired_key: field("still mine") } }));
    expect(JSON.stringify(drafts)).toContain("still mine");
  });

  it("ignores an empty record", () => {
    expect(draftsFromRecord(record())).toEqual([]);
  });
});

describe("importing into the tree", () => {
  it("does not hand the owner a queue full of their own answers", () => {
    const drafts = draftsFromRecord(record({
      fields: {
        citizenship: field("US", "you"),
        blood_type: field("O+", "you"),
        birthplace: field("Austin", "jarvis"),
      },
    }));
    const { store } = applyDrafts(seeded(), drafts);
    const unconfirmed = buildQueue(store.nodes).filter((q) => q.kind === "unconfirmed");
    // Only Jarvis's own guess needs agreeing to.
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0].question).toContain("Austin");
  });

  it("puts an imported secret in the vault, out of reach of the AI", () => {
    const drafts = draftsFromRecord(record({ fields: { ssn: field("123-45-6789"), citizenship: field("US") } }));
    const { store } = applyDrafts(seeded(), drafts);
    const text = redactForAi(store.nodes, store.basics);
    expect(text).not.toContain("123-45-6789");
    expect(text).toContain("[held in vault]");
    expect(text).toContain("US");
  });

  it("lands a job where a job belongs", () => {
    const drafts = draftsFromRecord(record({
      groups: { jobs: [{ id: "a", source: "you", updatedAt: "", values: { employer: "Acme Signs", title: "Press operator" } }] },
    }));
    const { store } = applyDrafts(seeded(), drafts);
    const node = store.nodes.find((n) => n.pack === "job" && n.fields.some((f) => f.value === "Acme Signs"))!;
    expect(pathOf(store.nodes, node.id)).toMatch(/^Work › Old Jobs › /);
  });

  it("is safe to run twice - the second import adds nothing", () => {
    const drafts = draftsFromRecord(record({ fields: { citizenship: field("US"), blood_type: field("O+") } }));
    const first = applyDrafts(seeded(), drafts);
    const second = applyDrafts(first.store, drafts);
    expect(second.marks).toHaveLength(0);
    expect(second.store.nodes.length).toBe(first.store.nodes.length);
  });
});
