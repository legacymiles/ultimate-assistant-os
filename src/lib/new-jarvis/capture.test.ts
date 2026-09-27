import { describe, expect, it } from "vitest";
import { FieldStash } from "./capture";
import { RECORD_KEYS } from "./agentTools";
import { setField } from "@/lib/jarvis/record/store";
import type { LifeRecord } from "@/lib/jarvis/record/types";

const blank = (): LifeRecord => ({ fields: {}, groups: {}, updatedAt: new Date().toISOString() } as LifeRecord);

describe("FieldStash", () => {
  it("holds what a page returned and hands back only what was asked for", () => {
    const s = new FieldStash();
    s.put({ acct: "87654321", ref: "CT-2026-0042" });
    const { values, missing } = s.take(["acct"]);
    expect(values).toEqual({ acct: "87654321" });
    expect(missing).toEqual([]);
  });

  // A key the model invented must resolve to nothing, not to an empty string,
  // or a hallucinated field quietly overwrites a real one with blank.
  it("reports an invented key instead of resolving it to empty", () => {
    const s = new FieldStash();
    s.put({ acct: "87654321" });
    const { values, missing } = s.take(["acct", "made_up"]);
    expect(values).toEqual({ acct: "87654321" });
    expect(missing).toEqual(["made_up"]);
  });

  it("holds one page at a time, so a stale value cannot be captured", () => {
    const s = new FieldStash();
    s.put({ acct: "111" });
    s.put({ other: "222" });
    expect(s.take(["acct"]).missing).toEqual(["acct"]);
    expect(s.keys()).toEqual(["other"]);
  });

  it("keeps nothing for an empty value", () => {
    const s = new FieldStash();
    s.put({ filled: "x", empty: "" });
    expect(s.keys()).toEqual(["filled"]);
  });

  it("can be emptied", () => {
    const s = new FieldStash();
    s.put({ a: "1" });
    s.clear();
    expect(s.size).toBe(0);
  });
});

describe("what capture writes into", () => {
  // The bug this pins: setField returns the record UNCHANGED for a key the
  // Record does not define. The model invents plausible keys off a page
  // ("council_tax_account"), nothing matches, nothing saves, and from the
  // outside it looks exactly like the feature being broken rather than a
  // vocabulary mismatch. This is why the real keys are handed to the model.
  it("ignores a key the Record does not define", () => {
    const before = blank();
    const after = setField(before, "council_tax_account", "87654321", "jarvis", "a page");
    expect(after).toBe(before);
  });

  it("writes a key the Record does define, with its provenance", () => {
    const after = setField(blank(), "city", "Manchester", "jarvis", "a page you had open");
    expect(after.fields.city?.value).toBe("Manchester");
    expect(after.fields.city?.source).toBe("jarvis");
    expect(after.fields.city?.origin).toBe("a page you had open");
  });

  it("hands the model real keys, and they are the ones that write", () => {
    expect(RECORD_KEYS.length).toBeGreaterThan(20);
    for (const key of ["city", "dob", "legal_first"]) {
      expect(RECORD_KEYS, key).toContain(key);
      expect(setField(blank(), key, "x", "jarvis").fields[key]?.value).toBe("x");
    }
    expect(RECORD_KEYS).not.toContain("council_tax_account");
  });
});
