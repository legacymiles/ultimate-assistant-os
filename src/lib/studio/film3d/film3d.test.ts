import { describe, expect, it } from "vitest";
import {
  blankDraft,
  briefText,
  checkPlan,
  coerceBeats,
  coerceHero,
  defaultHero,
  draftBeats,
  filmCode,
  filmFromBrief,
  filmOf,
  fromPrompt,
  hexOr,
  parseFilmCode,
  propFor,
  relay,
  worldFor,
  type Film3DDraft,
} from "./plan";
import { durationOf, frameAt, keyMoments, sizeFor } from "./director";
import { scoreEvents } from "./score";

function draft(over: Partial<Film3DDraft> = {}): Film3DDraft {
  const d = { ...blankDraft(), ...over };
  return { ...d, beats: over.beats ?? draftBeats(d) };
}

describe("film3d plan", () => {
  it("reads places into worlds and the want into a prop", () => {
    expect(worldFor("a pine forest")).toBe("forest");
    expect(worldFor("up the hill")).toBe("hill");
    expect(worldFor("the bakery")).toBe("town");
    expect(worldFor("somewhere odd", "park")).toBe("park");
    expect(propFor("her balloon floats away")).toBe("balloon");
    expect(propFor("he loses his dog")).toBe("puppy");
    expect(propFor("a quest")).toBe("star");
  });

  it("drafts a full arc that fills the length, with one silence before one payoff", () => {
    for (const length of [30, 45, 60] as const) {
      const d = draft({ length });
      expect(d.beats[d.beats.length - 1].end).toBe(length);
      const roles = d.beats.map((b) => b.role);
      expect(roles.filter((r) => r === "silence")).toHaveLength(1);
      expect(roles.indexOf("payoff")).toBe(roles.indexOf("silence") + 1);
      expect(roles[0]).toBe("hook");
      expect(roles[roles.length - 1]).toBe("return");
      expect(checkPlan(d)).toEqual([]);
    }
  });

  it("uses the story's places, prop and light", () => {
    const d = draft({ story: "Her balloon floats away and she follows it across the beach and into the city at night" });
    expect(d.beats.every((b) => b.prop === "balloon")).toBe(true);
    expect(d.beats.some((b) => b.world === "beach")).toBe(true);
    expect(d.beats.some((b) => b.world === "city")).toBe(true);
    expect(d.beats.every((b) => b.time === "night")).toBe(true);
  });

  it("flags plan problems", () => {
    const d = draft();
    d.beats[2] = { ...d.beats[2], caption: "this caption is far far too long to read" };
    const probs = checkPlan({ ...d, beats: d.beats.filter((b) => b.role !== "silence") });
    expect(probs.some((p) => /silence/.test(p.message))).toBe(true);
    expect(probs.some((p) => /6/.test(p.message))).toBe(true);
  });

  it("clamps a model's plan to what the engine can draw", () => {
    const beats = coerceBeats(
      [
        { role: "hook", seconds: 4, world: "Moon base", place: "the moon", move: "moonwalk", shot: "crane", prop: "unicorn", caption: "one two three four five six seven", action: "waves" },
        { role: "payoff", seconds: 3, world: "park", move: "cheer", expression: "delight", action: "cheers" },
      ],
      30,
      "kite",
    );
    expect(beats[0].world).toBe("space");
    expect(beats[0].move).toBe("idle");
    expect(beats[0].shot).toBe("medium");
    expect(beats[0].prop).toBe("kite");
    expect(beats[0].caption.split(" ")).toHaveLength(6);
    expect(beats[beats.length - 1].end).toBe(30);
    expect(hexOr("A1B2C3", "#000000")).toBe("#a1b2c3");
    expect(hexOr("#abc", "#000000")).toBe("#aabbcc");
    expect(hexOr("blue-ish", "#123456")).toBe("#123456");
    const hero = coerceHero({ hairStyle: "mohawk", accessory: "glasses", top: "#ff0000" }, defaultHero("Ada"));
    expect(hero.hairStyle).toBe(defaultHero().hairStyle);
    expect(hero.accessory).toBe("glasses");
    expect(hero.top).toBe("#ff0000");
    expect(hero.name).toBe("Ada");
  });

  it("re-lays beats end to end after an edit", () => {
    const d = draft({ length: 30 });
    const edited = d.beats.map((b, i) => (i === 1 ? { ...b, end: b.end + 2 } : b));
    const r = relay(edited);
    for (let i = 1; i < r.length; i++) expect(r[i].start).toBe(r[i - 1].end);
  });

  it("round-trips the film through the compact code the PC reads, under the queue's text cap", () => {
    const d = draft({ length: 60, title: "Milo and the very long title of the kite story" });
    const film = filmOf(d);
    const code = filmCode(film);
    const back = parseFilmCode(code)!;
    expect(back.beats).toHaveLength(film.beats.length);
    expect(back.beats.map((b) => b.world)).toEqual(film.beats.map((b) => b.world));
    expect(back.beats[back.beats.length - 1].end).toBeCloseTo(60, 1);
    expect(back.hero).toEqual(film.hero);
    const brief = briefText(d);
    expect(brief.length).toBeLessThan(3900);
    expect(filmFromBrief(brief)?.title).toBe(film.title);
    expect(parseFilmCode("not json")).toBeNull();
  });

  it("reads the Studio prompt into settings", () => {
    const s = fromPrompt("@film-3d my daughter Zoe, 30 seconds, vertical, clay — her balloon floats away at the beach");
    expect(s.name).toBe("Zoe");
    expect(s.length).toBe(30);
    expect(s.aspect).toBe("9:16");
    expect(s.look).toBe("clay");
    expect(s.story).toMatch(/balloon floats away at the beach/);
    expect(s.story).not.toMatch(/@|clay|vertical/);
    expect(fromPrompt("square neon city chase").aspect).toBe("1:1");
  });
});

