import { describe, expect, it } from "vitest";
import { Icon } from "@/components/icons";
import { PROJECTS } from "@/lib/catalog";
import { MERGED_INTO, isPlugin } from "@/lib/studio/plugins";
import { wallCards } from "./wall";

const cards = wallCards();

describe("the studio wall", () => {
  it("opens on the workflow wall, in the tab", () => {
    // Video is first because Studio used to BE the workflow wall: the owner's
    // muscle memory still lands on the leftmost panel.
    expect(cards[0].id).toBe("video");
    expect(cards[0].href).toBeNull();
  });

  it("sends every other panel to an app that exists", () => {
    for (const c of cards.slice(1)) {
      expect(c.href, `${c.id} has no route`).toMatch(/^\//);
      const slug = c.href!.replace("/apps/", "");
      expect(PROJECTS.some((p) => p.slug === slug), `${slug} is not in the catalog`).toBe(true);
    }
  });

  it("only panels studios the owner can actually reach", () => {
    // A panel for an app that is not offered anywhere else is a second,
    // inconsistent front door. Every studio here is a plugin on main.
    for (const c of cards.slice(1)) {
      expect(isPlugin(c.id), `${c.id} is not in PLUGIN_SLUGS`).toBe(true);
    }
  });

  it("takes its name and line from the catalog, not from a second list", () => {
    for (const c of cards.slice(1)) {
      const p = PROJECTS.find((x) => x.slug === c.id)!;
      expect(c.name).toBe(p.title);
      expect(c.tagline).toBe(p.tag ?? "");
    }
  });

  it("names something inside every studio", () => {
    for (const c of cards) expect(c.inside.length, `${c.id} is empty`).toBeGreaterThan(0);
  });

  it("draws every spine with an icon the set actually has", () => {
    for (const c of cards) {
      for (const i of c.inside) {
        expect(i.icon in Icon, `${c.id}/${i.label}: no Icon.${i.icon}`).toBe(true);
      }
    }
  });

  it("shows what moved into a studio as part of that studio", () => {
    // EA Lab and the Calculator merged into Trading Studio. The wall must say
    // so, because the whole point of the panel is to show what is inside.
    const trading = cards.find((c) => c.id === "trading-studio")!;
    const labels = trading.inside.map((i) => i.label);
    expect(labels).toContain("EA Lab");
    expect(labels).toContain("Calculator");
    // Those two reach it by different routes — a HomeSection and MERGED_INTO —
    // and the wall should not care which.
    expect(Object.entries(MERGED_INTO).some(([, home]) => home === "trading-studio")).toBe(true);
  });

  it("gives each panel its own clip", () => {
    const clips = cards.map((c) => c.clip.video);
    expect(new Set(clips).size).toBe(clips.length);
    for (const c of cards) expect(c.clip.poster).toMatch(/\.webp$/);
  });

  it("gives each panel a hue on the wheel", () => {
    for (const c of cards) {
      expect(c.hue).toBeGreaterThanOrEqual(0);
      expect(c.hue).toBeLessThan(360);
    }
  });
});
