import { describe, expect, it } from "vitest";
import { packGang } from "./gang";
import { GARMENTS, ZONES, getGarment, zonesFor } from "./garments";
import { canMove, orderNumber, statusFromJobs } from "./pipeline";
import { isPng, readPngInfo, withPhys } from "./png";
import { LANCELOT_M1630_PRO, effectiveDpi } from "./printers";
import { quote } from "./pricing";
import { applyOps, layerBounds, newImageLayer, newProject, newTextLayer, switchGarment } from "./project";
import { analyzePixels, checkProject, fineDetailRatio } from "./readiness";
import type { DesignProject, ImageLayer, Order } from "./types";

// A real 1×1 transparent PNG (IHDR, IDAT, IEND).
const PNG_1PX = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

function rgba(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y);
      d.set([r, g, b, a], (y * w + x) * 4);
    }
  return d;
}

function withImage(project: DesignProject, px: [number, number], mime = "image/png"): { project: DesignProject; layer: ImageLayer } {
  const layer = newImageLayer(project, "front", { assetId: "a1", src: "x", mime, naturalW: px[0], naturalH: px[1], origin: "upload", name: "art.png" });
  return { project: { ...project, layers: [...project.layers, layer] }, layer };
}

describe("png pHYs", () => {
  it("writes 300 DPI and reads it back, keeping the image valid", () => {
    expect(isPng(PNG_1PX)).toBe(true);
    expect(readPngInfo(PNG_1PX)?.dpi).toBeNull();
    const out = withPhys(PNG_1PX, 300);
    const info = readPngInfo(out)!;
    expect(info.dpi).toBe(300);
    expect(info.width).toBe(1);
    expect(info.hasAlpha).toBe(true);
    // Replacing an existing pHYs does not duplicate it.
    const again = withPhys(out, 150);
    expect(readPngInfo(again)?.dpi).toBe(150);
    expect(again.length).toBe(out.length);
  });
});

describe("garments and zones", () => {
  it("every zone fits the printer's safe width", () => {
    for (const z of Object.values(ZONES)) expect(z.rect.w * 10).toBeLessThanOrEqual(LANCELOT_M1630_PRO.safeWidthMm);
  });
  it("every garment's default zones are among its zones and inside its extents", () => {
    for (const g of GARMENTS) {
      for (const side of g.sides) {
        const id = g.defaultZones[side]!;
        expect(zonesFor(g, side).map((z) => z.id)).toContain(id);
        const ext = g.extents[side]!;
        const r = ZONES[id].rect;
        expect(r.x - r.w / 2).toBeGreaterThanOrEqual(ext.x - ext.w / 2);
        expect(r.y - r.h / 2).toBeGreaterThanOrEqual(ext.y - ext.h / 2);
      }
    }
  });
});

describe("reducer", () => {
  it("moves, resizes text without touching artwork, and respects locks", () => {
    let p = newProject("tee", "black");
    const { project, layer } = withImage(p, [3000, 3000]);
    const text = newTextLayer(project, "front", "HELLO");
    p = { ...project, layers: [...project.layers, text] };
    const before = p.layers.find((l) => l.id === layer.id)!;
    const r = applyOps(p, [
      { op: "move", layerId: layer.id, dy: 1 },
      { op: "resize", layerId: text.id, scale: 1.5 },
    ]);
    const img = r.project.layers.find((l) => l.id === layer.id)!;
    expect(img.y).toBeCloseTo(before.y + 1, 5);
    expect(img.w).toBe(before.w);
    const t = r.project.layers.find((l) => l.id === text.id)!;
    expect(t.kind === "text" && t.fontSizeCm).toBeCloseTo(text.fontSizeCm * 1.5, 2);

    const locked = { ...r.project, layers: r.project.layers.map((l) => ({ ...l, locked: true })) };
    const r2 = applyOps(locked, [{ op: "delete", layerId: layer.id }]);
    expect(r2.skipped.length).toBe(1);
    expect(r2.project.layers.length).toBe(2);
  });

  it("switching garment keeps the design and picks a valid colour and zone", () => {
    let p = newProject("tee", "red");
    p = withImage(p, [2000, 2000]).project;
    const tote = switchGarment(p, "tote");
    expect(tote.layers.length).toBe(1);
    expect(getGarment("tote").colors.map((c) => c.id)).toContain(tote.colorId);
    expect(tote.placements.front).toBe("tote-front");
    const back = switchGarment(tote, "tee");
    expect(back.placements.front).toBe("full-front");
  });

  it("changing placement refits layers into the new zone", () => {
    let p = newProject("tee");
    p = withImage(p, [2000, 2000]).project;
    const r = applyOps(p, [{ op: "set-placement", side: "front", zoneId: "left-chest" }]);
    const b = layerBounds(r.project.layers[0]);
    const z = ZONES["left-chest"].rect;
    expect(b.maxX - b.minX).toBeLessThanOrEqual(z.w + 0.01);
    expect(Math.abs((b.minX + b.maxX) / 2 - z.x)).toBeLessThan(0.5);
  });
});

