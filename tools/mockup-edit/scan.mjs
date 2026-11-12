// ---------------------------------------------------------------------------
// Read a live site the way a designer would before drawing a single mockup.
//
// Drives the PC's own headless Chrome over the DevTools protocol (no
// Puppeteer, no Playwright — Node's built-in WebSocket is enough) and, for
// each page, reads the RENDERED DOM: the colours and fonts the browser
// actually painted, the sections top to bottom, nav, forms, buttons, embeds
// and links. A screenshot can't say any of that; Flux only ever saw the
// screenshot. The pure half (turning scans into DESIGN.md / SITE.md / a page
// brief) is src/lib/mockup/site-context.ts, which has the tests.
//
// Also saves each page's rendered HTML (scripts stripped, <base> added) so a
// builder can see the real markup, not a picture of it.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
process.removeAllListeners("warning");
const sc = await import(pathToFileURL(path.join(REPO, "src", "lib", "mockup", "site-context.ts")).href);

// Same order as the drawer (tools/wangp-image/server.mjs): Edge's headless
// mode was measured exiting at once on the owner's PC, Chrome works.
const BROWSERS = [
  process.env.MOCKUP_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const VIEW = { desktop: { width: 1280, height: 820, mobile: false }, phone: { width: 390, height: 780, mobile: true } };
const PHONE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----- runs INSIDE the page ------------------------------------------------------
// Serialised with .toString(), so it must not close over anything out here.

/* eslint-disable */
function pageScan() {
  const W = window.innerWidth;
  const H = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const sy = window.scrollY;
  const clean = (t, n) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);
  const hex = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return "";
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    if (p.length > 3 && p[3] < 0.5) return "";
    return "#" + p.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
  };
  const css = (el) => getComputedStyle(el);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = css(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const bgOf = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const h = hex(css(n).backgroundColor);
      if (h) return h;
    }
    return "#ffffff";
  };
  const family = (s) => clean(String(s.fontFamily || "").split(",")[0].replace(/["']/g, ""), 40);
  const typeOf = (el) => {
    if (!el) return undefined;
    const s = css(el);
    const lh = parseFloat(s.lineHeight);
    const ls = parseFloat(s.letterSpacing);
    return { family: family(s), size: parseFloat(s.fontSize) || 0, weight: Number(s.fontWeight) || 400, lineHeight: Number.isFinite(lh) ? lh : 0, letterSpacing: Number.isFinite(ls) ? ls : 0 };
  };
  const firstVisible = (sel, test) => [...document.querySelectorAll(sel)].find((el) => visible(el) && (!test || test(el)));
  const sameOrigin = (href) => {
    try {
      const u = new URL(href, location.href);
      return u.origin === location.origin ? u : null;
    } catch {
      return null;
    }
  };

  // Colours, weighted by how much of the page they cover.
  const tally = new Map();
  const add = (h, role, w) => {
    if (!h || !(w > 0)) return;
    const k = role + h;
    const cur = tally.get(k) || { hex: h, role, weight: 0 };
    cur.weight += w;
    tally.set(k, cur);
  };
  const all = [...document.querySelectorAll("body, body *")].slice(0, 5000);
  for (const el of all) {
    if (!visible(el)) continue;
    const s = css(el);
    const r = el.getBoundingClientRect();
    const area = Math.min(r.width, W) * Math.min(r.height, H);
    add(hex(s.backgroundColor), "bg", area);
    let chars = 0;
    for (const n of el.childNodes) if (n.nodeType === 3) chars += n.textContent.trim().length;
    if (chars) add(hex(s.color), "text", chars);
  }
  const htmlBg = hex(css(document.documentElement).backgroundColor) || hex(css(document.body).backgroundColor);
  add(htmlBg || "#ffffff", "bg", W * H * 0.5);

  // Buttons: anything clickable that stands out from what is behind it.
  const clickables = [...document.querySelectorAll("a, button, [role=button], input[type=submit], input[type=button]")].filter(visible);
  const ctas = [];
  const radii = [];
  const seenCta = new Set();
  for (const el of clickables) {
    const s = css(el);
    const text = clean(el.innerText || el.value || el.getAttribute("aria-label"), 40);
    if (!text || text.length < 2) continue;
    const fill = hex(s.backgroundColor);
    const behind = el.parentElement ? bgOf(el.parentElement) : "#ffffff";
    const bordered = parseFloat(s.borderTopWidth) >= 1 && hex(s.borderTopColor);
    if (!(fill && fill !== behind) && !bordered) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 120 || r.width > W * 0.8) continue;
    const rad = parseFloat(s.borderTopLeftRadius) || 0;
    const radius = rad >= r.height / 2 - 1 ? 999 : Math.round(rad);
    radii.push(radius);
    if (fill) add(fill, "accent", r.width * r.height);
    if (seenCta.has(text.toLowerCase())) continue;
    seenCta.add(text.toLowerCase());
    const u = el.href ? sameOrigin(el.href) : null;
    ctas.push({ text, href: el.href ? (u ? u.pathname : el.href) : undefined, bg: fill || undefined, color: hex(s.color) || undefined, radius, top: r.top + sy });
  }
  ctas.sort((a, b) => a.top - b.top);
  for (const card of [...document.querySelectorAll("article, [class*=card], [class*=Card], li")].slice(0, 200)) {
    if (!visible(card)) continue;
    const s = css(card);
    const rad = parseFloat(s.borderTopLeftRadius);
    if (rad > 0 && (hex(s.backgroundColor) || parseFloat(s.borderTopWidth) >= 1)) radii.push(Math.round(rad));
  }
  const radCount = new Map();
  for (const r of radii) radCount.set(r, (radCount.get(r) || 0) + 1);

  // Nav: the site's own idea of what matters.
  const navEls = [...document.querySelectorAll("nav a, header a, [role=navigation] a")].filter(visible);
  const nav = [];
  const navHrefs = [];
  for (const a of navEls) {
    const t = clean(a.innerText || a.getAttribute("aria-label"), 30);
    if (t && !nav.includes(t) && nav.length < 14) nav.push(t);
    const u = sameOrigin(a.href);
    if (u && !navHrefs.includes(u.pathname)) navHrefs.push(u.pathname);
  }
  const links = [...navHrefs];
  for (const a of document.querySelectorAll("a[href]")) {
    const u = sameOrigin(a.href);
    if (u && !links.includes(u.pathname) && links.length < 120) links.push(u.pathname);
  }

  // Forms, and the field names a person would read.
  const fieldName = (f) => {
    const id = f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`);
    return clean((id && id.innerText) || f.getAttribute("aria-label") || f.placeholder || f.name || f.type, 30);
  };
  const forms = [];
  for (const form of [...document.querySelectorAll("form")].filter(visible).slice(0, 6)) {
    const fields = [...form.querySelectorAll("input, select, textarea")]
      .filter((f) => !["hidden", "submit", "button"].includes(f.type) && visible(f))
      .map(fieldName)
      .filter(Boolean);
    const btn = form.querySelector("button, input[type=submit]");
    const submit = clean(btn ? btn.innerText || btn.value : "", 30);
    let heading = form.getAttribute("aria-label") || "";
    if (!heading) {
      const sec = form.closest("section, article, div");
      const h = sec && sec.querySelector("h1, h2, h3, h4");
      heading = h ? h.innerText : "";
    }
    const u = form.action ? sameOrigin(form.action) : null;
    forms.push({ name: clean(heading || submit || "form", 50), fields, submit, action: form.action ? (u ? u.pathname : form.action) : undefined });
  }

  // Things that would silently break if a redesign dropped them.
  const embeds = new Set();
  for (const f of document.querySelectorAll("iframe")) {
    const src = f.src || "";
    if (/youtube|youtu\.be/.test(src)) embeds.add("embedded YouTube video");
    else if (/vimeo/.test(src)) embeds.add("embedded Vimeo video");
    else if (/google\.[a-z.]+\/maps|maps\.google/.test(src)) embeds.add("Google map");
    else if (/calendly|cal\.com|acuity|squareup|booksy|fresha/.test(src)) embeds.add("booking widget");
    else if (/stripe|paypal/.test(src)) embeds.add("payment widget");
    else if (src) embeds.add("embedded " + (new URL(src, location.href).hostname || "frame"));
  }
  if (document.querySelector("video")) embeds.add("video on the page");
  if (document.querySelector("canvas")) embeds.add("canvas / WebGL animation");
  if (document.querySelector("input[type=search], [role=search]")) embeds.add("search box");
  const hrefs = [...document.querySelectorAll("a[href]")].map((a) => a.href.toLowerCase());
  if (hrefs.some((h) => /\/(cart|checkout|basket)/.test(h))) embeds.add("cart / checkout links");
  if (hrefs.some((h) => /(login|signin|sign-in|account)/.test(h))) embeds.add("login / account link");
  if (hrefs.some((h) => h.startsWith("tel:"))) embeds.add("tap-to-call phone link");
  if (hrefs.some((h) => h.startsWith("mailto:"))) embeds.add("email link");

  // Sections, top to bottom: walk down wrapper chains, then take the big children.
  const big = (el) => {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.height >= 40 && r.width >= W * 0.6;
  };
  let node = document.body;
  for (let i = 0; i < 14; i++) {
    const kids = [...node.children].filter(big);
    const nh = node.getBoundingClientRect().height || 1;
    if (kids.length === 1 && !/^(HEADER|FOOTER|NAV)$/.test(kids[0].tagName) && kids[0].getBoundingClientRect().height >= nh * 0.6) node = kids[0];
    else break;
  }
  // A tall block made of several big blocks is a container, not a section:
  // open it up (measured on linear.app, where one wrapper held the whole page).
  // `display: contents` wrappers have no box of their own; look through them.
  const kidsOf = (el) => [...el.children].flatMap((k) => (css(k).display === "contents" ? kidsOf(k) : [k])).filter(big);
  const expand = (els, depth) =>
    els.flatMap((el) => {
      if (depth >= 8 || /^(HEADER|FOOTER|NAV|FORM)$/.test(el.tagName)) return [el];
      const kids = kidsOf(el);
      const tall = el.getBoundingClientRect().height > Math.max(H * 0.3, window.innerHeight * 1.4);
      const isMain = el.tagName === "MAIN" || el.getAttribute("role") === "main";
      if (!(isMain || tall)) return [el];
      // A tall wrapper around one block: step inside it.
      if (kids.length === 1) return expand(kids, depth + 1);
      return kids.length >= 2 ? expand(kids, depth + 1) : [el];
    });
  const list = expand([...node.children].filter(big), 0);
  // A page too narrow for any block to count (a centred sign-up card) is one section.
  if (!list.length && document.body) list.push(document.querySelector("main") || document.body);
  const sections = list.slice(0, 24).map((el, i) => {
    const r = el.getBoundingClientRect();
    const h = el.querySelector("h1, h2, h3, h4");
    const lead = h ? h.innerText : el.querySelector("p, strong, a, span") ? el.querySelector("p, strong, a, span").innerText : el.getAttribute("aria-label") || "";
    const imgs = [...el.querySelectorAll("img, svg image, picture")].filter(visible);
    const small = imgs.filter((im) => im.getBoundingClientRect().height < 90);
    const holds = [];
    const grid = [...el.querySelectorAll("ul, ol, div")].find((g) => {
      const k = [...g.children].filter(visible);
      if (k.length < 3 || k.length > 12) return false;
      const w = k.map((c) => Math.round(c.getBoundingClientRect().width / 10));
      return w.every((x) => x === w[0]) && w[0] * 10 < W * 0.5;
    });
    if (grid) holds.push(`${[...grid.children].filter(visible).length} cards`);
    if (small.length >= 5) holds.push("logo strip");
    else if (imgs.length) holds.push(imgs.length === 1 ? "image" : `${imgs.length} images`);
    if (el.querySelector("video")) holds.push("video");
    if (el.querySelector("form")) holds.push("form");
    if (el.querySelector("canvas")) holds.push("canvas");
    const btns = ctas.filter((c) => c.top >= r.top + sy && c.top <= r.bottom + sy).length;
    if (btns) holds.push(btns === 1 ? "1 button" : `${btns} buttons`);
    const tag = el.tagName;
    const linksIn = el.querySelectorAll("a").length;
    let kind = "content";
    if (tag === "HEADER" || el.getAttribute("role") === "banner" || (i === 0 && el.querySelector("nav") && r.height < 200)) kind = "header";
    else if (tag === "FOOTER" || el.getAttribute("role") === "contentinfo" || (i === list.length - 1 && linksIn >= 8)) kind = "footer";
    else if (el.querySelector("h1") && r.top + sy < 1400) kind = "hero";
    else if (el.querySelector("form")) kind = "form";
    return { kind, heading: clean(lead, 80), top: Math.round(r.top + sy), height: Math.round(r.height), bg: bgOf(el), holds };
  });

  const text = [...document.querySelectorAll("h1, h2, h3, p")]
    .filter(visible)
    .slice(0, 80)
    .map((el) => (/^H/.test(el.tagName) ? `${el.tagName}: ` : "") + clean(el.innerText, 200))
    .filter((t) => t.length > 3)
    .join("\n")
    .slice(0, 4000);

  const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
  return {
    url: location.href,
    path: location.pathname,
    title: document.title,
    description: meta ? meta.content : "",
    height: H,
    width: W,
    colors: [...tally.values()].sort((a, b) => b.weight - a.weight).slice(0, 40),
    type: {
      h1: typeOf(firstVisible("h1")),
      h2: typeOf(firstVisible("h2")),
      body: typeOf(firstVisible("p", (p) => p.innerText.trim().length > 40) || document.body),
      button: typeOf(firstVisible("a, button", (b) => ctas.some((c) => c.text === clean(b.innerText, 40)))),
    },
    radii: [...radCount.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r).slice(0, 6),
    sections,
    nav,
    ctas: ctas.slice(0, 10).map(({ top, ...c }) => c),
    forms,
    embeds: [...embeds],
    links: links.filter((l) => l !== location.pathname),
    text,
  };
}

/** Scroll the page once, so lazy images and on-scroll sections render, then back to the top. */
async function warmUp() {
  const H = document.documentElement.scrollHeight;
  for (let y = 0; y < Math.min(H, 20000); y += Math.max(400, Math.round(H / 10))) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 140));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 400));
  return H;
}

/** The rendered DOM as a file a builder can open: no scripts, assets resolve against the live site. */
function domSnapshot() {
  const doc = document.documentElement.cloneNode(true);
  for (const s of doc.querySelectorAll("script, noscript")) s.remove();
  const head = doc.querySelector("head");
  if (head && !head.querySelector("base")) {
    const b = document.createElement("base");
    b.href = location.href;
    head.prepend(b);
  }
  return "<!doctype html>\n" + doc.outerHTML;
}
/* eslint-enable */

// ----- a minimal DevTools client ---------------------------------------------------

async function launch(device) {
  const exe = BROWSERS.find((b) => existsSync(b));
  if (!exe) throw new Error("No Chrome or Edge on this PC to read the site with.");
  const profile = await mkdtemp(path.join(tmpdir(), "mockup-scan-"));
  const v = VIEW[device];
  const proc = spawn(
    exe,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--mute-audio",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      `--window-size=${v.width},${v.height}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  let port = 0;
  for (let i = 0; i < 60 && !port; i += 1) {
    await sleep(250);
    try {
      port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]);
    } catch {
      /* not yet */
    }
  }
  if (!port) {
    proc.kill();
    throw new Error("Chrome didn't open its DevTools port.");
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("Chrome opened without a page.");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("Couldn't talk to Chrome.")), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
    } else if (msg.method) {
      for (const w of [...waiters]) if (w.method === msg.method) w.res(msg.params);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      id += 1;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const once = (method, ms) =>
    new Promise((res) => {
      const w = { method, res: (p) => (clearTimeout(t), waiters.splice(waiters.indexOf(w), 1), res(p)) };
      const t = setTimeout(() => (waiters.splice(waiters.indexOf(w), 1), res(null)), ms);
      waiters.push(w);
    });
  const evaluate = async (fn) => {
    const out = await send("Runtime.evaluate", { expression: `(${fn.toString()})()`, awaitPromise: true, returnByValue: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
    return out.result.value;
  };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: 1, mobile: v.mobile });
  if (v.mobile) await send("Emulation.setUserAgentOverride", { userAgent: PHONE_UA });
  const close = async () => {
    try {
      ws.close();
    } catch {}
    try {
      proc.kill();
    } catch {}
    await sleep(400);
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  };
  return { send, once, evaluate, close };
}

