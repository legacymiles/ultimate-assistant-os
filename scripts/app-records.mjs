#!/usr/bin/env node
// ---------------------------------------------------------------------------
// App records: one file per app, docs/apps/<slug>.md — the truth about it.
//
//   node scripts/app-records.mjs              write every record + app-records.json
//   node scripts/app-records.mjs --check      fail if any record is missing or stale
//   node scripts/app-records.mjs --change <slug> "what to change"
//                                             print the Change it prompt for an edit
//
// A record's hand-written half (what it does, features, must keep working,
// requested, reviewed date) is never touched here. Its "From the code" block
// is rewritten from the app's folders: pages, API routes and who can call
// them, sign-in, tables + their RLS policies, buckets, saved-data keys, env
// keys, AI calls, scheduled callers and tests. --check is part of
// `npm run verify`, so a new route, key, table or test without a refreshed
// record fails the gate instead of quietly going stale.
//
// The pure parts (scan, render, parse, the Change it prompt) live in
// src/lib/timeline/records.ts, which Node loads directly (type stripping) and
// Projects Timeline uses in the browser — one implementation for both.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TIMELINE_FILES, foldersOf } from "./lib/app-folders.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs", "apps");
const JSON_OUT = path.join(ROOT, "src", "lib", "timeline", "app-records.json");

const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { PROJECTS } = await load("src/lib/catalog.ts");
const { routeAccess } = await load("src/lib/hubAccess.ts");
const R = await load("src/lib/timeline/records.ts");

const read = (abs) => readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
const rel = (abs) => path.relative(ROOT, abs).replace(/\\/g, "/");
const isDir = (abs) => existsSync(abs) && statSync(abs).isDirectory();

const CODE = /\.(ts|tsx|js|mjs)$/;