describe("film3d director", () => {
  const film = filmOf(draft({ length: 45 }));

  it("is deterministic and covers the whole film", () => {
    expect(durationOf(film)).toBe(45);
    expect(frameAt(film, 12.3)).toEqual(frameAt(film, 12.3));
    expect(frameAt(film, -5).t).toBe(0);
    expect(frameAt(film, 999).beatIndex).toBe(film.beats.length - 1);
  });

  it("fades in and out, titles the open, flashes the payoff, holds the silence", () => {
    expect(frameAt(film, 0).fade).toBeGreaterThan(0.9);
    expect(frameAt(film, 1.5).title.alpha).toBeGreaterThan(0.9);
    expect(frameAt(film, 44.95).fade).toBeGreaterThan(0.8);
    const payoff = film.beats.find((b) => b.role === "payoff")!;
    expect(frameAt(film, payoff.start + 0.02).flash).toBeGreaterThan(0.5);
    const silence = film.beats.find((b) => b.role === "silence")!;
    const a = frameAt(film, silence.start + 0.2);
    const b = frameAt(film, silence.start + 0.8);
    expect(a.energy).toBe(0);
    expect(Math.abs(a.hero.phase - b.hero.phase)).toBeLessThan(0.1);
    expect(a.prop.mode).toBe("almost");
  });

  it("moves him along the path when he runs and keeps the camera on him", () => {
    const j = film.beats.find((b) => b.role === "journey")!;
    const early = frameAt(film, j.start + 0.3);
    const late = frameAt(film, j.end - 0.3);
    expect(late.hero.pos[0]).toBeGreaterThan(early.hero.pos[0]);
    expect(Math.abs(late.camera.target[0] - late.hero.pos[0])).toBeLessThan(4);
  });

  it("cuts the rush into four shots", () => {
    const rush = film.beats.find((b) => b.role === "rush")!;
    const shots = new Set([0.1, 0.35, 0.6, 0.85].map((u) => JSON.stringify(frameAt(film, rush.start + u * (rush.end - rush.start)).camera.fov)));
    expect(shots.size).toBeGreaterThan(1);
    expect(keyMoments(film).length).toBe(film.beats.length + 3);
  });

  it("sizes frames for each aspect", () => {
    expect(sizeFor("16:9", 720)).toEqual({ width: 1280, height: 720 });
    expect(sizeFor("9:16", 1080)).toEqual({ width: 1080, height: 1920 });
    expect(sizeFor("1:1", 720)).toEqual({ width: 720, height: 720 });
  });
});

describe("film3d score", () => {
  const film = filmOf(draft({ length: 45 }));
  const events = scoreEvents(film);

  it("goes silent in the silence and hits hardest on the payoff", () => {
    const silence = film.beats.find((b) => b.role === "silence")!;
    const payoff = film.beats.find((b) => b.role === "payoff")!;
    const inSilence = events.filter((e) => e.t < silence.end - 0.01 && e.t + e.dur > silence.start + 0.01);
    expect(inSilence).toEqual([]);
    const hits = events.filter((e) => Math.abs(e.t - payoff.start) < 0.01);
    expect(hits.some((e) => e.voice === "sub")).toBe(true);
    expect(hits.some((e) => e.voice === "crash")).toBe(true);
  });

  it("is fullest in the rush and thin at the start", () => {
    const rush = film.beats.find((b) => b.role === "rush")!;
    const hook = film.beats[0];
    const rate = (b: { start: number; end: number }) => events.filter((e) => e.t >= b.start && e.t < b.end).length / (b.end - b.start);
    expect(rate(rush)).toBeGreaterThan(rate(hook) * 1.5);
    expect(events.every((e) => e.t >= 0 && e.t < durationOf(film))).toBe(true);
  });
});

describe("film3d hero from a picture's palette (no AI)", () => {
  it("finds the skin, then dresses the top and accent in the picture's colours", async () => {
    const { heroFromPalette, skinLike } = await import("./plan");
    expect(skinLike("#e0a77a")).toBe(true);
    expect(skinLike("#22a06b")).toBe(false);
    const h = heroFromPalette(["#22a06b", "#e0a77a", "#c0392b", "#ffffff", "#ff7a00"], defaultHero());
    expect(h.skin).toBe("#e0a77a");
    expect(h.top).toBe("#22a06b");
    expect(h.accent).toBe("#c0392b");
    expect(heroFromPalette([], defaultHero())).toEqual(defaultHero());
  });
});
