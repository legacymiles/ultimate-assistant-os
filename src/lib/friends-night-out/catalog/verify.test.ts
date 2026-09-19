import { describe, expect, it } from "vitest";
import { buildNameQueries, dedupeByNameAndPlace, matchByName, normName, parseDiscovery } from "./verify";

describe("normName", () => {
  it("ignores case, accents, 'the', punctuation and &", () => {
    expect(normName("The Café & Bar!")).toBe("cafe and bar");
    expect(normName("  Kitty’s   Lounge ")).toBe("kittys lounge");
  });
});

describe("parseDiscovery", () => {
  it("reads places, fills the asked section, drops nameless and duplicates", () => {
    const reply = `Here you go:
{"places":[
 {"name":"Kitty Lounge","address":"12 Main St","why":"Cat cafe with 20 rescue cats"},
 {"name":"kitty lounge"},
 {"address":"no name"},
 {"name":"The Soda Fountain","why":"Speakeasy behind a soda machine"}
]}`;
    const out = parseDiscovery(reply, "gems");
    expect(out.map((c) => c.name)).toEqual(["Kitty Lounge", "The Soda Fountain"]);
    expect(out[0]).toMatchObject({ section: "gems", address: "12 Main St", why: "Cat cafe with 20 rescue cats" });
  });

  it("returns [] for garbage", () => {
    expect(parseDiscovery("no json", "food")).toEqual([]);
  });
});

describe("buildNameQueries", () => {
  it("escapes regex characters and batches", () => {
    const qs = buildNameQueries(["A+B (Bar)", "Plain"], "1,2,3,4", 1);
    expect(qs).toHaveLength(2);
    expect(qs[0]).toContain('nwr["name"~"A\\\\+B \\\\(Bar\\\\)",i](1,2,3,4);');
  });
});

describe("matchByName", () => {
  const center = { lat: 40, lon: -83 };
  const els = [
    { type: "node" as const, id: 1, lat: 40.01, lon: -83, tags: { name: "The Kitty Lounge" } },
    { type: "node" as const, id: 2, lat: 45, lon: -83, tags: { name: "Soda Fountain" } }, // far away
    { type: "node" as const, id: 3, lat: 40.02, lon: -83, tags: { name: "Soda Fountain Co" } },
  ];

  it("matches by normalized name inside the radius, nearest first", () => {
    const { matched, unmatched } = matchByName(
      [
        { name: "Kitty Lounge", section: "gems" },
        { name: "Soda Fountain", section: "gems" },
        { name: "Nowhere Diner", section: "food" },
      ],
      els,
      center,
      10,
    );
    expect(matched.map((m) => [m.candidate.name, m.element.id])).toEqual([
      ["Kitty Lounge", 1],
      ["Soda Fountain", 3],
    ]);
    expect(unmatched.map((c) => c.name)).toEqual(["Nowhere Diner"]);
  });

  it("does not match short names by containment", () => {
    const { matched } = matchByName([{ name: "Bar", section: "food" }], [
      { type: "node", id: 9, lat: 40, lon: -83, tags: { name: "Barnyard Grill" } },
    ], center, 10);
    expect(matched).toHaveLength(0);
  });
});

describe("dedupeByNameAndPlace", () => {
  it("keeps the first of two same-named places within 100 m", () => {
    const out = dedupeByNameAndPlace([
      { name: "Kitty Lounge", lat: 40, lon: -83, n: 1 },
      { name: "The Kitty Lounge", lat: 40.0005, lon: -83, n: 2 },
      { name: "Kitty Lounge", lat: 40.1, lon: -83, n: 3 }, // other branch, far
    ]);
    expect(out.map((p) => p.n)).toEqual([1, 3]);
  });
});

describe("buildNameQueries quoting", () => {
  it("drops double quotes so the Overpass string never closes early", () => {
    const [q] = buildNameQueries(['Joe\'s "Famous" Diner'], "1,2,3,4");
    expect(q).toContain('nwr["name"~"Joe\'s Famous Diner",i]');
  });
});
