import { describe, expect, it } from "vitest";

import type { BuilderProject, Feature, FeatureKind } from "../app-builder/types";
import { directionFor, directionsFor } from "./directions";
import { esc, renderMockup } from "./render";
import { clip, seed, shapeOf, specFromEdits, specFromProject } from "./spec";
import type { MockupSpec } from "./types";

const T = "2026-11-09T10:00:00.000Z";

function feature(over: Partial<Feature> & { title: string }): Feature {
  return {
    id: over.id ?? `f_${over.title.slice(0, 6)}`,
    title: over.title,
    why: over.why ?? "It is why the app exists",
    detail: over.detail ?? "Does the thing, end to end",
    kind: (over.kind ?? "core") as FeatureKind,
    impact: over.impact ?? 3,
    effort: over.effort ?? "M",
    status: over.status ?? "accepted",
    source: over.source ?? "agent",
  };
}

function project(over: Partial<BuilderProject> = {}): BuilderProject {
  return {
    id: "p_1",
    createdAt: T,
    updatedAt: T,
    idea: "An app that keeps my receipts in order",
    stage: "features",
    questions: [],
    answers: {},
    understanding: {
      name: "Receipt Keeper",
      oneLiner: "Every receipt, filed the moment you photograph it",
      appType: "webapp",
      purpose: "Stop losing expenses at tax time",
      audience: "Freelancers who hate paperwork",
      endGoal: "Never think about a receipt again",
      beyond: "Taxes stop being a weekend",
      model: "Free, with a paid export later",
      designSkill: "minimalist-skill",
      designWhy: "Calm beats clever for paperwork",
      judge: ["A receipt is filed in under 5 seconds"],
    },
    features: [
      feature({ title: "Photograph a receipt", kind: "core", impact: 3 }),
      feature({ title: "Find any receipt by shop", kind: "experience", impact: 2 }),
      feature({ title: "Export a tax year", kind: "money", impact: 2, status: "accepted" }),
      feature({ title: "Scan a QR loyalty card", status: "denied" }),
    ],
    chat: [],
    ...over,
  };
}

describe("the spec a mockup is drawn from", () => {
  it("uses the owner's own words and never placeholder filler", () => {
    const spec = specFromProject(project());
    expect(spec.name).toBe("Receipt Keeper");
    expect(spec.rows.map((r) => r.title)).toEqual([
      "Photograph a receipt",
      "Find any receipt by shop",
      "Export a tax year",
    ]);
    const text = JSON.stringify(spec).toLowerCase();
    expect(text).not.toContain("lorem");
    expect(text).not.toContain("item 1");
    expect(text).not.toContain("placeholder");
  });

  it("leaves declined features out of the mockup", () => {
    const spec = specFromProject(project());
    expect(spec.rows.map((r) => r.title)).not.toContain("Scan a QR loyalty card");
  });

  it("gives the same numbers every time, so three lanes compare design and not noise", () => {
    const a = specFromProject(project());
    const b = specFromProject(project());
    expect(a.stats).toEqual(b.stats);
    expect(seed("Receipt Keeper")).toBe(seed("Receipt Keeper"));
    expect(seed("Receipt Keeper")).not.toBe(seed("Receipt Keeper 2"));
  });

  it("still draws something before any feature is accepted", () => {
    const p = project({ features: [feature({ title: "Photograph a receipt", status: "proposed" })] });
    const spec = specFromProject(p);
    expect(spec.rows).toHaveLength(1);
  });

  it("falls back to an empty-state surface with no features at all", () => {
    const spec = specFromProject(project({ features: [] }));
    expect(spec.rows).toHaveLength(0);
    const html = renderMockup(spec, directionFor("minimalist-skill"));
    expect(html).toContain("No items yet");
  });

  it("reads the shape off the features, not just the dropdown", () => {
    expect(shapeOf("webapp", [feature({ title: "Move a job through three stages" })])).toBe("board");
    expect(shapeOf("marketplace", [feature({ title: "Browse what is for sale" })])).toBe("grid");
    expect(shapeOf("tool", [feature({ title: "Show the numbers" })])).toBe("table");
    expect(shapeOf("game", [feature({ title: "Play a round" })])).toBe("canvas");
  });

  it("clips long text on a word boundary", () => {
    expect(clip("a short one", 40)).toBe("a short one");
    const out = clip("a sentence that keeps going well past the limit it was given", 24);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(25);
    expect(out).not.toContain("  ");
  });

  it("names the screens a recording was taken apart into", () => {
    const p = project({
      teardown: {
        mode: "recreate",
        summary: "A receipts app",
        screens: [
          { name: "Inbox", purpose: "new receipts", elements: [] },
          { name: "Shops", purpose: "by shop", elements: [] },
        ],
        flow: [],
        behaviours: [],
        dataModel: [],
        stackGuess: "",
        changes: [],
        unknowns: [],
      },
    });
    expect(specFromProject(p).nav).toContain("Inbox");
    expect(specFromProject(p).nav).toContain("Shops");
  });
});

describe("the three directions", () => {
  it("puts the recommended skill first and labels it", () => {
    const d = directionsFor("minimalist-skill");
    expect(d).toHaveLength(3);
    expect(d[0].skill).toBe("minimalist-skill");
    expect(d[0].role).toBe("recommended");
    expect(d.slice(1).every((x) => x.role === "contrast")).toBe(true);
  });

  it("never offers the same direction twice", () => {
    for (const start of ["minimalist-skill", "brutalist-skill", "soft-skill", "cinematic-ui", "taste-skill"]) {
      const skills = directionsFor(start).map((d) => d.skill);
      expect(new Set(skills).size).toBe(3);
    }
  });

  it("makes the lanes actually disagree — different chrome, not three colourways", () => {
    const d = directionsFor("minimalist-skill");
    expect(new Set(d.map((x) => x.chrome)).size).toBe(3);
  });

  it("falls back to the studio default rather than failing on an unknown skill", () => {
    expect(directionsFor("not-a-real-skill")[0].skill).toBe("interactive-web-studio");
    expect(directionsFor(undefined)[0].skill).toBe("interactive-web-studio");
    expect(directionsFor("")[0].skill).toBe("interactive-web-studio");
  });

  it("every direction carries a concrete note for the owner to read", () => {
    for (const d of directionsFor("soft-skill")) {
      expect(d.note.length).toBeGreaterThan(12);
    }
  });
});