describe("readiness", () => {
  it("flags low resolution in plain English", () => {
    const { project } = withImage(newProject("tee"), [500, 500]);
    const rep = checkProject({ project, printer: LANCELOT_M1630_PRO, safeWidthMm: 290, stats: {} });
    const res = rep.issues.find((i) => i.check === "resolution");
    expect(res?.severity).toBe("warn");
    expect(res?.message).toMatch(/blurry/);
  });

  it("passes a big transparent PNG as ready for production review", () => {
    const { project, layer } = withImage(newProject("tee"), [4000, 4000]);
    const stats = analyzePixels(rgba(64, 64, (x, y) => (x > 8 && x < 56 && y > 8 && y < 56 ? [255, 0, 0, 255] : [0, 0, 0, 0])), 64, 64);
    const rep = checkProject({ project, printer: LANCELOT_M1630_PRO, safeWidthMm: 290, stats: { [layer.id]: stats } });
    expect(rep.verdict).toBe("ok");
    expect(rep.issues.at(-1)?.message).toMatch(/ready for production review/);
  });

  it("detects a non-transparent background", () => {
    const { project, layer } = withImage(newProject("tee"), [4000, 4000], "image/jpeg");
    const stats = analyzePixels(rgba(32, 32, () => [250, 250, 250, 255]), 32, 32);
    expect(stats.hasAlpha).toBe(false);
    const rep = checkProject({ project, printer: LANCELOT_M1630_PRO, safeWidthMm: 290, stats: { [layer.id]: stats } });
    expect(rep.issues.some((i) => i.check === "transparency" && /not transparent/.test(i.message))).toBe(true);
  });

  it("blocks artwork wider than the printer", () => {
    const { project, layer } = withImage(newProject("oversized-tee"), [9000, 9000]);
    const big = { ...project, layers: [{ ...layer, w: 34, h: 34 }] };
    const rep = checkProject({ project: big, printer: LANCELOT_M1630_PRO, safeWidthMm: 290, stats: {} });
    expect(rep.verdict).toBe("block");
    expect(rep.issues.find((i) => i.check === "printer-width")?.message).toMatch(/wider than the printer/);
  });

  it("measures stroke width: hairlines are fine detail, solid blocks are not", () => {
    const hair = analyzePixels(rgba(200, 200, (x) => (x % 20 === 0 ? [0, 0, 0, 255] : [0, 0, 0, 0])), 200, 200);
    const solid = analyzePixels(rgba(200, 200, (x, y) => (x > 20 && x < 180 && y > 20 && y < 180 ? [0, 0, 0, 255] : [0, 0, 0, 0])), 200, 200);
    // 200 px across 20 cm → 1 mm per px; a 1-px line is 1 mm (OK) at 20 cm, 0.25 mm at 5 cm.
    expect(fineDetailRatio(hair, 5, 0.5)).toBeGreaterThan(0.5);
    expect(fineDetailRatio(solid, 5, 0.5)).toBeLessThan(0.2);
  });

  it("an empty design cannot go to print", () => {
    const rep = checkProject({ project: newProject("tee"), printer: LANCELOT_M1630_PRO, safeWidthMm: 290, stats: {} });
    expect(rep.verdict).toBe("block");
  });
});

describe("printer maths", () => {
  it("effective DPI", () => {
    expect(Math.round(effectiveDpi(3307, 28))).toBe(300);
  });
});

