// ---------------------------------------------------------------------------
// Prices. The ONE place the shop's numbers live — the studio, checkout and the
// server all call `quote`, and the server never trusts a price from a browser.
// ---------------------------------------------------------------------------

import { getGarment } from "./garments";
import type { DesignProject, SideId, ZoneId } from "./types";

/** Per print location, by zone size. Small marks cost less than a full back. */
export const LOCATION_CENTS: Record<ZoneId, number> = {
  "full-front": 900,
  "front-chest": 800,
  "left-chest": 500,
  "right-chest": 500,
  back: 900,
  "upper-back": 600,
  sleeve: 400,
  "sleeve-long": 700,
  "tote-front": 800,
  "tote-back": 800,
};

/** Bigger sizes use more cloth. */
export const SIZE_UPCHARGE_CENTS: Record<string, number> = { "2XL": 300, "3XL": 500 };

export const SHIPPING_CENTS = 695;
export const FREE_SHIPPING_FROM_CENTS = 7500;
export const CURRENCY = "usd";

export interface Quote {
  unitCents: number;
  lines: { label: string; cents: number }[];
  /** Sides that carry artwork, with their zone. */
  printed: { side: SideId; zoneId: ZoneId }[];
}

/** Sides that actually have visible artwork on them. */
export function printedSides(project: DesignProject): { side: SideId; zoneId: ZoneId }[] {
  const garment = getGarment(project.garmentId);
  const out: { side: SideId; zoneId: ZoneId }[] = [];
  for (const side of garment.sides) {
    if (!project.layers.some((l) => l.side === side && !l.hidden)) continue;
    const zoneId = project.placements[side] ?? garment.defaultZones[side];
    if (zoneId) out.push({ side, zoneId });
  }
  return out;
}

export function quote(project: DesignProject): Quote {
  const garment = getGarment(project.garmentId);
  const printed = printedSides(project);
  const lines = [{ label: garment.name, cents: garment.baseCents }];
  const up = SIZE_UPCHARGE_CENTS[project.size] ?? 0;
  if (up) lines.push({ label: `Size ${project.size}`, cents: up });
  for (const p of printed) {
    lines.push({ label: `Print — ${labelFor(p.side)}`, cents: LOCATION_CENTS[p.zoneId] });
  }
  return { unitCents: lines.reduce((s, l) => s + l.cents, 0), lines, printed };
}

function labelFor(side: SideId): string {
  return side === "front" ? "front" : side === "back" ? "back" : side === "sleeve-left" ? "left sleeve" : "right sleeve";
}

export function shippingFor(subtotalCents: number, method: "ship" | "pickup"): number {
  if (method === "pickup") return 0;
  return subtotalCents >= FREE_SHIPPING_FROM_CENTS ? 0 : SHIPPING_CENTS;
}

export function money(cents: number, currency = CURRENCY): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}
