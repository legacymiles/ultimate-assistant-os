// ---------------------------------------------------------------------------
// The shot-plan sheet as ONE image.
//
// OpenArt attaches the whole blueprint sheet to the video generation as its
// reference, and the user can download it. This composes the same thing on a
// canvas: a paper-white production sheet with the shared-choices strip,
// Section 1 (character / product reference), Section 2 (set plates + floor
// plan), Section 3 (the storyboard with captions) and Section 4 (lighting,
// mood, style). Client-only; drawn from object URLs of the stored panels.
// ---------------------------------------------------------------------------

"use client";

import type { Panel, PanelKind, Plan } from "./types";

export interface SheetSources {
  plan: Plan;
  panels: Panel[];
  /** media id → object URL or data URL. */
  urls: Record<string, string>;
}

const W = 2200;
const PAD = 36;
const GAP = 18;
const INK = "#1b1b1b";
const INK2 = "#4a4a48";
const LINE = "#cfcdc4";
const PAPER = "#f7f6f2";
const MONO = "600 15px ui-monospace, Menlo, Consolas, monospace";
const MONO_SM = "500 13px ui-monospace, Menlo, Consolas, monospace";
const SANS = "400 15px Inter, system-ui, sans-serif";
const SANS_SM = "400 13px Inter, system-ui, sans-serif";
const TITLE = "700 44px Impact, 'Arial Narrow', sans-serif";

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const probe = line ? `${line} ${word}` : word;
      if (ctx.measureText(probe).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else line = probe;
    }
    out.push(line);
  }
  return out;
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxWidth: number, font: string, color: string, lineHeight: number, maxLines = 99): number {
  ctx.font = font;
  ctx.fillStyle = color;
  const lines = wrap(ctx, s, maxWidth).slice(0, maxLines);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return lines.length * lineHeight;
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#ecebe5";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (!img) return;
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function swatches(ctx: CanvasRenderingContext2D, colors: string[], x: number, y: number, w: number, h = 16) {
  const each = w / Math.max(1, colors.length);
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + i * each, y, each - 3, h);
  });
}

function heading(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, w: number): number {
  ctx.font = MONO;
  ctx.fillStyle = INK;
  ctx.fillText(s, x, y + 14);
  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(x, y + 26);
  ctx.lineTo(x + w, y + 26);
  ctx.stroke();
  return 40;
}

/**
 * Draw the sheet. Returns a JPEG data URL (JPEG so it stays a few hundred KB
 * as a reference image) and the same as a Blob for storage.
 */
