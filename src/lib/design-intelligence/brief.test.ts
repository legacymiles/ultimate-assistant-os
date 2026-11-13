import { describe, expect, it } from "vitest";
import { designIntelligenceBlock, designIntelligenceLine, HUB_PACKAGES } from "./brief";
import { REGISTRIES, SOURCES, registriesJson } from "./sources";

describe("designIntelligenceBlock", () => {
  it("build: the six steps, research, components, the standout rule and the check", () => {
    const b = designIntelligenceBlock({ mode: "build", skill: "taste-skill" });
    expect(b.startsWith("<design_intelligence>")).toBe(true);
    expect(b.endsWith("</design_intelligence>")).toBe(true);
    for (const n of ["1. Understand", "2. Research", "3. Choose a direction", "4. Find and implement", "5. Build it cohesive", "6. Preview, inspect, test and refine"]) {
      expect(b).toContain(n);
    }
    expect(b).toContain("run taste-skill");
    expect(b).toContain('data-standout="');
    expect(b).toContain('node "$JARVIS_DESIGN_CHECK"');
    expect(b).toContain("--important /");
    expect(b).toContain("@magicui");
    expect(b).toContain("21st.dev/r/");
  });

  it("never authors a design: no palette, typeface or hex colour", () => {
    for (const mode of ["build", "review", "redesign"] as const) {
      const b = designIntelligenceBlock({ mode });
      expect(b).not.toMatch(/#[0-9a-f]{6}\b/i);
      expect(b).not.toMatch(/\buse (the )?(font|typeface) /i);
    }
  });

  it("is honest that the inspiration sites have no API", () => {
    expect(designIntelligenceBlock({ mode: "build" })).toMatch(/None of those three has an API or MCP/);
  });

  it("redesign: baselines the current site and must beat it", () => {
    const b = designIntelligenceBlock({ mode: "redesign", beforeUrl: "https://old.example.org" });
    expect(b).toContain("Run it FIRST on the current site (https://old.example.org)");
    expect(b).toContain("higher score than the baseline");
    expect(b).toContain("functionality inventory");
  });

  it("review: matches the site, no redesign, no new fails", () => {
    const b = designIntelligenceBlock({ mode: "review", beforeUrl: "https://client.example.org", importantPaths: ["/apps/cook"] });
    expect(b).toContain("No redesign");
    expect(b).toContain("may not add a single new fail");
    expect(b).toContain("--important /apps/cook");
    expect(b).not.toContain("1. Understand");
  });

  it("no-install folders port components with packages already present", () => {
    const b = designIntelligenceBlock({ mode: "build", canInstall: false, runHint: "Start it with X." });
    expect(b).toContain("may not install anything");
    expect(b).not.toContain("npx shadcn@latest init");
    for (const p of HUB_PACKAGES) expect(b).toContain(p);
    expect(b).toContain("- Start it with X.");
  });

  it("apps get an app-shaped standout, websites a page-shaped one", () => {
    expect(designIntelligenceBlock({ mode: "build", surface: "app" })).toContain("command palette");
    expect(designIntelligenceBlock({ mode: "build", surface: "website" })).toContain("the hero's mechanic");
  });

  it("the one-liners fit a queue request", () => {
    for (const mode of ["build", "review", "redesign"] as const) expect(designIntelligenceLine(mode).length).toBeLessThan(330);
  });
});

describe("sources", () => {
  it("every source says how and under what licence", () => {
    for (const s of SOURCES) {
      expect(s.howTo.length, s.id).toBeGreaterThan(20);
      expect(s.licence.length, s.id).toBeGreaterThan(3);
      expect(s.url, s.id).toMatch(/^https:\/\//);
    }
  });

  it("browse-only sources are never copyable and never claim an API", () => {
    for (const s of SOURCES.filter((x) => x.access.length === 1 && x.access[0] === "browse" && x.role === "inspiration")) {
      expect(s.copyable, s.id).toBe(false);
    }
    expect(SOURCES.find((s) => s.id === "aura")?.access).toEqual(["browse"]);
    expect(SOURCES.find((s) => s.id === "awwwards")?.access).toEqual(["browse"]);
  });

  it("registries are namespaced shadcn templates", () => {
    for (const [ns, url] of Object.entries(REGISTRIES)) {
      expect(ns).toMatch(/^@[a-z0-9-]+$/);
      expect(url).toContain("{name}");
    }
    expect(JSON.parse(registriesJson()).registries).toEqual(REGISTRIES);
  });
});