describe("drawing one", () => {
  const spec = specFromProject(project());

  it("is one whole document, so it is safe to hand to an iframe", () => {
    const html = renderMockup(spec, directionFor("minimalist-skill"));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("<style>");
  });

  it("runs nothing — there is no script in a mockup", () => {
    for (const skill of ["minimalist-skill", "brutalist-skill", "cinematic-ui", "soft-skill"]) {
      const html = renderMockup(spec, directionFor(skill));
      expect(html).not.toContain("<script");
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("onerror=");
    }
  });

  it("escapes the spec, because every word in it was typed by a person", () => {
    const nasty = specFromProject(
      project({
        understanding: {
          ...project().understanding!,
          name: '<img src=x onerror="alert(1)">',
          oneLiner: "Tom & Jerry's \"big\" idea",
        },
      }),
    );
    const html = renderMockup(nasty, directionFor("minimalist-skill"));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
    expect(html).toContain("Tom &amp; Jerry&#39;s");
    expect(esc('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });

  it("draws the app's own content, in every direction", () => {
    for (const d of directionsFor("minimalist-skill")) {
      const html = renderMockup(spec, d);
      expect(html).toContain("Receipt Keeper");
      expect(html).toContain("Photograph a receipt");
      expect(html).toContain("Freelancers who hate paperwork");
    }
  });

  it("keeps the shape the same across lanes and changes only the frame", () => {
    const lanes = directionsFor("minimalist-skill").map((d) => renderMockup(spec, d));
    for (const html of lanes) expect(html).toContain('shape-list"');
    expect(new Set(lanes).size).toBe(3);
  });

  it("drops the side panel and the rail on a phone", () => {
    const phone = renderMockup(spec, directionFor("minimalist-skill"), { device: "phone" });
    expect(phone).not.toContain('class="panel"');
    expect(phone).toContain(".rail{display:none !important;}");
  });

  it("never lets the backdrop show through the text on a card", () => {
    // The body carries a hairline grid or a field gradient. Cards used to sit
    // on a 3% wash, so those stripes ran straight through the row text at a
    // phone width (checklist U8). Every surface now sits on --surface, which
    // is mixed with --void and therefore opaque.
    for (const skill of ["interactive-web-studio", "brutalist-skill", "minimalist-skill", "soft-skill", "cinematic-ui"]) {
      const html = renderMockup(spec, directionFor(skill));
      const styles = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
      expect(styles).toContain("--surface:color-mix(in srgb, var(--ink) 4%, var(--void))");
      expect(styles).not.toMatch(/background:\s*color-mix\(in srgb, var\(--ink\) \d+%, transparent\)/);
    }
  });

  it("keeps nav labels short enough to read as destinations", () => {
    const s = specFromProject(project());
    for (const item of s.nav) expect(item.length).toBeLessThanOrEqual(24);
    // "Photograph a receipt" is an act, not a place — it must not be in the nav.
    expect(s.nav).not.toContain("Photograph a receipt");
    expect(s.nav).toContain("Export a tax year");
    expect(s.nav.length).toBeGreaterThanOrEqual(3);
  });

  it("honours reduced motion", () => {
    expect(renderMockup(spec, directionFor("cinematic-ui"))).toContain("prefers-reduced-motion");
  });

  it("loads only the faces its skin asks for, by absolute path", () => {
    const html = renderMockup(spec, directionFor("brutalist-skill"));
    const faces = [...html.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.length).toBeLessThanOrEqual(3);
    expect(new Set(faces).size).toBe(faces.length);
    expect(html).not.toContain("https://fonts.g");
  });

  it("draws every shape without throwing", () => {
    const shapes: MockupSpec["shape"][] = ["board", "grid", "list", "feed", "table", "canvas"];
    for (const shape of shapes) {
      for (const device of ["desktop", "phone"] as const) {
        const html = renderMockup({ ...spec, shape }, directionFor("soft-skill"), { device });
        expect(html).toContain(`shape-${shape}`);
      }
    }
  });
});

describe("a client's approved edits, drawn", () => {
  const spec = specFromEdits({
    siteName: "Harbour Dental",
    clientName: "Ana",
    version: "v3",
    edits: [
      { text: "Make the booking button green", pin: { x: 0.8, y: 0.12 } },
      { text: "Swap the hero photo for the new one" },
    ],
  });

  it("shows the client's own words as the surface", () => {
    expect(spec.rows[0].title).toBe("Make the booking button green");
    expect(spec.rows[1].meta).toBe("Asked for in writing");
    expect(spec.name).toBe("Harbour Dental");
  });

  it("says where they pointed, in plain English", () => {
    expect(spec.rows[0].meta).toBe("Pointed at 80% across, 12% down");
  });

  it("counts the changes honestly", () => {
    expect(spec.oneLiner).toContain("2 changes Ana asked for");
    expect(spec.stats.find((s) => s.label === "Changes")?.value).toBe("2");
  });

  it("renders for the client without a script", () => {
    const html = renderMockup(spec, directionFor("soft-skill"));
    expect(html).not.toContain("<script");
    expect(html).toContain("Harbour Dental");
  });
});
