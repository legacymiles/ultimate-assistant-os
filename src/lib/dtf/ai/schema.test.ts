import { describe, expect, it } from "vitest";
import type { DesignProject } from "../types";
import { AiReplySchema, DesignProjectInputSchema, extractJson, MAX_OPS, MAX_PROPOSALS, parseAiReply } from "./schema";
import { describeProject } from "./context";

function fixture(): DesignProject {
  return {
    id: "proj1",
    name: "Test tee",
    garmentId: "tee",
    colorId: "black",
    size: "M",
    placements: { front: "full-front" },
    layers: [
      { id: "img1", kind: "image", name: "Tiger", side: "front", x: 0, y: -24, w: 22, h: 22, rotation: 0, opacity: 1, locked: false, hidden: false, assetId: "a1", src: "", mime: "image/png", naturalW: 3000, naturalH: 3000, origin: "upload" },
      { id: "txt1", kind: "text", name: "Headline", side: "front", x: 0, y: -38, w: 20, h: 3, rotation: 0, opacity: 1, locked: false, hidden: false, text: "WILD", font: "inter", weight: 700, color: "#FFFFFF", fontSizeCm: 3, letterSpacing: 0.05, lineHeight: 1.1, align: "center", uppercase: true, italic: false },
      { id: "lock1", kind: "text", name: "Locked", side: "front", x: 0, y: -12, w: 10, h: 2, rotation: 0, opacity: 1, locked: true, hidden: false, text: "EST", font: "inter", weight: 500, color: "#FFFFFF", fontSizeCm: 1.5, letterSpacing: 0, lineHeight: 1, align: "center", uppercase: true, italic: false },
    ],
    references: [],
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
  };
}

