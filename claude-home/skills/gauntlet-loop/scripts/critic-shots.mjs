#!/usr/bin/env node
/**
 * Gauntlet critic camera: each critic runs this ITSELF to get its own evidence.
 * Run with --help for every option. Output: <out>/*.png (+ *.webm) and <out>/report.json.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const USAGE = `critic-shots.mjs: the gauntlet critic camera

  node critic-shots.mjs --url <url> --out <dir> [options]

Journey (one page load per viewport, walked top to bottom)
  --viewports W1xH1,W2xH2   default 1920x1080,1440x900,1280x720,390x844 (width < 768 = mobile + touch)
  --steps N                 scroll positions after the top (0 = top only)            default 5
  --wait ms                 after load, before the first shot (loaders, shaders)     default 4000
  --settle ms               after each scroll / wheel step                           default 900
  --wheel px                wheel distance per step on wheel-driven (one-screen) pages  default viewport height.
                            On a 3D scene with OrbitControls the wheel ZOOMS the camera: use a
                            small --wheel (e.g. 240) or --steps 1 there (see flag wheel-detail-loss)
                            probe.wheelDriven: true = the wheel changed the frame; probe.virtualScroll
                            is true only when the journey is confirmed (DOM text changed), else
                            "unconfirmed (scroll journey or camera zoom)"
  --frames N                motion bursts: N frames idle at the hero, and N frames of every
                            scroll/wheel transition (captured from the moment input ends)  default 0
  --frame-interval ms       target spacing of burst frames                           default 150
                            Each frame records tMs = SOURCE frame time (ms after the burst began
                            when Chrome produced that screencast frame) and targetMs (requested).
  --video                   also record the whole journey per viewport as <vp>-journey.webm

Detail
  --crop x,y,w,h            extra detail crop (repeatable). EACH value on its own: <= 1 is a
                            fraction of the viewport width (x, w) or height (y, h), > 1 is CSS px,
                            so 0,0,0.5,300 = left half, 300 px tall. Clamped to the viewport; a
                            crop that ends up zero-size is skipped with a flag. Shot at the top
                            and the middle step.
  --selector css            element crop (repeatable), shot on an untouched fresh load
  --page-zoom 150,200       real browser-zoom emulation (CSS viewport / z, DPR x z) on desktop
                            viewports (skipped on mobile; noted in the probe); checks reflow
                            (horizontal overflow) at each zoom; shoots the top and mid-page

Interaction (all on a FRESH load at the top, never at the journey's end)
  --interact                desktop: hover, press-drag, release, click at centre + keyboard Tab pass
                            mobile: tap centre, swipe up, swipe left
  --hover sel|x,y           hover target (repeatable)
  --click sel|x,y           click target (repeatable; a tap on mobile). URL is recorded before and
                            after; navigation and popups are flagged
  --tabs N                  Tab presses in the keyboard pass (with --interact)       default 8

Checks / environment
  --expect-webgl            error if the page has no <canvas> at all
  --reduced-motion          emulate prefers-reduced-motion: reduce
  --headed                  show the browser
  --max-ms ms               time budget for the whole run                            default 540000
                            When reached: no new shots, report.json gets stats.partial: true, exit 3.
                            Ctrl-C / SIGTERM also write the partial report before exiting.

Time: ~15-50 s per viewport; x2-3 with a long --wait, --frames or --video. Four viewports
pass Claude Code's default 2-minute Bash timeout: call Bash with timeout 600000, or
run_in_background and wait for the completion notice. (A hard kill cannot be caught; the
report is also checkpointed after every viewport.)

Every full shot is at 2x DPR; crops are "detail crops at native 2x DPR" (not upscaled).
Errors are tagged party:first|third by comparing the source URL with the --url site.
Only first-party errors (plus third-party ones the critic confirms the build caused) block a PASS.
Flags are leads. Flags with heuristic:true (keyboard-trap, blank-canvas, wheel-detail-loss)
are suspected errors: the critic confirms them in the shots before listing an error.

report.json is ALWAYS written, even when something fails. Exit codes:
  0 ok · 1 not loaded (navigation failed on EVERY viewport, or zero shots; stats.loaded = false)
  2 bad arguments · 3 partial (stats.partial: navigation failed on SOME viewports (listed in
  stats.navigationFailures: judge the rest, rerun the missing one), --max-ms reached,
  interrupted, or the camera itself failed on a viewport; see flags "budget-reached" /
  "interrupted" / "camera-failed")`;

// ---------- args (validated, loud) ----------
const SPEC = {
  url: "str", out: "str", viewports: "str", steps: "int", wait: "int", settle: "int", wheel: "int",
  frames: "int", "frame-interval": "int", video: "bool",
  crop: "multi", selector: "multi", "page-zoom": "str",
  interact: "bool", hover: "multi", click: "multi", tabs: "int",
  "expect-webgl": "bool", "reduced-motion": "bool", headed: "bool", help: "bool", "max-ms": "int",
};
const fail = (m) => { console.error(`critic-shots: ${m}\nRun with --help for options.`); process.exit(2); };
const opt = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(`unexpected argument "${a}"`);
    const name = a.slice(2);
    const kind = SPEC[name];
    if (!kind) fail(`unknown option --${name}`);
    if (kind === "bool") { opt[name] = true; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) fail(`--${name} needs a value`);
    i++;
    if (kind === "int") {
      if (!/^\d+$/.test(v)) fail(`--${name} must be a whole number >= 0, got "${v}"`);
      opt[name] = Number(v);
    } else if (kind === "multi") (opt[name] ??= []).push(v);
    else { if (name in opt) fail(`--${name} given twice`); opt[name] = v; }
  }
}
if (opt.help) { console.log(USAGE); process.exit(0); }
if (!opt.url) fail("--url is required");
let BASE;
try { BASE = new URL(opt.url); } catch { fail(`--url is not a valid URL: "${opt.url}"`); }
const TARGET = BASE.href;
if (!opt.out) fail("--out is required (the folder for shots + report.json, e.g. <run>/r1-art-direction)");
const OUT = path.resolve(opt.out);
const MAX_MS = opt["max-ms"] ?? 540_000;
if (MAX_MS < 5000) fail("--max-ms must be >= 5000");
const VIEWPORTS = (opt.viewports ?? "1920x1080,1440x900,1280x720,390x844").split(",").map((s) => {
  const m = /^(\d+)x(\d+)$/.exec(s.trim());
  if (!m || +m[1] < 200 || +m[2] < 200) fail(`bad viewport "${s}" (want WxH, each >= 200)`);
  return [+m[1], +m[2]];
});
const STEPS = opt.steps ?? 5;
const WAIT = opt.wait ?? 4000;
const SETTLE = opt.settle ?? 900;
const FRAMES = opt.frames ?? 0;
const INTERVAL = opt["frame-interval"] ?? 150;
const TABS = opt.tabs ?? 8;
if (FRAMES > 30) fail("--frames is capped at 30");
if (INTERVAL < 16) fail("--frame-interval must be >= 16 ms");
if (opt.wheel === 0) fail("--wheel must be > 0");
const NUM = /^(\d+(\.\d*)?|\.\d+)$/;
// Each value is judged on its own: <= 1 is a fraction of the viewport dimension, > 1 is CSS px.
const USER_CROPS = (opt.crop ?? []).map((c, k) => {
  const p = c.split(",");
  if (p.length !== 4 || !p.every((x) => NUM.test(x.trim()))) fail(`bad --crop "${c}" (want x,y,w,h, each >= 0)`);
  return [`c${k + 1}`, p.map(Number), c];
});
const PAGE_ZOOMS = opt["page-zoom"] ? opt["page-zoom"].split(",").map((z) => {
  if (!/^\d+$/.test(z.trim()) || +z < 110 || +z > 500) fail(`bad --page-zoom "${z}" (want percents 110-500)`);
  return +z;
}) : [];
const XY = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/;
fs.mkdirSync(OUT, { recursive: true });

// ---------- playwright ----------
const here = path.dirname(fileURLToPath(import.meta.url));
let chromium;
for (const base of [process.cwd(), path.join(here, "..")]) {
  try { ({ chromium } = createRequire(path.join(base, "package.json"))("playwright-core")); break; } catch {}
}
// Missing playwright is reported (and report.json still written) by the run block below.
if (!chromium) console.error(`playwright-core not found. Run once:  cd "${path.join(here, "..")}" && npm i playwright-core`);
// Launched inside the run's try block (below) so a launch failure still writes report.json.
let browser;
// A private about:blank page for image math (no page CSP can block data: URLs here).
let util;

// ---------- errors: deduped, party-tagged, viewport sets ----------
// Same-site = same registrable domain. Hosting platforms and two-label country suffixes are
// public suffixes: foo.vercel.app and bar.vercel.app are DIFFERENT sites.
const MULTI_SUFFIX = new Set([
  "vercel.app", "netlify.app", "github.io", "pages.dev", "web.app", "firebaseapp.com", "herokuapp.com",
  "co.uk", "com.au", "co.jp", "co.nz", "com.br",
]);
const siteOf = (h) => {
  if (/^[\d.]+$/.test(h) || h.includes(":") || !h.includes(".")) return h; // IPs, localhost
  const p = h.split(".");
  return MULTI_SUFFIX.has(p.slice(-2).join(".")) ? p.slice(-3).join(".") : p.slice(-2).join(".");
};
function partyOf(src) {
  if (!src) return "first"; // no source URL (inline script, layout check): the page's own
  let u;
  try { u = new URL(src); } catch { return "first"; }
  if (["data:", "blob:", "about:"].includes(u.protocol) || (u.protocol === "file:" && BASE.protocol === "file:")) return "first";
  if (!/^https?:$/.test(u.protocol)) return "third"; // chrome-extension:, moz-extension:, etc.
  if (u.origin === BASE.origin || siteOf(u.hostname) === siteOf(BASE.hostname)) return "first";
  return "third";
}
const errors = [];
const flags = [];
const pushErr = (kind, detail, vp, src) => {
  const party = partyOf(src);
  detail = String(detail).slice(0, 300);
  const key = `${kind}|${party}|${detail}`;
  const hit = errors.find((e) => e.key === key);
  if (hit) { hit.count++; hit.viewports.add(vp); }
  else errors.push({ key, kind, party, detail, source: src || null, viewports: new Set([vp]), count: 1 });
};
// Flags are deduped like errors: a repeat (same kind + detail) bumps count and adds its viewport.
const flag = (kind, detail, vp, extra = {}) => {
  detail = String(detail).slice(0, 400);
  const hit = flags.find((f) => f.kind === kind && f.detail === detail);
  if (hit) { hit.count++; if (!hit.viewports.includes(vp)) hit.viewports.push(vp); return; }
  flags.push({ kind, detail, viewport: vp, viewports: [vp], count: 1, ...extra });
};

// ---------- time budget (--max-ms) ----------
// Once the budget is spent every new shot / load / burst throws Budget; phases unwind (closing
// their contexts), later viewports are skipped, and the report is written as partial.
const T0 = Date.now();
const left = () => MAX_MS - (Date.now() - T0);
class Budget extends Error {}
let budgetHit = false;
function checkBudget() {
  if (!budgetHit && left() > 0) return;
  if (!budgetHit) {
    budgetHit = true;
    flag("budget-reached", `--max-ms ${MAX_MS} reached after ${Math.round((Date.now() - T0) / 1000)} s: no new shots; the rest of the run was skipped (stats.partial)`, "all");
  }
  throw new Budget("max-ms budget reached");
}
const stackUrl = (s) => (/((?:https?|chrome-extension|moz-extension|webpack|blob):\/\/[^\s)]+)/.exec(s || "") || [])[1];

function wire(page, ctx, vp) {
  page.on("console", (m) => { if (m.type() === "error") pushErr("console", m.text(), vp, m.location()?.url); });
  page.on("pageerror", (e) => pushErr("exception", e.message, vp, stackUrl(e.stack)));
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "";
    if (!/ERR_ABORTED/.test(why)) pushErr("request-failed", `${r.url()} ${why}`, vp, r.url());
  });
  page.on("response", (r) => { if (r.status() >= 400) pushErr(`http-${r.status()}`, r.url(), vp, r.url()); });
  ctx.on("page", (p) => { if (p !== page) { flag("popup", `a new tab opened: ${p.url() || "(pending)"}`, vp); p.close().catch(() => {}); } });
}

// ---------- shots ----------
const shots = [];
const videos = [];
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const lastHash = {};
// One failed shot is flagged (kind: failKind, default "shot-failed") and returns null; the run goes on.
async function shot(page, name, meta, { failKind = "shot-failed", ...opts } = {}) {
  checkBudget();
  const file = `${name}.png`;
  let buf;
  try {
    buf = opts.locator
      ? await opts.locator.screenshot({ path: path.join(OUT, file), timeout: 5000 })
      : await page.screenshot({ path: path.join(OUT, file), ...opts });
  } catch (e) {
    flag(failKind, `${name}: ${e.message.split("\n")[0]}`, meta.viewport);
    return null;
  }
  const h = sha1(buf);
  const k = `${meta.viewport}|${meta.zoom}`;
  if (lastHash[k]?.h === h) meta.duplicateOf = lastHash[k].file;
  lastHash[k] = { h, file };
  shots.push({ file, ...meta });
  return buf;
}
// Cheap comparison frame: CSS scale jpeg, never saved.
const cmpShot = (page, clip) => page.screenshot({ type: "jpeg", quality: 70, ...(clip ? { clip } : {}) });
// Image math in the util page: luma mean/sd of one image, or mean |diff| between two (0-255).
async function imgMath(a, b) {
  return util.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("decode failed"));
      i.src = "data:image/jpeg;base64," + s;
    });
    const luma = async (s, W, H) => {
      const img = await load(s);
      W ??= 96; H ??= Math.max(1, Math.round((96 * img.height) / img.width));
      const c = new OffscreenCanvas(W, H), g = c.getContext("2d");
      g.drawImage(img, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data, L = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      return { L, W, H };
    };
    const A = await luma(a);
    if (!b) {
      let m = 0; for (const v of A.L) m += v; m /= A.L.length;
      let s = 0; for (const v of A.L) s += (v - m) ** 2;
      return { mean: +m.toFixed(1), sd: +Math.sqrt(s / A.L.length).toFixed(2) };
    }
    const B = await luma(b, A.W, A.H);
    let d = 0; for (let i = 0; i < A.L.length; i++) d += Math.abs(A.L[i] - B.L[i]);
    return { diff: +(d / A.L.length).toFixed(2) };
  }, [a.toString("base64"), b ? b.toString("base64") : null]);
}

// Motion bursts come from a CDP screencast, not screenshots: a full-DPR screenshot stalls the
// compositor for ~300 ms, which kills wheel momentum on virtual-scroll scenes mid-transition.
// The screencast only emits a frame when the picture changes, so a still page repeats a frame
// (marked sameAsPrevious) instead of faking motion.
async function burst(page) {
  checkBudget();
  const vp = page.viewportSize();
  const cdp = await page.context().newCDPSession(page);
  const got = [];
  const t0 = Date.now();
  cdp.on("Page.screencastFrame", (f) => {
    got.push({ t: Date.now() - t0, data: f.data });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: vp.width * 2, maxHeight: vp.height * 2, everyNthFrame: 1 });
  await page.waitForTimeout((FRAMES - 1) * INTERVAL + 150);
  await cdp.send("Page.stopScreencast").catch(() => {});
  await cdp.detach().catch(() => {});
  if (!got.length) return [{ t: 0, buf: await page.screenshot({ type: "jpeg", quality: 85 }), sameAsPrevious: false }];
  const out = [];
  let prev = null;
  for (let k = 0; k < FRAMES; k++) {
    const want = k * INTERVAL;
    // latest frame at or before the target time (what the screen showed then), else the first
    let pick = got[0];
    for (const g of got) if (g.t <= want + 20) pick = g;
    out.push({ t: pick.t, want, buf: Buffer.from(pick.data, "base64"), sameAsPrevious: pick === prev });
    prev = pick;
  }
  return out;
}
function keepFrames(frames, tag, meta) {
  frames.forEach(({ t, want, buf, sameAsPrevious }, k) => {
    const file = `${tag}-f${String(k + 1).padStart(2, "0")}.jpg`;
    fs.writeFileSync(path.join(OUT, file), buf);
    shots.push({ file, ...meta, zoom: "motion frame (screencast jpeg, up to 2x DPR)", frame: `${k + 1}/${frames.length}`, tMs: t, targetMs: want ?? t, ...(sameAsPrevious ? { sameAsPrevious: true } : {}) });
  });
}

const navFailures = [];
const cameraFailures = [];
async function load(page, label) {
  checkBudget();
  try { await page.goto(TARGET, { waitUntil: "load", timeout: Math.max(1000, Math.min(90_000, left())) }); }
  catch (e) {
    if (left() <= 0) checkBudget(); // the budget, not the site, cut the load short
    pushErr("navigation", e.message.split("\n")[0], label); navFailures.push(label); return false;
  }
  // The util page lives in another window; keep the page under test focused so sites that
  // gate input on focus (document.hasFocus) still respond to wheel, keys and pointer.
  await page.bringToFront();
  await page.waitForTimeout(Math.max(0, Math.min(WAIT, left())));
  checkBudget();
  return true;
}
// Real 120 px wheel ticks (what a mouse sends), in either direction.
async function wheelBy(page, px) {
  const s = Math.sign(px), n = Math.abs(px);
  for (let d = 0; d < n; d += 120) { await page.mouse.wheel(0, s * Math.min(120, n - d)); await page.waitForTimeout(40); }
}

// ---------- per-page checks ----------
const DEEP = () => {
  window.__gauntletCanvases = () => {
    const out = [];
    const walk = (root) => { root.querySelectorAll("canvas").forEach((c) => out.push(c)); root.querySelectorAll("*").forEach((e) => e.shadowRoot && walk(e.shadowRoot)); };
    walk(document);
    for (const c of window.__gauntletCtxCanvases || []) if (c.isConnected && !out.includes(c)) out.push(c);
    return out;
  };
};
async function probePage(page) {
  await page.evaluate(DEEP);
  return page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return {
      webgl: !!gl,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown",
      scrollHeight: document.documentElement.scrollHeight,
      // clientWidth excludes a vertical scrollbar, so a scrollbar is never counted as overflow
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      canvases: window.__gauntletCanvases().length,
    };
  });
}
async function checkCanvases(page, w, h, vp, where) {
  await page.evaluate(DEEP);
  const rects = await page.evaluate(() => window.__gauntletCanvases().map((c, i) => {
    const r = c.getBoundingClientRect(), cs = getComputedStyle(c);
    return { i, x: r.x, y: r.y, w: r.width, h: r.height, shown: cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05 };
  }));
  const out = [];
  for (const r of rects) {
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    const cw = Math.min(w, r.x + r.w) - x, ch = Math.min(h, r.y + r.h) - y;
    if (!r.shown || cw < 32 || ch < 32) continue;
    const st = await imgMath(await cmpShot(page, { x, y, width: cw, height: ch }));
    out.push({ canvas: r.i, size: `${Math.round(r.w)}x${Math.round(r.h)}`, where, ...st });
    if (st.sd < 3) {
      // Heuristic: a canvas can be dark or plain on purpose (a fade-in, a night scene).
      flag("blank-canvas", `canvas #${r.i} (${Math.round(r.w)}x${Math.round(r.h)}) renders a flat ${st.mean < 12 ? "black" : "single colour"} frame (luma ${st.mean} +/- ${st.sd}) ${where}`, vp,
        { heuristic: true, confirm: "check the s00 shots and later steps: is the canvas meant to be dark/plain here? If it should show 3D and does not, list it as an error" });
    }
  }
  return out;
}

// ---------- phases ----------
async function journey(browser, w, h, vp, mobile, ctxBase) {
  const ctx = await browser.newContext({
    ...ctxBase,
    ...(opt.video ? { recordVideo: { dir: path.join(OUT, ".video-tmp"), size: { width: w, height: h } } } : {}),
  });
  // Record which input listeners the page registers: a one-screen page with its own wheel
  // listener is how virtual-scroll scenes are told apart from short static pages.
  await ctx.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    window.__gauntletInput = {};
    EventTarget.prototype.addEventListener = function (t, f, o) {
      if (/^(wheel|mousewheel|DOMMouseScroll|touchmove|keydown)$/.test(t)) window.__gauntletInput[t] = (window.__gauntletInput[t] || 0) + 1;
      return add.call(this, t, f, o);
    };
    // Canvases inside closed shadow roots are invisible to querySelector; remember every canvas
    // that asks for a rendering context.
    window.__gauntletCtxCanvases = new Set();
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...a) { window.__gauntletCtxCanvases.add(this); return gc.apply(this, a); };
  });
  const page = await ctx.newPage();
  wire(page, ctx, vp);
  const done = async () => {
    const video = page.video();
    await ctx.close().catch(() => {});
    if (video) {
      try {
        const file = `${vp}-journey.webm`;
        await video.saveAs(path.join(OUT, file));
        await video.delete().catch(() => {});
        videos.push({ file, viewport: vp, phase: "journey" });
      } catch (e) { flag("video-failed", e.message.split("\n")[0], vp); }
    }
  };
  // The probe is filled as the walk goes, so a budget stop mid-journey keeps what was measured.
  const probe = {};
  let loaded = false;
  try {
    if (!(await load(page, vp))) return null;
    loaded = true;
    return await walk(page, w, h, vp, mobile, probe);
  } catch (e) {
    if (e instanceof Budget && loaded) { probe.partial = "max-ms budget reached mid-journey; later steps not shot"; return probe; }
    throw e;
  } finally { await done(); }
}

// Detail (luma sd) of the largest visible canvas, else the whole frame: a wheel step that
// zooms an OrbitControls camera into a blur or a single surface loses most of it.
async function detailSd(page, w, h) {
  const r = await page.evaluate(() => {
    let best = null;
    for (const c of window.__gauntletCanvases?.() || []) {
      const b = c.getBoundingClientRect(), a = b.width * b.height;
      if (a > (best?.a ?? 0)) best = { x: b.x, y: b.y, w: b.width, h: b.height, a };
    }
    return best;
  });
  let clip;
  if (r) {
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    const cw = Math.min(w, r.x + r.w) - x, ch = Math.min(h, r.y + r.h) - y;
    if (cw >= 64 && ch >= 64) clip = { x, y, width: cw, height: ch };
  }
  return (await imgMath(await cmpShot(page, clip))).sd;
}

async function walk(page, w, h, vp, mobile, probe) {
  Object.assign(probe, await probePage(page));
  if (!probe.webgl && (probe.canvases > 0 || opt["expect-webgl"])) pushErr("no-webgl", "WebGL unavailable in this browser; 3D was not judged", vp);
  if (opt["expect-webgl"] && probe.canvases === 0) pushErr("no-canvas", "--expect-webgl was passed but the page has 0 <canvas> elements", vp);
  if (probe.overflowX > 1) pushErr("overflow-x", `page is ${probe.overflowX}px wider than the viewport`, vp);

  const crops = [
    ["centre", [0.3, 0.25, 0.4, 0.5]],
    ["topleft", mobile ? [0, 0, 0.7, 0.3] : [0, 0, 0.4, 0.35]],
    ...USER_CROPS,
  ];
  const cropsAt = async (tag, meta) => {
    for (const [name, c, given] of crops) {
      // per value: <= 1 is a fraction of the matching viewport dimension, > 1 is CSS px
      const dim = [w, h, w, h];
      let [x, y, cw, ch] = c.map((v, k) => (v <= 1 ? v * dim[k] : v));
      x = Math.min(Math.max(0, x), w); y = Math.min(Math.max(0, y), h);
      cw = Math.floor(Math.min(cw, w - x)); ch = Math.floor(Math.min(ch, h - y));
      if (cw < 1 || ch < 1) {
        flag("crop-skipped", `crop ${name}${given ? ` "${given}"` : ""} at ${meta.position} is zero-size after clamping to ${w}x${h} (${cw}x${ch} px)`, vp);
        continue;
      }
      await shot(page, `${tag}-crop-${name}`, { ...meta, zoom: "detail crop at native 2x DPR", crop: name, cropPx: [Math.round(x), Math.round(y), cw, ch] },
        { clip: { x, y, width: cw, height: ch } });
    }
  };

  // Top of the page: full, crops, blank-canvas check, idle motion at the hero.
  const top = { viewport: vp, phase: "journey", position: "top" };
  await page.mouse.move(w / 2, h / 2);
  await shot(page, `${vp}-s00-full`, { ...top, zoom: "full frame 2x DPR" });
  await cropsAt(`${vp}-s00`, top);
  probe.canvasChecks = await checkCanvases(page, w, h, vp, "at the top after --wait");
  if (FRAMES) keepFrames(await burst(page), `${vp}-s00-idle`, { ...top, sequence: "idle at the hero, no input" });

  const maxScroll = Math.max(0, probe.scrollHeight - h);
  const mid = Math.max(1, Math.ceil(STEPS / 2));
  if (STEPS > 0 && maxScroll > 0) {
    // Document scroll: the same real 120 px wheel ticks as virtual scroll (smooth-scroll libraries
    // listen to them). Only if the wheel lands more than a few px off target is the position
    // corrected, and the drift is recorded so the label says exactly what happened.
    probe.scrollMode = "document (120 px wheel ticks; corrected only on drift > 4 px)";
    probe.virtualScroll = false;
    probe.scrollDrift = [];
    for (let i = 1; i <= STEPS; i++) {
      const y = Math.round((maxScroll * i) / STEPS);
      const cur = await page.evaluate(() => window.scrollY);
      await page.mouse.move(w / 2, h / 2);
      await wheelBy(page, y - cur);
      const frames = FRAMES ? await burst(page) : [];
      await page.waitForTimeout(SETTLE);
      const reached = await page.evaluate(() => Math.round(window.scrollY));
      const drift = y - reached;
      let position = `scrollY ${reached} of ${maxScroll} (wheel only)`;
      if (Math.abs(drift) > 4) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.waitForTimeout(250);
        const actual = await page.evaluate(() => Math.round(window.scrollY));
        position = `scrollY ${actual} of ${maxScroll} (wheel reached ${reached}, ${drift} px off target ${y}; corrected by scrollTo)`;
      }
      probe.scrollDrift.push({ step: i, target: y, wheelReached: reached, drift, corrected: Math.abs(drift) > 4 });
      const tag = `${vp}-s${String(i).padStart(2, "0")}`;
      const meta = { viewport: vp, phase: "journey", position };
      if (frames.length) keepFrames(frames, tag, { ...meta, sequence: `transition into step ${i} (from end of wheel input)` });
      await shot(page, `${tag}-full`, { ...meta, zoom: "full frame 2x DPR" });
      if (i === mid) await cropsAt(tag, meta);
    }
  } else if (STEPS > 0) {
    // One screen tall. Either a wheel-driven (virtual-scroll) scene or simply a short static page.
    // Measure idle change vs change after one wheel step; only a real response counts as virtual.
    const WHEEL = opt.wheel ?? h;
    const domPrint = () => page.evaluate(() => {
      let s = document.body ? document.body.innerText : "";
      document.querySelectorAll("*").forEach((e) => { if (e.scrollTop) s += "|" + e.scrollTop; });
      return s.length + ":" + s.slice(0, 4000);
    });
    const domBefore = await domPrint();
    const A = await cmpShot(page);
    await page.waitForTimeout(SETTLE);
    const B = await cmpShot(page);
    const idle = (await imgMath(A, B)).diff;
    await page.mouse.move(w / 2, h / 2);
    await wheelBy(page, WHEEL);
    let frames = FRAMES ? await burst(page) : [];
    await page.waitForTimeout(SETTLE);
    const C = await cmpShot(page);
    const moved = (await imgMath(B, C)).diff;
    const domChanged = (await domPrint()) !== domBefore;
    const listeners = await page.evaluate(() => window.__gauntletInput || {});
    const wheelListener = !!(listeners.wheel || listeners.mousewheel || listeners.DOMMouseScroll);
    // virtual: the wheel moved an inner scroller / changed DOM text, or the page listens to the
    //   wheel itself and the frame changed after the wheel.
    // static: no DOM change and either nothing changed at all or the page has no wheel listener
    //   (so any pixel change is its own idle animation). Stepping stops.
    // unconfirmed: pixels changed by about as much as idle motion and listener info is missing.
    const verdict = domChanged || (wheelListener && moved > 1) || moved > Math.max(2, idle * 2) ? "virtual"
      : moved <= 1 || !wheelListener ? "static" : "unconfirmed";
    // virtualScroll is true only when the journey is confirmed (DOM text / inner scroll changed);
    // a pixel-only response may be camera zoom, so it stays "unconfirmed (scroll journey or camera zoom)".
    Object.assign(probe, {
      wheelDriven: verdict === "virtual",
      virtualScroll: verdict === "static" ? false : domChanged ? true : verdict === "virtual" ? "unconfirmed (scroll journey or camera zoom)" : "unconfirmed",
      idleDiff: idle, wheelDiff: moved, domChangedOnWheel: domChanged, inputListeners: listeners });
    if (verdict === "static") {
      probe.scrollMode = `static single screen (${moved <= 1 ? "wheel changed nothing" : "no wheel listener; pixel change is idle animation"}; stepping stopped)`;
    } else {
      probe.scrollMode = verdict === "virtual" ? "wheel-driven (scroll journey or camera zoom — compare w01 vs s00)" : "unconfirmed (scene animates on its own; wheel response not separable, stepped anyway)";
      const note = verdict === "virtual" ? "wheel-driven: scroll journey or camera zoom, compare with s00" : "wheel response UNCONFIRMED: compare with s00";
      // Detail at the top (before any wheel) vs after each step: a sharp drop suggests the
      // wheel is zooming an OrbitControls camera, not driving a journey.
      const baseSd = (await imgMath(B)).sd;
      probe.wheelDetail = { s00: baseSd, steps: [] };
      const lossCheck = async (i) => {
        const sd = await detailSd(page, w, h);
        probe.wheelDetail.steps.push({ step: i, sd });
        if (baseSd > 8 && sd < baseSd * 0.5 && !probe.wheelDetailLoss) {
          probe.wheelDetailLoss = true;
          flag("wheel-detail-loss", `detail (luma sd) fell from ${baseSd} at s00 to ${sd} at w${String(i).padStart(2, "0")} after +${i * WHEEL} px of wheel: the wheel may be ZOOMING an OrbitControls camera rather than driving a scroll journey. Compare w01 vs s00; rerun with a small --wheel (e.g. 240) or --steps 1`, vp,
            { heuristic: true, confirm: "look at the wNN shots: a zoomed-in blur / single surface is camera zoom (not a site defect by itself)" });
        }
      };
      for (let i = 1; i <= STEPS; i++) {
        if (i > 1) {
          await page.mouse.move(w / 2, h / 2);
          await wheelBy(page, WHEEL);
          frames = FRAMES ? await burst(page) : [];
          await page.waitForTimeout(SETTLE);
        }
        const tag = `${vp}-w${String(i).padStart(2, "0")}`;
        const meta = { viewport: vp, phase: "journey", position: `wheel +${i * WHEEL} px total (${note})` };
        if (frames.length) keepFrames(frames, tag, { ...meta, sequence: `transition into wheel step ${i} (from end of wheel input)` });
        await shot(page, `${tag}-full`, { ...meta, zoom: "full frame 2x DPR" });
        await lossCheck(i);
        if (i === mid) await cropsAt(tag, meta);
      }
    }
  } else probe.scrollMode = "top only (--steps 0)";

  return probe;
}

async function interactions(browser, w, h, vp, mobile, ctxBase) {
  const ctx = await browser.newContext(ctxBase);
  try { await interactOn(ctx, w, h, vp, mobile); }
  finally { await ctx.close().catch(() => {}); }
}

async function interactOn(ctx, w, h, vp, mobile) {
  const page = await ctx.newPage();
  wire(page, ctx, vp);
  if (!(await load(page, vp))) return;
  const base = { viewport: vp, phase: "interact", position: "fresh load, started at the top; see 'after' for the actions before this shot" };
  let n = 0;
  const history = [];
  // A fresh reload: 'after' restarts, so every label stays true.
  const fresh = async () => {
    if (!(await load(page, vp))) return false;
    history.length = 0;
    history.push("(fresh reload)");
    return true;
  };

  // Element crops FIRST, on the untouched fresh load (no action has happened yet).
  for (const sel of opt.selector ?? []) {
    const name = `${vp}-i${String(n + 1).padStart(2, "0")}-el-${sel.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 30) || "target"}`;
    const buf = await shot(page, name, { ...base, zoom: "element crop at native 2x DPR", selector: sel, after: [] },
      { locator: page.locator(sel).first(), failKind: "selector-missing" });
    if (buf) n++;
  }
  const st = async (name, extra = {}, o = {}) => {
    const r = await shot(page, `${vp}-i${String(++n).padStart(2, "0")}-${name}`, { ...base, zoom: "full frame 2x DPR", state: name, after: [...history], ...extra }, o);
    history.push(name);
    return r;
  };
  const slug = (t) => t.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 30) || "target";
  const cx = w / 2, cy = h / 2;

  const onTarget = async (verb, t) => {
    const m = XY.exec(t);
    try {
      if (m) {
        const x = +m[1], y = +m[2];
        if (verb === "hover") await page.mouse.move(x, y, { steps: 10 });
        else if (verb === "tap") await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
      } else {
        const loc = page.locator(t).first();
        if (verb === "hover") await loc.hover({ timeout: 5000 });
        else if (verb === "tap") await loc.tap({ timeout: 5000 });
        else await loc.click({ timeout: 5000 });
      }
      return true;
    } catch (e) { flag("target-failed", `${verb} ${t}: ${e.message.split("\n")[0]}`, vp); return false; }
  };
  // Click/tap with a URL check before and after. Navigation is flagged, then the page is reloaded.
  const pressChecked = async (name, act) => {
    const before = page.url();
    if (!(await act())) return;
    await page.waitForTimeout(900);
    const after = page.url();
    const hashOnly = before.split("#")[0] === after.split("#")[0];
    await st(name, { urlBefore: before, urlAfter: after, navigated: after !== before });
    if (after !== before) {
      flag(hashOnly ? "hash-change-on-click" : "navigation-on-click", `${name}: ${before} -> ${after}`, vp);
      if (!hashOnly) await fresh();
    }
  };
  const clicks = opt.click ?? [];

  if (!mobile) {
    if (opt.interact) {
      await page.mouse.move(cx - 80, cy - 40, { steps: 12 });
      await page.mouse.move(cx + 60, cy + 20, { steps: 12 });
      await page.waitForTimeout(400);
      await st("hover-centre");
      await page.mouse.move(cx, cy); await page.mouse.down();
      await page.mouse.move(cx + 260, cy + 30, { steps: 20 });
      await page.waitForTimeout(400);
      await st("drag-held");
      await page.mouse.up(); await page.waitForTimeout(600);
      await st("drag-released");
    }
    for (const t of opt.hover ?? []) if (await onTarget("hover", t)) { await page.waitForTimeout(500); await st(`hover-${slug(t)}`, { target: t }); }
    if (opt.interact && TABS > 0) await tabPass(page, vp, st);
    // Clicks get their own fresh load, so hover/drag/Tab state never leaks into them.
    if (opt.interact || clicks.length) {
      if (await fresh()) {
        if (opt.interact) await pressChecked("click-centre", async () => { await page.mouse.click(cx, cy); return true; });
        for (const t of clicks) await pressChecked(`click-${slug(t)}`, () => onTarget("click", t));
      }
    }
  } else {
    if (opt.hover?.length) flag("hover-skipped-mobile", `--hover ${opt.hover.join(", ")} not run: a touch viewport has no hover (shoot it on a desktop viewport)`, vp);
    if (opt.interact) await mobileGestures();
    if (clicks.length && (!opt.interact || (await fresh()))) {
      for (const t of clicks) await pressChecked(`tap-${slug(t)}`, () => onTarget("tap", t));
    }
  }
  async function mobileGestures() {
    const cdp = await ctx.newCDPSession(page);
    const swipe = async (x0, y0, x1, y1) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
      for (let k = 1; k <= 12; k++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * k) / 12, y: y0 + ((y1 - y0) * k) / 12 }] });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(SETTLE);
    };
    await pressChecked("tap-centre", async () => { await page.touchscreen.tap(cx, cy); return true; });
    await swipe(cx, h * 0.75, cx, h * 0.25); await st("swipe-up");
    await swipe(w * 0.8, cy, w * 0.2, cy); await st("swipe-left");
  }
}

async function tabPass(page, vp, st) {
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  const focusables = await page.evaluate(() => [...document.querySelectorAll(
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]'
  )].filter((e) => !e.disabled && e.getClientRects().length > 0).length);
  const seq = [];
  for (let k = 1; k <= TABS; k++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(250);
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body || a === document.documentElement) return { key: "body", tag: "body" };
      window.__gtab ??= 0;
      if (!a.dataset.gauntletFocus) a.dataset.gauntletFocus = String(++window.__gtab);
      const cs = getComputedStyle(a), r = a.getBoundingClientRect();
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
      return {
        key: a.dataset.gauntletFocus, tag: a.tagName.toLowerCase(),
        label: (a.getAttribute("aria-label") || a.innerText || a.value || a.id || "").trim().slice(0, 40),
        focusRing: ring, inViewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
      };
    });
    seq.push(f);
    await st(`tab${String(k).padStart(2, "0")}`, { focus: f });
  }
  const els = seq.filter((f) => f.key !== "body");
  const distinct = new Set(els.map((f) => f.key));
  let stuck = 1, maxStuck = 1;
  for (let k = 1; k < seq.length; k++) { stuck = seq[k].key === seq[k - 1].key && seq[k].key !== "body" ? stuck + 1 : 1; maxStuck = Math.max(maxStuck, stuck); }
  // Focus revisits elements without ever returning to the page/browser, and never reaches the
  // rest of the focusable elements: a loop the user cannot Tab out of.
  const cycling = seq.length >= 4 && els.length === seq.length && seq.length > distinct.size && distinct.size < focusables;
  if ((maxStuck >= 3 && focusables > 1) || cycling) {
    // Heuristic: an open modal SHOULD keep focus inside it, as long as Escape closes it.
    flag("keyboard-trap", `Tab focus looks trapped: ${seq.map((f) => f.tag + (f.label ? `"${f.label}"` : "")).join(" -> ")} (${focusables} focusable elements on the page)`, vp,
      { heuristic: true, confirm: "check the tabNN shots: is this a modal/dialog that Escape closes (fine), or can the user never leave it (error)?" });
  }
  if (focusables === 0) flag("no-focusable-elements", "the page has no keyboard-focusable elements", vp);
  const noRing = els.filter((f) => !f.focusRing);
  if (noRing.length) flag("focus-not-visible", `no outline/box-shadow on focus: ${[...new Set(noRing.map((f) => f.tag + (f.label ? `"${f.label}"` : "")))].join(", ")} (check the tabNN shots)`, vp);
  const off = els.filter((f) => !f.inViewport);
  if (off.length) flag("focus-offscreen", `${off.length} focused element(s) were outside the viewport`, vp);
  return seq;
}

async function zoomPass(browser, w, h, vp, ctxBase) {
  const notes = [];
  for (const z of PAGE_ZOOMS) {
    const cw = Math.round((w * 100) / z), ch = Math.round((h * 100) / z);
    const label = `${vp}@${z}%`;
    const zoom = `browser zoom ${z}% (CSS viewport ${cw}x${ch}, DPR ${(2 * z) / 100})`;
    const ctx = await browser.newContext({ ...ctxBase, viewport: { width: cw, height: ch }, deviceScaleFactor: (2 * z) / 100 });
    try {
      const page = await ctx.newPage();
      wire(page, ctx, label);
      if (!(await load(page, label))) { notes.push(`${z}%: navigation failed`); continue; }
      const ox = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (ox > 1) pushErr("overflow-x", `at ${z}% browser zoom the page is ${ox}px wider than the viewport (reflow)`, label);
      await shot(page, `${vp}-zoom${z}-full`, { viewport: label, phase: "page-zoom", position: "top", zoom });
      const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      if (max > 0) {
        await page.mouse.move(cw / 2, ch / 2);
        await wheelBy(page, Math.round(max / 2));
        await page.waitForTimeout(SETTLE);
        const y = await page.evaluate(() => Math.round(scrollY));
        await shot(page, `${vp}-zoom${z}-mid-full`, { viewport: label, phase: "page-zoom", position: `mid-page: scrollY ${y} of ${max} (wheel only)`, zoom });
        notes.push(`${z}%: top + mid-page shot`);
      } else notes.push(`${z}%: top only (the page does not scroll at this zoom; no mid-page shot)`);
    } finally { await ctx.close().catch(() => {}); }
  }
  return notes;
}

// ---------- run (each viewport isolated; report.json is written no matter what) ----------
const probes = [];
// One camera failure is recorded and the run moves on to the next phase / viewport.
// A budget stop is not a camera failure: the phase just ends.
const guard = async (vp, phase, fn) => {
  try { return await fn(); }
  catch (e) {
    if (e instanceof Budget) return undefined;
    flag("camera-failed", `${phase}: ${e.message.split("\n")[0]}`, vp);
    cameraFailures.push(`${vp} ${phase}`);
    return undefined;
  }
};

let interrupted = null;
let exitCode = 0;
// Synchronous, so it is safe from a signal handler. final=false is the checkpoint after a viewport.
function writeReport(final) {
  const errs = errors.map(({ key, viewports, ...e }) => ({ ...e, viewports: [...viewports] }));
  const first = errs.filter((e) => e.party === "first");
  // loaded:false only when EVERY viewport failed navigation or there are zero shots. A nav failure
  // on some viewports is partial (exit 3): judge the rest, rerun the missing one.
  const navFailed = [...new Set(navFailures)];
  const allNavFailed = final && VIEWPORTS.every(([w, h]) => navFailed.includes(`${w}x${h}`));
  const loaded = !allNavFailed && shots.length > 0 && !cameraFailures.includes("browser");
  const partial = !final || budgetHit || !!interrupted || cameraFailures.length > 0 || navFailed.length > 0;
  exitCode = !loaded ? 1 : partial ? 3 : 0;
  const report = {
    url: TARGET,
    origin: BASE.origin,
    takenAt: new Date().toISOString(),
    options: opt,
    shots,
    videos,
    probes,
    errors: errs,
    flags,
    stats: {
      loaded, partial, ...(final ? {} : { inProgress: true }),
      ...(budgetHit ? { partialReason: `--max-ms ${MAX_MS} reached` } : interrupted ? { partialReason: `interrupted by ${interrupted}` } : navFailed.length ? { partialReason: `navigation failed on ${navFailed.join(", ")}` } : {}),
      elapsedMs: Date.now() - T0, maxMs: MAX_MS,
      shots: shots.length, videos: videos.length,
      firstPartyErrors: first.length, thirdPartyErrors: errs.length - first.length, flags: flags.length,
      heuristicFlags: flags.filter((f) => f.heuristic).length,
      navigationFailures: navFailed, cameraFailures, exitCode,
    },
    note: "loaded:false means the evidence is incomplete (navigation failed on EVERY viewport, or no shots): do not score from it. Navigation failed on some viewports = partial: judge the rest, rerun the missing one. partial:true means some viewports or phases were not shot (see probes[].skipped / partial): judge only what was shot, or rerun the missing viewports. First-party errors block a PASS. Third-party errors block only if the critic confirms the build caused them. Flags are leads; heuristic:true flags are suspected errors the critic must confirm.",
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  return { errs, first, loaded };
}
function summary({ errs, first, loaded }) {
  console.log(`${loaded ? "LOADED" : "NOT LOADED"}${exitCode === 3 ? " (PARTIAL)" : ""}: ${shots.length} shots, ${videos.length} videos, ${first.length} first-party + ${errs.length - first.length} third-party errors, ${flags.length} flags, ${Math.round((Date.now() - T0) / 1000)} s -> ${OUT}`);
  for (const p of probes) {
    if (p.skipped) { console.log(`  ${p.viewport}: SKIPPED (${p.skipped})`); continue; }
    if (!p.loaded) { console.log(`  ${p.viewport}: NOT LOADED (${p.note})`); continue; }
    console.log(`  ${p.viewport}: ${p.scrollMode ?? "(journey cut short)"}${p.wheelDiff !== undefined ? ` (idle diff ${p.idleDiff}, wheel diff ${p.wheelDiff})` : ""}, canvases ${p.canvases}, webgl ${p.webgl} (${p.renderer}), ${Math.round((p.ms ?? 0) / 1000)} s${p.partial ? ` [partial: ${p.partial}]` : ""}`);
    if (p.pageZoom) console.log(`    page zoom: ${Array.isArray(p.pageZoom) ? p.pageZoom.join("; ") : p.pageZoom}`);
  }
  for (const e of errs) console.log(`  [${e.party}] [${e.kind}] x${e.count} @${e.viewports.join(",")} ${e.detail}`);
  for (const f of flags) console.log(`  (flag${f.heuristic ? ", heuristic: confirm" : ""}) [${f.kind}]${f.count > 1 ? ` x${f.count}` : ""} @${f.viewports.join(",")} ${f.detail}`);
  if (exitCode === 1) console.error("critic-shots: NOT LOADED (navigation failed on every viewport, or zero shots); report.json written, exit 1");
  if (exitCode === 3) {
    const navFailed = [...new Set(navFailures)];
    const why = [navFailed.length && `navigation failed on ${navFailed.join(", ")} (judge the rest, rerun those)`, budgetHit && `--max-ms ${MAX_MS} reached`, interrupted && `interrupted by ${interrupted}`, cameraFailures.length && `camera failed on: ${cameraFailures.join(", ")}`].filter(Boolean).join("; ");
    console.error(`critic-shots: PARTIAL (${why}); report.json written with stats.partial: true, exit 3`);
  }
}

// Ctrl-C / kill: write what we have, then leave (playwright kills Chrome on process exit).
const onSignal = (sig) => {
  if (interrupted) return;
  interrupted = sig;
  flag("interrupted", `received ${sig} after ${Math.round((Date.now() - T0) / 1000)} s; partial report written`, "all");
  try { summary(writeReport(true)); } catch (e) { console.error(`critic-shots: could not write report on ${sig}: ${e.message}`); }
  const code = exitCode || 3;
  Promise.race([browser?.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]).finally(() => process.exit(code));
};
for (const sig of ["SIGINT", "SIGTERM", ...(process.platform === "win32" ? ["SIGBREAK"] : [])]) process.on(sig, () => onSignal(sig));
// Watchdog: if one browser call hangs past the budget, still leave a report. The 45 s grace keeps
// the default 540000 under a 600000 ms Bash timeout.
setTimeout(() => {
  if (interrupted) return;
  budgetHit = true;
  onSignal("watchdog (--max-ms + 45 s: a browser call hung)");
}, MAX_MS + 45_000).unref();

try {
  browser = await chromium.launch({
    channel: "chrome",
    headless: !opt.headed,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=default", "--enable-unsafe-swiftshader"],
  });
  util = await browser.newPage();
  for (const [w, h] of VIEWPORTS) {
    if (interrupted) break;
    const vp = `${w}x${h}`;
    if (budgetHit || left() <= 0) {
      try { checkBudget(); } catch {}
      probes.push({ viewport: vp, loaded: null, skipped: "--max-ms budget reached before this viewport; not shot" });
      continue;
    }
    const t = Date.now();
    const mobile = w < 768;
    const ctxBase = {
      viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile,
      reducedMotion: opt["reduced-motion"] ? "reduce" : "no-preference",
    };
    const probe = await guard(vp, "journey", () => journey(browser, w, h, vp, mobile, ctxBase));
    const entry = probe ? { viewport: vp, loaded: true, ...probe }
      : navFailures.includes(vp) ? { viewport: vp, loaded: false, note: "navigation failed (see errors)" }
      : budgetHit ? { viewport: vp, loaded: null, skipped: "--max-ms budget reached while loading; not shot" }
      : { viewport: vp, loaded: false, note: "journey failed (see flags camera-failed)" };
    probes.push(entry);
    if (opt.interact || opt.hover || opt.click || opt.selector) {
      if (!budgetHit) await guard(vp, "interact", () => interactions(browser, w, h, vp, mobile, ctxBase));
      else entry.interact = "skipped: --max-ms budget reached";
    }
    if (PAGE_ZOOMS.length) {
      if (mobile) entry.pageZoom = "skipped: --page-zoom runs on desktop viewports only (mobile browsers pinch-zoom instead of reflowing)";
      else if (budgetHit) entry.pageZoom = "skipped: --max-ms budget reached";
      else entry.pageZoom = (await guard(vp, "page-zoom", () => zoomPass(browser, w, h, vp, ctxBase))) ?? (budgetHit ? "cut short: --max-ms budget reached" : "failed (see flags)");
    }
    if (budgetHit && entry.loaded) entry.partial ??= "--max-ms budget reached during this viewport; later phases cut short";
    entry.ms = Date.now() - t;
    if (!interrupted) writeReport(false); // checkpoint: a hard kill still leaves the viewports done so far
  }
} catch (e) {
  if (!interrupted) {
    flag("camera-failed", `browser: ${e.message.split("\n")[0]}`, "all");
    cameraFailures.push("browser");
  }
} finally {
  if (!interrupted) {
    await browser?.close().catch(() => {});
    fs.rmSync(path.join(OUT, ".video-tmp"), { recursive: true, force: true });
    summary(writeReport(true));
  }
}
if (!interrupted) process.exit(exitCode);
