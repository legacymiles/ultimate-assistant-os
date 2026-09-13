import { describe, expect, it } from "vitest";
import { closestPlace, editDistance, normalizePlace } from "./places";

describe("normalizePlace", () => {
  it("ignores case, spaces, punctuation and a plural s", () => {
    expect(normalizePlace("Desserts")).toBe("dessert");
    expect(normalizePlace("  Me & My Son ")).toBe("memyson");
  });

  it("does not strip the s from very short words", () => {
    expect(normalizePlace("bus")).toBe("bus");
  });
});

describe("editDistance", () => {
  it("counts single-character edits", () => {
    expect(editDistance("desert", "dessert")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("same", "same")).toBe(0);
  });
});

describe("closestPlace", () => {
  const cookbooks = ["Desserts", "Weeknight Dinners", "Lunch", "From Photos"];

  it("finds an exact name regardless of case", () => {
    expect(closestPlace("weeknight dinners", cookbooks)).toBe("Weeknight Dinners");
  });

  it("finds the existing place for a singular or plural", () => {
    expect(closestPlace("Dessert", cookbooks)).toBe("Desserts");
  });

  it("finds the existing place despite a common misspelling", () => {
    expect(closestPlace("desert", cookbooks)).toBe("Desserts");
    expect(closestPlace("Deserts", cookbooks)).toBe("Desserts");
  });

  // The failure that matters most: filing into the WRONG existing place.
  it("does not treat a different place one letter away as the same", () => {
    expect(closestPlace("Brunch", cookbooks)).toBeNull();
  });

  it("does not match short, genuinely different names", () => {
    expect(closestPlace("Kale", ["Keto"])).toBeNull();
  });

  it("returns null when nothing is close, so a new place is made", () => {
    expect(closestPlace("Holiday Baking", cookbooks)).toBeNull();
  });

  it("returns null for an empty request", () => {
    expect(closestPlace("", cookbooks)).toBeNull();
    expect(closestPlace(undefined, cookbooks)).toBeNull();
  });

  it("prefers the nearest of two candidates", () => {
    expect(closestPlace("Dinner", ["Dinners", "Winners"])).toBe("Dinners");
  });

  it("returns the stored spelling, so records land in the real place", () => {
    expect(closestPlace("DESSERT", ["Desserts"])).toBe("Desserts");
  });
});
