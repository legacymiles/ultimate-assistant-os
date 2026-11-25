import { describe, expect, it } from "vitest";
import type { AppEditEntry } from "../types";
import {
  CODE_END,
  CODE_START,
  apiPathOf,
  buildChangeItPrompt,
  emptyFacts,
  freshness,
  pagePathOf,
  parseMigrations,
  parseRecord,
  renderCodeBlock,
  routeMethods,
  savedKeysUsed,
  scanApp,
  seedRecord,
  signInFacts,
  spliceCodeBlock,
  tablesUsed,
  type AppRecord,
} from "./records";

const edit = (id: string, date: string, title: string, group: "core" | "supporting" = "supporting"): AppEditEntry => ({
  id,
  date,
  slug: "demo",
  title,
  detail: "",
  group,
  source: "git",
});

describe("paths", () => {
  it("turns route and page files into URLs", () => {
    expect(apiPathOf("src/app/api/demo/[id]/route.ts")).toBe("/api/demo/[id]");
    expect(apiPathOf("src/lib/demo/route.ts")).toBeNull();
    expect(pagePathOf("src/app/apps/demo/settings/page.tsx")).toBe("/apps/demo/settings");
  });

  it("reads every way a route exports its methods", () => {
    const text = `export async function GET() {}\nexport const POST = handler;\nexport { del as DELETE };\nexport function helper() {}`;
    expect(routeMethods(text)).toEqual(["GET", "POST", "DELETE"]);
  });
});

describe("what a file says", () => {
  it("finds Google sign-in, both ways", () => {
    expect(signInFacts(`supabase.auth.signInWithOAuth({ provider: "google", options: {} })`)).toContain(
      "Google sign-in (OAuth redirect)",
    );
    expect(signInFacts(`import { oneTap } from "@/lib/auth/google";`)[0]).toMatch(/one tap/);
    expect(signInFacts(`const user = await requireUser(req);`)).toContain("Needs a signed-in user (requireUser / auth.getUser)");
  });

  it("tells tables from storage buckets and Array.from", () => {
    const text = `db.from("recipes").select(); supabase.storage.from("photos").upload(); Array.from("abc");`;
    expect(tablesUsed(text)).toEqual(["recipes"]);
  });

  it("finds saved-data keys by the hub's naming", () => {
    expect(savedKeysUsed(`saveSynced("money-agents:v1", x); const k = "cook-connect:personal:v1";`)).toEqual([
      "cook-connect:personal:v1",
      "money-agents:v1",
    ]);
  });
});

describe("migrations", () => {
  it("keeps only the policies the database ends up with", () => {
    const sql = `
      create table if not exists cook.recipes (id uuid);
      alter table cook.recipes enable row level security;
      create policy recipes_read on cook.recipes for select using (false);
      -- a later migration replaces it
      drop policy if exists recipes_read on cook.recipes;
      create policy recipes_read on cook.recipes for select using (true);
      create policy old_one on cook.recipes for delete using (false);
      drop policy old_one on cook.recipes;
    `;
    const m = parseMigrations(sql);
    expect(m.policies).toEqual([{ table: "recipes", qualified: "cook.recipes", name: "recipes_read", rule: "for select using (true)" }]);
    expect(m.rls.has("cook.recipes")).toBe(true);
    expect(m.tables.has("cook.recipes")).toBe(true);
  });
});

describe("scanApp", () => {
  it("collects facts per app, leaving tests out of behaviour", () => {
    const facts = scanApp({
      files: [
        { path: "src/app/api/demo/ping/route.ts", text: `export async function GET() { process.env.DEMO_KEY; }` },
        { path: "src/lib/demo/store.ts", text: `db.from("things").select(); readDoc(uid, ".demo.json");` },
        { path: "src/lib/demo/store.test.ts", text: `db.from("fixtures"); process.env.TEST_ONLY;` },
      ],
      folders: ["src/lib/demo/", "src/app/api/demo/"],
      migrations: `create table public.things (id int); create policy things_own on public.things for all using (user_id = auth.uid());`,
      callers: [{ path: ".github/workflows/tick.yml", text: "curl https://x/api/demo/ping" }],
      access: (p) => (p === "/api/demo/ping" ? "token" : "owner"),
    });
    expect(facts.api).toEqual([{ path: "/api/demo/ping", methods: ["GET"], access: "token", file: "src/app/api/demo/ping/route.ts" }]);
    expect(facts.tables.map((t) => t.name)).toEqual(["things"]);
    expect(facts.tables[0].policies[0]).toContain("things_own");
    expect(facts.env.map((e) => e.what)).toEqual(["DEMO_KEY"]);
    expect(facts.tests).toEqual(["src/lib/demo/store.test.ts"]);
    expect(facts.serverDocs).toEqual(["src/lib/demo/store.ts"]);
    expect(facts.callers[0].what).toBe(".github/workflows/tick.yml calls /api/demo/ping");
  });
});

