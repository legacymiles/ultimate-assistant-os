import { describe, expect, it } from "vitest";
import {
  buildProfileFields,
  buildProfileNoteBody,
  heuristicProfileDraft,
  profileCompleteness,
  profileFolderPath,
} from "./profiles";
import type { Profile } from "./types";

function person(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "p1",
    kind: "person",
    role: "child",
    displayName: "Mason",
    folderId: "f1",
    fields: buildProfileFields("person", [], "Mason"),
    accounts: [],
    tags: ["profile", "person"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("profile blueprints", () => {
  it("creates the placeholders a person profile needs, even when blank", () => {
    const fields = buildProfileFields("person", [], "Mason");
    const labels = fields.map((f) => f.label);
    expect(labels).toContain("Full legal name");
    expect(labels).toContain("Birthday");
    expect(labels).toContain("SSN");
    expect(fields.find((f) => f.label === "SSN")?.sensitive).toBe(true);
    expect(fields.find((f) => f.label === "Full legal name")?.value).toBe("Mason");
    expect(fields.find((f) => f.label === "Birthday")?.value).toBe("");
  });

  it("keeps the value the user supplied and appends an extra field", () => {
    const fields = buildProfileFields(
      "person",
      [
        { label: "Birthday", value: "2012-03-14" },
        { label: "School", value: "Lincoln Elementary" },
      ],
      "Mason",
    );
    expect(fields.find((f) => f.label === "Birthday")?.value).toBe("2012-03-14");
    expect(fields.find((f) => f.label === "School")?.value).toBe("Lincoln Elementary");
  });

  it("puts people and businesses in different folder branches", () => {
    expect(profileFolderPath("person", "Mason")).toEqual(["Profiles", "People", "Mason"]);
    expect(profileFolderPath("business", "Bighomie AI")).toEqual([
      "Profiles",
      "Businesses",
      "Bighomie AI",
    ]);
  });
});

describe("completeness", () => {
  it("counts blank placeholders as still missing", () => {
    const c = profileCompleteness(person());
    expect(c.total).toBeGreaterThan(0);
    expect(c.known).toBe(1); // the name filled from displayName
    expect(c.missing.some((f) => f.label === "Birthday")).toBe(true);
  });
});

describe("the offline draft", () => {
  it("reads a son and a Trump account out of a sentence", () => {
    const draft = heuristicProfileDraft({
      description:
        "My son Mason was born 3/14/2012. He has a Trump account I opened in 2024 — no login yet.",
    });
    expect(draft.kind).toBe("person");
    expect(draft.displayName).toBe("Mason");
    expect(draft.role).toBe("child");
    expect(draft.accounts.some((a) => /trump/i.test(a.label))).toBe(true);
    expect(draft.fields.find((f) => f.label === "Birthday")?.value).toBe("3/14/2012");
    expect(draft.questions.length).toBeGreaterThan(0);
  });

  it("reads a domain business and keeps the renewal date", () => {
    const draft = heuristicProfileDraft({
      description:
        "Bighomie AI — domain bighomieai.com bought at Cloudflare. Renewal date 2027-11-02. Login is me@example.com.",
    });
    expect(draft.kind).toBe("business");
    expect(draft.accounts.some((a) => a.kind === "domain")).toBe(true);
    expect(draft.fields.find((f) => f.label === "Website / domain")?.value).toContain("bighomieai.com");
    expect(draft.fields.find((f) => f.label === "Registrar")?.value).toBe("Cloudflare");
  });
});

describe("the folder note", () => {
  it("mirrors non-sensitive values but keeps SSNs out of searchable text", () => {
    const profile = person({
      fields: buildProfileFields(
        "person",
        [
          { label: "SSN", value: "123-45-6789" },
          { label: "Birthday", value: "2012-03-14" },
        ],
        "Mason",
      ),
      accounts: [
        {
          id: "a1",
          label: "Trump account",
          kind: "brokerage",
          openedDate: "2024-06-01",
          renewalDate: "2027-01-01",
          login: "mason@example.com",
          password: "never-in-the-note",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const body = buildProfileNoteBody(profile);
    expect(body).toContain("Birthday: 2012-03-14");
    expect(body).toContain("Trump account");
    expect(body).toContain("Renewal: 2027-01-01");
    expect(body).not.toContain("123-45-6789");
    expect(body).not.toContain("never-in-the-note");
  });
});
