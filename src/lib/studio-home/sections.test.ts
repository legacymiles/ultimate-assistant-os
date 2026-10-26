import { describe, expect, it } from "vitest";
import { isSectionOf, liveSections, pickSection, sectionById, sectionHref, sectionIds, stepSection, type HomeSection } from "./sections";
import { TRADING_SECTIONS, TRADING_DEFAULT } from "./trading";
import { GAME_SECTIONS, GAME_DEFAULT, UNFINISHED_GAMES, finishRequest } from "./games";
import { BUILDER_SECTIONS, BUILDER_DEFAULT, SHOWCASE, showcaseIdea } from "./builder";

const S: HomeSection<"a" | "b" | "c">[] = [
  { id: "a", label: "A", hint: "first", icon: "Search", hue: 10 },
  { id: "b", label: "B", hint: "second", icon: "Grid", hue: 120, pending: { title: "On the PC", body: ["Later."] } },
  { id: "c", label: "C", hint: "third", icon: "Play", hue: 240 },
];

describe("studio home sections", () => {
  it("validates what the URL asked for, keeping 'nothing asked' distinct from a default", () => {
    expect(pickSection(S, "b")).toBe("b");
    expect(pickSection(S, ["c", "a"])).toBe("c");
    expect(pickSection(S, "nope")).toBeNull();
    expect(pickSection(S, undefined)).toBeNull();
    expect(pickSection(S, 3)).toBeNull();
    expect(isSectionOf(S, "a")).toBe(true);
    expect(isSectionOf(S, "")).toBe(false);
  });

  it("walks the switcher like a tablist: arrows wrap, Home/End jump", () => {
    expect(stepSection(S, "a", "ArrowRight")).toBe("b");
    expect(stepSection(S, "c", "ArrowRight")).toBe("a");
    expect(stepSection(S, "a", "ArrowLeft")).toBe("c");
    expect(stepSection(S, "b", "Home")).toBe("a");
    expect(stepSection(S, "a", "End")).toBe("c");
  });

  it("knows which sections can mount now and builds section links", () => {
    expect(liveSections(S).map((s) => s.id)).toEqual(["a", "c"]);
    expect(sectionIds(S)).toEqual(["a", "b", "c"]);
    expect(sectionById(S, "c").hue).toBe(240);
    expect(() => sectionById(S, "x" as "a")).toThrow();
    expect(sectionHref("/apps/x", "b")).toBe("/apps/x?section=b");
    expect(sectionHref("/apps/x", "b", { idea: "a b" })).toBe("/apps/x?section=b&idea=a+b");
  });
});

describe("the three homes", () => {
  const homes = [
    { sections: TRADING_SECTIONS, def: TRADING_DEFAULT },
    { sections: GAME_SECTIONS, def: GAME_DEFAULT },
    { sections: BUILDER_SECTIONS, def: BUILDER_DEFAULT },
  ];

  it("has unique ids, a real default and a hue for every section", () => {
    for (const { sections, def } of homes) {
      const ids = sectionIds(sections);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain(def);
      for (const s of sections) {
        expect(s.hue).toBeGreaterThanOrEqual(0);
        expect(s.hue).toBeLessThan(360);
        expect(s.label).toBeTruthy();
      }
    }
  });

  it("opens Trading Studio on Replay, with EA World and EA Lab waiting on the PC", () => {
    expect(sectionIds(TRADING_SECTIONS)).toEqual(["world", "lab", "replay", "terminals", "features", "calculator"]);
    expect(TRADING_DEFAULT).toBe("replay");
    expect(TRADING_SECTIONS.filter((s) => s.pending).map((s) => s.id)).toEqual(["world", "lab"]);
    for (const s of TRADING_SECTIONS.filter((x) => x.pending)) {
      expect(s.pending!.request!.folder).toBe("app:trading-studio");
      expect(s.pending!.body.join(" ")).toMatch(/PC/);
    }
  });

  it("files a Finish it request per unfinished game in Game Studio's folder", () => {
    expect(UNFINISHED_GAMES.map((g) => g.slug)).toEqual(["slippery-escape", "item-storm-arena"]);
    for (const g of UNFINISHED_GAMES) {
      const r = finishRequest(g);
      expect(r.folder).toBe("app:game-studio");
      expect(r.text.startsWith(`Finish ${g.title}:`)).toBe(true);
      expect(r.text).toContain(g.route);
      expect(r.text.length).toBeLessThan(3_900);
      expect(g.route).toMatch(/^\/apps\//);
    }
  });

  it("turns a showcase piece into a Build idea", () => {
    expect(SHOWCASE.map((s) => s.slug)).toEqual(["fire-reveal", "kart-showcase"]);
    for (const s of SHOWCASE) expect(showcaseIdea(s)).toBe(`Build an app like ${s.title}: ${s.tag}`);
  });
});
