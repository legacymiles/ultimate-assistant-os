#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Where every model and service in this hub is actually used.
//
// The Tools tab used to carry a hand-written "where it's wired in" note per
// model. Notes drift: the seeded line still called Opus 5 the hub default long
// after that stopped being the plan. So the wiring half is no longer written by
// hand — it is read out of the code, here, and committed as JSON.
//
// Committed rather than scanned at runtime because the deployed hub has no
// repo to read: same reason skills/ is committed (see scripts/sync-skills.mjs).
// Re-run this after moving a model call, then commit the JSON with the change.
//
//   node scripts/scan-tools.mjs          # write the map
//   node scripts/scan-tools.mjs --check  # exit 1 if the map is stale (CI)
//
// What it cannot know: which Studio workflow uses which engine. A workflow
// declares a medium, not a model, and the render layer decides. Those bindings
// are the owner's, set in the Tools tab, and stored alongside their notes.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "src/lib/jarvis/toolUsage.generated.json");

// --- what counts as a model id --------------------------------------------
// Vendor prefixes the hub really calls. A bare /-string is too loose: it would
// catch every import path and API route in the codebase.
const VENDORS = [
  "anthropic", "google", "openai", "qwen", "deepseek", "x-ai", "z-ai",
  "meta-llama", "mistralai", "minimax", "bytedance", "moonshotai", "upstage",
];
const MODEL_RE = new RegExp(`["'\`](${VENDORS.join("|")})\\/([a-zA-Z0-9._:+~-]+)["'\`]`, "g");

// --- what counts as a service ---------------------------------------------
// Keyed by the env var or hostname that gives it away. A service is anything an
// app needs to work that is not a model: GPU pods, local bridges, storage.
const SERVICES = [
  { name: "OpenRouter", signals: ["OPENROUTER_API_KEY", "openrouter.ai"], url: "https://openrouter.ai" },
  { name: "Vercel AI Gateway", signals: ["AI_GATEWAY_API_KEY", "ai-gateway.vercel.sh"], url: "https://vercel.com/docs/ai-gateway" },
  { name: "RunPod", signals: ["RUNPOD_API_KEY", "RUNPOD_ENDPOINT_ID", "runpod.ai"], url: "https://runpod.io" },
  { name: "MiniMax", signals: ["MINIMAX_API_KEY", "MINIMAX_API_BASE"], url: "https://minimax.io" },
  { name: "fish.audio", signals: ["FISH_API_KEY", "fish.audio"], url: "https://fish.audio" },
  { name: "Supabase", signals: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], url: "https://supabase.com" },
  { name: "muapi.ai", signals: ["MUAPI_API_KEY", "muapi.ai"], url: "https://muapi.ai" },
  { name: "WanGP local bridge", signals: ["WANGP_URL", "WANGP_BRIDGE"], url: null },
  { name: "Music GPU pod", signals: ["MUSIC_SERVER_URL", "MUSIC_POD_ID"], url: null },
  { name: "Lucy GPU server", signals: ["LUCY_SERVER_URL", "LUCY_TOKEN"], url: null },
  { name: "Google APIs", signals: ["NEXT_PUBLIC_GOOGLE_CLIENT_ID", "NEXT_PUBLIC_GOOGLE_API_KEY"], url: null },
  { name: "Ticketmaster", signals: ["TICKETMASTER_API_KEY"], url: null },
  { name: "Windy webcams", signals: ["WINDY_WEBCAMS_API_KEY"], url: null },
  { name: "NASA FIRMS", signals: ["NASA_FIRMS_MAP_KEY"], url: null },
  { name: "AISStream", signals: ["AISSTREAM_API_KEY"], url: null },
];

// --- folder → app slug -----------------------------------------------------
// Most code folders match their /apps/<slug> route. These are the ones that
// don't; the table is the same one CLAUDE.md documents.
const FOLDER_TO_SLUG = {
  recall: "dashboard", blueprint: "prompt-architect", "viral-studio": "viral-studio-content",
  "dance-studio": "viral-studio-content", reveal: "fire-reveal", studio3d: "3d-studio",
  cookbook: "cookbook-genie", "gods-eye": "gods-eye-view", kart: "kart-showcase",
  calculator: "multi-order-calculator", stdsafe: "std-safe", ea: "ea-feature-list",
  "ea-features": "ea-feature-list", redesigner: "website-redesigner",
  seedance: "seedance-studio", "smart-shot": "smart-shot-videos",
  "video-studio": "video-studio-arena", skills: "skills-library",
  slippery: "slippery-escape", repo: "projects-timeline",
  // The three studios merged into Jarvis Audio Studio keep their own folders;
  // their tools belong to the app they are now part of.
  "mp3-download": "jarvis-audio-studio", "music-classified": "jarvis-audio-studio",
  "music-creator": "jarvis-audio-studio",
};

// Files that configure the hub as a whole rather than any one app.
const GLOBAL_FILES = [
  "src/lib/ai/provider.ts", "src/lib/ai/models.ts", "src/lib/ai/settings.ts",
  "src/middleware.ts",
];

// Inventories, not call sites. Each of these NAMES every tool in the hub so it
// can list them — the status panel's key checklist, the Tools tab's own seed,
// this scanner's service table. Reading them back would mark every key "used
// hub-wide" and make the map agree with itself instead of with the code.
const INVENTORIES = [
  "src/lib/ai/status.ts",
  "src/lib/jarvis/toolkit.ts",
  "src/lib/jarvis/toolUsage.ts",
  "scripts/scan-tools.mjs",
];