describe("extractJson", () => {
  it("finds an object inside code fences and prose", () => {
    expect(extractJson('Sure! Here you go:\n```json\n{"message":"hi","proposals":[]}\n```\nEnjoy')).toEqual({ message: "hi", proposals: [] });
    expect(extractJson('Thinking... {"a":{"b":"}"}} trailing')).toEqual({ a: { b: "}" } });
    expect(extractJson('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{broken {\"ok\":true}")).toEqual({ ok: true });
    expect(extractJson(undefined)).toBeNull();
  });
});

describe("parseAiReply", () => {
  it("keeps valid ops and drops unknown layer ids", () => {
    const reply = parseAiReply(
      {
        message: "Moved it.",
        proposals: [
          {
            id: "a",
            title: "Nudge",
            rationale: "Better balance.",
            ops: [
              { op: "move", layerId: "img1", dy: 2 },
              { op: "move", layerId: "ghost", dy: 2 },
              { op: "resize", layerId: "nope", scale: 2 },
            ],
          },
        ],
      },
      fixture(),
    );
    expect(reply.engine).toBe("live");
    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0].ops).toEqual([{ op: "move", layerId: "img1", dy: 2 }]);
    expect(reply.notes?.join(" ")).toMatch(/2 referred to layers that don't exist/);
    expect(AiReplySchema.safeParse(reply).success).toBe(true);
  });

  it("never touches locked layers", () => {
    const reply = parseAiReply(
      {
        message: "x",
        proposals: [
          { id: "p", title: "t", rationale: "r", ops: [{ op: "set-text", layerId: "lock1", color: "#000000" }, { op: "delete", layerId: "lock1" }, { op: "rotate", layerId: "txt1", rotation: 10 }] },
          { id: "q", title: "only locked", rationale: "r", ops: [{ op: "move", layerId: "lock1", dx: 1 }] },
        ],
      },
      fixture(),
    );
    const ids = reply.proposals.flatMap((p) => p.ops.map((o) => ("layerId" in o ? o.layerId : "")));
    expect(ids).not.toContain("lock1");
    // The proposal that only touched the locked layer is gone entirely.
    expect(reply.proposals).toHaveLength(1);
    expect(reply.notes?.join(" ")).toMatch(/locked/);
  });

  it("drops invalid colour and zone ids, and kind mismatches", () => {
    const reply = parseAiReply(
      {
        message: "x",
        proposals: [
          {
            id: "p",
            title: "t",
            rationale: "r",
            ops: [
              { op: "set-color", colorId: "plaid" },
              { op: "set-color", colorId: "Midnight Navy" },
              { op: "set-placement", side: "front", zoneId: "back" },
              { op: "set-placement", side: "front", zoneId: "left-chest" },
              { op: "set-placement", side: "front", zoneId: "tote-front" },
              { op: "remove-background", layerId: "txt1" },
              { op: "set-text", layerId: "img1", color: "#fff" },
              { op: "explode", layerId: "img1" },
            ],
          },
        ],
      },
      fixture(),
    );
    expect(reply.proposals[0].ops).toEqual([
      { op: "set-color", colorId: "navy" },
      { op: "set-placement", side: "front", zoneId: "left-chest" },
    ]);
  });

  it("validates a colour against the garment chosen earlier in the same proposal", () => {
    const reply = parseAiReply(
      { message: "x", proposals: [{ id: "p", title: "t", rationale: "r", ops: [{ op: "set-garment", garmentId: "tote" }, { op: "set-color", colorId: "royal" }, { op: "set-color", colorId: "olive" }] }] },
      fixture(),
    );
    expect(reply.proposals[0].ops).toEqual([
      { op: "set-garment", garmentId: "tote" },
      { op: "set-color", colorId: "olive" },
    ]);
  });

  it("clamps numbers to sane ranges and normalises values", () => {
    const reply = parseAiReply(
      {
        message: "x",
        proposals: [
          {
            id: "p",
            title: "t",
            rationale: "r",
            ops: [
              { op: "move", layerId: "img1", x: 500, y: "-500" },
              { op: "resize", layerId: "txt1", w: 400 },
              { op: "resize", layerId: "img1", scale: 50 },
              { op: "set-text", layerId: "txt1", fontSizeCm: 99, weight: 1234, color: "white", font: "Instrument Serif", letterSpacing: 5 },
              { op: "set-opacity", layerId: "img1", opacity: 7 },
              { op: "rotate", layerId: "img1", rotation: 370 },
              { op: "add-text", side: "front", text: "  hi  ", x: 0, y: 100, fontSizeCm: 0.01 },
              { op: "remove-background", layerId: "img1", tolerance: 300 },
            ],
          },
        ],
      },
      fixture(),
    );
    const ops = reply.proposals[0].ops;
    // Tee front extent: x -32..32, y -84..4.
    expect(ops[0]).toEqual({ op: "move", layerId: "img1", x: 32, y: -84 });
    expect(ops[1]).toEqual({ op: "resize", layerId: "txt1", w: 60 });
    const resize = ops[2];
    expect(resize.op === "resize" && resize.scale !== undefined && resize.scale * 22 <= 60).toBe(true);
    expect(ops[3]).toEqual({ op: "set-text", layerId: "txt1", fontSizeCm: 20, weight: 900, color: "#FFFFFF", font: "instrument-serif", letterSpacing: 1 });
    expect(ops[4]).toEqual({ op: "set-opacity", layerId: "img1", opacity: 1 });
    expect(ops[5]).toEqual({ op: "rotate", layerId: "img1", rotation: 10 });
    expect(ops[6]).toEqual({ op: "add-text", side: "front", text: "hi", x: 0, y: 4, fontSizeCm: 0.3 });
    expect(ops[7]).toEqual({ op: "remove-background", layerId: "img1", tolerance: 100 });
  });

  it("sanitises add-svg and drops graphics that cannot be made safe", () => {
    const reply = parseAiReply(
      {
        message: "x",
        proposals: [
          {
            id: "p",
            title: "t",
            rationale: "r",
            ops: [
              { op: "add-svg", side: "front", name: "Star", svg: '<svg viewBox="0 0 10 10" onload="x()"><script>x()</script><path d="M5 0L10 10H0z" fill="#fff"/></svg>', x: 0, y: -20, w: 90 },
              { op: "add-svg", side: "front", name: "Broken", svg: "<div>not svg</div>", x: 0, y: -20, w: 10 },
            ],
          },
        ],
      },
      fixture(),
    );
    const ops = reply.proposals[0].ops;
    expect(ops).toHaveLength(1);
    const op = ops[0];
    expect(op.op).toBe("add-svg");
    if (op.op === "add-svg") {
      expect(op.svg).not.toMatch(/script|onload/);
      expect(op.w).toBe(60);
    }
    expect(reply.notes?.join(" ")).toMatch(/print-safe/);
  });

  it("caps proposals and ops", () => {
    const ops = Array.from({ length: 40 }, () => ({ op: "move", layerId: "img1", dx: 0.1 }));
    const proposals = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, title: "t", rationale: "r", ops }));
    const reply = parseAiReply({ message: "x", proposals }, fixture());
    expect(reply.proposals).toHaveLength(MAX_PROPOSALS);
    expect(reply.proposals[0].ops).toHaveLength(MAX_OPS);
  });

  it("never throws on garbage", () => {
    for (const raw of [null, undefined, 42, "x", [], { proposals: "nope" }, { proposals: [null, 1, { ops: [null] }] }]) {
      const reply = parseAiReply(raw, fixture());
      expect(reply.proposals).toEqual([]);
      expect(typeof reply.message).toBe("string");
      expect(AiReplySchema.safeParse(reply).success).toBe(true);
    }
  });

  it("keeps palette entries with valid hex only", () => {
    const reply = parseAiReply({ message: "x", proposals: [], palette: [{ hex: "#abc", name: "Pale" }, { hex: "nope", name: "Bad" }, { hex: "cream" }] }, fixture());
    expect(reply.palette).toEqual([
      { hex: "#AABBCC", name: "Pale" },
      { hex: "#F2E8CF", name: "#F2E8CF" },
    ]);
  });
});

describe("project input + context", () => {
  it("accepts a real project and describes it with ids, zones and dpi", () => {
    const parsed = DesignProjectInputSchema.safeParse(fixture());
    expect(parsed.success).toBe(true);
    const text = describeProject(fixture(), {
      checkedAt: "",
      verdict: "warn",
      issues: [{ check: "resolution", severity: "warn", message: "Soft at this size.", layerId: "img1" }],
      sides: {},
    });
    expect(text).toContain("id=img1");
    expect(text).toContain("id=txt1");
    expect(text).toContain("LOCKED");
    expect(text).toContain("Jet Black");
    expect(text).toContain("DARK fabric");
    expect(text).toContain("active zone full-front");
    expect(text).toMatch(/3000×3000 px → 346 dpi/);
    expect(text).toContain("[warn] resolution (layer img1)");
  });

  it("rejects a project without layers", () => {
    expect(DesignProjectInputSchema.safeParse({ garmentId: "tee" }).success).toBe(false);
  });
});
