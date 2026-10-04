// ---------------------------------------------------------------------------
// The brief's job is to lose nothing.
//
// A bake-off compares three builds of the same thing, so the brief is the one
// place a difference must NOT come from. These tests guard the two ways it
// could quietly ruin a run: dropping a feature on the way in, and letting more
// than one voice decide how the build looks.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { buildBrief, laneBranch, type BriefFeature, type TargetFacts } from "./brief";

const features: BriefFeature[] = [
  { title: "Photo inbox", description: "iPhone Shortcut pushes photos, deduped on arrival.", group: "core" },
  { title: "Destination routing", description: "A photo becomes a recipe, a list entry or a note.", group: "core" },
  { title: "City Explore Directory", description: "Errand spots worth remembering.", group: "supporting" },
];

const facts: TargetFacts = {
  name: "Dashboard",
  tagline: "The things you point a camera at, filed",
  overview: "A photo inbox with somewhere for every photo to go.",
  features,
  route: "/apps/dashboard",
  folders: ["src/components/recall", "src/lib/dashboard"],
};

const base = {
  skill: "interactive-web-studio",
  target: { kind: "my-app", slug: "dashboard" } as const,
  facts,
};

describe("buildBrief — the features survive", () => {
  it("quotes every feature title verbatim", () => {
    const out = buildBrief(base);
    for (const f of features) expect(out).toContain(f.title);
  });

  it("quotes every feature description verbatim, never summarised", () => {
    const out = buildBrief(base);
    for (const f of features) expect(out).toContain(f.description);
  });

  it("states the count, so a lane can check itself against a number", () => {
    const out = buildBrief(base);
    expect(out).toContain("Core features (2)");
    expect(out).toContain("Supporting features (1)");
  });

  it("numbers them continuously across both groups", () => {
    const out = buildBrief(base);
    expect(out).toContain("1. **Photo inbox**");
    expect(out).toContain("2. **Destination routing**");
    expect(out).toContain("3. **City Explore Directory**");
  });

  it("omits the features section entirely rather than printing an empty heading", () => {
    const out = buildBrief({ ...base, facts: { ...facts, features: [] } });
    expect(out).not.toContain("## Features");
  });
});

describe("buildBrief — one voice decides the look", () => {
  it("names the skill as sole authority", () => {
    const out = buildBrief(base);
    expect(out).toContain("Invoke the **interactive-web-studio** skill");
    expect(out).toContain("owns every visual decision");
  });

  it("names no other design skill", () => {
    const out = buildBrief(base);
    const others = ["impeccable", "taste-skill", "blender-to-web", "capcut-design", "soft-skill"];
    for (const other of others) expect(out).not.toContain(other);
  });

  it("prescribes no palette, typeface or layout of its own", () => {
    const out = buildBrief(base);
    // A hex colour anywhere in the brief means V2 started art-directing, which
    // is the exact failure this design was chosen to avoid.
    expect(out).not.toMatch(/#[0-9a-f]{6}\b/i);
    expect(out).not.toMatch(/\bfont-family\b/i);
  });

  it("tells the lane that converging on something safe wastes the run", () => {
    const out = buildBrief(base);
    expect(out).toContain("bake-off");
    expect(out).toMatch(/safe, familiar layout/);
  });
});

describe("buildBrief — the contract", () => {
  it("always demands it run with no keys set", () => {
    expect(buildBrief(base)).toContain("NO environment keys");
  });

  it("forbids touching the shared node_modules junction", () => {
    expect(buildBrief(base)).toContain("junction shared with the main checkout");
  });

  it("tells the lane to commit nothing, because landing is the owner's call", () => {
    expect(buildBrief(base)).toContain("Commit nothing");
  });

  it("names the route the build has to serve", () => {
    expect(buildBrief(base)).toContain("/apps/dashboard");
  });

  it("points at today's folders when there are any", () => {
    const out = buildBrief(base);
    expect(out).toContain("src/components/recall");
    expect(out).toContain("src/lib/dashboard");
  });
});

describe("buildBrief — each target reads differently", () => {
  it("a new app says it does not exist yet and quotes the idea", () => {
    const out = buildBrief({
      ...base,
      target: { kind: "new", idea: "a tool that files receipts by vendor" },
      facts: { ...facts, features: [] },
    });
    expect(out).toContain("does not exist yet");
    expect(out).toContain("a tool that files receipts by vendor");
  });

  it("a rebuild insists every existing feature still works", () => {
    const out = buildBrief(base);
    expect(out).toContain("must still work");
    expect(out).toContain("Losing one is a failed build");
  });

  it("a URL rebuild keeps what the site does and names the URL", () => {
    const out = buildBrief({
      ...base,
      target: { kind: "url", url: "https://example.com" },
      facts: {
        ...facts,
        scraped: {
          title: "Example",
          summary: "A shop that sells one thing.",
          navItems: ["Shop", "About"],
          ctas: ["Buy now"],
        },
      },
    });
    expect(out).toContain("https://example.com");
    expect(out).toContain("Keep what it DOES");
    expect(out).toContain("Shop · About");
    expect(out).toContain("Buy now");
  });

  it("a hub page redesign says the rest of the app is off limits", () => {
    const out = buildBrief({ ...base, target: { kind: "hub-page", route: "/apps/jarvis" } });
    expect(out).toContain("off limits");
  });
});

describe("buildBrief — the owner's own words", () => {
  it("passes intent through verbatim", () => {
    const intent = "make it feel like a workshop, not a SaaS dashboard";
    expect(buildBrief({ ...base, intent })).toContain(intent);
  });

  it("says nothing about intent when none was typed", () => {
    expect(buildBrief({ ...base, intent: "   " })).not.toContain("verbatim");
  });
});

describe("laneBranch", () => {
  it("is flat, because a branch literally called `jarvis` already exists", () => {
    expect(laneBranch("Dashboard", "interactive-web-studio")).not.toContain("/");
  });

  it("names both the target and the skill, so three lanes never collide", () => {
    const a = laneBranch("Dashboard", "impeccable");
    const b = laneBranch("Dashboard", "taste-skill");
    expect(a).not.toBe(b);
    expect(a).toContain("dashboard");
    expect(a).toContain("impeccable");
  });

  it("survives a name that is punctuation and nothing else", () => {
    const branch = laneBranch("!!! ???", "###");
    expect(branch).toBe("bakeoff-bakeoff-skill");
    expect(branch).toMatch(/^[a-z0-9-]+$/);
  });
});
