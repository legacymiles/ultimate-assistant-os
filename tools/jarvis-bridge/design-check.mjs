#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The design check — the half of Design Intelligence a builder cannot grade.
//
// Every Jarvis website build (App Builder, Client Review edits, Redesigner
// lanes) is told to run this against its running site before it reports. It
// loads each page in a real Chromium at phone and desktop width, scrolls it so
// reveal-on-scroll content actually shows, measures what is on screen, saves
// screenshots, and judges it with the rules in
// src/lib/design-intelligence/slop.ts — the same rules the tests pin down.
//
//   node design-check.mjs <url> [--important /,/pricing] [--paths /about]
//                         [--src <folder>] [--no-src] [--out <folder>]
//                         [--widths 390,1440] [--max-pages 6] [--json]
//
// Exit code: 0 pass · 1 fail · 2 could not run. The bridge sets
// JARVIS_DESIGN_CHECK to this file's path on every harness thread, so a build
// in any folder runs it as `node "$JARVIS_DESIGN_CHECK" http://localhost:3000`.
//
// It only reads pages and writes into its own output folder (under the system
// temp folder unless --out says otherwise), so it never leaves files in the
// repository being checked.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RULES_URL = pathToFileURL(resolve(HERE, "../../src/lib/design-intelligence/slop.ts")).href;

/**
 * Loaded lazily so `--help` and argument errors never need Node's TypeScript support.
 *
 * The hub's package.json has no "type", so Node warns that it re-parsed
 * slop.ts as a module. The warning is true and harmless, and in a build's
 * terminal it reads like a failure — so that one warning is dropped.
 */
async function rules() {
  const emit = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const code = typeof rest[0] === "object" ? rest[0]?.code : rest[1];
    if (code === "MODULE_TYPELESS_PACKAGE_JSON" || /MODULE_TYPELESS_PACKAGE_JSON/.test(String(warning?.code ?? ""))) return;
    return emit.call(process, warning, ...rest);
  };
  try {
    return await import(RULES_URL);
  } finally {
    process.emitWarning = emit;
  }
}

// ----- arguments --------------------------------------------------------------------

/**
 * A route as the owner typed it.
 *
 * Git Bash on Windows rewrites any argument that starts with "/" into a
 * Windows path before Node sees it: `--important /` arrives as
 * `C:/Program Files/Git/`, and `/pricing` as `C:/Program Files/Git/pricing`.
 * The briefs tell every build to type exactly that, so the rewrite is undone
 * here rather than hoping each agent knows about MSYS_NO_PATHCONV.
 */
export function routeArg(v) {
  const s = String(v ?? "").trim().replace(/\\/g, "/");
  const msys = /^[a-z]:\/(?:.*\/)?Git\/?(.*)$/i.exec(s);
  if (msys) return `/${msys[1]}`;
  if (/^[a-z]:\//i.test(s)) return s; // a real Windows path: leave it, it will fail loudly
  if (s === "home") return "/";
  return s.startsWith("/") || /^https?:/i.test(s) ? s : `/${s}`;
}

export function parseArgs(argv) {
  const o = { url: "", important: ["/"], paths: [], src: process.cwd(), useSrc: true, out: "", widths: [390, 1440], maxPages: 6, json: false };
  const list = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const routes = (v) => list(v).map(routeArg);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--important") o.important = routes(next());
    else if (a === "--paths") o.paths = routes(next());
    else if (a === "--src") o.src = next();
    else if (a === "--no-src") o.useSrc = false;
    else if (a === "--out") o.out = next();
    else if (a === "--widths") o.widths = list(next()).map(Number).filter((n) => n > 0);
    else if (a === "--max-pages") o.maxPages = Math.max(1, Number(next()) || 6);
    else if (a === "--json") o.json = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (!a.startsWith("--") && !o.url) o.url = a;
  }
  return o;
}

// ----- source files -----------------------------------------------------------------

const SRC_EXT = /\.(tsx|jsx|ts|js|html|vue|svelte|astro|mdx|css|scss)$/i;
const SKIP_DIR = new Set(["node_modules", ".next", "dist", "build", "out", "coverage", ".git", ".vercel", ".turbo", "public"]);

/** The files a build wrote, read as text — bounded so a monorepo cannot stall the check. */
export function readSources(root, limit = 600) {
  const files = [];
  const walk = (dir) => {
    if (files.length >= limit) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= limit) return;
      if (e.name.startsWith(".") && e.name !== ".") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(p);
      } else if (SRC_EXT.test(e.name)) {
        try {
          if (statSync(p).size > 400_000) continue;
          files.push({ path: relative(root, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") });
        } catch {
          /* unreadable file: skip */
        }
      }
    }
  };
  walk(root);
  return files;
}

