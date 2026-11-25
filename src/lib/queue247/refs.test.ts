import { describe, expect, it } from "vitest";
import { MAX_REFS, base64Bytes, cleanRefs, ownsRef, parseDataUrl, refKey, refsNote } from "./refs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("reference pictures", () => {
  it("reads a picture's data URL and refuses anything else", () => {
    expect(parseDataUrl(PNG)).toMatchObject({ type: "image/png", ext: "png" });
    expect(parseDataUrl("data:image/jpg;base64,AAAA")).toMatchObject({ type: "image/jpeg", ext: "jpg" });
    expect(parseDataUrl("data:video/mp4;base64,AAAA")).toBeNull();
    expect(parseDataUrl("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(parseDataUrl("https://example.com/a.png")).toBeNull();
    expect(parseDataUrl(42)).toBeNull();
  });

  it("counts decoded bytes", () => {
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AAA=")).toBe(2);
    expect(base64Bytes("AA==")).toBe(1);
  });

  it("keeps the good pictures and says why it dropped the rest", () => {
    const { refs, problem } = cleanRefs([
      { dataUrl: PNG, name: "hero.png" },
      { dataUrl: "data:text/plain;base64,AAAA", name: "notes.txt" },
    ]);
    expect(refs.map((r) => r.name)).toEqual(["hero.png"]);
    expect(problem).toMatch(/notes\.txt isn't a JPEG, PNG, WebP or GIF/);
  });

  it("refuses an oversized picture", () => {
    const big = `data:image/jpeg;base64,${"A".repeat(Math.ceil((4 * 1024 * 1024 * 4) / 3) + 8)}`;
    const { refs, problem } = cleanRefs([{ dataUrl: big, name: "huge.jpg" }]);
    expect(refs).toEqual([]);
    expect(problem).toMatch(/over 4 MB/);
  });

  it(`keeps at most ${MAX_REFS}`, () => {
    const { refs, problem } = cleanRefs(Array.from({ length: MAX_REFS + 2 }, (_, i) => ({ dataUrl: PNG, name: `p${i}.png` })));
    expect(refs).toHaveLength(MAX_REFS);
    expect(problem).toMatch(/only the first 6/);
  });

  it("nothing attached is not a problem", () => {
    expect(cleanRefs(undefined)).toEqual({ refs: [], problem: null });
    expect(cleanRefs([])).toEqual({ refs: [], problem: null });
  });

  it("keys live in the owner's own folder and can't be forged", () => {
    const key = refKey("user-1", "abc123", "jpg");
    expect(key).toBe("refs/user-1/abc123.jpg");
    expect(ownsRef("user-1", key)).toBe(true);
    expect(ownsRef("user-2", key)).toBe(false);
    expect(ownsRef("user-1", "refs/user-1/../user-2/x.jpg")).toBe(false);
    expect(ownsRef("user-1", "uploads/user-1/x.mp4")).toBe(false);
    expect(refKey("../evil", "../../x", "png")).toBe("refs/evil/x.png");
  });

  it("tells the planner what was attached, and nothing when nothing was", () => {
    expect(refsNote([])).toBe("");
    const note = refsNote([{ name: "hero.png" }, { name: "set.jpg" }]);
    expect(note).toMatch(/2 reference pictures/);
    expect(note).toMatch(/picture 1: hero\.png/);
    expect(note).toMatch(/config\.changes/);
  });
});
