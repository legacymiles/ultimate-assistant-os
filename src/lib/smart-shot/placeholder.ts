// ---------------------------------------------------------------------------
// The stand-in image drawn when no image model is configured, so the whole
// sheet still lays out and can be walked through offline. Pure.
// ---------------------------------------------------------------------------

import { aspectSize } from "./panels";
import type { PanelKind } from "./types";

const HUE: Record<PanelKind, number> = { character: 30, product: 15, environment: 205, floorplan: 150, elevation: 160, cut: 260, lighting: 45 };
const LABEL: Record<PanelKind, string> = {
  character: "Character sheet",
  product: "Product sheet",
  environment: "Environment plate",
  floorplan: "Top-down floor plan",
  elevation: "Side elevation",
  cut: "Storyboard frame",
  lighting: "Lighting reference",
};

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
}

export function placeholderPanel(kind: PanelKind, aspect: string, caption: string): string {
  const [w, h] = aspectSize(aspect);
  const hue = HUE[kind];
  const words = caption.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > Math.floor(w / 22)) {
      lines.push(line.trim());
      line = word;
    } else line += " " + word;
    if (lines.length === 3) break;
  }
  if (lines.length < 3 && line.trim()) lines.push(line.trim());
  const text = lines
    .map((l, i) => `<text x="${w / 2}" y="${h / 2 + 30 + i * 30}" font-family="system-ui,sans-serif" font-size="${Math.round(w / 48)}" fill="#fff" opacity="0.7" text-anchor="middle">${esc(l)}</text>`)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},40%,32%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},45%,12%)"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<rect x="12" y="12" width="${w - 24}" height="${h - 24}" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-dasharray="6 6"/>` +
    `<text x="${w / 2}" y="${h / 2 - 20}" font-family="ui-monospace,monospace" font-size="${Math.round(w / 30)}" fill="#fff" opacity="0.9" text-anchor="middle" letter-spacing="2">${esc(LABEL[kind].toUpperCase())}</text>` +
    text +
    `<text x="${w / 2}" y="${h - 28}" font-family="system-ui,sans-serif" font-size="${Math.round(w / 56)}" fill="#fff" opacity="0.45" text-anchor="middle">offline preview — add an image model key to draw this</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