function walk(dir, out = []) {
  if (!isDir(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (CODE.test(name)) out.push(abs);
  }
  return out;
}

// ---- Shared inputs --------------------------------------------------------

const migrationsDir = path.join(ROOT, "supabase", "migrations");
const MIGRATIONS = isDir(migrationsDir)
  ? readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort().map((f) => read(path.join(migrationsDir, f))).join("\n")
  : "";

const middleware = read(path.join(ROOT, "src", "middleware.ts"));
const tokenBlock = middleware.match(/const TOKEN_AUTH_PATHS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
const TOKEN_PATHS = new Set([...tokenBlock.replace(/\/\/[^\n]*/g, "").matchAll(/["'`](\/[^"'`]+)["'`]/g)].map((m) => m[1]));
const access = (p) => routeAccess(p, TOKEN_PATHS);

const workflowsDir = path.join(ROOT, ".github", "workflows");
const CALLERS = [
  ...(isDir(workflowsDir) ? readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => path.join(workflowsDir, f)) : []),
  path.join(ROOT, "vercel.json"),
]
  .filter((f) => existsSync(f))
  .map((f) => ({ path: rel(f), text: read(f) }));

const EDITS = JSON.parse(read(path.join(ROOT, "src", "lib", "timeline", "feature-log.json")));

/** Commits that touched more than three apps: repo-wide chores, not one app's feature. */
const WIDE = (() => {
  const count = new Map();
  for (const e of EDITS) {
    const hash = e.id.split(":")[0];
    count.set(hash, (count.get(hash) ?? 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n > 3).map(([h]) => h));
})();

/** The top-level files under src/components and src/lib that are Projects Timeline's own. */
const timelineRootFiles = () =>
  [...walk(path.join(ROOT, "src", "components")), ...walk(path.join(ROOT, "src", "lib"))]
    .map(rel)
    .filter((f) => TIMELINE_FILES.test(f));

// ---- One app --------------------------------------------------------------

function factsFor(slug) {
  const folders = [];
  const files = new Set();
  for (const f of foldersOf(slug)) {
    for (const base of ["src/app/apps", "src/components", "src/lib", "src/app/api"]) {
      const abs = path.join(ROOT, base, f);
      if (!isDir(abs)) continue;
      if (base !== "src/app/apps") folders.push(`${base}/${f}/`);
      for (const file of walk(abs)) files.add(rel(file));
    }
    const seed = path.join(ROOT, "src", "lib", "seed-content", `${f}.ts`);
    if (existsSync(seed)) files.add(rel(seed));
  }
  if (slug === "projects-timeline") for (const f of timelineRootFiles()) files.add(f);
  return R.scanApp({
    files: [...files].sort().map((f) => ({ path: f, text: read(path.join(ROOT, f)) })),
    folders,
    migrations: MIGRATIONS,
    callers: CALLERS,
    access,
  });
}

const today = new Date().toISOString().slice(0, 10);

function recordFor(p) {
  const file = path.join(DOCS, `${p.slug}.md`);
  const facts = factsFor(p.slug);
  const block = R.renderCodeBlock(facts);
  const before = existsSync(file) ? read(file) : null;
  const base =
    before ??
    R.seedRecord({
      slug: p.slug,
      title: p.title,
      route: p.appUrl ?? p.externalUrl ?? `/apps/${p.slug}`,
      category: p.category,
      status: p.status,
      overview: p.overview,
      edits: EDITS.filter((e) => e.slug === p.slug),
      today,
      wide: WIDE,
    });
  const md = R.spliceCodeBlock(base, block);
  const hand = R.parseRecord(md);
  const record = {
    slug: p.slug,
    title: p.title,
    route: p.appUrl ?? p.externalUrl ?? "",
    category: p.category,
    ...hand,
    whatItDoes: hand.whatItDoes || p.overview,
    code: facts,
  };
  return { file, before, md, record };
}

// ---- Change it ------------------------------------------------------------

const changeAt = process.argv.indexOf("--change");
if (changeAt !== -1) {
  const slug = process.argv[changeAt + 1];
  const p = PROJECTS.find((x) => x.slug === slug);
  if (!p) {
    console.error(`No app "${slug ?? ""}". Slugs: ${PROJECTS.map((x) => x.slug).join(", ")}`);
    process.exit(1);
  }
  const { record } = recordFor(p);
  const request = process.argv.slice(changeAt + 2).join(" ");
  process.stdout.write(
    R.buildChangeItPrompt({
      name: p.title,
      request,
      record,
      edits: EDITS.filter((e) => e.slug === slug),
      today,
    }) + "\n",
  );
  process.exit(0);
}

// ---- Write / check --------------------------------------------------------

const results = PROJECTS.map(recordFor);
const json = JSON.stringify(results.map((r) => r.record), null, 1) + "\n";
const jsonBefore = existsSync(JSON_OUT) ? read(JSON_OUT) : null;

if (process.argv.includes("--check")) {
  const problems = [];
  for (const r of results) {
    if (r.before === null) problems.push(`missing   docs/apps/${path.basename(r.file)}`);
    else if (r.before !== r.md) problems.push(`stale     docs/apps/${path.basename(r.file)} — its "From the code" block no longer matches the code`);
  }
  if (jsonBefore !== json) problems.push("stale     src/lib/timeline/app-records.json");
  if (problems.length) {
    console.error(
      [
        "App records are out of date with the code:",
        ...problems.map((p) => `  ${p}`),
        "",
        "Run `npm run apps:records` and commit what it changes. If you changed what the app does,",
        "also update the hand-written half of its record (Features, Must keep working, Requested)",
        "and set `Record reviewed:` to today.",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log(`App records are current (${results.length} apps).`);
} else {
  let wrote = 0;
  for (const r of results) {
    if (r.before === r.md) continue;
    writeFileSync(r.file, r.md);
    wrote += 1;
  }
  if (jsonBefore !== json) writeFileSync(JSON_OUT, json);
  const seeded = results.filter((r) => r.before === null).length;
  console.log(`App records: ${results.length} apps · ${wrote} file(s) written${seeded ? ` (${seeded} new, seeded from the edit log)` : ""}.`);
}
