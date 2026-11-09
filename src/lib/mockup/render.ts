// ---------------------------------------------------------------------------
// Mockups — drawing one.
//
// Out comes ONE self-contained HTML document, ready for an iframe's srcDoc.
// Self-contained matters: a srcdoc document cannot see the parent page's
// stylesheet or its next/font variables, so every token, face and rule the
// mockup needs is written into it. The faces are the hub's own woff2 files,
// loaded by absolute path, which is why the frame gets `allow-same-origin`
// (and never `allow-scripts` — there is no script in here, and there must
// never be one).
//
// There is no JavaScript and no network call beyond those fonts. A mockup is
// a drawing, so it renders instantly, costs nothing, works with no keys
// (checklist R4), and cannot break the page that frames it.
//
// Two things vary, and they vary independently — that is the whole design:
//
//   CHROME (from the skin's layout) frames the app: a console with a rail, a
//   printed sheet, an editorial measure, an agency stage, a letterboxed reel,
//   a glass lab. This is what a design skill decides, so it differs per lane.
//
//   SHAPE (from the app) fills the main surface: a board, a grid, a list, a
//   feed, a table, a canvas. This is the app's own truth, so it is the SAME in
//   every lane — otherwise the bake-off would be comparing two things at once
//   and telling the owner nothing about either.
//
// Everything interpolated from the spec goes through `esc`. The spec is the
// owner's own typing and a client's own words, and both land in markup.
// ---------------------------------------------------------------------------

import { isLight, skinFor, type FontKey, type Skin } from "@/lib/redesigner/skins";
import type { Chrome, Device, MockupDirection, MockupSpec, Shape } from "./types";

/** The hub's faces, as the mockup document can reach them. */
const FACE: Record<FontKey, { file: string; family: string; weight: string; fallback: string }> = {
  black: { file: "archivo-black-400.woff2", family: "Archivo Black", weight: "400", fallback: "system-ui, sans-serif" },
  grotesk: { file: "space-grotesk-variable.woff2", family: "Space Grotesk", weight: "300 700", fallback: "system-ui, sans-serif" },
  mono: { file: "jetbrains-mono-variable.woff2", family: "JetBrains Mono", weight: "100 800", fallback: "ui-monospace, monospace" },
  serif: { file: "instrument-serif-400.woff2", family: "Instrument Serif", weight: "400", fallback: "Georgia, serif" },
  sans: { file: "inter-variable.woff2", family: "Inter", weight: "100 900", fallback: "system-ui, sans-serif" },
  syne: { file: "syne-variable.woff2", family: "Syne", weight: "400 800", fallback: "system-ui, sans-serif" },
};

/** The width a mockup is drawn at. The parent scales it down to fit. */
export const FRAME_WIDTH: Record<Device, number> = { desktop: 1280, phone: 390 };
export const FRAME_HEIGHT: Record<Device, number> = { desktop: 820, phone: 780 };