// ----- the in-page measurement ------------------------------------------------------

/**
 * Runs inside the page. Everything it needs is in here — no closures over Node.
 * Returns a PageSnapshot (see slop.ts) minus url/width/consoleErrors.
 */
function measure() {
  /** Opacity as seen: the product of every ancestor's. A menu faded to 0 is not on screen. */
  const seenOpacity = (el) => {
    let o = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    // Over 2px: screen-reader-only text (clipped to 1px) is not something a visitor reads.
    if (r.width <= 2 || r.height <= 2) return false;
    // Pushed off the side (closed drawers, slid-out menus).
    if (r.right <= 0 || r.left >= window.innerWidth) return false;
    if (el.closest("[aria-hidden=true], [inert], dialog:not([open])")) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || seenOpacity(el) <= 0.1) return false;
    // Clipped away by a parent (the other slides of a carousel, a collapsed panel).
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n);
      if (/hidden|clip/.test(o.overflowX + o.overflowY)) {
        const c = n.getBoundingClientRect();
        if (r.right <= c.left + 1 || r.left >= c.right - 1 || r.bottom <= c.top + 1 || r.top >= c.bottom - 1) return false;
      }
    }
    return true;
  };
  /**
   * Pictures that text may sit on without being their child: a hero photo, a
   * video, a canvas gradient, a background-image layer. Text over one of these
   * has no knowable contrast, so it is skipped rather than guessed at.
   */
  const media = [...document.querySelectorAll("img, video, canvas, picture, svg, [style*=background-image]")]
    .concat([...document.querySelectorAll("body *")].filter((n) => {
      const bi = getComputedStyle(n).backgroundImage;
      return bi && bi !== "none";
    }).slice(0, 300))
    .map((n) => ({ n, r: n.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 40 && r.height > 24);
  const overMedia = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return media.some(({ n, r: m }) => !n.contains(el) && !el.contains(n) && x >= m.left && x <= m.right && y >= m.top && y <= m.bottom);
  };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
  const rgba = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || "");
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  /** The colour actually behind an element, or null when an image or gradient makes it unknowable. */
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      const c = rgba(cs.backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  const textEls = [...document.body.querySelectorAll("*")].filter((el) => ownText(el) && vis(el)).slice(0, 1500);
  const fonts = new Set();
  const sizes = new Set();
  let lowContrast = 0;
  let unreadable = 0;
  for (const el of textEls) {
    const cs = getComputedStyle(el);
    fonts.add(cs.fontFamily);
    sizes.add(Math.round(parseFloat(cs.fontSize)));
    const fgRaw = rgba(cs.color);
    if (overMedia(el)) continue;
    const bg = bgOf(el);
    // Gradient-clipped text paints with a transparent colour: unknowable here, skip it.
    if (!fgRaw || !bg || fgRaw.a < 0.15) continue;
    // Semi-transparent text is seen blended over what is behind it.
    const fg = {
      r: fgRaw.r * fgRaw.a + bg.r * (1 - fgRaw.a),
      g: fgRaw.g * fgRaw.a + bg.g * (1 - fgRaw.a),
      b: fgRaw.b * fgRaw.a + bg.b * (1 - fgRaw.a),
    };
    const L1 = lum(fg);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.6 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) lowContrast++;
    if (ratio < (large ? 2 : 3)) unreadable++;
  }

  // Card grids: a container of ≥3 same-shaped, boxed children that are big enough to be cards.
  const counted = new Set();
  let cardGrids = 0;
  for (const el of document.body.querySelectorAll("*")) {
    if ([...counted].some((c) => c.contains(el))) continue;
    const kids = [...el.children].filter(vis);
    if (kids.length < 3) continue;
    const sig = (k) => `${k.tagName}|${k.className && typeof k.className === "string" ? k.className : ""}`;
    if (!sig(kids[0]).split("|")[1]) continue;
    if (!kids.every((k) => sig(k) === sig(kids[0]))) continue;
    const r0 = kids[0].getBoundingClientRect();
    if (r0.height < 90 || r0.width < 120) continue;
    if (!kids.every((k) => Math.abs(k.getBoundingClientRect().width - r0.width) < r0.width * 0.12)) continue;
    const cs = getComputedStyle(kids[0]);
    const boxed = parseFloat(cs.borderTopLeftRadius) > 0 && (cs.boxShadow !== "none" || parseFloat(cs.borderTopWidth) > 0 || (rgba(cs.backgroundColor)?.a ?? 0) > 0);
    if (!boxed) continue;
    counted.add(el);
    cardGrids++;
  }

  const imgs = [...document.images];
  const targets = [...document.querySelectorAll("a[href], button, [role=button]")].filter((el) => vis(el) && !el.closest("p"));
  const buttons = [...document.querySelectorAll("button, [role=button], a")]
    .filter(vis)
    .map((el) => getComputedStyle(el).backgroundColor)
    .filter((c) => (rgba(c)?.a ?? 0) > 0.5)
    .slice(0, 30);
  // Only what never stops: a reveal that finishes is motion with meaning, a loop on every logo is noise.
  const animTargets = new Set(
    (document.getAnimations?.() ?? [])
      .filter((a) => a.playState === "running" && a.effect?.getTiming?.().iterations === Infinity)
      .map((a) => a.effect && a.effect.target)
      .filter(Boolean),
  );
  let bodyBg = getComputedStyle(document.body).backgroundColor;
  if ((rgba(bodyBg)?.a ?? 0) === 0) bodyBg = getComputedStyle(document.documentElement).backgroundColor;
  const standoutEls = [...document.querySelectorAll("[data-standout]")];

  return {
    // One line per visible element's own text, so a stand-in LABEL ("Feature 1") is its own
    // line and "grow your company" inside a sentence is not mistaken for one.
    text: textEls
      .map((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" "))
      .join("\n")
      .slice(0, 60_000),
    fonts: [...fonts],
    fontSizes: [...sizes].sort((a, b) => a - b),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    brokenImages: imgs.filter((i) => i.complete && i.getAttribute("src") && i.naturalWidth === 0).length,
    imagesMissingAlt: imgs.filter((i) => !i.hasAttribute("alt")).length,
    standouts: standoutEls.map((el) => el.getAttribute("data-standout") || ""),
    standoutVisible: standoutEls.some(vis),
    hasCanvas: !!document.querySelector("canvas"),
    hasVideo: !!document.querySelector("video"),
    cardGrids,
    animated: animTargets.size,
    lowContrast,
    unreadable,
    // WCAG 2.2 AA target size: 24px.
    smallTargets: targets.filter((el) => el.getBoundingClientRect().height < 24).length,
    bodyBg,
    buttonBgs: buttons,
    h1Count: document.querySelectorAll("h1").length,
    links: [...document.querySelectorAll("a[href]")].map((a) => a.href),
  };
}

