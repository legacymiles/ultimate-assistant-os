import { describe, expect, it } from "vitest";
import { matchField, matchForm } from "./fields";

const key = (f: Parameters<typeof matchField>[0]) => matchField(f)?.key ?? null;

describe("the autocomplete rung", () => {
  it("takes the page at its word", () => {
    expect(key({ autocomplete: "given-name" })).toBe("legal_first");
    expect(key({ autocomplete: "family-name" })).toBe("legal_last");
    expect(key({ autocomplete: "postal-code" })).toBe("postal_code");
    expect(key({ autocomplete: "address-level2" })).toBe("city");
  });

  it("reads a sectioned token, as real sites write them", () => {
    expect(key({ autocomplete: "shipping given-name" })).toBe("legal_first");
    expect(key({ autocomplete: "section-blue billing email" })).toBe("email");
  });

  it("outranks a misleading name", () => {
    const m = matchField({ autocomplete: "family-name", name: "first_name" });
    expect(m).toMatchObject({ key: "legal_last", by: "autocomplete", confidence: 1 });
  });

  it("ignores a token that means more than one record field", () => {
    // "name" is the full name — three fields — so splitting it would be a guess.
    expect(key({ autocomplete: "name" })).toBeNull();
    expect(key({ autocomplete: "organization" })).toBeNull();
  });
});

describe("the name rung", () => {
  it("places the common spellings", () => {
    expect(key({ name: "first_name" })).toBe("legal_first");
    expect(key({ name: "fname" })).toBe("legal_first");
    expect(key({ id: "applicant-last-name" })).toBe("legal_last");
    expect(key({ name: "dob" })).toBe("dob");
    expect(key({ name: "zipcode" })).toBe("postal_code");
    expect(key({ name: "ssn" })).toBe("ssn");
  });

  it("does not let a broad pattern swallow a narrow one", () => {
    // The reason NAME_PATTERNS is ordered: /name/ would take all of these.
    expect(key({ name: "last_name" })).toBe("legal_last");
    expect(key({ name: "middle_initial" })).toBe("legal_middle");
    expect(key({ name: "preferred_name" })).toBe("preferred_name");
  });

  it("separates a mobile number from another phone", () => {
    expect(key({ name: "mobile_phone" })).toBe("phone_mobile");
    expect(key({ name: "alternate_phone" })).toBe("phone_alt");
    expect(key({ name: "phone" })).toBe("phone_mobile");
  });

  it("separates the two address lines", () => {
    expect(key({ name: "address_line_2" })).toBe("address_line2");
    expect(key({ name: "apt" })).toBe("address_line2");
    expect(key({ name: "street_address" })).toBe("address_line1");
  });

  it("places what a benefits form asks that a job form does not", () => {
    expect(key({ name: "county" })).toBe("county");
    expect(key({ name: "household_size" })).toBe("household_size");
    expect(key({ name: "medicaid_id" })).toBe("medicaid_id");
    expect(key({ name: "is_pregnant" })).toBe("pregnant");
  });
});

describe("the label rung", () => {
  it("reads a label when the name is useless", () => {
    const m = matchField({ name: "ctl00$Main$txt17", label: "Social Security Number" });
    expect(m).toMatchObject({ key: "ssn", by: "label", confidence: 0.5 });
  });

  it("reads the prose a portal actually uses", () => {
    expect(key({ name: "input_14_3", label: "How many people live in your household?" })).toBe("household_size");
    expect(key({ name: "q7", label: "When can you start?" })).toBe("available_from");
    expect(key({ name: "q9", label: "Are you legally authorized to work in the US?" })).toBe("work_authorization");
  });

  it("falls back to a placeholder when there is no label at all", () => {
    expect(key({ name: "x1", placeholder: "Date of birth" })).toBe("dob");
  });
});

describe("what it refuses", () => {
  it("never places a password, whatever it is called", () => {
    expect(key({ type: "password", name: "ssn" })).toBeNull();
    expect(key({ type: "password", autocomplete: "given-name" })).toBeNull();
  });

  it("never places a hidden, file or submit input", () => {
    expect(key({ type: "hidden", name: "first_name" })).toBeNull();
    expect(key({ type: "file", name: "email" })).toBeNull();
    expect(key({ type: "submit", name: "city" })).toBeNull();
  });

  it("rejects a match the input's type makes impossible", () => {
    expect(key({ type: "email", name: "date_of_birth" })).toBeNull();
  });

  it("does not match a bare word that hides inside an innocent name", () => {
    // Each of these shipped broken once. "captcha" contains apt; "current_"
    // and "parent_" contain rent. A substring alternative in a pattern list is
    // how a phone number ends up in a licence-number field.
    expect(key({ name: "captcha_response" })).toBeNull();
    expect(key({ name: "current_address" })).not.toBe("rent_monthly");
    expect(key({ name: "parent_first_name" })).not.toBe("rent_monthly");
    // And the words themselves still match when they are actually the field.
    expect(key({ name: "apt_number" })).toBe("address_line2");
    expect(key({ name: "monthly_rent" })).toBe("rent_monthly");
  });

  it("returns null rather than guessing", () => {
    expect(key({ name: "how_did_you_hear_about_us" })).toBeNull();
    expect(key({ name: "captcha_response", label: "Type the characters you see" })).toBeNull();
    expect(key({})).toBeNull();
  });
});

describe("matching a whole form", () => {
  it("drops empty fields and keeps unmatched ones for the model", () => {
    const out = matchForm([
      { name: "first_name", value: "James" },
      { name: "last_name", value: "" },
      { name: "weird_portal_field_9", value: "something" },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((f) => f.match?.key === "legal_first")?.value).toBe("James");
    expect(out.find((f) => f.name === "weird_portal_field_9")?.match).toBeNull();
  });

  it("lets a stronger signal win a duplicate, whichever came first", () => {
    const out = matchForm([
      { autocomplete: "email", name: "email", value: "real@example.com" },
      { name: "email_confirm", value: "typo@example.com" },
    ]);
    const email = out.filter((f) => f.match?.key === "email");
    expect(email).toHaveLength(1);
    expect(email[0].value).toBe("real@example.com");
  });

  it("takes the later value when two signals are equally strong", () => {
    // A billing block repeated under a shipping one: the lower is the answer.
    const out = matchForm([
      { name: "city", value: "Tucson" },
      { name: "city", value: "Phoenix" },
    ]);
    expect(out.filter((f) => f.match?.key === "city")[0].value).toBe("Phoenix");
  });
});
