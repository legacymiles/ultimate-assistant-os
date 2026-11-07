import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { parseAppDoc } from "./appDocs";
import { buildChangePrompt, buildRepoBrief } from "./brief";

const project: Project = {
  id: "p1",
  name: "Cook Connect",
  one_liner: "Recipes and card games",
  overview: "",
  catalog_slug: "cook-connect",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-02T00:00:00.000Z",
  features: [{ id: "f1", project_id: "p1", title: "Holiday themes", description: "Spades table dresses up for holidays", group: "supporting", created_at: "2026-10-01T00:00:00.000Z" }],
  versions: [],
  knowledge: [{ id: "k1", project_id: "p1", kind: "note", title: "Bots", content: "Bots never renig.", created_at: "2026-10-01T00:00:00.000Z" }],
  edits: [{ id: "e1", date: "2026-10-28", slug: "cook-connect", title: "Cook Connect: video gallery", detail: "", group: "supporting" }],
};

const doc = parseAppDoc(
  "cook-connect",
  `# Cook Connect

Two apps in one account.

![Cook Connect](../../public/look/cook-connect.jpg)

## Features — every one of these must still exist after your change

**Connect**
- **Renig** — illegal cards greyed out. \`src/lib/cook-connect/renege.ts\`

## How it looks

- **Look:** holo table

## Where the code is

| Part | Path |
|---|---|
| UI | \`src/components/cook-connect/\` |

## Owner's rules for this app

- Never auto-advance a hand.

## Described but not found in code

- **Chess** — described in the change log.
`,
);

describe("buildChangePrompt", () => {
  const out = buildChangePrompt(project, doc, "Redesign how it looks.");

  it("puts the change first and holds every feature from both sources", () => {
    expect(out.indexOf("## The change")).toBeLessThan(out.indexOf("## Features"));
    expect(out).toContain("Redesign how it looks.");
    expect(out).toContain("**Renig**");
    expect(out).toContain("`src/lib/cook-connect/renege.ts`");
    expect(out).toContain("**Holiday themes** (supporting)");
  });

  it("carries the look, code map, rules, the gap list, edits and notes", () => {
    expect(out).toContain("holo table");
    expect(out).toContain("`public/look/cook-connect.jpg`");
    expect(out).toContain("| UI | `src/components/cook-connect/` |");
    expect(out).toContain("Never auto-advance a hand.");
    expect(out).toContain("Chess");
    expect(out).toContain("2026-10-28 — Cook Connect: video gallery");
    expect(out).toContain("Bots never renig.");
    expect(out).toContain("docs/apps/cook-connect.md");
  });

  it("asks for the change when none is written", () => {
    expect(buildChangePrompt(project, doc, "  ")).toContain("ask the owner what should change");
  });

  it("works for a project with no repo doc", () => {
    const plain = buildChangePrompt({ ...project, catalog_slug: undefined }, null, "Add dark mode.");
    expect(plain).toContain("**Holiday themes**");
    expect(plain).not.toContain("docs/apps/");
  });
});

describe("buildRepoBrief", () => {
  it("is a standing AGENTS.md with the full record", () => {
    const out = buildRepoBrief(project, doc);
    expect(out.startsWith("# Cook Connect — read this first")).toBe(true);
    expect(out).toContain("**Renig**");
    expect(out).toContain("**Holiday themes**");
    expect(out).toContain("Bots never renig.");
    expect(out).toContain("## Working here");
  });
});
