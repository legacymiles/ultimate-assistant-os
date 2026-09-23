import { describe, expect, it } from "vitest";
import { backfillNote, itemsNeedingUrl } from "./backfillUrls";
import type { Item } from "@/lib/recall/types";

const item = (over: Partial<Item>): Item =>
  ({
    id: "i",
    title: "Krea",
    body: "",
    summary: "",
    kind: "website",
    source: "manual",
    folderId: "f",
    tags: [],
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as Item;

const inFolder = new Set(["f", "sub"]);

describe("itemsNeedingUrl", () => {
  it("takes the linkless entries in the folder and its sub-folders", () => {
    const items = [
      item({ id: "a" }),
      item({ id: "b", folderId: "sub" }),
      item({ id: "c", folderId: "elsewhere" }),
    ];
    expect(itemsNeedingUrl(items, inFolder).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("never touches an entry that already has a link", () => {
    const items = [
      item({ id: "a", url: "https://krea.ai" }),
      item({ id: "b", fields: { url: "https://krea.ai" } }),
      item({ id: "c" }),
    ];
    expect(itemsNeedingUrl(items, inFolder).map((i) => i.id)).toEqual(["c"]);
  });

  it("skips an entry with no name to look up, and loose items", () => {
    const items = [item({ id: "a", title: "  " }), item({ id: "b", folderId: null })];
    expect(itemsNeedingUrl(items, inFolder)).toEqual([]);
  });
});

describe("backfillNote", () => {
  it("counts what happened, and says when nothing needed doing", () => {
    expect(backfillNote({ filled: 0, skipped: 0 })).toBe("Every entry already has a link.");
    expect(backfillNote({ filled: 1, skipped: 0 })).toBe("1 link added. Check any that look wrong.");
    expect(backfillNote({ filled: 12, skipped: 2 })).toBe(
      "12 links added, 2 left blank — no site found. Check any that look wrong.",
    );
  });
});