/** Scroll the whole page so reveal-on-scroll content is actually on screen when measured. */
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    const max = Math.min(document.documentElement.scrollHeight, 30_000);
    for (let y = 0; y < max; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
}

// ----- the run ----------------------------------------------------------------------

function samePath(base, href) {
  try {
    const u = new URL(href, base);
    const b = new URL(base);
    if (u.origin !== b.origin) return null;
    if (/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3)$/i.test(u.pathname)) return null;
    return u.pathname || "/";
  } catch {
    return null;
  }
}

/**
 * Check a running site. Returns { verdict, pages, out, text }.
 * `chromium` can be injected (tests); otherwise Playwright is loaded from this folder.
 */
export async function designCheck(opts, deps = {}) {
  const { scanPage, scanSource, verdict, report } = await rules();
  const base = new URL(opts.url);
  const out = opts.out || join(tmpdir(), "jarvis-design-check", `${base.hostname}-${base.port || "80"}-${Date.now()}`);
  mkdirSync(out, { recursive: true });

  let chromium = deps.chromium;
  if (!chromium) {
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      throw new Error("Playwright is not installed in tools/jarvis-bridge. Run `npm install` then `npx playwright install chromium` there.");
    }
  }

  const browser = await chromium.launch({ headless: true });
  const findings = [];
  const pages = [];
  try {
    const important = new Set((opts.important ?? ["/"]).map((p) => samePath(base.href, p) ?? p));
    // The address the check was given is always checked, first, whatever else was asked for.
    const start = base.pathname || "/";
    const queue = [...new Set([start, ...important, ...(opts.paths ?? [])].map((p) => samePath(base.href, p) ?? p))];
    const seen = new Set();
    const widths = opts.widths?.length ? opts.widths : [390, 1440];

    while (queue.length && seen.size < (opts.maxPages ?? 6)) {
      const path = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      const url = new URL(path, base).href;
      for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const errors = [];
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
        let status = 0;
        try {
          const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 }).catch(async () => page.goto(url, { waitUntil: "load", timeout: 45_000 }));
          status = res?.status() ?? 0;
          await page.waitForTimeout(1200);
          await scrollThrough(page);
          const snap = await page.evaluate(measure);
          const shot = join(out, `${path === "/" ? "home" : path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}-${width}.jpg`);
          await page.screenshot({ path: shot, fullPage: true, type: "jpeg", quality: 55 }).catch(() => page.screenshot({ path: shot, type: "jpeg", quality: 55 }));
          const isImportant = important.has(path) && width === Math.max(...widths);
          const snapshot = { url, width, ...snap, consoleErrors: errors };
          if (status >= 400) {
            findings.push({ rule: "page-status", severity: "fail", where: `${url} @ ${width}px`, message: `The page answered ${status}.`, fix: "Make the route exist and render." });
          }
          // The standout is judged once per page, at desktop width, where it is designed to land.
          findings.push(...scanPage(snapshot, { important: isImportant }));
          if (isImportant && snap.standouts.length) {
            const rm = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
            const rp = await rm.newPage();
            await rp.goto(url, { waitUntil: "load", timeout: 45_000 }).catch(() => null);
            await rp.waitForTimeout(800);
            const still = await rp.evaluate(() => [...document.querySelectorAll("[data-standout]")].some((el) => {
              const r = el.getBoundingClientRect();
              const cs = getComputedStyle(el);
              return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
            })).catch(() => false);
            await rm.close();
            if (!still) {
              findings.push({ rule: "standout-reduced-motion", severity: "warn", where: `${url} @ ${width}px`, message: "With reduced motion on, the standout disappears.", fix: "Under prefers-reduced-motion show a still, legible version of the standout rather than nothing." });
            }
          }
          pages.push({ path, width, status, screenshot: shot, standouts: snap.standouts, cardGrids: snap.cardGrids, lowContrast: snap.lowContrast, fonts: snap.fonts.map((f) => f.split(",")[0].trim()) });
          if (width === widths[0]) {
            for (const href of snap.links) {
              const p = samePath(base.href, href);
              if (p && !seen.has(p) && !queue.includes(p)) queue.push(p);
            }
          }
        } catch (e) {
          findings.push({ rule: "page-load", severity: "fail", where: `${url} @ ${width}px`, message: `The page did not load: ${String(e?.message ?? e).split("\n")[0]}`, fix: "Start the site and make this route load." });
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (opts.useSrc !== false && opts.src && existsSync(opts.src)) {
    findings.push(...scanSource(readSources(resolve(opts.src))));
  }

  // The same finding at two widths is one problem, not two.
  const unique = [];
  const keys = new Set();
  for (const f of findings) {
    const k = `${f.rule}|${f.where.replace(/ @ \d+px$/, "")}|${f.message.replace(/\d+/g, "#")}`;
    if (keys.has(k)) continue;
    keys.add(k);
    unique.push(f);
  }
  const v = verdict(unique);
  const text = report(v);
  writeFileSync(join(out, "report.json"), JSON.stringify({ url: base.href, at: new Date().toISOString(), ...v, pages }, null, 2));
  writeFileSync(join(out, "report.txt"), `${text}\n\nScreenshots: ${out}\n`);
  return { verdict: v, pages, out, text };
}

// ----- CLI --------------------------------------------------------------------------

const HELP = `design check — judge a running site the way the owner would.

  node design-check.mjs <url> [--important /,/pricing] [--paths /about]
                        [--src <folder>] [--no-src] [--out <folder>]
                        [--widths 390,1440] [--max-pages 6] [--json]

  --important  pages that must carry a data-standout (default: /)
  --src        folder whose source is scanned for placeholder copy and tells (default: here)
Exit 0 pass · 1 fail · 2 could not run.`;

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.url) {
    console.log(HELP);
    process.exit(o.help ? 0 : 2);
  }
  try {
    new URL(o.url);
  } catch {
    console.error(`Not a URL: ${o.url}. Give the full address, e.g. http://localhost:3000`);
    process.exit(2);
  }
  try {
    const r = await designCheck(o);
    if (o.json) console.log(JSON.stringify({ ...r.verdict, out: r.out, pages: r.pages }, null, 2));
    else console.log(`${r.text}\n\nScreenshots and report: ${r.out}`);
    process.exit(r.verdict.pass ? 0 : 1);
  } catch (e) {
    console.error(`The design check could not run: ${e?.message ?? e}`);
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
