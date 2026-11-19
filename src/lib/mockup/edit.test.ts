import { describe, expect, it } from "vitest";

import { cleanPick, editBrief, editLanes, factsLine, joinEdits, nameFromUrl, pickMatches } from "./edit";

describe("edit mockups — three readings of one change", () => {
  const lanes = editLanes("Make the hero dark navy.");

  it("always gives three lanes, in a fixed order", () => {
    expect(lanes.map((l) => l.id)).toEqual(["faithful", "polished", "bold"]);
  });

  it("the first lane is the owner's own words, tidied", () => {
    expect(lanes[0].instruction).toBe("Make the hero dark navy");
  });

  it("the three readings differ, so the lanes are a real choice", () => {
    expect(new Set(lanes.map((l) => l.instruction)).size).toBe(3);
  });

  it("takes readings written from the code, by position, and keeps defaults for the rest", () => {
    const custom = editLanes("Dark hero", [{ label: "Navy hero", instruction: "Navy #0b1b3a hero, white h1" }, undefined]);
    expect(custom[0].label).toBe("Navy hero");
    expect(custom[0].instruction).toBe("Navy #0b1b3a hero, white h1");
    expect(custom[1].label).toBe("Polished");
  });

  it("never mocks up an empty request", () => {
    expect(editLanes("   ")[0].instruction).toBe("Tidy this page");
  });
});

describe("facts", () => {
  it("facts are only well-formed colours and short font names", () => {
    expect(factsLine({ colors: ["#ff4d2e", "red", "#12"], fonts: ["Inter"] })).toBe(
      "The site uses brand colours #ff4d2e; typeface Inter.",
    );
    expect(factsLine({})).toBe("");
  });
});

describe("the pick reaches the build", () => {
  const pick = {
    lane: "polished" as const,
    label: "Polished",
    edit: "Make the hero dark",
    instruction: "Make the hero dark, with the surrounding section refined to match",
    tweaks: ["make the button green"],
  };

  it("the brief names the lane, the reading, every tweak and the check", () => {
    const b = editBrief({ siteName: "Bloom", url: "https://bloom.co", pick, facts: { features: ["the /order page"] } });
    expect(b).toContain('picked "Polished"');
    expect(b).toContain("refined to match");
    expect(b).toContain("- make the button green");
    expect(b).toContain("- the /order page");
    expect(b).toContain("390 px");
  });

  it("joins several edits the same way everywhere", () => {
    expect(joinEdits(["Bigger logo.", "  ", "Green button;"])).toBe("Bigger logo; Green button");
  });

  it("recognises a pick made for the same edits, and refuses an old one", () => {
    expect(pickMatches(pick, "make the hero dark.")).toBe(true);
    expect(pickMatches(pick, "Make the footer dark")).toBe(false);
    expect(pickMatches(null, "x")).toBe(false);
  });

  it("checks a pick sent by a browser", () => {
    expect(cleanPick({ ...pick, lane: "sneaky" })).toBeNull();
    expect(cleanPick({ lane: "bold", edit: "", instruction: "x" })).toBeNull();
    const ok = cleanPick({ ...pick, tweaks: ["a", 3, "b", "c", "d", "e", "f", "g"], label: "" });
    expect(ok?.tweaks).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(ok?.label).toBe("Polished");
  });
});

describe("naming a site from its address", () => {
  it("reads a name from the host", () => {
    expect(nameFromUrl("https://www.bloom-florist.co.uk/order")).toBe("Bloom Florist");
  });
  it("never invents a name for a local address or nonsense", () => {
    expect(nameFromUrl("http://localhost:3000/apps/x")).toBe("This site");
    expect(nameFromUrl("not a url")).toBe("This site");
  });
});
