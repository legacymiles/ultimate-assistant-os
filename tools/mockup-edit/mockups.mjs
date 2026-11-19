#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Three coded mockups of a website edit, before the edit is built.
//
// This is how a website edit starts from Claude Code chat. Since 18 Nov 2026
// the mockups are real HTML pages Claude writes (they replaced Flux 2
// paintings: better looking, exact words, seconds instead of GPU minutes).
// In chat, Claude IS the writer, so this command does the parts around it:
//
//   1. start   — reads the live site (scan.mjs), photographs the page and
//                saves its trimmed markup, and prints, for each of the three
//                lanes, the file to write and the same brief the hub's writer
//                gets (src/lib/mockup/coded.ts codedUser).
//   2. render  — after Claude has written lane-1.html … lane-3.html: cleans
//                them (no scripts ever), photographs each at device width,
//                reads each one's label and reading, and writes a board.
//
//   node tools/mockup-edit/mockups.mjs --url https://site.com --edit "make the hero dark" \
//        [--name "Site"] [--repo C:/path/to/site] [--device desktop|phone] \
//        [--lane "Label::what this version does"] x3 [--out DIR]
//   node tools/mockup-edit/mockups.mjs --from DIR --render
//
//   node tools/mockup-edit/mockups.mjs --from DIR --pick 2 --tweak "make the button green"
//        (copies lane 2's page to lane-2-t1.html for Claude to edit; then --render)
//   node tools/mockup-edit/mockups.mjs --from DIR --pick 2 --brief
//   node tools/mockup-edit/mockups.mjs --from DIR --pick 2 --lock --style "the look in words"
//
//   node tools/mockup-edit/mockups.mjs --scan --url https://site.com [--pages 6] [--device phone]
//
// --scan reads the live site first (tools/mockup-edit/scan.mjs): every page's
// rendered sections, colours, fonts, nav, forms and buttons, written as
// DESIGN.md + SITE.md in ~/.cache/wangp-image/sites/<site>/ (or --context DIR).
// Starting a board reuses that context (scanning first when there is none;
// --rescan to refresh, --no-scan to skip). --lock makes a pick the direction
// for the whole site: later pages' briefs carry it in words.
//
// Prints one JSON object on stdout (paths, link, lanes); progress on stderr.
// Screenshots come from the screenshot helper in tools/wangp-image (headless
// Chrome — no image model is involved).
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const HELPER = process.env.WANGP_IMAGE_URL || "http://127.0.0.1:3391";
const HUB = (process.env.HUB_ORIGIN || "https://ultimate-assistant-os.vercel.app").replace(/\/$/, "");
/** The before picture, at the hub's sizes (useCodedMockups photographPage). */
const SHOT = { desktop: { width: 1280, height: 820 }, phone: { width: 390, height: 780 } };
/** A written mockup is photographed taller, so the board shows more than the first screen. */
const LANE_SHOT = { desktop: { width: 1280, height: 1600 }, phone: { width: 390, height: 1600 } };

// Node prints a one-line notice when it reads a .ts file; it is noise here.
process.removeAllListeners("warning");
const edit = await import(pathToFileURL(path.join(REPO, "src", "lib", "mockup", "edit.ts")).href);
const coded = await import(pathToFileURL(path.join(REPO, "src", "lib", "mockup", "coded.ts")).href);
const sc = await import(pathToFileURL(path.join(REPO, "src", "lib", "mockup", "site-context.ts")).href);
const scanner = await import(pathToFileURL(path.join(HERE, "scan.mjs")).href);

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

// ----- the screenshot helper ---------------------------------------------------

