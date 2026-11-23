// ---------------------------------------------------------------------------
// The project, as the AI designer reads it.
//
// Plain text, not JSON: it is shorter, models read it more reliably, and it
// lets every number carry its unit. Everything the model needs to propose a
// correct DesignOp is here — real layer ids, positions in cm, the active zone
// as edges, the fabric's darkness, and what print readiness already found —
// and nothing it does not (asset URLs, timestamps).
//
// Customer-written strings (layer names, text content) are JSON-quoted and
// truncated so they read as data, not as instructions.
// ---------------------------------------------------------------------------

import { getColor, getGarment, isDarkFabric, SIDE_LABEL, ZONES, zonesFor } from "../garments";
import { effectiveDpi, LANCELOT_M1630_PRO } from "../printers";
import type { DesignProject, Layer, ReadinessReport, RectCm, SideId, ZoneId } from "../types";

const f = (n: number, places = 1) => (Number.isFinite(n) ? Number(n.toFixed(places)).toString() : "?");
const q = (s: string, max = 120) => JSON.stringify(s.length > max ? `${s.slice(0, max)}…` : s);

function edges(r: RectCm): string {
  return `x ${f(r.x - r.w / 2)}..${f(r.x + r.w / 2)}, y ${f(r.y - r.h / 2)}..${f(r.y + r.h / 2)}`;
}

/** The zone a side prints in: the project's choice, else the garment's default. */
export function activeZone(project: DesignProject, side: SideId): ZoneId | undefined {
  const garment = getGarment(project.garmentId);
  const picked = project.placements[side];
  const offered = zonesFor(garment, side).map((z) => z.id);
  if (picked && offered.includes(picked)) return picked;
  return garment.defaultZones[side];
}

/** Lowest effective DPI of an image layer at its printed size. */
export function layerDpi(layer: Layer): number | null {
  if (layer.kind !== "image" || !layer.naturalW || !layer.naturalH) return null;
  return Math.round(Math.min(effectiveDpi(layer.naturalW, layer.w), effectiveDpi(layer.naturalH, layer.h)));
}

function describeLayer(l: Layer): string {
  const flags = [l.locked ? "LOCKED (do not edit)" : "", l.hidden ? "hidden" : "", l.opacity < 1 ? `opacity ${f(l.opacity, 2)}` : ""].filter(Boolean);
  const head = `- id=${l.id} ${l.kind} ${q(l.name, 60)} on ${l.side}: centre (${f(l.x)}, ${f(l.y)}) cm, ${f(l.w)}×${f(l.h)} cm, rotation ${f(l.rotation)}°`;
  let body: string;
  if (l.kind === "text") {
    body =
      `text ${q(l.text)} font=${l.font} weight=${l.weight} colour=${l.color} size=${f(l.fontSizeCm, 2)}cm` +
      ` tracking=${f(l.letterSpacing, 3)}em line-height=${f(l.lineHeight, 2)} align=${l.align}` +
      `${l.uppercase ? " UPPERCASE" : ""}${l.italic ? " italic" : ""}`;
  } else {
    const dpi = layerDpi(l);
    body = `image ${l.mime}, source ${l.naturalW}×${l.naturalH} px → ${dpi ?? "?"} dpi at this size, origin ${l.origin}${l.sourceAssetId ? " (derived copy; original kept)" : ""}`;
  }
  return `${head}${flags.length ? ` [${flags.join(", ")}]` : ""}\n    ${body}`;
}

/**
 * Compact, plain-text state of a design for the model. `readiness` is the
 * browser's latest print-readiness report, when it sent one.
 */
export function describeProject(project: DesignProject, readiness?: ReadinessReport): string {
  const garment = getGarment(project.garmentId);
  const color = getColor(garment, project.colorId);
  const dark = isDarkFabric(color.hex);
  const printer = LANCELOT_M1630_PRO;
  const lines: string[] = [];

  lines.push(`PROJECT: ${q(project.name, 80)}`);
  lines.push(`GARMENT: ${garment.name} (id ${garment.id}) — ${garment.fabric}, ${garment.weightGsm} gsm, fit: ${garment.fit}`);
  lines.push(
    `FABRIC COLOUR: ${color.name} (id ${color.id}) ${color.hex} — ${dark ? "DARK fabric: use light inks; the printer lays a white underbase" : "LIGHT fabric: use dark or saturated inks; pale ink will vanish"}${color.heather ? ", heathered (mélange) yarn" : ""}`,
  );
  lines.push(`SIZE: ${project.size}`);
  lines.push(`OTHER COLOURS FOR THIS GARMENT: ${garment.colors.map((c) => `${c.id} ${c.hex}`).join(", ")}`);
  lines.push(
    `PRINTER: ${printer.name} via ${printer.rip} — safe print width ${printer.safeWidthMm / 10} cm (max ${printer.maxWidthMm / 10} cm), finest line ${printer.minLineMm} mm, target ${printer.targetDpi} dpi (≥${printer.minGoodDpi} good, <${printer.minAcceptableDpi} blurry)`,
  );

  lines.push("SIDES (cm, origin = centre of collar line, +y up, so chest prints have negative y):");
  for (const side of garment.sides) {
    const ext = garment.extents[side];
    const zoneId = activeZone(project, side);
    const zone = zoneId ? ZONES[zoneId] : undefined;
    const count = project.layers.filter((l) => l.side === side).length;
    const allowed = zonesFor(garment, side)
      .map((z) => `${z.id} (${f(z.rect.w)}×${f(z.rect.h)} at ${f(z.rect.x)},${f(z.rect.y)})`)
      .join("; ");
    lines.push(
      `- ${side} (${SIDE_LABEL[side]}, ${count} layer${count === 1 ? "" : "s"}): ` +
        `${zone ? `active zone ${zone.id} "${zone.label}" ${f(zone.rect.w)}×${f(zone.rect.h)} cm, ${edges(zone.rect)}` : "no zone"}` +
        `${ext ? `; editable area ${edges(ext)}` : ""}; allowed zones: ${allowed || "none"}`,
    );
  }

  if (project.layers.length) {
    lines.push("LAYERS (bottom → top; use these exact ids):");
    for (const l of project.layers) lines.push(describeLayer(l));
  } else {
    lines.push("LAYERS: none yet — the design is empty.");
  }

  if (project.references.length) {
    lines.push(`REFERENCE PICTURES ON FILE: ${project.references.length} (inspiration only, never printed)`);
  }

  if (readiness) {
    const issues = readiness.issues.filter((i) => i.severity !== "ok").slice(0, 20);
    lines.push(`PRINT READINESS: ${readiness.verdict.toUpperCase()}${issues.length ? "" : " — no issues"}`);
    for (const i of issues) {
      lines.push(`- [${i.severity}] ${i.check}${i.layerId ? ` (layer ${i.layerId})` : ""}${i.side ? ` on ${i.side}` : ""}: ${i.message}${i.fix ? ` Fix: ${i.fix}` : ""}`);
    }
  }
  return lines.join("\n");
}
