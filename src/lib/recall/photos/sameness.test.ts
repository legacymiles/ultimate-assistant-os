import { describe, expect, it } from "vitest";
import { duplicateIds, photoNameKey, samePhoto } from "./sameness";

const H = "0f0f0f0f0f0f0f0f";
const H1 = "0f0f0f0f0f0f0f0e"; // 1 bit off: a look-alike
const FAR = "f0f0f0f0f0f0f0f0";

describe("photoNameKey", () => {
  it("reads the phone's file number the same way however it is written", () => {
    expect(photoNameKey("IMG_6843.jpeg")).toBe("img6843");
    expect(photoNameKey("IMG 6843")).toBe("img6843");
    expect(photoNameKey("img-6843.HEIC")).toBe("img6843");
  });
});

describe("samePhoto", () => {
  it("catches an indistinguishable copy", () => {
    expect(samePhoto({ id: "a", hash: H }, { id: "b", hash: H })).toBe(true);
  });

  it("catches a re-encoded copy with the same file number", () => {
    expect(samePhoto({ id: "a", hash: H, name: "IMG_6843.jpeg" }, { id: "b", hash: H1, name: "IMG 6843" })).toBe(true);
  });

  it("catches a look-alike taken at the same moment", () => {
    expect(
      samePhoto(
        { id: "a", hash: H, takenAt: "2026-10-18T19:30:00.000Z" },
        { id: "b", hash: H1, takenAt: "2026-10-18T19:30:01.000Z" },
      ),
    ).toBe(true);
  });

  it("keeps two different shots of a burst", () => {
    expect(
      samePhoto(
        { id: "a", hash: H, name: "IMG_6843.jpeg", takenAt: "2026-10-18T19:30:00Z" },
        { id: "b", hash: H1, name: "IMG_6844.jpeg", takenAt: "2026-10-18T19:30:04Z" },
      ),
    ).toBe(false);
  });

  it("does not trust a name alone when the pictures differ, or a generic name", () => {
    expect(samePhoto({ id: "a", hash: H, name: "IMG_1.jpg" }, { id: "b", hash: FAR, name: "IMG_1.jpg" })).toBe(false);
    expect(samePhoto({ id: "a", name: "photo.jpg", size: 10 }, { id: "b", name: "photo.jpg", size: 10 })).toBe(false);
    expect(samePhoto({ id: "a", name: "IMG_6843.jpeg", size: 9000 }, { id: "b", name: "IMG_6843.jpeg", size: 9000 })).toBe(true);
  });

  it("never compares a collage with a plain photo", () => {
    expect(samePhoto({ id: "a", hash: H, composite: true }, { id: "b", hash: H })).toBe(false);
  });
});

describe("duplicateIds", () => {
  it("keeps the copy that has been read and drops the rest", () => {
    const q = [
      { id: "reading", hash: H, name: "IMG_6843.jpeg", status: "analyzing", addedAt: "2026-10-18T19:00:00Z" },
      { id: "read", hash: H1, name: "IMG 6843", status: "ready", addedAt: "2026-10-18T20:00:00Z" },
      { id: "other", hash: FAR, name: "IMG_6900.jpeg", status: "ready", addedAt: "2026-10-18T20:00:00Z" },
    ];
    expect(duplicateIds(q)).toEqual(["reading"]);
  });
});