async function health() {
  try {
    const res = await fetch(`${HELPER}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Make sure the screenshot helper is up, starting it (detached, so it outlives this command) when it isn't. */
async function ensureHelper() {
  let h = await health();
  if (h?.ok && h.shot) return h;
  if (h?.ok && !h.shot) fail("The screenshot helper on port 3391 can't find Chrome. Install Google Chrome, then restart: node tools/wangp-image/server.mjs");
  if (has("no-start")) fail("The screenshot helper isn't running. Start it with: node tools/wangp-image/server.mjs");
  say("starting the screenshot helper (tools/wangp-image/server.mjs)…");
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
  if (!h?.ok) fail("The screenshot helper didn't start. Run it yourself to see why: node tools/wangp-image/server.mjs");
  return h;
}

/** Photograph a page (url) or a written mockup (html). */
async function shoot(body) {
  const res = await fetch(`${HELPER}/shot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.image) throw new Error(data.error || `The screenshot helper answered ${res.status}.`);
  return data;
}

function bytesOf(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("The helper sent something that isn't a picture.");
  return { mime: m[1], bytes: Buffer.from(m[2], "base64"), ext: m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg" };
}

// ----- what the code says about the site --------------------------------------
// Colours, fonts and pages, read from the repo when one is given. They go in
// each lane's brief and the build brief (what must keep working).

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

// ----- what the live site says about itself ------------------------------------
// The rendered DOM of every page, read once and kept per site, so page 2 knows
// what page 1 looks like and what was picked there (site-context.ts).

function contextDir(url) {
  return flag("context") || path.join(homedir(), ".cache", "wangp-image", "sites", sc.siteSlug(url));
}

function pathOf(url) {
  try {
    return sc.cleanPath(new URL(url).pathname);
  } catch {
    return "/";
  }
}

/** The site's context: read from disk, or by scanning the live site when there is none (or --rescan). */
async function ensureContext(url, device, siteName) {
  const dir = contextDir(url);
  let ctx = await scanner.readContext(dir);
  const sameSite = ctx && (() => {
    try {
      return new URL(ctx.origin).hostname.replace(/^www\./, "") === new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return false;
    }
  })();
  const want = pathOf(url);
  const hasPage = ctx?.pages?.some((p) => sc.cleanPath(p.path) === want);
  if (ctx && sameSite && hasPage && !has("rescan")) return { dir, ctx, files: await scanner.writeContext(dir, ctx) };
  if (has("no-scan")) return { dir, ctx: sameSite ? ctx : null, files: null };
  const pages = Math.max(1, Math.min(15, Number(flag("pages")) || 6));
  say(`reading the live site (${pages} pages max) so the mockups know every section, form and colour…`);
  const fresh = await scanner.scanSite(url, { maxPages: pages, device, name: siteName, saveDir: dir, say });
  // A rescan keeps the direction already locked for the site.
  if (ctx?.lock && sameSite) fresh.lock = ctx.lock;
  return { dir, ctx: fresh, files: await scanner.writeContext(dir, fresh) };
}

async function scanOnly() {
  const url = flag("url");
  if (!url) fail("Pass --url, e.g. --scan --url https://site.com");
  const device = flag("device") === "phone" ? "phone" : "desktop";
  const siteName = flag("name") || edit.nameFromUrl(url);
  const { ctx, files } = await ensureContext(url, device, siteName);
  if (!ctx) fail("Nothing could be read from that site.");
  const out = {
    ok: true,
    site: ctx.name,
    origin: ctx.origin,
    files,
    pages: ctx.pages.map((p) => ({ path: p.path, title: p.title, sections: p.sections.length, forms: p.forms.length })),
    locked: ctx.lock ? { page: ctx.lock.page, label: ctx.lock.label, instruction: ctx.lock.instruction } : null,
    // What whoever writes the three readings should read first.
    outline: sc.pageBrief(ctx, pathOf(url)),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

// ----- the board -------------------------------------------------------------

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function boardHtml({ site, url, edit: request, before, lanes, link, device, note = "" }) {
  const phone = device === "phone";
  const w = phone ? 390 : 1280;
  const h = phone ? 780 : 820;
  // Each lane is its own page, shown live (no scripts run in it) and scaled to the column.
  const frame = (file, title) =>
    file
      ? `<div class="pic"><iframe src="${esc(file)}" title="${esc(title)}" sandbox="allow-same-origin" style="width:${w}px;height:${h}px" data-w="${w}"></iframe></div>`
      : `<div class="pic"><span>not written yet</span></div>`;
  const card = (body, title, sub, n) => `
    <figure class="lane">
      ${body}
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
.pic{position:relative;aspect-ratio:${w}/${h};background:#111;overflow:hidden;display:grid;place-items:center}
.pic img{width:100%;height:100%;object-fit:cover;object-position:top}
.pic iframe{position:absolute;top:0;left:0;border:0;transform-origin:top left;background:#fff}
figcaption{display:flex;flex-direction:column;gap:4px}figcaption b{font:600 12px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}
figcaption span{color:var(--ink2);font-size:13.5px}
.open{display:inline-block;align-self:flex-start;background:var(--sig);color:#0b0b0b;padding:12px 18px;font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;text-decoration:none}
@media (max-width:820px){.lanes{grid-template-columns:1fr}.ask{grid-template-columns:1fr}}
</style></head><body><main>
<div><p class="k">Website edit · coded mockups · ${esc(site)}</p><h1>Three versions of your change. Pick one.</h1>${note ? `<p class="k" style="color:var(--ink2);margin-top:12px">${esc(note)}</p>` : ""}</div>
<section class="ask">${card(before ? `<div class="pic"><img src="${esc(before)}" alt="Now"></div>` : "", "Now", url, 0)}<q>${esc(request)}</q></section>
<section class="lanes">${lanes.map((l, i) => card(frame(l.html ? path.basename(l.tweaks?.at(-1)?.html || l.html) : "", l.label), l.label, l.instruction, i + 1)).join("")}</section>
<a class="open" href="${esc(link)}">Open in the Redesigner to tweak and send</a>
</main>
<script>
// The board's own script (never a mockup's): scale each lane's page to its column.
for (const f of document.querySelectorAll("iframe[data-w]")) {
  const fit = () => { f.style.transform = "scale(" + (f.parentElement.clientWidth / Number(f.dataset.w)) + ")"; };
  fit(); new ResizeObserver(fit).observe(f.parentElement);
}
</script></body></html>`;
}

// ----- the modes ---------------------------------------------------------------

/** The live page's markup, trimmed the way the hub trims it. "" when it won't load. */
async function pageMarkup(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "Mozilla/5.0 (mockup reader)" } });
    return res.ok ? coded.trimMarkup(await res.text(), url) : "";
  } catch {
    return "";
  }
}

