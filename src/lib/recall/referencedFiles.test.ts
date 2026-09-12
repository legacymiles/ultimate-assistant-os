import { describe, expect, it } from "vitest";
import { referencedFileIds } from "./referencedFiles";

describe("referencedFileIds — what a sweep must not delete", () => {
  it("keeps blobs attached to items", () => {
    const ids = referencedFileIds([{ attachment: { fileId: "blob_item" } }], []);
    expect(ids.has("blob_item")).toBe(true);
  });

  // The regression: queued photos were not counted, so every page load deleted
  // the full-size image of every photo still awaiting review.
  it("keeps blobs of photos still waiting in the review queue", () => {
    const ids = referencedFileIds([], [{ fileId: "blob_queued" }]);
    expect(ids.has("blob_queued")).toBe(true);
  });

  it("keeps both kinds together", () => {
    const ids = referencedFileIds(
      [{ attachment: { fileId: "blob_item" } }],
      [{ fileId: "blob_queued" }],
    );
    expect([...ids].sort()).toEqual(["blob_item", "blob_queued"]);
  });

  it("counts a blob once when a filed item and a queued photo share it", () => {
    const ids = referencedFileIds([{ attachment: { fileId: "blob_x" } }], [{ fileId: "blob_x" }]);
    expect(ids.size).toBe(1);
  });

  it("ignores items and photos with no stored file", () => {
    const ids = referencedFileIds(
      [{}, { attachment: null }, { attachment: {} }, { attachment: { fileId: "" } }],
      [{}, { fileId: null }, { fileId: "" }],
    );
    expect(ids.size).toBe(0);
  });

  it("returns an empty set for nothing at all", () => {
    expect(referencedFileIds([], []).size).toBe(0);
  });
});
