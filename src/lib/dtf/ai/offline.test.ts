import { describe, expect, it } from "vitest";
import type { DesignOp, DesignProject } from "../types";
import { contrastRatio, offlineReply } from "./offline";
import { AiReplySchema } from "./schema";

function fixture(overrides: Partial<DesignProject> = {}): DesignProject {
  return {
    id: "proj1",
    name: "Test tee",
    garmentId: "tee",
    colorId: "black",
    size: "M",
    placements: { front: "full-front" },
    layers: [
      { id: "img1", kind: "image", name: "Tiger", side: "front", x: 0, y: -24, w: 20, h: 20, rotation: 0, opacity: 1, locked: false, hidden: false, assetId: "a1", src: "", mime: "image/png", naturalW: 3000, naturalH: 3000, origin: "upload" },
      { id: "txt1", kind: "text", name: "Headline", side: "front", x: 0, y: -38, w: 18, h: 3, rotation: 0, opacity: 1, locked: false, hidden: false, text: "WILD", font: "inter", weight: 700, color: "#FFFFFF", fontSizeCm: 3, letterSpacing: 0.05, lineHeight: 1.1, align: "center", uppercase: true, italic: false },
    ],
    references: [],
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
    ...overrides,
  };
}

const opsOf = (reply: ReturnType<typeof offlineReply>): DesignOp[] => reply.proposals.flatMap((p) => p.ops);
const layerIds = (ops: DesignOp[]) => new Set(ops.map((o) => ("layerId" in o ? o.layerId : "")).filter(Boolean));

