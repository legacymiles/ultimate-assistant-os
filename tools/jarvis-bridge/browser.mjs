// ---------------------------------------------------------------------------
// The browser New Jarvis drives.
//
// A real Chromium with a persistent profile, not a throwaway headless one. The
// profile is the point: a headless browser that forgets every login can read
// public pages and nothing else, which rules out most of what the owner would
// actually ask for. With a profile on disk, the owner signs in ONCE, by hand,
// in a window they can see, and every later run is already signed in.
//
// It runs headed by default for the same reason: an agent clicking through a
// site the owner cannot watch is a thing that gets switched off after the first
// surprise. `JARVIS_BRIDGE_HEADLESS=1` turns that off for unattended runs.
//
// Elements are addressed by `ref`, a number stamped onto the DOM node at read
// time (`data-jb-ref`). Selectors and text matches break the moment a page
// re-renders between the model reading it and deciding to click; a ref stamped
// during THIS read either still exists or is gone, and gone is an error we can
// report rather than a wrong element we silently clicked.
// ---------------------------------------------------------------------------

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fieldIsSecret, hideCompletely, mask, redactText } from "./redact.mjs";

const HEADLESS = process.env.JARVIS_BRIDGE_HEADLESS === "1";

let chromium = null;
let context = null;
/** tabId → Playwright Page. Ids are stable for the life of the bridge. */
const tabs = new Map();
let nextTab = 1;

/** Playwright is a big optional dependency; say so plainly when it is absent. */
async function loadPlaywright() {
  if (chromium) return chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "Playwright is not installed. Run `npm install` then `npx playwright install chromium` in tools/jarvis-bridge.",
    );
  }
  return chromium;
}

export function browserRunning() {
  return context !== null;
}

