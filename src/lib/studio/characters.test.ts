import { describe, expect, it } from "vitest";
import {
  characterContext,
  characterToken,
  charactersIn,
  cleanCharacters,
  searchCharacters,
  uniqueTokens,
  type CharacterMention,
} from "./characters";
import { pick } from "./render";

function person(name: string, extra: Partial<CharacterMention> = {}): CharacterMention {
  return { token: characterToken(name), name, kind: "person", role: "Friend", pictures: 3, ...extra };
}

describe("characterToken", () => {
  it("makes a name safe to type after an @ and still readable", () => {
    expect(characterToken("Brandy")).toBe("Brandy");
    expect(characterToken("Aunt Mary")).toBe("Aunt-Mary");
    expect(characterToken("  Bob   O'Neill Jr.  ")).toBe("Bob-ONeill-Jr");
  });

  it("never returns an empty token, because @ + nothing matches everything", () => {
    expect(characterToken("!!!")).toBe("character");
  });

  it("keeps two people with the same name apart", () => {
    expect(uniqueTokens(["Chris", "Chris", "Dana"])).toEqual(["Chris", "Chris-2", "Dana"]);
  });
});

describe("charactersIn", () => {
  const all = [person("Brandy"), person("Aunt Mary"), person("Leo")];

  it("finds the people a prompt names, in order, without repeats", () => {
    const hits = charactersIn("@Brandy and @Aunt-Mary walk in, then @Brandy sits", all);
    expect(hits.map((c) => c.name)).toEqual(["Brandy", "Aunt Mary"]);
  });

  it("is case-insensitive, because nobody types their own family carefully", () => {
    expect(charactersIn("@brandy laughing", all).map((c) => c.name)).toEqual(["Brandy"]);
  });

  it("ignores an @ that is not a known person", () => {
    expect(charactersIn("@kids-story about @Nobody", all)).toEqual([]);
  });

  it("does not match a name buried inside another word", () => {
    expect(charactersIn("email brandy@example.com", all)).toEqual([]);
  });

  it("does not let a shorter name swallow a longer one", () => {
    const two = [person("Mary"), person("Aunt Mary")];
    expect(charactersIn("@Aunt-Mary in the kitchen", two).map((c) => c.name)).toEqual(["Aunt Mary"]);
  });
});

describe("searchCharacters", () => {
  const all = [person("Brandy"), person("Aunt Mary"), person("Bradley")];

  it("puts a name that starts with the query first", () => {
    expect(searchCharacters("bra", all).map((c) => c.name)).toEqual(["Brandy", "Bradley"]);
  });

  it("matches on a middle word too", () => {
    expect(searchCharacters("mary", all).map((c) => c.name)).toEqual(["Aunt Mary"]);
  });

  it("offers everyone when nothing has been typed yet", () => {
    expect(searchCharacters("", all)).toHaveLength(3);
  });
});

describe("characterContext", () => {
  it("tells the model to write the description rather than the token", () => {
    const block = characterContext([
      person("Brandy", { appearance: "A woman in her thirties with...", identifiers: ["round jaw"] }),
    ]);
    expect(block).toContain("@Brandy");
    expect(block).toContain("A woman in her thirties with...");
    expect(block).toContain("round jaw");
    expect(block).toMatch(/write the DESCRIPTION/);
  });

  it("says a person has no sheet instead of letting one be invented", () => {
    const block = characterContext([person("Brandy", { pictures: 4 })]);
    expect(block).toContain("4 pictures");
    expect(block).toMatch(/no\s+written description yet/);
  });

  it("is empty when nobody was named, so it costs no tokens", () => {
    expect(characterContext([])).toBe("");
  });
});

describe("cleanCharacters", () => {
  it("drops anything nameless and clamps the rest", () => {
    const out = cleanCharacters([
      { name: "", appearance: "x" },
      { name: "Brandy", appearance: "a".repeat(5000), identifiers: ["one", "two", "three", "four", "five", "six", "seven"] },
      "not an object",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].appearance).toHaveLength(1200);
    expect(out[0].identifiers).toHaveLength(6);
  });

  it("invents a token when the client sent none", () => {
    expect(cleanCharacters([{ name: "Aunt Mary" }])[0].token).toBe("Aunt-Mary");
  });

  it("refuses a non-array without throwing", () => {
    expect(cleanCharacters(undefined)).toEqual([]);
    expect(cleanCharacters({ name: "Brandy" })).toEqual([]);
  });
});

describe("pick, with characters", () => {
  const brandy = { token: "Brandy", name: "Brandy", images: ["b1", "b2", "b3"] };
  const leo = { token: "Leo", name: "Leo", images: ["l1", "l2"] };
  const job = (prompt: string) => ({ title: "t", prompt, useReferences: true });

  it("attaches a named person even though the prompt no longer names them", () => {
    // The approved prompt carries her description, not "@Brandy" — so a job that
    // only got her faces because the conversation named her is the whole feature.
    const refs = pick(job("A woman in her thirties steps off the bus"), [], [brandy]);
    expect(refs).toEqual([
      { label: "Brandy", dataUrl: "b1" },
      { label: "Brandy", dataUrl: "b2" },
    ]);
  });

  it("narrows to the person a job does name", () => {
    const refs = pick(job("@Leo alone in the yard"), [], [brandy, leo]);
    expect(refs.map((r) => r.label)).toEqual(["Leo", "Leo"]);
  });

  it("gives one face each once there are more than two people", () => {
    const dana = { token: "Dana", name: "Dana", images: ["d1", "d2"] };
    expect(pick(job("the three of them"), [], [brandy, leo, dana]).map((r) => r.dataUrl)).toEqual([
      "b1",
      "l1",
      "d1",
    ]);
  });

  it("puts faces ahead of uploads and never exceeds the cap", () => {
    const uploads = ["u1", "u2", "u3", "u4", "u5"];
    const refs = pick(job("Subject 1 Subject 2 Subject 3 Subject 4 Subject 5"), uploads, [brandy]);
    expect(refs).toHaveLength(6);
    expect(refs.slice(0, 2).map((r) => r.label)).toEqual(["Brandy", "Brandy"]);
    expect(refs.slice(2).map((r) => r.label)).toEqual(["Subject 1", "Subject 2", "Subject 3", "Subject 4"]);
  });

  it("still attaches a person when there are no uploads at all", () => {
    expect(pick(job("she laughs"), [], [leo])).toHaveLength(2);
  });

  it("honours use_references: false for people as well as uploads", () => {
    expect(pick({ title: "t", prompt: "@Leo", useReferences: false }, ["u1"], [leo])).toEqual([]);
  });

  it("is unchanged for a conversation with no characters", () => {
    expect(pick(job("Subject 2"), ["u1", "u2"], []).map((r) => r.label)).toEqual(["Subject 2"]);
  });
});
