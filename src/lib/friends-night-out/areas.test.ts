import { describe, expect, it } from "vitest";
import { findReusableArea } from "./areas";

// Columbus, OH and a point ~5.5 mi north of it.
const COLUMBUS = { id: "cbus", lat: 39.9612, lon: -82.9988, builtRadiusMi: 30 };
const NORTH = { lat: 40.0412, lon: -82.9988 };

describe("findReusableArea", () => {
  it("reuses when the user's circle fits inside the built one", () => {
    expect(findReusableArea([COLUMBUS], NORTH, 15)?.id).toBe("cbus");
  });

  it("builds new when the radius spills outside", () => {
    expect(findReusableArea([COLUMBUS], NORTH, 28)).toBeNull();
  });

  it("builds new when the center is more than 10 mi away", () => {
    const far = { lat: 40.1612, lon: -82.9988 }; // ~13.8 mi
    expect(findReusableArea([{ ...COLUMBUS, builtRadiusMi: 50 }], far, 5)).toBeNull();
  });

  it("picks the nearest qualifying area", () => {
    const near = { id: "near", lat: 40.0312, lon: -82.9988, builtRadiusMi: 30 };
    expect(findReusableArea([COLUMBUS, near], NORTH, 10)?.id).toBe("near");
  });

  it("returns null with no areas", () => {
    expect(findReusableArea([], NORTH, 10)).toBeNull();
  });
});
