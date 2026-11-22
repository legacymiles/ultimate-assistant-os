import { describe, expect, it } from "vitest";
import { systemPrompt } from "./agent";
import { classifyIntake, GUIDES } from "./intake";
import { gapsFor, isEquipment, needsResearch, researchBlock, researchQuery, subjectOf } from "./research";
import { ROOT, seedProfiles } from "./seed";
import type { ProfileNode, ProfilesData } from "./types";

/** A machine profile holding only what a shop listing gives you. */
function listingOnly(): ProfileNode {
  return {
    // Not "dtf": the seed already uses that id for one of its three machines.
    id: "mymachine",
    name: "DTF printer",
    kind: "thing",
    label: "Equipment",
    sub: "",
    children: [],
    links: [],
    media: [],
    sections: [
      {
        id: "s1",
        title: "Details",
        items: [{ id: "i1", k: "Model", v: 'Lancelot M1630 Pro A3 13" all-in-one DTF kit with auto powder shaker' }],
      },
    ],
  };
}

/** The machine in a folder of its own, so the seed's own machines don't count. */
function withNode(node: ProfileNode): ProfilesData {
  const data = seedProfiles();
  data.nodes[node.id] = node;
  data.nodes.shed = {
    id: "shed",
    name: "The shed",
    kind: "thing",
    label: "Folder",
    sub: "",
    children: [node.id],
    links: [],
    sections: [],
    media: [],
  };
  data.nodes[ROOT].children = [...data.nodes[ROOT].children, "shed"];
  return data;
}

describe("needsResearch", () => {
  it("researches how-to questions", () => {
    for (const q of [
      "how do I set up the RIP software?",
      "why won't it print white?",
      "what temperature should the shaker be?",
      "the printer keeps clogging",
      "walk me through calibrating it",
      "which film is compatible?",
    ]) {
      expect(needsResearch(q), q).toBe(true);
    }
  });

  it("leaves plain record lookups to the outline", () => {
    for (const q of [
      "what's my son's teacher's email?",
      "where is the gas code?",
      "when did I buy the printer?",
      "show me the heat press settings",
      "how many profiles do I have?",
    ]) {
      expect(needsResearch(q), q).toBe(false);
    }
  });

  it("treats a lookup worded with a research word as a lookup", () => {
    // Their own notes come first: this is "where is it", not "teach me".
    expect(needsResearch("where is the manual for my printer?")).toBe(false);
  });

  it("ignores empty input", () => {
    expect(needsResearch("")).toBe(false);
    expect(needsResearch("   ")).toBe(false);
  });
});

describe("gapsFor", () => {
  it("names what a listing-only profile is missing", () => {
    const gaps = gapsFor(listingOnly());
    expect(gaps).toHaveLength(3);
    expect(gaps.join(" ")).toMatch(/software/);
    expect(gaps.join(" ")).toMatch(/ink, film, powder/);
    expect(gaps.join(" ")).toMatch(/operating system/);
    // It DOES have a model row, so that is not asked for again.
    expect(gaps.join(" ")).not.toMatch(/model and serial/);
  });

  it("is empty once the profile is filled in", () => {
    const node = listingOnly();
    node.sections.push({
      id: "s2",
      title: "Software",
      items: [
        { id: "i2", k: "RIP software", v: "Acrorip 10.3" },
        { id: "i3", k: "Ink", v: "Lancelot CMYK + white" },
        { id: "i4", k: "Computer", v: "Windows 11 laptop" },
      ],
    });
    expect(gapsFor(node)).toEqual([]);
  });

  it("says nothing about a profile that isn't there", () => {
    expect(gapsFor(undefined)).toEqual([]);
  });
});

describe("isEquipment", () => {
  it("recognises a machine by its label", () => {
    expect(isEquipment(listingOnly())).toBe(true);
  });

  it("does not treat a person as equipment", () => {
    const data = seedProfiles();
    expect(isEquipment(data.nodes.son)).toBe(false);
  });
});