async function start() {
  const url = flag("url");
  const request = flag("edit");
  if (!url || !request) fail('Pass --url and --edit, e.g. --url https://site.com --edit "make the hero dark".');
  const device = flag("device") === "phone" ? "phone" : "desktop";
  const siteName = flag("name") || edit.nameFromUrl(url);
  const custom = flags("lane").map((l) => {
    const [label, ...rest] = l.split("::");
    return rest.length ? { label: label.trim(), instruction: rest.join("::").trim() } : { instruction: l.trim() };
  });
  const repo = flag("repo");
  const out =
    flag("out") ||
    path.join(homedir(), ".cache", "wangp-image", "boards", `${siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`);
  await mkdir(out, { recursive: true });

  const pagePath = pathOf(url);
  const codeFacts = repo && existsSync(repo) ? await siteFacts(repo, pagePath) : null;
  if (codeFacts) say(`read the site's code: ${codeFacts.pages.length} pages, colours ${codeFacts.colors.slice(0, 3).join(" ")}, fonts ${codeFacts.fonts.join(", ") || "none named"}`);

  // The live site, read from its rendered pages. Never blocks the mockups.
  let site = null;
  try {
    site = await ensureContext(url, device, siteName);
  } catch (e) {
    say(`couldn't read the live site (${e.message}) — working from the screenshot and markup alone.`);
  }
  const ctx = site?.ctx ?? null;
  const liveFacts = ctx ? sc.scanFacts(ctx, pagePath) : null;
  const facts =
    liveFacts || codeFacts
      ? {
          ...(codeFacts ?? {}),
          ...(liveFacts ?? {}),
          pages: [...new Set([...(liveFacts?.pages ?? []), ...(codeFacts?.pages ?? [])])],
          features: [...(liveFacts?.features ?? []), ...(codeFacts?.features ?? [])].slice(0, 12),
        }
      : null;
  const lock = has("no-lock") ? null : sc.lockFor(ctx, pagePath);
  const outline = [ctx ? sc.pageBrief(ctx, pagePath) : "", lock ? sc.lockedStyleLine(lock, false) : ""].filter(Boolean).join("\n\n");
  if (ctx) say(`site context: ${ctx.pages.length} pages read → ${site.files?.design ?? site.dir}`);
  if (lock) say(`mocking up in the direction locked on ${lock.page}: "${lock.label}"`);

  await ensureHelper();
  say(`photographing ${url} at ${device} width…`);
  const shot = await shoot({ url, ...SHOT[device] }).catch((e) => fail(`Couldn't photograph the page: ${e.message}`));
  const before = bytesOf(shot.image);
  const beforeFile = path.join(out, `before.${before.ext}`);
  await writeFile(beforeFile, before.bytes);

  const markup = await pageMarkup(url);
  const markupFile = path.join(out, "page.html");
  if (markup) await writeFile(markupFile, markup, "utf8");
  else say("the page's markup couldn't be fetched from here — read the rendered page in the site context (pages/*.html) instead.");

  const lanes = edit.editLanes(request, custom).map((lane, i) => {
    const req = {
      kind: "edit",
      edit: request,
      lane: lane.id,
      ...(custom[i]?.instruction ? { reading: custom[i] } : {}),
      siteName,
      url,
      device,
      ...(facts ? { facts } : {}),
      ...(outline ? { outline } : {}),
    };
    return {
      n: i + 1,
      id: lane.id,
      label: custom[i]?.instruction ? lane.label : coded.roleLabel(lane.id),
      instruction: lane.instruction,
      html: path.join(out, `lane-${i + 1}.html`),
      shot: "",
      brief: coded.codedUser(req),
    };
  });

  const meta = {
    ok: true,
    stage: "write",
    site: siteName,
    url,
    edit: request,
    device,
    out,
    before: beforeFile,
    markup: markup ? markupFile : "",
    facts,
    context: ctx
      ? {
          dir: site.dir,
          design: site.files?.design,
          site: site.files?.site,
          pages: ctx.pages.length,
          locked: lock ? { page: lock.page, label: lock.label, instruction: lock.style || lock.instruction } : null,
        }
      : null,
    rules: coded.CODED_SYSTEM,
    lanes,
    next: `Write each lane's page to its "html" path (one self-contained HTML document per lane, following "rules" and that lane's "brief", reading "markup" and "before"), then run: node tools/mockup-edit/mockups.mjs --from "${out}" --render`,
  };
  await writeFile(path.join(out, "mockups.json"), JSON.stringify(meta, null, 2), "utf8");
  process.stdout.write(JSON.stringify(meta, null, 2) + "\n");
}

