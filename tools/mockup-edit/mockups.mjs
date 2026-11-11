#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Three Flux 2 mockups of a website edit, before the edit is built.
//
// This is how a website edit starts from Claude Code chat. It photographs the
// live page on this PC, paints three versions of the change onto that
// screenshot with Flux 2 Klein in WanGP (free, local), writes a board to look
// at, and prints a link that opens the SAME board in the Website Redesigner
// (the drawer's cache hands it the same pictures, so nothing is painted twice).
//
//   node tools/mockup-edit/mockups.mjs --url https://site.com --edit "make the hero dark" \
//        [--name "Site"] [--repo C:/path/to/site] [--device desktop|phone] \
//        [--lane "Label::what this version does"] x3 [--out DIR]
//
//   node tools/mockup-edit/mockups.mjs --from DIR --pick 2 --tweak "make the button green"
//   node tools/mockup-edit/mockups.mjs --from DIR --pick 2 --brief
//
// Prints one JSON object on stdout (paths, link, lanes); progress on stderr.
// The prompts come from src/lib/mockup/edit.ts — the same code the hub uses.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const DRAWER = process.env.WANGP_IMAGE_URL || "http://127.0.0.1:3391";
const HUB = (process.env.HUB_ORIGIN || "https://ultimate-assistant-os.vercel.app").replace(/\/$/, "");
/** Same sizes as the hub (src/lib/mockup/flux.ts FLUX_SIZE); lane seeds come from edit.ts laneSeed. */
const SIZE = { desktop: { width: 1024, height: 656 }, phone: { width: 512, height: 1024 } };
const SHOT = { desktop: { width: 1280, height: 820 }, phone: { width: 390, height: 780 } };
const SEED = 7;

// Node prints a one-line notice when it reads a .ts file; it is noise here.
process.removeAllListeners("warning");
const edit = await import(pathToFileURL(path.join(REPO, "src", "lib", "mockup", "edit.ts")).href);

// ----- arguments -------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
function flags(name) {
  const out = [];
  argv.forEach((a, i) => {
    if (a === `--${name}` && argv[i + 1] !== undefined) out.push(argv[i + 1]);
  });
  return out;
}
const has = (name) => argv.includes(`--${name}`);
const say = (text) => process.stderr.write(`[mockups] ${text}\n`);
function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
  process.exit(1);
}

// ----- the drawer ------------------------------------------------------------

