import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addProfileAccount,
  createProfile,
  deleteFolder,
  getData,
  setProfileField,
} from "./store";

// A minimal localStorage + document so the real store path (load → mutate →
// save) runs in Node. No IndexedDB and no Supabase are needed.
function installBrowser() {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("document", { cookie: "" });
  return map;
}

beforeEach(() => {
  installBrowser();
});

describe("createProfile", () => {
  it("creates the folder, the searchable record and the profile together", () => {
    const { data, profile } = createProfile({
      kind: "person",
      displayName: "Mason",
      role: "child",
      fields: [{ label: "Birthday", value: "2012-03-14" }],
    });

    const folder = data.folders.find((f) => f.id === profile.folderId);
    const parent = folder ? data.folders.find((f) => f.id === folder.parentId) : undefined;
    expect(parent?.name).toBe("People");

    const note = data.items.find((it) => it.id === profile.itemId);
    expect(note?.profileId).toBe(profile.id);
    expect(note?.folderId).toBe(profile.folderId);
    expect(note?.body).toContain("2012-03-14");
    expect(note?.body).toContain("Birthday");
    expect(note?.body).not.toContain("123-45-6789");

    expect(profile.fields.find((f) => f.label === "SSN")?.value).toBe("");
    expect(profile.fields.find((f) => f.label === "Birthday")?.value).toBe("2012-03-14");
  });

  it("keeps the record and profile in sync when a field is filled later", () => {
    const { profile } = createProfile({ kind: "person", displayName: "Mason" });
    setProfileField(profile.id, "Birthday", "2012-03-14");
    const fresh = getData();
    const note = fresh.items.find((it) => it.profileId === profile.id);
    expect(note?.body).toContain("2012-03-14");
  });

  it("adds an account with placeholders and writes it into the record", () => {
    const { profile } = createProfile({ kind: "person", displayName: "Mason" });
    const result = addProfileAccount(profile.id, {
      label: "Trump account",
      provider: "Trump Media",
      kind: "brokerage",
      openedDate: "2024-06-01",
      currency: "USD",
    });
    expect(result?.account.label).toBe("Trump account");
    const fresh = getData();
    const note = fresh.items.find((it) => it.profileId === profile.id);
    expect(note?.body).toContain("Trump account");
    expect(note?.body).toContain("Opened: 2024-06-01");
  });

  it("never deletes the profile when its folder is deleted", () => {
    const { data, profile } = createProfile({ kind: "person", displayName: "Mason" });
    const next = deleteFolder(profile.folderId as string);
    expect(next.profiles.some((p) => p.id === profile.id)).toBe(true);
    expect(next.profiles.find((p) => p.id === profile.id)?.folderId).toBe(null);
    // The profile note lived in that folder, so it is gone.
    expect(next.items.some((it) => it.profileId === profile.id)).toBe(false);
    expect(data.folders.some((f) => f.id === profile.folderId)).toBe(true);
  });
});
