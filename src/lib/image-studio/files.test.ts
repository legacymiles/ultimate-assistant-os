import { describe, expect, it } from "vitest";
import { imageUrlFromDrop, isHeic, pickImageFiles } from "./files";

const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });

describe("pickImageFiles", () => {
  it("accepts a normal typed image", () => {
    const r = pickImageFiles([file("me.jpg", "image/jpeg")], 6);
    expect(r.accepted.map((f) => f.name)).toEqual(["me.jpg"]);
    expect(r.skipped).toEqual([]);
  });

  it("accepts an image whose MIME type the OS left blank", () => {
    const r = pickImageFiles([file("photo.webp", ""), file("IMG_0001", "")], 6);
    expect(r.accepted.map((f) => f.name)).toEqual(["photo.webp", "IMG_0001"]);
  });

  it("accepts by extension when the type is generic", () => {
    const r = pickImageFiles([file("scan.JPEG", "application/octet-stream")], 6);
    expect(r.accepted).toHaveLength(1);
  });

  it("explains why a non-image was skipped", () => {
    const r = pickImageFiles([file("clip.mp4", "video/mp4"), file("doc.pdf", "application/pdf")], 6);
    expect(r.accepted).toEqual([]);
    expect(r.skipped.map((s) => s.name)).toEqual(["clip.mp4", "doc.pdf"]);
    expect(r.skipped[0].reason).toMatch(/not an image/i);
  });

  it("stops at the free slots and says so", () => {
    const r = pickImageFiles([file("a.png", "image/png"), file("b.png", "image/png"), file("c.png", "image/png")], 2);
    expect(r.accepted.map((f) => f.name)).toEqual(["a.png", "b.png"]);
    expect(r.skipped).toEqual([{ name: "c.png", reason: expect.stringMatching(/limit/i) }]);
  });
});

describe("isHeic", () => {
  it("spots iPhone photos by type or extension", () => {
    expect(isHeic(file("IMG_1.HEIC", ""))).toBe(true);
    expect(isHeic(file("x", "image/heif"))).toBe(true);
    expect(isHeic(file("x.jpg", "image/jpeg"))).toBe(false);
  });
});

describe("imageUrlFromDrop", () => {
  it("reads the URL of an image dragged from a web page", () => {
    expect(imageUrlFromDrop("# comment\nhttps://cdn.example.com/a.jpg", "")).toBe("https://cdn.example.com/a.jpg");
  });

  it("falls back to the <img src> in dragged HTML", () => {
    expect(imageUrlFromDrop("", '<meta charset="utf-8"><img alt="x" src="https://example.com/b.png">')).toBe(
      "https://example.com/b.png",
    );
  });

  it("accepts an inline data image and ignores everything else", () => {
    expect(imageUrlFromDrop("data:image/png;base64,AAA", "")).toBe("data:image/png;base64,AAA");
    expect(imageUrlFromDrop("javascript:alert(1)", "")).toBeNull();
    expect(imageUrlFromDrop("", "")).toBeNull();
  });
});