async function loadBoard(dir) {
  const file = path.join(dir, "mockups.json");
  if (!existsSync(file)) fail(`No mockups.json in ${dir}. Start a board first.`);
  return JSON.parse(await readFile(file, "utf8"));
}

/** The page a lane shows now: its last tweak, else its first version. */
const currentHtml = (lane) => lane.tweaks?.at(-1)?.html || lane.html;

async function render() {
  const dir = flag("from");
  const meta = await loadBoard(dir);
  await ensureHelper();
  for (const lane of meta.lanes) {
    const file = currentHtml(lane);
    if (!existsSync(file)) {
      lane.shot = "";
      lane.error = `not written yet: ${file}`;
      continue;
    }
    const clean = coded.cleanMockupHtml(await readFile(file, "utf8"));
    if (!clean) {
      lane.shot = "";
      lane.error = `${path.basename(file)} has no HTML document in it.`;
      continue;
    }
    await writeFile(file, clean, "utf8");
    const m = coded.mockupMeta(clean);
    if (m.label) lane.label = m.label;
    if (m.reading) lane.instruction = m.reading;
    say(`photographing ${path.basename(file)}…`);
    try {
      const got = bytesOf((await shoot({ html: clean, ...LANE_SHOT[meta.device] })).image);
      lane.shot = file.replace(/\.html$/, `.${got.ext}`);
      await writeFile(lane.shot, got.bytes);
      delete lane.error;
    } catch (e) {
      lane.shot = "";
      lane.error = `couldn't photograph it: ${e.message}`;
    }
  }
  const q = new URLSearchParams({ section: "redesign", v: "edit", url: meta.url, edit: meta.edit });
  if (meta.site) q.set("name", meta.site);
  meta.lanes.forEach((l, i) => {
    if (l.instruction) q.set(`l${i + 1}`, l.instruction);
    if (l.label) q.set(`n${i + 1}`, l.label);
  });
  meta.link = `${HUB}/apps/app-builder?${q.toString()}`;
  meta.localLink = `http://localhost:3000/apps/app-builder?${q.toString()}`;
  meta.board = path.join(dir, "board.html");
  meta.stage = "pick";
  meta.ok = meta.lanes.every((l) => l.shot);
  delete meta.next;
  await writeFile(
    meta.board,
    boardHtml({
      site: meta.site,
      url: meta.url,
      edit: meta.edit,
      before: path.basename(meta.before),
      lanes: meta.lanes,
      link: meta.link,
      device: meta.device,
      note: meta.context ? `${meta.context.pages} pages of the live site read` : "",
    }),
    "utf8",
  );
  await writeFile(path.join(dir, "mockups.json"), JSON.stringify(meta, null, 2), "utf8");
  process.stdout.write(JSON.stringify(meta, null, 2) + "\n");
}