async function ensureContext(profileDir) {
  if (context) return context;
  const cx = await loadPlaywright();
  mkdirSync(profileDir, { recursive: true });
  context = await cx.launchPersistentContext(profileDir, {
    headless: HEADLESS,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  // A persistent context opens holding a blank page of its own, and it does
  // not always exist by the time launch resolves. Wait briefly for it and
  // track it: discovered later, during a click, it is indistinguishable from a
  // tab the click opened, and the bridge reports a popup that never happened.
  if (context.pages().length === 0) {
    await context.waitForEvent("page", { timeout: 2_000 }).catch(() => {});
  }
  for (const p of context.pages()) track(p);
  // A window the owner closes by hand must not leave the bridge insisting the
  // browser is up; the next call then starts a fresh one instead of throwing.
  context.on("close", () => {
    context = null;
    tabs.clear();
  });
  context.on("page", (p) => track(p));
  return context;
}

function idOf(page) {
  for (const [id, p] of tabs) if (p === page) return id;
  return null;
}

function track(page) {
  const existing = idOf(page);
  if (existing) return existing;
  const id = `tab_${nextTab}`;
  nextTab += 1;
  tabs.set(id, page);
  page.on("close", () => tabs.delete(id));
  return id;
}

function pageOf(tabId) {
  const page = tabId ? tabs.get(tabId) : [...tabs.values()].at(-1);
  if (!page || page.isClosed()) throw new Error(`No open tab ${tabId ?? ""}`.trim());
  return page;
}

export async function openTab({ url, profileDir, tabId }) {
  const cx = await ensureContext(profileDir);
  const named = tabId ? tabs.get(tabId) : null;
  // Reuse the blank page the profile opened with rather than leaving it behind
  // as an empty tab the owner has to close.
  const blank = [...tabs.values()].find((p) => !p.isClosed() && p.url() === "about:blank");
  const page = named && !named.isClosed() ? named : blank ?? (await cx.newPage());
  const id = track(page);
  if (url) await page.goto(normalizeUrl(url), { waitUntil: "domcontentloaded", timeout: 45_000 });
  return { tabId: id, url: page.url(), title: await page.title() };
}

function normalizeUrl(url) {
  const u = String(url).trim();
  if (/^[a-z]+:\/\//i.test(u)) return u;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?/i.test(u)) return `http://${u}`;
  return `https://${u}`;
}

export async function listTabs() {
  const out = [];
  for (const [id, page] of tabs) {
    if (page.isClosed()) continue;
    out.push({ tabId: id, url: page.url(), title: await page.title().catch(() => "") });
  }
  return out;
}

/**
 * The page as the model reads it: its visible text, plus every control with a
 * ref stamped on it.
 *
 * The stamping happens inside the page in one pass so the refs and the text
 * describe the same instant. Anything invisible or zero-sized is skipped —
 * a menu that has not opened yet is not a thing that can be clicked, and
 * offering it as one is how an agent ends up reporting a click that did
 * nothing.
 */
export async function readTab({ tabId, maxChars = 20_000 }) {
  const page = pageOf(tabId);
  const snapshot = await page.evaluate((limit) => {
    const SELECTOR = [
      "a[href]", "button", "input", "select", "textarea",
      "[role=button]", "[role=link]", "[role=textbox]", "[role=checkbox]",
      "[role=radio]", "[role=tab]", "[role=menuitem]", "[role=combobox]",
      "[contenteditable=true]", "[onclick]",
    ].join(",");

    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
    };

    const label = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.trim();
      if (el.labels && el.labels[0]) return el.labels[0].textContent.trim();
      const ph = el.getAttribute("placeholder");
      if (ph) return ph.trim();
      const title = el.getAttribute("title");
      if (title) return title.trim();
      const text = (el.innerText || el.value || "").trim();
      if (text) return text.slice(0, 120);
      return el.getAttribute("name") || el.getAttribute("type") || "";
    };

    document.querySelectorAll("[data-jb-ref]").forEach((el) => el.removeAttribute("data-jb-ref"));

    let n = 0;
    const elements = [];
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (!visible(el)) continue;
      n += 1;
      const ref = `ref_${n}`;
      el.setAttribute("data-jb-ref", ref);
      const tag = el.tagName.toLowerCase();
      elements.push({
        ref,
        role: el.getAttribute("role") || (tag === "a" ? "link" : tag),
        name: label(el),
        value: tag === "input" || tag === "textarea" ? String(el.value ?? "").slice(0, 200) : undefined,
        type: el.getAttribute("type") || undefined,
        checked: el.type === "checkbox" || el.type === "radio" ? el.checked : undefined,
        disabled: el.disabled || undefined,
      });
      if (n >= 400) break;
    }

    const main = document.querySelector("main, article, [role=main]") || document.body;
    return { text: (main.innerText || "").slice(0, limit), elements };
  }, maxChars);

  // Scrubbed here, before it crosses out of this process. See redact.mjs for
  // why this is a filter and not a guarantee.
  const scrubbed = redactText(snapshot.text);
  const elements = snapshot.elements.map((el) => {
    if (el.value === undefined) return el;
    if (fieldIsSecret({ name: el.name, type: el.type })) {
      const hide = hideCompletely({ name: el.name, type: el.type });
      return { ...el, value: el.value ? mask(el.value, { tail: !hide }) : "", masked: true };
    }
    return { ...el, value: redactText(el.value).text };
  });

  return {
    tabId: idOf(page),
    url: page.url(),
    title: await page.title().catch(() => ""),
    text: scrubbed.text,
    // Named, not silent: a model told nothing will report the page as having
    // contained no such value, which is a different and worse untruth.
    redacted: scrubbed.redacted,
    elements,
  };
}

/**
 * The form on this page, as names and shapes — never as values.
 *
 * This is the half of capture that keeps the owner's rule intact. The VALUES
 * are returned to the page that asked (the owner's own tab, over loopback) and
 * the runner strips them before anything is sent to a model, exactly as it
 * strips a screenshot. The model is given the key, the label, whether the
 * field is filled and a masked preview — enough to decide WHICH field is worth
 * keeping, and never enough to know what it says.
 */
