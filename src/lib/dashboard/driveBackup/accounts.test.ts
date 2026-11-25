import { describe, expect, it } from "vitest";
import type { Item } from "@/lib/recall/types";
import { buildInventory, coverage, formatBytes, parseAbout, upsertAccount, type DriveAccount } from "./accounts";

const F = "application/vnd.google-apps.folder";

describe("parseAbout", () => {
  it("reads Google's real quota fields (strings of bytes)", () => {
    const a = parseAbout({
      user: { emailAddress: "Me@Gmail.com", displayName: "Me" },
      storageQuota: { limit: "16106127360", usage: "5368709120", usageInDrive: "4294967296", usageInDriveTrash: "1073741824" },
    });
    expect(a.email).toBe("me@gmail.com");
    expect(a.quota).toEqual({ limit: 16106127360, usage: 5368709120, usageInDrive: 4294967296, usageInTrash: 1073741824 });
  });
  it("keeps an unlimited plan unlimited instead of inventing a number", () => {
    expect(parseAbout({ user: { emailAddress: "a@b.c" }, storageQuota: { usage: "10" } }).quota.limit).toBeNull();
  });
});

describe("buildInventory", () => {
  const raw = [
    { id: "r", name: "Ultimate Assistant OS", mimeType: F, parents: ["myDrive"], appProperties: { dashboardKey: "root" } },
    { id: "fo", name: "Folders", mimeType: F, parents: ["r"], appProperties: { dashboardKey: "folders" } },
    { id: "tr", name: "Trading", mimeType: F, parents: ["fo"], appProperties: { dashboardKey: "folder:f_tr" } },
    { id: "d1", name: "Gold plan", mimeType: "application/vnd.google-apps.document", parents: ["tr"], appProperties: { dashboardKey: "item:i1" }, modifiedTime: "2026-11-20T00:00:00Z" },
    { id: "d2", name: "Links, to-dos & logins", mimeType: "application/vnd.google-apps.document", parents: ["tr"], appProperties: { dashboardKey: "list:folder:f_tr" }, modifiedTime: "2026-11-21T00:00:00Z" },
  ];
  it("rebuilds each file's real destination path and finds the root", () => {
    const inv = buildInventory(raw);
    expect(inv.rootId).toBe("r");
    expect(inv.folders).toBe(3);
    expect(inv.files.find((f) => f.id === "d1")?.path).toBe("Ultimate Assistant OS › Folders › Trading");
    expect(inv.files[0].id).toBe("d2"); // newest first
  });

  it("maps Folders items to the account holding them, including list-doc kinds", () => {
    const acct: DriveAccount = { email: "me@gmail.com", inventory: { files: buildInventory(raw).files, folders: 3, truncated: false } };
    const items = [
      { id: "i1", kind: "note", folderId: "f_tr" },
      { id: "i2", kind: "link", folderId: "f_tr" },
      { id: "i3", kind: "note", folderId: "f_tr" },
    ] as unknown as Item[];
    const c = coverage(items, [acct]);
    expect(c.where.get("i1")?.[0].email).toBe("me@gmail.com");
    expect(c.where.has("i2")).toBe(true);
    expect(c.missing.map((i) => i.id)).toEqual(["i3"]);
    expect(c.backedUp).toBe(2);
  });
});

describe("upsertAccount", () => {
  it("merges by lower-cased email and keeps earlier fields", () => {
    const s1 = upsertAccount({ accounts: [], target: null }, { email: "A@x.com", name: "A" });
    const s2 = upsertAccount(s1, { email: "a@x.com", lastError: "boom" });
    expect(s2.accounts).toHaveLength(1);
    expect(s2.accounts[0]).toMatchObject({ email: "a@x.com", name: "A", lastError: "boom" });
  });
});

describe("formatBytes", () => {
  it("formats sizes and unlimited", () => {
    expect(formatBytes(16106127360)).toBe("15.0 GB");
    expect(formatBytes(null)).toBe("Unlimited");
    expect(formatBytes(512)).toBe("512 B");
  });
});
