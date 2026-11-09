// ---------------------------------------------------------------------------
// Writes docs/apps/README.md from src/lib/catalog.ts.
//
//   node scripts/apps-index.mjs          # write the file
//   node scripts/apps-index.mjs --check  # fail if it is out of date
//
// Why this exists: a tool that clones this repo has no way to know what the
// site is supposed to contain. `src/lib/catalog.ts` knows — it is the single
// source of truth for the hub — but it is 1,000 lines of TypeScript carrying
// icon hues and iframe preview rules alongside the facts. This flattens the
// part an outside reader needs into one table, so "did the rebuild produce the
// right site?" is a question with a checkable answer.
//
// Derived, never edited by hand. Run it after adding an app to PROJECTS; the
// --check form is for CI, so the table cannot quietly drift from the catalog.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "docs", "apps", "README.md");

// catalog.ts imports nothing, so Node's own type stripping is enough.
const { PROJECTS, CATEGORIES } = await import(
  new URL("../src/lib/catalog.ts", import.meta.url).href
);

/** One line of the table. Pipes in prose would break the table. */
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** The first sentence of an overview is enough to recognise an app by. */
function oneLine(overview) {
  const text = cell(overview);
  const end = text.search(/\.\s|\.$/);
  const first = end === -1 ? text : text.slice(0, end + 1);
  return first.length > 180 ? `${first.slice(0, 177)}…` : first;
}

function route(p) {
  if (p.appUrl) return `\`${p.appUrl}\``;
  if (p.externalUrl) return `[external](${p.externalUrl})`;
  return "—";
}

const live = PROJECTS.filter((p) => p.status === "live");
const soon = PROJECTS.filter((p) => p.status !== "live");

const lines = [];
lines.push("# Apps in this hub");
lines.push("");
lines.push(
  "**Generated — do not edit.** `node scripts/apps-index.mjs` rewrites this from " +
    "[`src/lib/catalog.ts`](../../src/lib/catalog.ts), which is the single source of truth for the hub. " +
    "`node scripts/apps-index.mjs --check` fails when the two disagree.",
);
lines.push("");
lines.push(
  `${PROJECTS.length} projects — ${live.length} live, ${soon.length} coming soon. ` +
    "Every live one is a real route under this one Next.js app; none of them is a separate " +
    "project, repo or deployment. A rebuild that is missing routes from this table is not this site.",
);
lines.push("");

for (const category of CATEGORIES) {
  const inCategory = PROJECTS.filter((p) => p.category === category);
  if (inCategory.length === 0) continue;
  lines.push(`## ${category} (${inCategory.length})`);
  lines.push("");
  lines.push("| App | Route | What it is |");
  lines.push("|---|---|---|");
  for (const p of inCategory) {
    const title = p.status === "live" ? cell(p.title) : `${cell(p.title)} _(coming soon)_`;
    lines.push(`| **${title}** | ${route(p)} | ${oneLine(p.overview)} |`);
  }
  lines.push("");
}

lines.push("## Where an app's code lives");
lines.push("");
lines.push("For an app with route `/apps/<slug>`:");
lines.push("");
lines.push("| Part | Path |");
lines.push("|---|---|");
lines.push("| Page | `src/app/apps/<slug>/page.tsx` |");
lines.push("| UI components | `src/components/<folder>/` |");
lines.push("| Logic, types, tests | `src/lib/<folder>/` (`*.test.ts` beside the code) |");
lines.push("| Server routes | `src/app/api/<folder>/` |");
lines.push("| Catalog entry | `src/lib/catalog.ts` → `PROJECTS` |");
lines.push("");
lines.push(
  "`<folder>` is usually the slug but not always — read the table in " +
    "[`CLAUDE.md`](../../CLAUDE.md) for the exceptions rather than guessing.",
);
lines.push("");

const next = `${lines.join("\n")}`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    console.error(`docs/apps/README.md is missing. Run: node scripts/apps-index.mjs`);
    process.exit(1);
  }
  if (current.trim() !== next.trim()) {
    console.error(
      "docs/apps/README.md is out of date with src/lib/catalog.ts.\n" +
        "Run: node scripts/apps-index.mjs",
    );
    process.exit(1);
  }
  console.log(`docs/apps/README.md is current (${PROJECTS.length} projects).`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, next, "utf8");
  console.log(`Wrote docs/apps/README.md — ${PROJECTS.length} projects, ${live.length} live.`);
}