async function tweak() {
  const dir = flag("from");
  const n = Number(flag("pick"));
  const text = flag("tweak");
  const meta = await loadBoard(dir);
  const lane = meta.lanes.find((l) => l.n === n);
  if (!lane || !existsSync(currentHtml(lane))) fail(`Mockup ${n} hasn't been written, so there's nothing to tweak.`);
  const k = (lane.tweaks?.length ?? 0) + 1;
  const file = path.join(dir, `lane-${n}-t${k}.html`);
  await copyFile(currentHtml(lane), file);
  lane.tweaks = [...(lane.tweaks ?? []), { text, html: file }];
  await writeFile(path.join(dir, "mockups.json"), JSON.stringify(meta, null, 2), "utf8");
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        lane: n,
        file,
        tweak: text,
        next: `Edit ${file} so it makes this change and nothing else (update its mockup-label and mockup-reading tags), then run: node tools/mockup-edit/mockups.mjs --from "${dir}" --render`,
      },
      null,
      2,
    ) + "\n",
  );
}

async function brief() {
  const dir = flag("from");
  const n = Number(flag("pick"));
  const meta = await loadBoard(dir);
  const lane = meta.lanes.find((l) => l.n === n);
  if (!lane) fail(`There's no mockup ${n} on that board.`);
  const pick = { lane: lane.id, label: lane.label, edit: meta.edit, instruction: lane.instruction, tweaks: (lane.tweaks ?? []).map((t) => t.text) };
  const text = edit.editBrief({
    siteName: meta.site,
    url: meta.url,
    pick,
    facts: meta.facts ?? undefined,
    designFile: meta.context?.design,
    siteFile: meta.context?.site,
    lock: meta.context?.locked ?? undefined,
  });
  const page = currentHtml(lane);
  process.stdout.write(JSON.stringify({ ok: true, pick, html: page, image: lane.shot, brief: `${text}\nThe picked mockup, as a page: ${page}` }, null, 2) + "\n");
}

/** Make a pick the direction for the whole site (DESIGN.md §6, carried in words to later pages). */
async function lockPick() {
  const dir = flag("from");
  const n = Number(flag("pick"));
  const meta = await loadBoard(dir);
  const lane = meta.lanes.find((l) => l.n === n);
  if (!lane?.shot) fail(`Mockup ${n} hasn't been rendered, so it can't be locked. Run --render first.`);
  const cdir = meta.context?.dir || contextDir(meta.url);
  const ctx = await scanner.readContext(cdir);
  if (!ctx) fail(`This site hasn't been read yet, so there's nowhere to lock it. Run: node tools/mockup-edit/mockups.mjs --scan --url ${meta.url}`);
  const image = path.join(cdir, `locked${path.extname(lane.shot)}`);
  await copyFile(lane.shot, image);
  ctx.lock = {
    page: pathOf(meta.url),
    edit: meta.edit,
    label: lane.label,
    instruction: lane.instruction,
    // The look alone, for other pages. Without it the page-specific instruction is used.
    style: flag("style") ? String(flag("style")).slice(0, 400) : undefined,
    tweaks: (lane.tweaks ?? []).map((t) => t.text),
    image,
    at: new Date().toISOString(),
  };
  if (!ctx.lock.style) say('no --style given: pass the look alone in words (e.g. --style "deep navy panels, red pill buttons") so it carries to other pages cleanly.');
  const files = await scanner.writeContext(cdir, ctx);
  process.stdout.write(JSON.stringify({ ok: true, locked: ctx.lock, ...files }, null, 2) + "\n");
}

try {
  if (flag("from") && flag("tweak")) await tweak();
  else if (flag("from") && has("render")) await render();
  else if (flag("from") && has("brief")) await brief();
  else if (flag("from") && has("lock")) await lockPick();
  else if (has("scan")) await scanOnly();
  else await start();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
