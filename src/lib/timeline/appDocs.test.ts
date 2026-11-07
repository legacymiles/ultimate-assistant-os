import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJECTS } from "../catalog";
import { parseAppDoc, parseFeature } from "./appDocs";
import DOCS from "./app-docs.json";

const SAMPLE = `# Cook Connect

\`/apps/cook-connect\` · Apps · live · shows as: App plugins card

> Recipes and card games in one account

Two apps in one account: a cookbook and a games table.
It keeps every recipe you save.

![Cook Connect](../../public/look/cook-connect.jpg)

## Features — every one of these must still exist after your change

The owner asked for each of these.

**Cookbook**
- **Add a recipe** — words, links, photos and video in one box. \`src/components/cook-connect/views/RecipeEditorView.tsx\`
- **Recipes found** — keep, skip or edit each one.
  Nothing is saved without the cook saying so. \`src/lib/cook-connect/found.ts\`

**Connect**
- **Renig** — illegal cards greyed out. \`src/lib/cook-connect/renege.ts\`

## How it looks

- **Look:** holo table
- **Motion:** felt pulses on a trick win

## Where the code is

| Part | Path |
|---|---|
| Page | \`src/app/apps/cook-connect/page.tsx\` |
| UI | \`src/components/cook-connect/\` |

## Owner's rules for this app

- Never auto-advance a hand.

## Described but not found in code

- None found.
`;

describe("parseAppDoc", () => {
  const doc = parseAppDoc("cook-connect", SAMPLE);

  it("reads the head of the doc", () => {
    expect(doc.title).toBe("Cook Connect");
    expect(doc.meta).toContain("/apps/cook-connect");
    expect(doc.tag).toBe("Recipes and card games in one account");
    expect(doc.overview).toBe("Two apps in one account: a cookbook and a games table. It keeps every recipe you save.");
    expect(doc.screenshot).toBe("/look/cook-connect.jpg");
  });

  it("reads features with their group, text and files, folding wrapped lines", () => {
    expect(doc.features.map((f) => f.title)).toEqual(["Add a recipe", "Recipes found", "Renig"]);
    expect(doc.features[0].group).toBe("Cookbook");
    expect(doc.features[2].group).toBe("Connect");
    expect(doc.features[1].text).toContain("Nothing is saved without the cook saying so");
    expect(doc.features[1].files).toEqual(["src/lib/cook-connect/found.ts"]);
  });

  it("reads the look, the code map and the rules, and drops 'None found'", () => {
    expect(doc.look).toHaveLength(2);
    expect(doc.code).toEqual([
      { part: "Page", path: "`src/app/apps/cook-connect/page.tsx`" },
      { part: "UI", path: "`src/components/cook-connect/`" },
    ]);
    expect(doc.rules).toEqual(["Never auto-advance a hand."]);
    expect(doc.missing).toEqual([]);
  });

  it("handles a feature line with no bold title", () => {
    expect(parseFeature("Search by name — finds it. `a/b.ts`").title).toBe("Search by name");
  });
});

// Any AI tool reads docs/apps/<slug>.md before changing an app (AGENTS.md).
// An app without one is an app whose features nobody can protect.
describe("every app has a doc", () => {
  const files = readdirSync("docs/apps").filter((f) => f.endsWith(".md") && !f.startsWith("_") && f !== "README.md");

  it.each(PROJECTS.map((p) => p.slug))("%s has docs/apps/<slug>.md with a Features list", (slug) => {
    const path = `docs/apps/${slug}.md`;
    expect(existsSync(path), `${path} is missing — copy docs/apps/_TEMPLATE.md`).toBe(true);
    const doc = parseAppDoc(slug, readFileSync(path, "utf8"));
    expect(doc.features.length, `${path} lists no features`).toBeGreaterThan(0);
  });

  it("Projects Timeline's copy of the docs is current (node scripts/apps-index.mjs)", () => {
    const copy = DOCS as Record<string, string>;
    for (const f of files) {
      const slug = f.slice(0, -3);
      expect(copy[slug], `${f} changed — run: node scripts/apps-index.mjs`).toBe(
        readFileSync(`docs/apps/${f}`, "utf8").replace(/\r\n/g, "\n"),
      );
    }
    expect(Object.keys(copy).sort()).toEqual(files.map((f) => f.slice(0, -3)).sort());
  });
});