async function health() {
  try {
    const res = await fetch(`${DRAWER}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Make sure the drawer is up, starting it (detached, so it outlives this command) when it isn't. */
async function ensureDrawer() {
  let h = await health();
  if (h?.ok && h.refs) return h;
  if (h?.ok && !h.refs) fail("The picture drawer running on port 3391 is an older one that can't start from a screenshot. Stop it and run: node tools/wangp-image/server.mjs");
  if (has("no-start")) fail("The picture drawer isn't running. Start it with: node tools/wangp-image/server.mjs");
  say("starting the Flux 2 drawer (tools/wangp-image/server.mjs)…");
  const child = spawn(process.execPath, [path.join(REPO, "tools", "wangp-image", "server.mjs")], {
    cwd: REPO,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    h = await health();
    if (h?.ok) break;
  }
  if (!h?.ok) fail("The picture drawer didn't start. Run it yourself to see why: node tools/wangp-image/server.mjs");
  if (!h.hasWanGP) fail(`WanGP isn't installed where the drawer looks (${h.root}). Set WANGP_ROOT.`);
  return h;
}

async function post(route, body, timeoutMs) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const res = await fetch(`${DRAWER}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 429: another picture (perhaps the Redesigner's) is on the GPU. Wait our turn.
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.image) throw new Error(data.error || `The drawer answered ${res.status}.`);
    return data;
  }
  throw new Error("The drawer stayed busy for 12 minutes.");
}

function bytesOf(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("The drawer sent something that isn't a picture.");
  return { mime: m[1], bytes: Buffer.from(m[2], "base64"), ext: m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg" };
}

// ----- what the code says about the site --------------------------------------
// Colours, fonts and pages, read from the repo when one is given. They go in
// the brief (what must keep working) and are printed for whoever writes the
// three readings; they are NOT put in the Flux prompt, which keeps the prompt
// identical to the Redesigner's so the two share pictures.

const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".vercel", ".claude", "coverage", ".turbo"]);

async function walk(dir, depth = 0, out = []) {
  if (depth > 7 || out.length > 4000) return out;
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, depth + 1, out);
    else out.push(p);
  }
  return out;
}

async function siteFacts(repo, pagePath) {
  const files = await walk(repo);
  const colors = new Map();
  const fonts = new Set();
  const pages = [];
  for (const f of files) {
    const rel = path.relative(repo, f).replace(/\\/g, "/");
    if (/(^|\/)app\/(.+\/)?page\.(t|j)sx?$/.test(rel)) {
      const route = "/" + rel.replace(/^(src\/)?app\//, "").replace(/\/?page\.(t|j)sx?$/, "").replace(/\([^)]*\)\/?/g, "");
      pages.push(route.replace(/\/$/, "") || "/");
    } else if (/(^|\/)pages\/(?!api\/|_).+\.(t|j)sx?$/.test(rel)) {
      pages.push("/" + rel.replace(/^(src\/)?pages\//, "").replace(/(index)?\.(t|j)sx?$/, "").replace(/\/$/, ""));
    } else if (/\.html?$/.test(rel) && !rel.includes("/public/") && pages.length < 60) {
      pages.push("/" + rel.replace(/(^|\/)index\.html?$/, "").replace(/\.html?$/, ""));
    }
    if (!/\.(css|scss|tsx|jsx|ts|js|html|mjs)$/.test(rel)) continue;
    let st;
    try {
      st = await stat(f);
    } catch {
      continue;
    }
    if (st.size > 400_000) continue;
    const text = await readFile(f, "utf8").catch(() => "");
    for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
      const c = m[0].toLowerCase();
      colors.set(c, (colors.get(c) ?? 0) + 1);
    }
    for (const m of text.matchAll(/font-family:\s*["']?([A-Za-z][A-Za-z0-9 \-]+)/g)) {
      const name = m[1].trim();
      if (!/^(var|inherit|system|ui-|sans-serif|serif|monospace)/i.test(name)) fonts.add(name);
    }
    for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/g)) {
      for (const n of m[1].split(",")) fonts.add(n.trim().replace(/_/g, " "));
    }
  }
  const neutral = new Set(["#ffffff", "#000000"]);
  const top = [...colors.entries()].filter(([c]) => !neutral.has(c)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
  const uniq = [...new Set(pages)].sort((a, b) => a.length - b.length).slice(0, 40);
  return {
    colors: top,
    fonts: [...fonts].slice(0, 4),
    pages: uniq,
    features: uniq.filter((p) => p !== pagePath).slice(0, 8).map((p) => `the ${p} page`),
  };
}

// ----- the board -------------------------------------------------------------

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function boardHtml({ site, url, edit: request, before, lanes, link, device }) {
  const phone = device === "phone";
  const card = (src, title, sub, n) => `
    <figure class="lane">
      <div class="pic${phone ? " phone" : ""}">${src ? `<img src="${esc(src)}" alt="${esc(title)}">` : `<span>not drawn</span>`}</div>
      <figcaption><b>${n ? `${n} · ` : ""}${esc(title)}</b><span>${esc(sub)}</span></figcaption>
    </figure>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(site)} — 3 mockups</title>
<style>
:root{--void:#050505;--ink:#f5f5f5;--ink2:rgba(245,245,245,.7);--line:rgba(245,245,245,.14);--sig:#ff4d2e}
*{box-sizing:border-box}body{margin:0;background:var(--void);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:32px 16px 64px}
main{max-width:1440px;margin:0 auto;display:flex;flex-direction:column;gap:22px}
.k{font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--sig);margin:0}
h1{font:900 clamp(28px,4.6vw,54px)/.98 "Archivo Black",ui-sans-serif,system-ui,sans-serif;letter-spacing:-.02em;margin:8px 0 0;max-width:22ch}
.ask{display:grid;grid-template-columns:minmax(0,300px) 1fr;gap:18px;align-items:center;border:1px solid var(--line);padding:12px}
.ask q{font-size:19px;line-height:1.35}.ask a{color:var(--ink2)}
.lanes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.lane{margin:0;border:1px solid var(--line);padding:10px;display:flex;flex-direction:column;gap:10px}
.pic{aspect-ratio:1024/656;background:#111;overflow:hidden;display:grid;place-items:center}.pic.phone{aspect-ratio:1/2}
.pic img{width:100%;height:100%;object-fit:cover;object-position:top}
figcaption{display:flex;flex-direction:column;gap:4px}figcaption b{font:600 12px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}
figcaption span{color:var(--ink2);font-size:13.5px}
.open{display:inline-block;align-self:flex-start;background:var(--sig);color:#0b0b0b;padding:12px 18px;font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;text-decoration:none}
@media (max-width:820px){.lanes{grid-template-columns:1fr}.ask{grid-template-columns:1fr}}
</style></head><body><main>
<div><p class="k">Website Redesigner · Edit · ${esc(site)}</p><h1>Three versions of your change. Pick one.</h1></div>
<section class="ask">${card(before, "Now", url, 0)}<q>${esc(request)}</q></section>
<section class="lanes">${lanes.map((l, i) => card(l.file ? path.basename(l.file) : "", l.label, l.instruction, i + 1)).join("")}</section>
<a class="open" href="${esc(link)}">Open in the Redesigner to tweak and send</a>
</main></body></html>`;
}

// ----- the three modes ---------------------------------------------------------

async function paint() {
  const url = flag("url");
  const request = flag("edit");
  if (!url || !request) fail('Pass --url and --edit, e.g. --url https://site.com --edit "make the hero dark".');
  const device = flag("device") === "phone" ? "phone" : "desktop";
  const siteName = flag("name") || edit.nameFromUrl(url);
  const custom = flags("lane").map((l) => {
    const [label, ...rest] = l.split("::");
    return rest.length ? { label: label.trim(), instruction: rest.join("::").trim() } : { instruction: l.trim() };
  });
  if (!custom.some((c) => c.instruction)) {
    say("no --lane readings given, so the built-in ones are used. They are generic and tend to paint three similar pictures — pass three concrete --lane readings that name the page's own elements.");
  }
  const repo = flag("repo");
  const out =
    flag("out") ||
    path.join(homedir(), ".cache", "wangp-image", "boards", `${siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`);
  await mkdir(out, { recursive: true });

  const facts = repo && existsSync(repo) ? await siteFacts(repo, (() => { try { return new URL(url).pathname.replace(/\/$/, "") || "/"; } catch { return "/"; } })()) : null;
  if (facts) say(`read the site's code: ${facts.pages.length} pages, colours ${facts.colors.slice(0, 3).join(" ")}, fonts ${facts.fonts.join(", ") || "none named"}`);

  const h = await ensureDrawer();
  say(h.loaded ? "Flux 2 is loaded — 1–3 minutes a picture on this laptop." : "Flux 2 is cold — the first picture takes ~4 minutes, the rest 1–3 minutes.");

  say(`photographing ${url} at ${device} width…`);
  const shot = await post("/shot", { url, ...SHOT[device] }, 90_000).catch((e) => fail(`Couldn't photograph the page: ${e.message}`));
  const before = bytesOf(shot.image);
  const beforeFile = path.join(out, `before.${before.ext}`);
  await writeFile(beforeFile, before.bytes);

  const lanes = edit.editLanes(request, { siteName, device }, custom);
  const results = [];
  for (const [i, lane] of lanes.entries()) {
    say(`painting ${i + 1}/3 — ${lane.label}…`);
    const started = Date.now();
    try {
      const got = await post(
        "/generate",
        { prompt: lane.prompt, ...SIZE[device], steps: 4, seed: edit.laneSeed(lane.id), refs: [{ image: shot.image, url }] },
        15 * 60_000,
      );
      const pic = bytesOf(got.image);
      const file = path.join(out, `lane-${i + 1}.${pic.ext}`);
      await writeFile(file, pic.bytes);
      results.push({ n: i + 1, id: lane.id, label: lane.label, instruction: lane.instruction, prompt: lane.prompt, file, cached: Boolean(got.cached), seconds: Math.round((Date.now() - started) / 1000) });
    } catch (e) {
      results.push({ n: i + 1, id: lane.id, label: lane.label, instruction: lane.instruction, prompt: lane.prompt, file: "", error: e.message });
    }
  }

  const q = new URLSearchParams({ section: "redesign", v: "edit", url, edit: request });
  if (flag("name")) q.set("name", siteName);
  custom.forEach((c, i) => {
    if (c?.instruction) q.set(`l${i + 1}`, c.instruction);
    if (c?.label) q.set(`n${i + 1}`, c.label);
  });
  const link = `${HUB}/apps/app-builder?${q.toString()}`;
  const localLink = `http://localhost:3000/apps/app-builder?${q.toString()}`;

  const board = path.join(out, "board.html");
  await writeFile(board, boardHtml({ site: siteName, url, edit: request, before: path.basename(beforeFile), lanes: results, link, device }), "utf8");
  const meta = { ok: results.some((r) => r.file), site: siteName, url, edit: request, device, out, board, before: beforeFile, lanes: results, link, localLink, facts };
  await writeFile(path.join(out, "mockups.json"), JSON.stringify(meta, null, 2), "utf8");
  process.stdout.write(JSON.stringify(meta, null, 2) + "\n");
}

async function loadBoard(dir) {
  const file = path.join(dir, "mockups.json");
  if (!existsSync(file)) fail(`No mockups.json in ${dir}. Paint a board first.`);
  return JSON.parse(await readFile(file, "utf8"));
}

async function tweak() {
  const dir = flag("from");
  const n = Number(flag("pick"));
  const text = flag("tweak");
  const meta = await loadBoard(dir);
  const lane = meta.lanes.find((l) => l.n === n);
  if (!lane?.file) fail(`Mockup ${n} wasn't drawn, so there's nothing to tweak.`);
  await ensureDrawer();
  const src = lane.tweaks?.at(-1)?.file || lane.file;
  const bytes = await readFile(src);
  const mime = src.endsWith(".png") ? "image/png" : "image/jpeg";
  const prompt = edit.refineFluxPrompt(text, { siteName: meta.site, device: meta.device });
  say(`tweaking ${n} — "${text}"…`);
  const got = await post("/generate", { prompt, ...SIZE[meta.device], steps: 4, seed: SEED, refs: [{ image: `data:${mime};base64,${bytes.toString("base64")}` }] }, 15 * 60_000);
  const pic = bytesOf(got.image);
  lane.tweaks = [...(lane.tweaks ?? []), { text, file: path.join(dir, `lane-${n}-t${(lane.tweaks?.length ?? 0) + 1}.${pic.ext}`) }];
  await writeFile(lane.tweaks.at(-1).file, pic.bytes);
  await writeFile(path.join(dir, "mockups.json"), JSON.stringify(meta, null, 2), "utf8");
  process.stdout.write(JSON.stringify({ ok: true, lane: n, file: lane.tweaks.at(-1).file, tweaks: lane.tweaks.map((t) => t.text) }, null, 2) + "\n");
}

async function brief() {
  const dir = flag("from");
  const n = Number(flag("pick"));
  const meta = await loadBoard(dir);
  const lane = meta.lanes.find((l) => l.n === n);
  if (!lane) fail(`There's no mockup ${n} on that board.`);
  const pick = { lane: lane.id, label: lane.label, edit: meta.edit, instruction: lane.instruction, tweaks: (lane.tweaks ?? []).map((t) => t.text) };
  const text = edit.editBrief({ siteName: meta.site, url: meta.url, pick, facts: meta.facts ?? undefined });
  const image = lane.tweaks?.at(-1)?.file || lane.file;
  process.stdout.write(JSON.stringify({ ok: true, pick, image, brief: text }, null, 2) + "\n");
}

try {
  if (flag("from") && flag("tweak")) await tweak();
  else if (flag("from") && has("brief")) await brief();
  else await paint();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