export async function fieldsTab({ tabId }) {
  const page = pageOf(tabId);
  const found = await page.evaluate(() => {
    const label = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.trim();
      if (el.labels && el.labels[0]) return el.labels[0].textContent.trim();
      const ph = el.getAttribute("placeholder");
      if (ph) return ph.trim();
      return el.getAttribute("name") || el.getAttribute("id") || "";
    };
    const out = [];
    let n = 0;
    for (const el of document.querySelectorAll("input, select, textarea")) {
      const type = (el.getAttribute("type") || el.tagName).toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      n += 1;
      out.push({
        key: el.getAttribute("name") || el.getAttribute("id") || `field_${n}`,
        label: label(el),
        kind: type,
        value: String(el.value ?? ""),
      });
      if (n >= 120) break;
    }
    return out;
  });

  const fields = [];
  const values = {};
  for (const f of found) {
    values[f.key] = f.value;
    fields.push({
      key: f.key,
      label: f.label,
      kind: f.kind,
      filled: f.value.length > 0,
      preview: mask(f.value, { tail: !hideCompletely({ name: f.key, type: f.kind, label: f.label }) }),
      secret: fieldIsSecret({ name: f.key, type: f.kind, label: f.label }),
    });
  }

  return { tabId: idOf(page), url: page.url(), fields, values };
}

/** Find the locator a request names, by ref first and text only as a fallback. */
function locate(page, { ref, selector, text }) {
  if (ref) return page.locator(`[data-jb-ref="${ref}"]`);
  if (selector) return page.locator(selector);
  if (text) return page.getByText(text, { exact: false }).first();
  throw new Error("Nothing to act on: pass a ref, a selector or some text.");
}

export async function clickTab({ tabId, ref, selector, text }) {
  const page = pageOf(tabId);
  const target = locate(page, { ref, selector, text });
  await target.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
  // A click that opens a new tab must hand that tab back, or the next call
  // reads the old page and reports that nothing happened.
  const before = new Set(tabs.keys());
  await target.click({ timeout: 15_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  for (const p of context?.pages() ?? []) track(p);
  // A blank page appearing during the click is Chromium's own housekeeping, not
  // a popup the click caused. Reporting it as one sends the agent off to read a
  // tab with nothing in it and conclude the click did something it did not.
  const opened = [...tabs.entries()]
    .filter(([id, p]) => !before.has(id) && !p.isClosed() && p.url() !== "about:blank")
    .map(([id]) => id);
  return { tabId: idOf(page), url: page.url(), openedTabs: opened };
}

export async function typeTab({ tabId, ref, selector, text, value, submit }) {
  const page = pageOf(tabId);
  const target = locate(page, { ref, selector, text });
  await target.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
  await target.fill(String(value ?? ""), { timeout: 15_000 });
  if (submit) {
    await target.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
  }
  return { tabId: idOf(page), url: page.url() };
}

export async function pressTab({ tabId, key }) {
  const page = pageOf(tabId);
  await page.keyboard.press(String(key));
  return { tabId: idOf(page), url: page.url() };
}

export async function scrollTab({ tabId, direction = "down", amount = 600 }) {
  const page = pageOf(tabId);
  const dy = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
  await page.mouse.wheel(0, dy);
  return { tabId: idOf(page) };
}

export async function navigateTab({ tabId, url, action }) {
  const page = pageOf(tabId);
  if (action === "back") await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
  else if (action === "forward") await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
  else if (action === "reload") await page.reload({ waitUntil: "domcontentloaded" });
  else await page.goto(normalizeUrl(url), { waitUntil: "domcontentloaded", timeout: 45_000 });
  return { tabId: idOf(page), url: page.url(), title: await page.title().catch(() => "") };
}

export async function shotTab({ tabId, fullPage = false }) {
  const page = pageOf(tabId);
  const buf = await page.screenshot({ fullPage, type: "png" });
  return { tabId: idOf(page), url: page.url(), png: buf.toString("base64") };
}

export async function closeTab({ tabId }) {
  const page = pageOf(tabId);
  const id = idOf(page);
  await page.close();
  tabs.delete(id);
  return { closed: id };
}

export async function shutdownBrowser() {
  if (!context) return { closed: false };
  await context.close().catch(() => {});
  context = null;
  tabs.clear();
  return { closed: true };
}

/** Everything the page's Browser panel needs to draw itself. */
export async function browserStatus() {
  return {
    running: browserRunning(),
    headless: HEADLESS,
    tabs: browserRunning() ? await listTabs() : [],
  };
}

export const __test = { normalizeUrl };