describe("subjectOf", () => {
  it("is the machine when you are looking at it", () => {
    const data = withNode(listingOnly());
    expect(subjectOf(data, "mymachine")?.id).toBe("mymachine");
  });

  it("is the one machine inside the folder you are looking at", () => {
    const data = withNode(listingOnly());
    expect(subjectOf(data, "shed")?.id).toBe("mymachine");
  });

  it("does not guess when a folder holds two machines", () => {
    const data = withNode(listingOnly());
    data.nodes.second = { ...listingOnly(), id: "second", name: "Second printer" };
    data.nodes.shed.children = [...data.nodes.shed.children, "second"];
    expect(subjectOf(data, "shed")).toBeUndefined();
  });

  it("does not guess inside the seed's Equipment folder, which holds three", () => {
    expect(subjectOf(seedProfiles(), "equipment")).toBeUndefined();
  });
});

describe("researchQuery", () => {
  it("anchors the search to the model, not the owner's nickname", () => {
    const q = researchQuery("why won't it print white?", listingOnly());
    expect(q).toMatch(/Lancelot M1630 Pro/);
    expect(q).toMatch(/white/);
    // "my"/"the" are noise in a search box.
    expect(q).not.toMatch(/\bmy\b/);
  });

  it("does not repeat a model the owner already typed", () => {
    const q = researchQuery("Lancelot M1630 Pro white ink settings", listingOnly());
    expect(q.match(/Lancelot/g)).toHaveLength(1);
  });

  it("works with no machine in context", () => {
    expect(researchQuery("how do I cure DTF transfers")).toMatch(/cure DTF transfers/);
  });
});

describe("researchBlock", () => {
  it("tells the brain to admit it when nothing came back", () => {
    expect(researchBlock("x", [])).toMatch(/Nothing came back/);
  });

  it("lists hits with their addresses and includes page text", () => {
    const block = researchBlock(
      "lancelot m1630 white ink",
      [{ title: "Manual", url: "https://example.com/m", snippet: "White ink circulation" }],
      [{ url: "https://example.com/m", text: "Set the white ink limit to 240%." }],
    );
    expect(block).toMatch(/https:\/\/example\.com\/m/);
    expect(block).toMatch(/White ink circulation/);
    expect(block).toMatch(/240%/);
  });
});

describe("equipment intake", () => {
  it("routes a machine to the equipment guide, not the generic one", () => {
    for (const q of ["add my DTF printer", "create a profile for my heat press", "new profile for my laser cutter", "make a profile for my 3d printer"]) {
      expect(classifyIntake(q).type, q).toBe("equipment");
    }
  });

  it("still routes the business itself to the business guide", () => {
    for (const q of ["add my t-shirt printing business", "create a profile for my print shop", "new profile for my resale hustle"]) {
      expect(classifyIntake(q).type, q).toBe("business");
    }
  });

  it("asks for the facts that make an answer correct", () => {
    const asks = GUIDES.equipment.questions.join(" ").toLowerCase();
    expect(asks).toMatch(/serial/);
    expect(asks).toMatch(/version/);
    expect(asks).toMatch(/warranty/);
    // The whole point: the plate, not the advert.
    expect(asks).toMatch(/differs from the name on the listing/);
  });
});

describe("the prompt", () => {
  it("lets the brain answer general knowledge but not invent the owner's facts", () => {
    const p = systemPrompt(seedProfiles(), "biz");
    expect(p).toMatch(/FACTS ABOUT THE OWNER/);
    expect(p).toMatch(/GENERAL KNOWLEDGE is different, and allowed/);
    // The old blanket ban is gone, or research can never happen.
    expect(p).not.toMatch(/Do not use tools/);
  });

  it("carries the web block and asks for the missing facts", () => {
    const data = withNode(listingOnly());
    const p = systemPrompt(data, "mymachine", "", "", {
      block: researchBlock("lancelot white ink", [{ title: "Manual", url: "https://example.com", snippet: "s" }]),
      gaps: gapsFor(listingOnly()),
      subject: "DTF printer",
    });
    expect(p).toMatch(/FROM THE WEB/);
    expect(p).toMatch(/WHAT THIS PROFILE IS MISSING/);
    expect(p).toMatch(/DTF printer's profile does not record/);
    expect(p).toMatch(/do not refuse to answer because they are missing/);
  });

  it("leaves the missing-facts block out when there is nothing to ask for", () => {
    expect(systemPrompt(seedProfiles(), "biz")).not.toMatch(/WHAT THIS PROFILE IS MISSING/);
  });

  it("includes the equipment questions so every brain asks the same ones", () => {
    expect(systemPrompt(seedProfiles(), ROOT)).toMatch(/equipment \(thing, lives:/);
  });
});