async function readPage(b, url) {
  const loaded = b.once("Page.loadEventFired", 25_000);
  const nav = await b.send("Page.navigate", { url });
  if (nav.errorText) throw new Error(`${url} didn't load (${nav.errorText}).`);
  await loaded;
  await sleep(1200);
  await b.evaluate(warmUp);
  const raw = await b.evaluate(pageScan);
  const html = await b.evaluate(domSnapshot).catch(() => "");
  return { raw, html };
}

/**
 * Read up to `maxPages` pages of a site, starting at `url`, and return a
 * SiteContext (see site-context.ts). `say` gets one progress line per page.
 */
export async function scanSite(url, { maxPages = 6, device = "desktop", name = "", saveDir = "", say = () => {} } = {}) {
  const b = await launch(device === "phone" ? "phone" : "desktop");
  const pages = [];
  try {
    say(`reading ${url}…`);
    const first = await readPage(b, url);
    const start = sc.coerceScan(first.raw);
    if (!start) throw new Error("The page loaded but nothing could be read from it.");
    pages.push({ scan: start, html: first.html });
    const origin = new URL(start.url).origin;
    for (const p of sc.crawlOrder(start, Math.max(0, maxPages - 1))) {
      say(`reading ${p}…`);
      try {
        const got = await readPage(b, origin + p);
        const scan = sc.coerceScan(got.raw);
        // A redirect off-site (login wall, external shop) is not this site's page.
        // Two addresses for one page (/ and /homepage) are read once.
        const same = (x) => x.scan.path === scan.path || (x.scan.title === scan.title && x.scan.sections[0]?.heading === scan.sections[0]?.heading);
        if (scan && new URL(scan.url).origin === origin && !pages.some(same)) pages.push({ scan, html: got.html });
      } catch (e) {
        say(`skipped ${p}: ${e.message}`);
      }
    }
    const ctx = {
      name: name || sc.siteSlug(origin),
      origin,
      scannedAt: new Date().toISOString(),
      device: device === "phone" ? "phone" : "desktop",
      pages: pages.map((p) => p.scan),
    };
    if (saveDir) {
      await mkdir(path.join(saveDir, "pages"), { recursive: true });
      for (const p of pages) if (p.html) await writeFile(path.join(saveDir, "pages", `${sc.pageSlug(p.scan.path)}.html`), p.html, "utf8");
    }
    return ctx;
  } finally {
    await b.close();
  }
}

/** Write context.json (the truth) and the two documents rendered from it. */
export async function writeContext(dir, ctx) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "context.json"), JSON.stringify(ctx, null, 2), "utf8");
  await writeFile(path.join(dir, "DESIGN.md"), sc.designMd(ctx), "utf8");
  await writeFile(path.join(dir, "SITE.md"), sc.siteMd(ctx), "utf8");
  return { dir, context: path.join(dir, "context.json"), design: path.join(dir, "DESIGN.md"), site: path.join(dir, "SITE.md") };
}

export async function readContext(dir) {
  try {
    return JSON.parse(await readFile(path.join(dir, "context.json"), "utf8"));
  } catch {
    return null;
  }
}