describe("gang sheets", () => {
  it("packs on a 300 mm roll, rotates a too-wide piece, rejects an impossible one", () => {
    const layout = packGang(
      [
        { id: "a", label: "A", widthMm: 280, heightMm: 300, copies: 2 },
        { id: "b", label: "B", widthMm: 400, heightMm: 120, copies: 1 },
        { id: "c", label: "C", widthMm: 90, heightMm: 90, copies: 3 },
        { id: "x", label: "X", widthMm: 400, heightMm: 400, copies: 1 },
      ],
      { widthMm: 300, maxLengthMm: 2000, gapMm: 6, marginMm: 5 },
    );
    expect(layout.unplaced.map((u) => u.id)).toEqual(["x"]);
    const b = layout.placed.find((p) => p.id === "b")!;
    expect(b.rotated).toBe(true);
    for (const p of layout.placed) {
      expect(p.x + p.w).toBeLessThanOrEqual(295.001);
      for (const q of layout.placed) {
        if (p === q) continue;
        const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("pipeline + pricing", () => {
  it("moves one stage at a time and cancels before shipping", () => {
    expect(canMove("incoming", "artwork_review")).toBe(true);
    expect(canMove("incoming", "printing")).toBe(false);
    expect(canMove("quality_control", "printing")).toBe(false);
    expect(canMove("quality_control", "heat_transfer")).toBe(true);
    expect(canMove("shipped", "cancelled")).toBe(false);
    expect(orderNumber(117)).toBe("DTF-24117");
  });

  it("advances to heat transfer only when every job is printed", () => {
    const order = { status: "printing", jobs: [{ status: "printed" }, { status: "opened" }] } as unknown as Order;
    expect(statusFromJobs(order)).toBeNull();
    order.jobs[1].status = "printed";
    expect(statusFromJobs(order)).toBe("heat_transfer");
  });

  it("prices only printed sides", () => {
    const p = withImage(newProject("tee"), [3000, 3000]).project;
    const q = quote(p);
    expect(q.printed).toEqual([{ side: "front", zoneId: "full-front" }]);
    expect(q.unitCents).toBe(1800 + 900);
  });
});

describe("fabric colour and automatic ink", () => {
  it("flips the studio's automatic text ink with the fabric, but never a chosen colour", () => {
    let p = newProject("tee", "black");
    const auto = newTextLayer(p, "front", "AUTO");
    const chosen = { ...newTextLayer(p, "front", "MINE"), color: "#FF5A4E" };
    p = { ...p, layers: [auto, chosen] };
    expect(auto.color).toBe("#F4F1EA");
    const light = applyOps(p, [{ op: "set-color", colorId: "white" }]).project;
    expect(light.layers[0].kind === "text" && light.layers[0].color).toBe("#141416");
    expect(light.layers[1].kind === "text" && light.layers[1].color).toBe("#FF5A4E");
    const back = applyOps(light, [{ op: "set-color", colorId: "navy" }]).project;
    expect(back.layers[0].kind === "text" && back.layers[0].color).toBe("#F4F1EA");
  });
});

describe("photo mockups", () => {
  it("has a real photo for every side of every garment, and at least one scene", async () => {
    const { photoFor, scenesFor } = await import("./mockups");
    for (const g of GARMENTS) {
      for (const side of g.sides) expect(photoFor(g.id, side), `${g.id} ${side}`).not.toBeNull();
      expect(scenesFor(g.id).length, g.id).toBeGreaterThan(0);
    }
  });

  it("puts the collar at side-space 0,0 — mirrored photos included", async () => {
    const { PHOTOS, photoExtent } = await import("./mockups");
    for (const sides of Object.values(PHOTOS)) {
      for (const p of Object.values(sides ?? {})) {
        if (!p) continue;
        const e = photoExtent(p);
        const minX = e.x - e.w / 2;
        const maxY = e.y + e.h / 2;
        const cx = p.flip ? p.w - p.collar[0] : p.collar[0];
        // (0,0) in cm lands on the collar pixel.
        expect((0 - minX) * p.ppc).toBeCloseTo(cx, 6);
        expect((maxY - 0) * p.ppc).toBeCloseTo(p.collar[1], 6);
      }
    }
  });

  it("keeps every default print zone inside its photo", async () => {
    const { photoExtent, photoFor } = await import("./mockups");
    for (const g of GARMENTS) {
      for (const side of g.sides) {
        const id = g.defaultZones[side];
        const p = photoFor(g.id, side);
        if (!id || !p) continue;
        const z = ZONES[id].rect;
        const e = photoExtent(p);
        expect(z.x - z.w / 2).toBeGreaterThanOrEqual(e.x - e.w / 2);
        expect(z.x + z.w / 2).toBeLessThanOrEqual(e.x + e.w / 2);
        expect(z.y + z.h / 2).toBeLessThanOrEqual(e.y + e.h / 2);
        expect(z.y - z.h / 2).toBeGreaterThanOrEqual(e.y - e.h / 2);
      }
    }
  });

  it("places scene quads inside the scene photo", async () => {
    const { SCENES } = await import("./mockups");
    for (const s of SCENES) {
      expect(s.quad).toHaveLength(4);
      for (const [x, y] of s.quad) {
        expect(x, s.id).toBeGreaterThan(-0.2);
        expect(x, s.id).toBeLessThan(1.2);
        expect(y, s.id).toBeGreaterThan(-0.2);
        expect(y, s.id).toBeLessThan(1.2);
      }
    }
  });
});