/** Every source file worth reading. Tests describe the code, they don't wire it. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".next-")) continue;
    if (entry === "test" || entry === "__tests__") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry) && !/\.(test|spec)\.[a-z]+$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The real app slugs. Read from the routes first: an app on this hub is a
 * thing with a page. The catalog is the union'd second source, because a few
 * entries there point at something served from outside src/app/apps.
 *
 * Catalog alone was wrong — dashboard, recall, new-dashboard, skills-library
 * and slippery-escape all ship a page without a PROJECTS entry, and treating
 * them as library folders filed their models under "shared code".
 */
function appSlugs() {
  const routes = readdirSync(path.join(ROOT, "src/app/apps"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const src = readFileSync(path.join(ROOT, "src/lib/catalog.ts"), "utf8");
  const catalogued = [...src.matchAll(/slug:\s*["']([a-z0-9-]+)["']/g)].map((m) => m[1]);
  return new Set([...routes, ...catalogued]);
}

/**
 * Where a file sits in the hub: hub-wide, one app, one API route, or a desktop
 * helper. Returns the scope plus the app slug it belongs to, when it has one.
 */
function placeOf(rel, slugs) {
  const unix = rel.split(path.sep).join("/");
  if (GLOBAL_FILES.includes(unix)) return { scope: "global", app: null, label: "Hub-wide" };

  // A folder only counts as an app when the catalog says that slug exists.
  // Otherwise it is shared library code, and calling it an app would invent a
  // product that isn't on the hub ("fno", "auth", "server").
  const asApp = (folder) => {
    const slug = FOLDER_TO_SLUG[folder] ?? folder;
    return slugs.has(slug) ? slug : null;
  };

  const api = unix.match(/^src\/app\/api\/([^/]+)\//);
  if (api) {
    const app = asApp(api[1]);
    return { scope: "route", app, label: `/api/${api[1]}` };
  }
  const page = unix.match(/^src\/app\/apps\/([^/]+)\//);
  if (page) return { scope: "app", app: asApp(page[1]), label: page[1] };

  const lib = unix.match(/^src\/(?:lib|components)\/([^/]+)\//);
  if (lib) {
    const app = asApp(lib[1]);
    return app ? { scope: "app", app, label: app } : { scope: "lib", app: null, label: lib[1] };
  }
  const tool = unix.match(/^tools\/([^/]+)\//);
  if (tool) return { scope: "tool", app: null, label: tool[1] };

  return { scope: "other", app: null, label: unix.split("/").slice(0, -1).join("/") || "root" };
}

/** Line number of a character offset, 1-indexed. */
const lineAt = (text, index) => text.slice(0, index).split("\n").length;

function scan() {
  const roots = ["src", "tools", "scripts"].map((d) => path.join(ROOT, d)).filter((d) => {
    try { return statSync(d).isDirectory(); } catch { return false; }
  });
  const slugs = appSlugs();
  const files = roots.flatMap((d) => walk(d))
    .filter((abs) => !INVENTORIES.includes(path.relative(ROOT, abs).split(path.sep).join("/")));

  /** id → { kind, sites[] } */
  const found = new Map();
  const note = (key, kind, site) => {
    const entry = found.get(key) ?? { id: key, kind, sites: [] };
    // One site per file+line; a model named twice on a line is one use.
    if (!entry.sites.some((s) => s.file === site.file && s.line === site.line)) entry.sites.push(site);
    found.set(key, entry);
  };

  for (const abs of files) {
    const rel = path.relative(ROOT, abs);
    const text = readFileSync(abs, "utf8");
    const place = placeOf(rel, slugs);
    const unix = rel.split(path.sep).join("/");

    for (const m of text.matchAll(MODEL_RE)) {
      note(`${m[1]}/${m[2]}`, "model", { file: unix, line: lineAt(text, m.index), ...place });
    }
    for (const svc of SERVICES) {
      for (const signal of svc.signals) {
        const at = text.indexOf(signal);
        if (at !== -1) note(svc.name, "service", { file: unix, line: lineAt(text, at), ...place });
      }
    }
  }

  const tools = [...found.values()]
    .map((t) => {
      const scopes = [...new Set(t.sites.map((s) => s.scope))];
      const apps = [...new Set(t.sites.map((s) => s.app).filter(Boolean))].sort();
      return {
        ...t,
        url: SERVICES.find((s) => s.name === t.id)?.url ?? (t.kind === "model" ? `https://openrouter.ai/${t.id}` : null),
        // A tool called from a hub-wide file is global however many apps also
        // name it — that is the call every app inherits.
        reach: scopes.includes("global") ? "global" : apps.length > 1 ? "shared" : "single",
        apps,
        sites: t.sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
      };
    })
    .sort((a, b) => b.sites.length - a.sites.length || a.id.localeCompare(b.id));

  return { generatedAt: new Date().toISOString(), tools };
}

const map = scan();
const body = JSON.stringify(map, null, 2) + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch {}
  // generatedAt always differs; compare the part that means something.
  const strip = (s) => s.replace(/"generatedAt": "[^"]*",?\n/, "");
  if (strip(current) !== strip(body)) {
    console.error("Tool usage map is stale. Run: node scripts/scan-tools.mjs");
    process.exit(1);
  }
  console.log(`Tool usage map is current (${map.tools.length} tools).`);
} else {
  writeFileSync(OUT, body);
  const models = map.tools.filter((t) => t.kind === "model").length;
  const sites = map.tools.reduce((n, t) => n + t.sites.length, 0);
  console.log(`${map.tools.length} tools (${models} models, ${map.tools.length - models} services) across ${sites} call sites → ${path.relative(ROOT, OUT)}`);
}
