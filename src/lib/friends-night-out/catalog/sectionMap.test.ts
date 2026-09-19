import { describe, expect, it } from "vitest";
import { defaultSection } from "./sectionMap";

describe("defaultSection", () => {
  it("files nature and water under parks", () => {
    expect(defaultSection("Nature", "Waterfall")).toBe("parks");
    expect(defaultSection("Water", "Swimming hole")).toBe("parks");
  });

  it("files outdoor climbing under parks but a gym under fun", () => {
    expect(defaultSection("Climbing", "Crag")).toBe("parks");
    expect(defaultSection("Climbing", "Climbing")).toBe("fun");
  });

  it("files kid magnets under kids whatever their category", () => {
    for (const label of ["Zoo", "Aquarium", "Amusement park", "Water park", "Trampoline park", "Mini golf"]) {
      expect(defaultSection("Games", label)).toBe("kids");
    }
  });

  it("files oddities and culture under unique gems", () => {
    expect(defaultSection("Oddities", "Curiosity shop")).toBe("gems");
    expect(defaultSection("Culture", "Museum")).toBe("gems");
  });

  it("files food and drink under food", () => {
    expect(defaultSection("Food & Drink", "Brewery")).toBe("food");
  });

  it("falls back to fun", () => {
    expect(defaultSection("Motors", "Go-karts")).toBe("fun");
    expect(defaultSection("Something new", undefined)).toBe("fun");
  });
});