describe("offlineReply", () => {
  it("move the graphic slightly higher → dy ≈ +1 on the image", () => {
    const reply = offlineReply(fixture(), "Move the graphic slightly higher");
    expect(reply.engine).toBe("offline");
    const ops = opsOf(reply);
    expect(ops).toEqual([{ op: "move", layerId: "img1", dy: 1 }]);
    expect(AiReplySchema.safeParse(reply).success).toBe(true);
  });

  it("default nudge is 2 cm, explicit distances are honoured", () => {
    expect(opsOf(offlineReply(fixture(), "move the text down"))).toEqual([{ op: "move", layerId: "txt1", dy: -2 }]);
    expect(opsOf(offlineReply(fixture(), "shift the logo left 15 mm"))).toEqual([{ op: "move", layerId: "img1", dx: -1.5 }]);
  });

  it("make the text larger but keep the artwork the same size → only the text changes", () => {
    const reply = offlineReply(fixture(), "make the text larger but keep the artwork the same size");
    const ops = opsOf(reply);
    expect(ops.length).toBeGreaterThan(0);
    expect(layerIds(ops)).toEqual(new Set(["txt1"]));
    for (const op of ops) expect(["resize", "set-text"]).toContain(op.op);
    const resize = ops.find((o) => o.op === "resize");
    expect(resize && resize.op === "resize" && (resize.scale ?? 0) > 1).toBe(true);
  });

  it("make the graphic smaller keeps the text", () => {
    const ops = opsOf(offlineReply(fixture(), "make the graphic smaller"));
    expect(layerIds(ops)).toEqual(new Set(["img1"]));
  });

  it("three versions → three meaningfully different proposals", () => {
    const reply = offlineReply(fixture(), "show me three versions");
    expect(reply.proposals).toHaveLength(3);
    const titles = new Set(reply.proposals.map((p) => p.title));
    expect(titles.size).toBe(3);
    for (const p of reply.proposals) expect(p.ops.length).toBeGreaterThan(0);
    const fonts = reply.proposals.map((p) => p.ops.find((o) => o.op === "set-text" && o.layerId === "txt1"));
    expect(new Set(fonts.map((o) => (o && o.op === "set-text" ? o.font : undefined))).size).toBe(3);
    expect(AiReplySchema.safeParse(reply).success).toBe(true);
  });

  it("works on a black shirt → set-color black and dark text flipped light", () => {
    const project = fixture({
      colorId: "white",
      layers: fixture().layers.map((l) => (l.kind === "text" ? { ...l, color: "#111111" } : l)),
    });
    const ops = opsOf(offlineReply(project, "make it work on a black shirt"));
    expect(ops).toContainEqual({ op: "set-color", colorId: "black" });
    const flip = ops.find((o) => o.op === "set-text" && o.layerId === "txt1");
    expect(flip && flip.op === "set-text" && flip.color && contrastRatio(flip.color, "#141416") >= 3).toBe(true);
  });

  it("works on a white shirt flips white text to dark", () => {
    const ops = opsOf(offlineReply(fixture(), "will this work on a white tee?"));
    expect(ops).toContainEqual({ op: "set-color", colorId: "white" });
    expect(ops).toContainEqual({ op: "set-text", layerId: "txt1", color: "#111111" });
  });

  it("text colour words recolour the text, not the fabric", () => {
    const ops = opsOf(offlineReply(fixture(), "make the text cream"));
    expect(ops).toEqual([{ op: "set-text", layerId: "txt1", color: "#F2E8CF" }]);
  });

  it("changes the font to a named font", () => {
    const ops = opsOf(offlineReply(fixture(), "change the font to Archivo Black"));
    expect(ops).toEqual([{ op: "set-text", layerId: "txt1", font: "archivo-black", weight: 900 }]);
  });

  it("more premium → serif or wide-tracked uppercase, smaller scale", () => {
    const reply = offlineReply(fixture(), "make it look more expensive");
    expect(reply.proposals).toHaveLength(1);
    const ops = reply.proposals[0].ops;
    // "WILD" is a short word → a wide-tracked uppercase wordmark.
    expect(ops).toContainEqual(expect.objectContaining({ op: "set-text", layerId: "txt1", font: "geist", uppercase: true, letterSpacing: 0.35 }));
    const phrase = fixture({ layers: fixture().layers.map((l) => (l.kind === "text" ? { ...l, text: "Built for the long road home" } : l)) });
    expect(opsOf(offlineReply(phrase, "more luxury"))).toContainEqual(expect.objectContaining({ op: "set-text", layerId: "txt1", font: "instrument-serif" }));
    const resizes = ops.filter((o) => o.op === "resize");
    expect(resizes.length).toBeGreaterThan(0);
    for (const r of resizes) expect(r.op === "resize" && (r.scale ?? 1) < 1).toBe(true);
  });

  it("vintage, streetwear and minimal presets produce edits", () => {
    for (const msg of ["give it a vintage feel", "more streetwear", "make it minimal"]) {
      expect(opsOf(offlineReply(fixture(), msg)).length).toBeGreaterThan(0);
    }
  });

  it("targets the selected layer for 'this' / 'it'", () => {
    const ops = opsOf(offlineReply(fixture(), "rotate it 10 degrees", { selectedLayerId: "txt1" }));
    expect(ops).toEqual([{ op: "rotate", layerId: "txt1", rotation: 10 }]);
  });

  it("centres, removes backgrounds and adds quoted text", () => {
    expect(opsOf(offlineReply(fixture(), "center the graphic"))).toEqual([{ op: "center", layerId: "img1", axis: "both" }]);
    expect(opsOf(offlineReply(fixture(), "remove the background"))).toEqual([{ op: "remove-background", layerId: "img1" }]);
    const add = opsOf(offlineReply(fixture(), 'add text "Since 2024" under it'));
    expect(add).toHaveLength(1);
    expect(add[0]).toMatchObject({ op: "add-text", side: "front", text: "Since 2024", color: "#FFFFFF" });
  });

  it("moves a design to a placement zone, scaled to fit", () => {
    const ops = opsOf(offlineReply(fixture(), "put it on the left chest"));
    expect(ops[0]).toEqual({ op: "set-placement", side: "front", zoneId: "left-chest" });
    expect(ops.some((o) => o.op === "resize")).toBe(true);
  });

  it("never touches a locked layer", () => {
    const project = fixture({ layers: fixture().layers.map((l) => ({ ...l, locked: true })) });
    const reply = offlineReply(project, "make the text larger");
    expect(opsOf(reply)).toEqual([]);
    expect(reply.notes?.join(" ")).toMatch(/locked/);
  });

  it("offers a palette for the current fabric with real contrast", () => {
    const reply = offlineReply(fixture(), "what colours would work?");
    expect(reply.palette?.length).toBeGreaterThan(0);
    for (const c of reply.palette ?? []) expect(contrastRatio(c.hex, "#141416")).toBeGreaterThanOrEqual(3);
  });

  it("falls back to a helpful message and never throws on nonsense", () => {
    const reply = offlineReply(fixture(), "asdf qwerty");
    expect(reply.proposals).toEqual([]);
    expect(reply.message).toMatch(/try/i);
    expect(offlineReply(fixture({ layers: [] }), "make it bigger").message).toMatch(/empty/i);
  });
});