describe("the record file", () => {
  const block = renderCodeBlock(emptyFacts());

  it("replaces only the generated block, even when the prose mentions the marker", () => {
    const md = `# Demo\n\nThe \`${CODE_START}\` block is generated.\n\n## Features\n\n- Hand written\n\n${CODE_START}\nold\n${CODE_END}\n`;
    const out = spliceCodeBlock(md, block);
    expect(out).toContain("- Hand written");
    expect(out).toContain(`The \`${CODE_START}\` block is generated.`);
    expect(out).not.toContain("\nold\n");
    expect(spliceCodeBlock(out, block)).toBe(out);
  });

  it("appends the block to a hand-written file that has none", () => {
    expect(spliceCodeBlock("# Demo\n\n## Features\n\n- A\n", block)).toMatch(/- A\n\n<!-- code:start -->/);
  });

  it("seeds Features from real edits, skipping bookkeeping and repo-wide chores", () => {
    const md = seedRecord({
      slug: "demo",
      title: "Demo",
      route: "/apps/demo",
      category: "AI",
      status: "live",
      overview: "Does a thing.",
      today: "2026-11-13",
      edits: [
        edit("a1:demo", "2026-10-01", "Demo app", "core"),
        edit("b2:demo", "2026-10-05", "Log app edits"),
        edit("c3:demo", "2026-10-06", "Self-host every font"),
        edit("d4:demo", "2026-10-07", "Bigger buttons"),
      ],
      wide: new Set(["c3"]),
    });
    const parsed = parseRecord(spliceCodeBlock(md, block));
    expect(parsed.features).toEqual(["Demo app", "Bigger buttons"]);
    expect(parsed.reviewed).toBeNull();
    expect(parsed.seeded).toBe("2026-11-13");
    expect(parsed.whatItDoes).toBe("Does a thing.");
    expect(parsed.mustKeep).toEqual([]);
  });

  it("reads a reviewed date and the hand sections", () => {
    const md = `# Demo\n\nRecord reviewed: 2026-11-01\n\n## Must keep working\n\n- **Google sign-in** on the first visit\n  still one tap\n\n## Requested, not built yet\n\n- Dark mode\n`;
    const r = parseRecord(md);
    expect(r.reviewed).toBe("2026-11-01");
    expect(r.mustKeep).toEqual(["Google sign-in on the first visit still one tap"]);
    expect(r.requested).toEqual(["Dark mode"]);
  });
});

describe("freshness", () => {
  const edits = [edit("x:demo", "2026-11-05", "New thing"), edit("y:demo", "2026-10-01", "Old thing")];

  it("counts edits shipped after the review", () => {
    const f = freshness({ reviewed: "2026-11-01", seeded: null }, edits);
    expect(f.state).toBe("behind");
    expect(f.behind).toBe(1);
    expect(freshness({ reviewed: "2026-11-10", seeded: null }, edits).state).toBe("current");
    expect(freshness({ reviewed: null, seeded: "2026-11-01" }, edits).state).toBe("seeded");
    expect(freshness({ reviewed: null, seeded: null }, edits).state).toBe("never");
  });
});

describe("Change it", () => {
  const facts = emptyFacts();
  facts.pages = [{ path: "/apps/demo", access: "owner" }];
  facts.api = [{ path: "/api/demo/ping", methods: ["GET"], access: "token", file: "x" }];
  facts.signIn = [{ what: "Google sign-in (OAuth redirect)", files: ["a.tsx"] }];
  facts.savedKeys = [{ what: "demo:v1", files: ["b.ts"] }];
  const record: AppRecord = {
    slug: "demo",
    title: "Demo",
    route: "/apps/demo",
    category: "AI",
    reviewed: "2026-11-01",
    seeded: null,
    whatItDoes: "Does a thing.",
    features: ["Radar"],
    mustKeep: ["The radar sweeps"],
    requested: ["Dark mode"],
    code: facts,
  };

  it("puts the request, the features and everything that must keep working in one prompt", () => {
    const out = buildChangeItPrompt({
      name: "Demo",
      request: "Make the blips bigger",
      record,
      edits: [edit("x:demo", "2026-11-05", "Compass mode")],
      today: "2026-11-13",
    });
    expect(out).toContain("Make the blips bigger");
    expect(out).toContain("- Radar");
    expect(out).toContain("- The radar sweeps");
    expect(out).toContain("Sign-in: Google sign-in (OAuth redirect)");
    expect(out).toContain("`/api/demo/ping` stays per-account key (no session)");
    expect(out).toContain("`demo:v1` — never rename");
    expect(out).toContain("- Dark mode");
    expect(out).toContain("2026-11-05 — Compass mode");
    expect(out).toContain("Record reviewed: 2026-11-13");
  });

  it("still works for a project with no record", () => {
    const out = buildChangeItPrompt({ name: "Side project", request: "", project: { overview: "x", features: [], knowledge: [] } });
    expect(out).toContain("_Write the change here before sending this prompt._");
    expect(out).not.toContain("docs/apps/");
  });
});
