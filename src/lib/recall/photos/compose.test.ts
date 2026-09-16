import { describe, expect, it } from "vitest";
import { captionHeight, gridShape, wrapLines } from "./compose";
import { readPlanLocally } from "./batch";

describe("gridShape", () => {
  it("fills a grid without leaving holes", () => {
    expect(gridShape(4, "grid")).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(6, "grid")).toEqual({ cols: 3, rows: 2 });
    expect(gridShape(9, "grid")).toEqual({ cols: 3, rows: 3 });
  });

  it("never divides a single picture", () => {
    expect(gridShape(1, "grid")).toEqual({ cols: 1, rows: 1 });
    expect(gridShape(1, "row")).toEqual({ cols: 1, rows: 1 });
  });

  it("lays a row out across and a column down", () => {
    expect(gridShape(5, "row")).toEqual({ cols: 5, rows: 1 });
    expect(gridShape(5, "column")).toEqual({ cols: 1, rows: 5 });
  });

  it("always has room for every picture", () => {
    for (let n = 1; n <= 24; n++) {
      const { cols, rows } = gridShape(n, "grid");
      expect(cols * rows).toBeGreaterThanOrEqual(n);
    }
  });
});

describe("captionHeight", () => {
  it("grows with the size the user asked for", () => {
    const small = captionHeight("small", 1000);
    const medium = captionHeight("medium", 1000);
    const large = captionHeight("large", 1000);
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
  });

  it("scales with the picture, so it is never a fixed slab on a small one", () => {
    expect(captionHeight("medium", 500)).toBeLessThan(captionHeight("medium", 2000));
  });
});

describe("wrapLines", () => {
  // One "pixel" per character keeps the maths obvious.
  const measure = (s: string) => s.length;

  it("breaks on the last word that fits", () => {
    expect(wrapLines("one two three four", 9, measure)).toEqual(["one two", "three", "four"]);
  });

  it("leaves a word longer than the line alone rather than chopping it", () => {
    expect(wrapLines("supercalifragilistic", 5, measure)).toEqual(["supercalifragilistic"]);
  });

  it("caps the block so a pasted paragraph cannot cover the photo", () => {
    expect(wrapLines("a b c d e f g h i j", 1, measure)).toHaveLength(6);
  });
});

describe("readPlanLocally", () => {
  it("makes a collage when asked, with no AI key", () => {
    const plan = readPlanLocally("make these into a collage", 6);
    expect(plan.collage?.layout).toBe("grid");
    expect(plan.couldNot).toEqual([]);
  });

  it("refuses a collage of one picture and says why", () => {
    const plan = readPlanLocally("make these into a collage", 1);
    expect(plan.collage).toBeNull();
    expect(plan.couldNot[0]).toMatch(/more than one picture/i);
  });

  it("uses words the user actually typed", () => {
    const plan = readPlanLocally('collage these and put "FOR SALE" across the bottom', 4);
    expect(plan.caption?.text).toBe("FOR SALE");
    expect(plan.caption?.position).toBe("bottom");
  });

  it("reads the position and size out of the sentence", () => {
    const plan = readPlanLocally('put "SOLD" at the top in big letters', 1);
    expect(plan.caption?.position).toBe("top");
    expect(plan.caption?.size).toBe("large");
  });

  it("will not invent a quote it was asked to write", () => {
    // The whole point: a made-up quote presented as the user's would be worse
    // than saying the key is needed.
    const plan = readPlanLocally("add a short quote about hard work", 3);
    expect(plan.caption).toBeNull();
    expect(plan.couldNot[0]).toMatch(/AI key/i);
  });

  it("changes nothing when the instruction is only about filing", () => {
    const plan = readPlanLocally("these are all recipes", 5);
    expect(plan.collage).toBeNull();
    expect(plan.caption).toBeNull();
    expect(plan.couldNot).toEqual([]);
  });

  it("does nothing at all with an empty instruction", () => {
    expect(readPlanLocally("   ", 5).collage).toBeNull();
  });
});
