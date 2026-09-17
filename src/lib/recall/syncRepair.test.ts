import { describe, expect, it } from "vitest";
import type { RecallData } from "./types";
import { mergeRecallData } from "./store";

const T1 = "2026-09-01T00:00:00.000Z";
const T2 = "2026-09-10T00:00:00.000Z";

// The reported bug: the laptop holds the real folders, the phone pushed an
// almost-empty tree with its own "Photos" root over the server copy.
const laptop = {
  folders: [
    { id: "f_photos_l", name: "Photos", parentId: null, role: "photos", createdAt: T1 },
    { id: "f_work", name: "Work", parentId: null, createdAt: T1 },
    { id: "f_beach", name: "Beach", parentId: "f_photos_l", createdAt: T1 },
  ],
  items: [{ id: "i1", title: "note", folderId: "f_work", updatedAt: T1 }],
} as unknown as RecallData;

const phone = {
  folders: [{ id: "f_photos_p", name: "Photos", parentId: null, role: "photos", createdAt: T2 }],
  items: [{ id: "i2", title: "phone snap", folderId: "f_photos_p", updatedAt: T2 }],
} as unknown as RecallData;

describe("mergeRecallData", () => {
  it("keeps every folder from both devices, whichever side is local", () => {
    for (const merged of [mergeRecallData(laptop, phone), mergeRecallData(phone, laptop)]) {
      expect(merged.folders.map((f) => f.name).sort()).toEqual(["Beach", "Photos", "Work"]);
      expect(merged.items.map((i) => i.id).sort()).toEqual(["i1", "i2"]);
    }
  });

  it("collapses duplicate Photos roots and moves their contents to the one kept", () => {
    const merged = mergeRecallData(phone, laptop);
    const roots = merged.folders.filter((f) => f.parentId === null && f.name === "Photos");
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe("f_photos_l"); // the older one
    expect(merged.items.find((i) => i.id === "i2")?.folderId).toBe("f_photos_l");
    expect(merged.folders.find((f) => f.id === "f_beach")?.parentId).toBe("f_photos_l");
  });

  it("takes the later edit when both devices hold the same item", () => {
    const older = { folders: [], items: [{ id: "x", title: "old", folderId: null, updatedAt: T1 }] };
    const newer = { folders: [], items: [{ id: "x", title: "new", folderId: null, updatedAt: T2 }] };
    expect(mergeRecallData(older, newer).items[0].title).toBe("new");
    expect(mergeRecallData(newer, older).items[0].title).toBe("new");
  });

  it("tolerates a missing or malformed side", () => {
    expect(mergeRecallData(null, laptop).folders).toHaveLength(3);
  });
});
