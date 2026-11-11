import { describe, expect, it } from "vitest";
import type { RecallData } from "./types";
import { degradedNotice, sanitizeActions } from "./agent";

// The tree from the bug report: a top-level "vps 2026" and a "trading fx"
// holding the coinexx logins that the keyword search wrongly answered with.
const DATA = {
  folders: [
    { id: "f_vps", name: "vps 2026", parentId: null },
    { id: "f_fx", name: "trading fx", parentId: null },
    { id: "f_cx", name: "coinexx broker logins", parentId: "f_fx" },
  ],
  items: [],
} as unknown as RecallData;

describe("move_folder survives sanitizeActions", () => {
  it("keeps a move_folder naming a real folder", () => {
    expect(
      sanitizeActions([{ type: "move_folder", folderId: "f_vps", path: ["trading fx"] }], DATA, []),
    ).toEqual([{ type: "move_folder", folderId: "f_vps", path: ["trading fx"] }]);
  });

  it("drops a move_folder naming a folder that does not exist", () => {
    expect(
      sanitizeActions([{ type: "move_folder", folderId: "f_nope", path: ["trading fx"] }], DATA, []),
    ).toEqual([]);
  });

  it("keeps create_folder + move_folder together when the target is new", () => {
    const out = sanitizeActions(
      [
        { type: "create_folder", path: ["trading fx", "brokers"] },
        { type: "move_folder", folderId: "f_vps", path: ["trading fx", "brokers"] },
      ],
      DATA,
      [],
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ type: "move_folder", folderId: "f_vps" });
  });

  it("drops an action whose type is not one of the allowed ones", () => {
    expect(sanitizeActions([{ type: "rm_rf", folderId: "f_vps" }], DATA, [])).toEqual([]);
  });

  it("returns nothing for a non-array, rather than throwing", () => {
    expect(sanitizeActions("not an array", DATA, [])).toEqual([]);
    expect(sanitizeActions(null, DATA, [])).toEqual([]);
  });
});

describe("profile actions survive sanitizeActions", () => {
  const withProfile = {
    ...DATA,
    profiles: [{ id: "p_mason", displayName: "Mason", kind: "person", fields: [], accounts: [] }],
  } as unknown as RecallData;

  it("keeps add_profile_account and reads its label", () => {
    const out = sanitizeActions(
      [
        {
          type: "add_profile_account",
          profileId: "p_mason",
          label: "Trump account",
          kind: "brokerage",
          openedDate: "2024-06-01",
        },
      ],
      withProfile,
      [],
    );
    expect(out).toEqual([
      {
        type: "add_profile_account",
        profileId: "p_mason",
        label: "Trump account",
        kind: "brokerage",
        provider: undefined,
        openedDate: "2024-06-01",
        renewalDate: undefined,
        login: undefined,
        value: undefined,
        currency: undefined,
        url: undefined,
      },
    ]);
  });

  it("drops a profile action naming a profile that does not exist", () => {
    expect(
      sanitizeActions(
        [{ type: "update_profile_field", profileId: "p_nope", label: "Phone", value: "555" }],
        withProfile,
        [],
      ),
    ).toEqual([]);
  });

  it("keeps create_profile only when it has a kind and a name", () => {
    expect(
      sanitizeActions([{ type: "create_profile", kind: "person", displayName: "Mason" }], withProfile, []),
    ).toEqual([
      {
        type: "create_profile",
        kind: "person",
        displayName: "Mason",
        role: undefined,
        fields: [],
        accounts: [],
        tags: [],
      },
    ]);
    expect(sanitizeActions([{ type: "create_profile", kind: "person" }], withProfile, [])).toEqual([]);
  });
});

describe("degraded mode announces itself", () => {
  // The reported failure was not a weak model — no model ran at all, and the
  // keyword search answered in a voice indistinguishable from a real reply.
  it("says AI is off and that the result is a search", () => {
    const n = degradedNotice();
    expect(n.toLowerCase()).toContain("ai is off");
    expect(n.toLowerCase()).toContain("keyword search");
  });

  it("names a key the user can actually set", () => {
    expect(degradedNotice()).toMatch(/OPENROUTER_API_KEY|AI_GATEWAY_API_KEY/);
  });
});