export async function renderSheet(src: SheetSources): Promise<{ dataUrl: string; blob: Blob }> {
  const { plan, panels, urls } = src;
  const urlFor = (kind: PanelKind, id: string) => {
    const p = panels.find((x) => x.kind === kind && x.targetId === id);
    return p?.mediaId ? urls[p.mediaId] : undefined;
  };
  const images = new Map<string, HTMLImageElement | null>();
  const need = async (kind: PanelKind, id: string) => {
    const u = urlFor(kind, id);
    const key = `${kind}:${id}`;
    if (!images.has(key)) images.set(key, u ? await loadImage(u) : null);
    return images.get(key) ?? null;
  };
  await Promise.all([
    ...plan.characters.map((c) => need("character", c.id)),
    ...plan.products.map((p) => need("product", p.id)),
    ...plan.environments.map((e) => need("environment", e.id)),
    need("floorplan", "floorplan"),
    need("elevation", "elevation"),
    ...plan.cuts.map((c) => need("cut", c.id)),
    ...plan.lighting.map((l) => need("lighting", l.id)),
  ]);
  const img = (kind: PanelKind, id: string) => images.get(`${kind}:${id}`) ?? null;

  // Lay out with a generous height, then crop to what was used.
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 4200;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "alphabetic";

  const inner = W - PAD * 2;
  let y = PAD;

  // ----- title + shared choices strip -----
  ctx.font = TITLE;
  ctx.fillStyle = INK;
  ctx.fillText(plan.title.toUpperCase(), PAD, y + 40);
  y += 62;
  ctx.fillStyle = "#111";
  ctx.fillRect(PAD, y, inner, 34);
  ctx.font = MONO_SM;
  ctx.fillStyle = "#f2f0ea";
  const strip = [
    `CUT COUNT: ${plan.cuts.length}`,
    `LIGHTING: ${plan.lightingNote}`,
    `LENS: ${plan.lensNote}`,
    `PALETTE: ${plan.paletteNote.toUpperCase().slice(0, 70)}`,
  ].join("     ·     ");
  ctx.fillText(strip, PAD + 14, y + 22);
  y += 34;
  swatches(ctx, plan.palette, PAD, y + 6, 360, 14);
  ctx.font = SANS_SM;
  ctx.fillStyle = INK2;
  ctx.fillText(plan.environmentFingerprint.slice(0, 220), PAD + 380, y + 17);
  y += 34;

  // ----- section 1 + 2 side by side -----
  const colW = (inner - GAP) / 2;
  const leftX = PAD;
  const rightX = PAD + colW + GAP;
  let ly = y;
  let ry = y;

  const subjects = [
    ...plan.characters.map((c) => ({ kind: "character" as const, id: c.id, name: c.name, body: `${c.look}${c.wardrobe ? `\nWardrobe: ${c.wardrobe}` : ""}`, palette: c.palette, square: true })),
    ...plan.products.map((p) => ({ kind: "product" as const, id: p.id, name: p.name, body: `${p.description}${p.notes.length ? "\n" + p.notes.map((n) => `${n.label}: ${n.text}`).join("\n") : ""}`, palette: p.palette, square: false })),
  ];
  ly += heading(ctx, plan.products.length && !plan.characters.length ? "SECTION 1: PRODUCT / HERO OBJECT REFERENCE" : plan.products.length ? "SECTION 1: CHARACTER + PRODUCT REFERENCE" : "SECTION 1: CHARACTER REFERENCE", leftX, ly, colW);
  const perRow = Math.min(2, Math.max(1, subjects.length));
  const subW = (colW - GAP * (perRow - 1)) / perRow;
  let rowTop = ly;
  let rowBottom = ly;
  subjects.forEach((s, i) => {
    const col = i % perRow;
    if (col === 0 && i > 0) {
      rowTop = rowBottom + GAP;
    }
    const x = leftX + col * (subW + GAP);
    let yy = rowTop;
    ctx.font = MONO;
    ctx.fillStyle = INK;
    ctx.fillText(s.name, x, yy + 14);
    yy += 24;
    const h = s.square ? subW : subW * 0.62;
    cover(ctx, img(s.kind, s.id), x, yy, subW, h);
    yy += h + 8;
    swatches(ctx, s.palette, x, yy, subW, 12);
    yy += 20;
    yy += text(ctx, s.body, x, yy + 12, subW, SANS_SM, INK2, 17, 8);
    rowBottom = Math.max(rowBottom, yy);
  });
  ly = rowBottom + GAP;

  ry += heading(ctx, "SECTION 2: ENVIRONMENT / SET DESIGN", rightX, ry, colW);
  const envs = plan.environments.slice(0, 2);
  const envW = (colW - GAP * (envs.length - 1)) / Math.max(1, envs.length);
  let envBottom = ry;
  envs.forEach((e, i) => {
    const x = rightX + i * (envW + GAP);
    let yy = ry;
    ctx.font = MONO;
    ctx.fillStyle = INK;
    ctx.fillText(e.name.slice(0, 44), x, yy + 14);
    yy += 24;
    cover(ctx, img("environment", e.id), x, yy, envW, envW * 0.56);
    yy += envW * 0.56 + 8;
    yy += text(ctx, e.description, x, yy + 12, envW, SANS_SM, INK2, 17, 5);
    envBottom = Math.max(envBottom, yy);
  });
  ry = envBottom + GAP;
  const planW = colW * 0.72 - GAP / 2;
  const elevW = colW - planW - GAP;
  ctx.font = MONO;
  ctx.fillStyle = INK;
  ctx.fillText("TOP-DOWN FLOOR PLAN", rightX, ry + 14);
  ctx.fillText(`${plan.cuts[plan.cuts.length - 1]?.title.toUpperCase() ?? "FINAL"} — SIDE ELEVATION`, rightX + planW + GAP, ry + 14);
  ry += 24;
  cover(ctx, img("floorplan", "floorplan"), rightX, ry, planW, planW * 0.56);
  cover(ctx, img("elevation", "elevation"), rightX + planW + GAP, ry, elevW, planW * 0.56);
  ry += planW * 0.56 + 10;
  ctx.font = SANS_SM;
  ctx.fillStyle = INK2;
  ctx.fillText(plan.cuts.map((c, i) => `${i + 1} ${c.title}: ${c.move.toUpperCase()}`).join("   "), rightX, ry + 12);
  ry += 26;
  if (plan.setNotes) ry += text(ctx, `SET NOTES: ${plan.setNotes}`, rightX, ry + 12, colW, SANS_SM, INK2, 17, 4);
  if (plan.props) ry += text(ctx, `PROPS: ${plan.props}`, rightX, ry + 12, colW, SANS_SM, INK2, 17, 3);
  ry += GAP;

  y = Math.max(ly, ry);

  // ----- section 3: storyboard -----
  y += heading(ctx, "SECTION 3: STORYBOARD", PAD, y, inner);
  const n = plan.cuts.length;
  const perRowCuts = n <= 4 ? n : Math.ceil(n / 2);
  const cutW = (inner - GAP * (perRowCuts - 1)) / perRowCuts;
  let cutRowTop = y;
  let cutRowBottom = y;
  plan.cuts.forEach((c, i) => {
    const col = i % perRowCuts;
    if (col === 0 && i > 0) cutRowTop = cutRowBottom + GAP;
    const x = PAD + col * (cutW + GAP);
    let yy = cutRowTop;
    ctx.fillStyle = INK;
    ctx.fillRect(x, yy, 70, 22);
    ctx.font = MONO_SM;
    ctx.fillStyle = "#fff";
    ctx.fillText(c.title, x + 8, yy + 16);
    yy += 30;
    cover(ctx, img("cut", c.id), x, yy, cutW, cutW * 0.5625);
    yy += cutW * 0.5625 + 8;
    ctx.font = MONO_SM;
    ctx.fillStyle = INK;
    ctx.fillText(`${c.lensMm}mm anamorphic | ${c.aperture} | ${c.durationSec}s | ${c.move.toUpperCase()} | ${c.framing.toUpperCase()}`, x, yy + 12);
    yy += 22;
    yy += text(ctx, c.description, x, yy + 12, cutW, SANS_SM, INK2, 17, 5);
    cutRowBottom = Math.max(cutRowBottom, yy);
  });
  y = cutRowBottom + GAP;

  // ----- section 4: lighting / mood / style -----
  y += heading(ctx, "SECTION 4: LIGHTING / MOOD / STYLE NOTES", PAD, y, inner);
  const lightW = (inner * 0.5 - GAP * 3) / 4;
  let bottom = y;
  plan.lighting.forEach((l, i) => {
    const x = PAD + i * (lightW + GAP);
    cover(ctx, img("lighting", l.id), x, y, lightW, lightW * 0.75);
    const h = text(ctx, l.caption, x, y + lightW * 0.75 + 20, lightW, SANS_SM, INK2, 16, 3);
    bottom = Math.max(bottom, y + lightW * 0.75 + 20 + h);
  });
  const moodX = PAD + inner * 0.5 + GAP;
  const moodW = inner * 0.22;
  ctx.font = MONO;
  ctx.fillStyle = INK;
  ctx.fillText("MOOD KEYWORDS", moodX, y + 14);
  let my = y + 40;
  my += text(ctx, plan.moods.join("   "), moodX, my, moodW, "italic 400 20px Georgia, serif", INK, 30, 4);
  if (plan.styleEssence) {
    ctx.font = MONO;
    ctx.fillStyle = INK;
    ctx.fillText("STYLE ESSENCE", moodX, my + 20);
    my += text(ctx, plan.styleEssence, moodX, my + 46, moodW, SANS, INK2, 19, 4) + 40;
  }
  const cineX = moodX + moodW + GAP;
  const cineW = W - PAD - cineX;
  ctx.font = MONO;
  ctx.fillStyle = INK;
  ctx.fillText("CINEMATOGRAPHY / STYLE NOTES", cineX, y + 14);
  const cine = plan.cinematography
    .split(/\n/)
    .map((l) => l.replace(/^\s*[•\-*]\s*/, ""))
    .filter(Boolean)
    .map((l) => `• ${l}`)
    .join("\n");
  let cy = y + 40;
  cy += text(ctx, cine, cineX, cy, cineW, SANS, INK2, 19, 8);
  if (plan.soundscape) cy += text(ctx, `SOUND: ${plan.soundscape}`, cineX, cy + 10, cineW, SANS_SM, INK2, 17, 3) + 10;
  if (plan.music) cy += text(ctx, `MUSIC: ${plan.music}`, cineX, cy + 4, cineW, SANS_SM, INK2, 17, 2);
  y = Math.max(bottom, my, cy) + PAD;

  // Crop.
  const out = document.createElement("canvas");
  out.width = W;
  out.height = Math.min(canvas.height, Math.ceil(y));
  const octx = out.getContext("2d")!;
  octx.drawImage(canvas, 0, 0);
  const dataUrl = out.toDataURL("image/jpeg", 0.88);
  const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.88));
  return { dataUrl, blob };
}