export function esc(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function faces(skin: Skin): string {
  const keys: FontKey[] = Array.from(new Set([skin.display, skin.body, skin.mono]));
  return keys
    .map((k) => {
      const f = FACE[k];
      return `@font-face{font-family:'${f.family}';src:url('/fonts/${f.file}') format('woff2');font-weight:${f.weight};font-style:normal;font-display:swap;}`;
    })
    .join("");
}

function stack(key: FontKey): string {
  const f = FACE[key];
  return `'${f.family}', ${f.fallback}`;
}

/**
 * The token block.
 *
 * The dimming ladder is split by polarity, exactly as the redesigner's
 * `skinVars` does it and for the same reason: 42% ink on black still reads,
 * and 42% ink on newsprint is a smudge. Reusing the rule keeps a light mockup
 * from looking like a dark one with the colours flipped.
 */
function tokens(skin: Skin, device: Device): string {
  const light = isLight(skin);
  const scale = device === "phone" ? 0.86 : 1;
  return [
    `--void:${skin.void}`,
    `--ink:${skin.ink}`,
    `--sig:${skin.sig}`,
    `--a2:${light ? "88%" : "74%"}`,
    `--a3:${light ? "70%" : "56%"}`,
    `--a4:${light ? "54%" : "42%"}`,
    `--l1:${light ? "16%" : "13%"}`,
    `--l2:${light ? "32%" : "24%"}`,
    `--display:${stack(skin.display)}`,
    `--body:${stack(skin.body)}`,
    `--mono:${stack(skin.mono)}`,
    `--radius:${skin.radius}px`,
    `--radius-sm:${Math.min(skin.radius, 6)}px`,
    `--bw:${skin.border}px`,
    `--case:${skin.caps ? "uppercase" : "none"}`,
    `--track:${skin.track}em`,
    `--title-case:${skin.titleCase}`,
    `--title-track:${skin.titleTrack}em`,
    `--title-lead:${skin.titleLead}`,
    `--shadow:${skin.shadow}`,
    `--grid-op:${skin.grid}`,
    `--pad:${(skin.density * scale).toFixed(3)}`,
    `--gap:calc(14px * var(--pad))`,
    `--step:calc(20px * var(--pad))`,
    // Every card, row, tile and panel sits on THIS, never on a transparent
    // wash. The body carries a hairline grid or a field gradient, and at 3%
    // alpha those stripes ran straight through the text on top of them —
    // which is the one thing a mockup may never do (checklist U8).
    `--surface:color-mix(in srgb, var(--ink) 4%, var(--void))`,
  ].join(";");
}

/** The backdrop each skin asks for, as pure CSS — no canvas, no shader. */
function backdrop(skin: Skin): string {
  const ink = "color-mix(in srgb, var(--ink) var(--l2), transparent)";
  switch (skin.backdrop) {
    case "paper":
      return `background-image:radial-gradient(circle at 18% 8%, color-mix(in srgb, var(--sig) 10%, transparent), transparent 60%);`;
    case "dots":
      return `background-image:radial-gradient(${ink} 1px, transparent 1px);background-size:22px 22px;background-position:-1px -1px;`;
    case "bars":
      return `background-image:repeating-linear-gradient(90deg, ${ink} 0 1px, transparent 1px 64px);`;
    case "bloom":
      return `background-image:radial-gradient(60% 50% at 70% 0%, color-mix(in srgb, var(--sig) 22%, transparent), transparent 70%);`;
    case "field":
      return `background-image:radial-gradient(70% 55% at 85% -10%, color-mix(in srgb, var(--sig) 18%, transparent), transparent 65%),linear-gradient(transparent 0 1px, ${ink} 1px 2px);background-size:auto, 100% 46px;`;
    default:
      return "";
  }
}

// ----- the chrome ----------------------------------------------------------

/**
 * Layout rules per chrome. Each one is a different ARRANGEMENT of the same
 * content — a rail against a masthead against a centred stage — because that
 * is the difference the owner is being asked to judge.
 */
const CHROME_CSS: Record<Chrome, string> = {
  console: `
.shell{display:grid;grid-template-columns:216px 1fr;min-height:100%;}
.rail{border-right:var(--bw) solid var(--line);padding:var(--step);display:flex;flex-direction:column;gap:var(--step);}
.bar{display:flex;align-items:center;justify-content:space-between;gap:var(--gap);padding:var(--step);border-bottom:var(--bw) solid var(--line);}
.main{padding:var(--step);display:flex;flex-direction:column;gap:var(--step);}
.title{font-size:34px;}
`,
  workbench: `
.shell{display:grid;grid-template-columns:200px 1fr;min-height:100%;}
.rail{background:color-mix(in srgb, var(--ink) 5%, var(--void));border-right:var(--bw) solid var(--line);padding:var(--step);display:flex;flex-direction:column;gap:var(--gap);}
.bar{display:flex;align-items:center;justify-content:space-between;gap:var(--gap);padding:calc(var(--gap)) var(--step);border-bottom:var(--bw) solid var(--line);background:color-mix(in srgb, var(--ink) 3%, var(--void));}
.main{padding:var(--step);display:flex;flex-direction:column;gap:var(--gap);}
.title{font-size:26px;}
.stats{gap:1px;background:var(--line);border:var(--bw) solid var(--line);}
`,
  sheet: `
.shell{display:block;min-height:100%;}
.rail{display:none;}
.bar{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--gap);padding:var(--step);border-bottom:calc(var(--bw) * 3) solid var(--ink);}
.main{padding:var(--step);display:flex;flex-direction:column;gap:var(--step);}
.title{font-size:46px;}
.nav{display:flex;gap:var(--gap);flex-wrap:wrap;border-bottom:var(--bw) solid var(--line);padding-bottom:8px;}
.ticker{font-family:var(--mono);font-size:10px;letter-spacing:var(--track);text-transform:var(--case);border-bottom:var(--bw) solid var(--line);padding:6px var(--step);display:flex;gap:18px;color:color-mix(in srgb, var(--ink) var(--a4), transparent);}
`,
  editorial: `
.shell{display:block;min-height:100%;}
.rail{display:none;}
.bar{display:flex;align-items:baseline;justify-content:space-between;gap:var(--gap);padding:var(--step) var(--step) 0;max-width:720px;margin:0 auto;}
.main{padding:var(--step);display:flex;flex-direction:column;gap:var(--step);max-width:720px;margin:0 auto;}
.title{font-size:44px;}
.nav{display:flex;gap:16px;flex-wrap:wrap;}
`,
  atelier: `
.shell{display:block;min-height:100%;}
.rail{display:none;}
.bar{position:sticky;top:12px;margin:12px auto 0;width:calc(100% - 48px);display:flex;align-items:center;justify-content:space-between;gap:var(--gap);padding:10px 16px;border:var(--bw) solid var(--line);border-radius:999px;background:color-mix(in srgb, var(--void) 78%, transparent);backdrop-filter:blur(14px);}
.main{padding:calc(var(--step) * 1.6) var(--step);display:flex;flex-direction:column;gap:calc(var(--step) * 1.3);align-items:center;text-align:center;}
.main > *{width:100%;}
.title{font-size:48px;}
.head{text-align:center;}
/* The stage is centred; the CONTENT on it is not. Centred body text in a list
   row reads as a poster, not as something you could scan. */
.card,.row,.panel,.tr{text-align:left;}
.cell{text-align:center;}
.card,.row,.cell{box-shadow:var(--shadow);}
`,
  reel: `
.shell{display:block;min-height:100%;padding:28px 0;}
.rail{display:none;}
.bar{display:flex;align-items:center;justify-content:space-between;gap:var(--gap);padding:var(--gap) var(--step);border-top:var(--bw) solid var(--line);border-bottom:var(--bw) solid var(--line);}
.main{padding:var(--step);display:flex;flex-direction:column;gap:var(--step);}
.title{font-size:40px;}
.shell::before,.shell::after{content:"";position:fixed;left:0;right:0;height:28px;background:#000;z-index:3;}
.shell::before{top:0;}
.shell::after{bottom:0;}
`,
  lab: `
.shell{display:block;min-height:100%;}
.rail{display:none;}
.bar{display:flex;align-items:center;justify-content:space-between;gap:var(--gap);padding:var(--step);}
.main{padding:0 var(--step) var(--step);display:flex;flex-direction:column;gap:var(--step);}
.title{font-size:58px;}
.card,.cell,.panel{background:color-mix(in srgb, var(--void) 88%, transparent);backdrop-filter:blur(16px);border:var(--bw) solid var(--line);}
.surface{transform:rotate(-0.6deg);}
.stats{transform:rotate(0.5deg);}
`,
};

// ----- the parts -----------------------------------------------------------

function navBlock(spec: MockupSpec, chrome: Chrome): string {
  const items = spec.nav
    .map((n, i) => `<span class="nav-item${i === 0 ? " on" : ""}">${esc(n)}</span>`)
    .join("");
  if (chrome === "console" || chrome === "workbench") {
    return `<div class="rail">
      <div class="brand"><span class="dot"></span><span class="brand-name">${esc(spec.name)}</span></div>
      <nav class="nav">${items}</nav>
      <div class="rail-foot"><span class="who">${esc(spec.who)}</span><span class="muted">${esc(spec.audience)}</span></div>
    </div>`;
  }
  return "";
}

function barBlock(spec: MockupSpec, chrome: Chrome): string {
  const inRail = chrome === "console" || chrome === "workbench";
  const nav = inRail ? "" : `<nav class="nav">${spec.nav.map((n, i) => `<span class="nav-item${i === 0 ? " on" : ""}">${esc(n)}</span>`).join("")}</nav>`;
  const brand = inRail ? `<span class="crumb">${esc(spec.nav[0] ?? spec.entity)}</span>` : `<span class="brand-name">${esc(spec.name)}</span>`;
  const tools = spec.tools.map((t) => `<span class="tool">${esc(t)}</span>`).join("");
  return `<header class="bar">
    <div class="bar-l">${brand}${nav}</div>
    <div class="bar-r">${tools}<span class="cta">${esc(spec.action)}</span>${inRail ? "" : `<span class="who">${esc(spec.who)}</span>`}</div>
  </header>`;
}

function headBlock(spec: MockupSpec): string {
  return `<div class="head">
    <h1 class="title">${esc(spec.name)}</h1>
    <p class="lede">${esc(spec.oneLiner)}</p>
  </div>`;
}

function statsBlock(spec: MockupSpec): string {
  if (!spec.stats.length) return "";
  return `<div class="stats">${spec.stats
    .map(
      (s) => `<div class="cell">
        <span class="label">${esc(s.label)}</span>
        <span class="value">${esc(s.value)}</span>
        ${s.delta ? `<span class="delta">${esc(s.delta)}</span>` : ""}
      </div>`,
    )
    .join("")}</div>`;
}

/** The main surface. Same shape in every lane — the app's own truth. */
function surfaceBlock(spec: MockupSpec, shape: Shape): string {
  const rows = spec.rows;
  if (!rows.length) {
    return `<div class="surface empty"><p class="empty-t">No ${esc(spec.entity.toLowerCase())} yet</p><p class="muted">${esc(spec.action)} to start.</p></div>`;
  }
  switch (shape) {
    case "board": {
      const cols = spec.columns.length ? spec.columns : ["To do", "In progress", "Done"];
      return `<div class="surface board">${cols
        .map(
          (c, ci) => `<div class="col">
            <div class="col-head"><span class="label">${esc(c)}</span><span class="count">${rows.filter((_, i) => i % cols.length === ci).length}</span></div>
            ${rows
              .filter((_, i) => i % cols.length === ci)
              .map(
                (r) => `<article class="card">
                  <h2>${esc(r.title)}</h2>
                  <p class="muted">${esc(r.meta)}</p>
                  ${r.tag ? `<span class="tag">${esc(r.tag)}</span>` : ""}
                </article>`,
              )
              .join("")}
          </div>`,
        )
        .join("")}</div>`;
    }
    case "grid":
      return `<div class="surface grid">${rows
        .map(
          (r) => `<article class="card">
            <div class="thumb"${r.level ? ` style="--lv:${r.level.toFixed(2)}"` : ""}></div>
            <h2>${esc(r.title)}</h2>
            <p class="muted">${esc(r.meta)}</p>
            ${r.tag ? `<span class="tag">${esc(r.tag)}</span>` : ""}
          </article>`,
        )
        .join("")}</div>`;
    case "table":
      return `<div class="surface table">
        <div class="tr th">${(spec.columns.length ? spec.columns : ["Name", "Kind", "Impact", "State"]).map((c) => `<span class="label">${esc(c)}</span>`).join("")}</div>
        ${rows
          .map(
            (r) => `<div class="tr">
              <span class="td-main"><strong>${esc(r.title)}</strong><em class="muted">${esc(r.meta)}</em></span>
              <span>${r.tag ? `<span class="tag">${esc(r.tag)}</span>` : ""}</span>
              <span class="bar-cell"><i style="--lv:${(r.level ?? 0.5).toFixed(2)}"></i></span>
              <span class="muted">Ready</span>
            </div>`,
          )
          .join("")}
      </div>`;
    case "feed":
      return `<div class="surface feed">${rows
        .map(
          (r) => `<article class="row">
            <span class="who sm">${esc(spec.who)}</span>
            <div>
              <h2>${esc(r.title)}</h2>
              <p class="muted">${esc(r.meta)}</p>
            </div>
            ${r.tag ? `<span class="tag">${esc(r.tag)}</span>` : ""}
          </article>`,
        )
        .join("")}</div>`;
    case "canvas":
      return `<div class="surface canvas">
        <div class="stage"><span class="stage-t">${esc(spec.rows[0]?.title ?? spec.entity)}</span><span class="cta big">${esc(spec.action)}</span></div>
        <div class="strip">${rows
          .slice(1, 6)
          .map((r) => `<span class="chip">${esc(r.title)}</span>`)
          .join("")}</div>
      </div>`;
    default:
      return `<div class="surface list">${rows
        .map(
          (r) => `<article class="row">
            <div>
              <h2>${esc(r.title)}</h2>
              <p class="muted">${esc(r.meta)}</p>
            </div>
            <div class="row-r">${r.tag ? `<span class="tag">${esc(r.tag)}</span>` : ""}<i class="meter" style="--lv:${(r.level ?? 0.5).toFixed(2)}"></i></div>
          </article>`,
        )
        .join("")}</div>`;
  }
}

function panelBlock(spec: MockupSpec): string {
  if (!spec.detail.length) return "";
  return `<aside class="panel">
    <span class="label">${esc(spec.entity.replace(/s$/, ""))} detail</span>
    <dl>${spec.detail.map((d) => `<div><dt>${esc(d.label)}</dt><dd>${esc(d.value)}</dd></div>`).join("")}</dl>
  </aside>`;
}

// ----- the document --------------------------------------------------------

/**
 * Draw the app.
 *
 * The result is a whole document, so it is safe to hand straight to an
 * iframe's `srcDoc`. Nothing in it runs.
 */
export function renderMockup(
  spec: MockupSpec,
  direction: MockupDirection,
  opts: { device?: Device } = {},
): string {
  const device = opts.device ?? "desktop";
  const skin = skinFor(direction.skill);
  const chrome = direction.chrome;
  const phone = device === "phone";

  const body = `<div class="shell ${chrome} shape-${spec.shape}">
    ${navBlock(spec, chrome)}
    <div class="col-main">
      ${barBlock(spec, chrome)}
      ${chrome === "sheet" ? `<div class="ticker"><span>${esc(spec.entity)}</span><span>${esc(spec.audience)}</span><span>${esc(spec.stats[0]?.value ?? "")}</span></div>` : ""}
      <main class="main">
        ${headBlock(spec)}
        ${statsBlock(spec)}
        <div class="work">
          ${surfaceBlock(spec, spec.shape)}
          ${phone ? "" : panelBlock(spec)}
        </div>
      </main>
    </div>
  </div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${isLight(skin) ? "light" : "dark"}">
<meta name="theme-color" content="${skin.void}">
<title>${esc(spec.name)} — ${esc(direction.skill)} mockup</title>
<style>
${faces(skin)}
*,*::before,*::after{box-sizing:border-box;}
:root{color-scheme:${isLight(skin) ? "light" : "dark"};${tokens(skin, device)};--line:color-mix(in srgb, var(--ink) var(--l2), transparent);}
html,body{margin:0;height:100%;}
body{
  background:var(--void);color:var(--ink);
  font-family:var(--body);font-size:${phone ? 13 : 14}px;line-height:1.5;
  -webkit-font-smoothing:antialiased;
  ${backdrop(skin)}
}
.col-main{display:flex;flex-direction:column;min-width:0;}
.title{
  font-family:var(--display);font-weight:400;margin:0;
  text-transform:var(--title-case);letter-spacing:var(--title-track);line-height:var(--title-lead);
  text-wrap:balance;
}
.lede{margin:8px 0 0;color:color-mix(in srgb, var(--ink) var(--a3), transparent);max-width:56ch;}
.label,.tool,.tag,.crumb,.nav-item,.ticker span{
  font-family:var(--mono);font-size:10px;letter-spacing:var(--track);text-transform:var(--case);
}
.muted{color:color-mix(in srgb, var(--ink) var(--a4), transparent);margin:0;}
.brand{display:flex;align-items:center;gap:8px;}
.dot{width:10px;height:10px;border-radius:50%;background:var(--sig);flex:none;}
.brand-name{font-family:var(--display);font-size:14px;letter-spacing:var(--title-track);text-transform:var(--title-case);}
.nav{display:flex;flex-direction:column;gap:2px;}
.console .nav,.workbench .nav{flex-direction:column;}
.nav-item{padding:6px 8px;border-radius:var(--radius-sm);color:color-mix(in srgb, var(--ink) var(--a4), transparent);}
.nav-item.on{color:var(--ink);background:color-mix(in srgb, var(--ink) var(--l1), transparent);}
/* A horizontal nav needs a horizontal rhythm: the column gap of 2px left the
   items touching inside the atelier capsule ("ItemsExport a tax year"). */
.sheet .nav,.editorial .nav,.atelier .nav,.reel .nav,.lab .nav{flex-direction:row;gap:16px;flex-wrap:wrap;}
.sheet .nav-item,.editorial .nav-item,.atelier .nav-item,.reel .nav-item,.lab .nav-item{background:none;padding:0;}
.sheet .nav-item.on,.editorial .nav-item.on,.atelier .nav-item.on,.reel .nav-item.on,.lab .nav-item.on{border-bottom:calc(var(--bw) * 2) solid var(--sig);}
.rail-foot{margin-top:auto;display:flex;align-items:center;gap:8px;}
.who{
  width:26px;height:26px;border-radius:50%;flex:none;
  display:grid;place-items:center;
  background:color-mix(in srgb, var(--sig) 20%, transparent);
  border:var(--bw) solid var(--sig);
  font-family:var(--mono);font-size:10px;
}
.who.sm{width:22px;height:22px;}
.bar-l,.bar-r{display:flex;align-items:center;gap:var(--gap);min-width:0;}
.tool{color:color-mix(in srgb, var(--ink) var(--a4), transparent);}
.cta{
  font-family:var(--mono);font-size:10px;letter-spacing:var(--track);text-transform:var(--case);
  padding:8px 14px;border-radius:var(--radius-sm);
  background:var(--sig);color:${isLight(skin) ? "#fff" : skin.void};
  border:var(--bw) solid var(--sig);white-space:nowrap;
}
.cta.big{padding:12px 22px;font-size:12px;}
.head{min-width:0;}
.stats{display:grid;grid-template-columns:repeat(${phone ? 3 : 3}, minmax(0,1fr));gap:var(--gap);}
.cell{
  border:var(--bw) solid var(--line);border-radius:var(--radius);
  padding:calc(12px * var(--pad));display:flex;flex-direction:column;gap:4px;min-width:0;
  background:var(--surface);
}
.cell .label{color:color-mix(in srgb, var(--ink) var(--a4), transparent);}
.value{font-variant-numeric:tabular-nums;font-family:var(--display);font-size:${phone ? 22 : 28}px;line-height:1;letter-spacing:var(--title-track);}
.delta{font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:10px;color:var(--sig);}
.work{display:grid;grid-template-columns:${phone ? "1fr" : "1fr 240px"};gap:var(--step);align-items:start;min-width:0;}
.surface{min-width:0;}
.board{display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:var(--gap);}
.col-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:var(--bw) solid var(--line);margin-bottom:var(--gap);}
.count{font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:10px;color:color-mix(in srgb, var(--ink) var(--a4), transparent);}
.col{display:flex;flex-direction:column;gap:var(--gap);min-width:0;}
.grid{display:grid;grid-template-columns:repeat(${phone ? 2 : 3}, minmax(0,1fr));gap:var(--gap);}
.card{
  border:var(--bw) solid var(--line);border-radius:var(--radius);
  padding:calc(12px * var(--pad));display:flex;flex-direction:column;gap:6px;min-width:0;
  background:var(--surface);
}
.card h2,.row h2{font-family:var(--body);font-size:13px;font-weight:600;margin:0;}
.thumb{
  height:${phone ? 54 : 74}px;border-radius:var(--radius-sm);
  background:linear-gradient(135deg, color-mix(in srgb, var(--sig) calc(var(--lv,.5) * 55%), transparent), color-mix(in srgb, var(--ink) var(--l1), transparent));
}
.tag{
  align-self:flex-start;padding:3px 7px;border-radius:999px;
  border:var(--bw) solid var(--line);color:color-mix(in srgb, var(--ink) var(--a3), transparent);
}
.list,.feed{display:flex;flex-direction:column;gap:${skin.border >= 2 ? "0" : "var(--gap)"};}
.row{
  display:flex;align-items:${"center"};gap:var(--gap);min-width:0;
  border:var(--bw) solid var(--line);border-radius:var(--radius);
  padding:calc(11px * var(--pad)) calc(13px * var(--pad));
  background:var(--surface);
}
${skin.border >= 2 ? ".list .row,.feed .row{border-radius:0;margin-bottom:-1px;}" : ""}
.row > div{min-width:0;flex:1;}
.row-r{display:flex;align-items:center;gap:10px;flex:none;}
.meter,.bar-cell i{
  display:block;height:4px;width:54px;border-radius:999px;flex:none;
  background:linear-gradient(90deg, var(--sig) calc(var(--lv) * 100%), color-mix(in srgb, var(--ink) var(--l1), transparent) calc(var(--lv) * 100%));
}
.table{border:var(--bw) solid var(--line);border-radius:var(--radius);overflow:hidden;}
.tr{
  display:grid;grid-template-columns:${phone ? "1fr auto" : "1fr 90px 70px 60px"};
  gap:var(--gap);align-items:center;
  padding:calc(10px * var(--pad)) calc(12px * var(--pad));
  border-bottom:var(--bw) solid var(--line);
}
.tr:last-child{border-bottom:none;}
.tr.th{background:color-mix(in srgb, var(--ink) var(--l1), transparent);}
.tr.th .label{color:color-mix(in srgb, var(--ink) var(--a3), transparent);}
.td-main{display:flex;flex-direction:column;gap:2px;min-width:0;}
.td-main strong{font-weight:600;font-size:13px;}
.td-main em{font-style:normal;font-size:11px;}
${phone ? ".tr > *:nth-child(n+3){display:none;}" : ""}
.canvas{display:flex;flex-direction:column;gap:var(--gap);}
.stage{
  border:var(--bw) solid var(--line);border-radius:var(--radius);
  min-height:${phone ? 200 : 300}px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:16px;text-align:center;
  background:
    radial-gradient(60% 60% at 50% 40%, color-mix(in srgb, var(--sig) 24%, transparent), transparent 70%),
    var(--surface);
}
.stage-t{font-family:var(--display);font-size:${phone ? 24 : 34}px;letter-spacing:var(--title-track);text-transform:var(--title-case);max-width:18ch;}
.strip{display:flex;gap:8px;flex-wrap:wrap;}
.chip{
  font-family:var(--mono);font-size:10px;letter-spacing:var(--track);text-transform:var(--case);
  padding:6px 10px;border-radius:999px;border:var(--bw) solid var(--line);
}
.panel{
  border:var(--bw) solid var(--line);border-radius:var(--radius);
  padding:calc(13px * var(--pad));display:flex;flex-direction:column;gap:10px;
  background:var(--surface);
}
.panel .label{color:color-mix(in srgb, var(--ink) var(--a4), transparent);}
.panel dl{margin:0;display:flex;flex-direction:column;gap:10px;}
.panel dt{font-family:var(--mono);font-size:10px;letter-spacing:var(--track);text-transform:var(--case);color:color-mix(in srgb, var(--ink) var(--a4), transparent);}
.panel dd{margin:2px 0 0;font-size:12px;}
.empty{
  border:var(--bw) dashed var(--line);border-radius:var(--radius);
  padding:calc(28px * var(--pad));text-align:center;
}
.empty-t{font-family:var(--display);font-size:18px;margin:0 0 4px;text-transform:var(--title-case);}
${CHROME_CSS[chrome]}
${phone ? ".shell{grid-template-columns:1fr !important;}.rail{display:none !important;}.board{grid-template-columns:1fr !important;}.bar{flex-wrap:wrap;}.bar .nav{display:none;}.title{font-size:30px !important;}" : ""}
@media (prefers-reduced-motion: reduce){*{animation:none !important;transition:none !important;}}
</style></head>
<body>${body}</body></html>`;
}

/** Everything a lane needs to draw itself. */
export function mockupFor(
  spec: MockupSpec,
  direction: MockupDirection,
  device: Device = "desktop",
): { html: string; width: number; height: number } {
  return {
    html: renderMockup(spec, direction, { device }),
    width: FRAME_WIDTH[device],
    height: FRAME_HEIGHT[device],
  };
}
