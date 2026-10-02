import { describe, expect, it } from "vitest";
import {
  activity,
  badgeOf,
  colourVar,
  CORE_RADIUS,
  coreRadius,
  flowOf,
  formatFps,
  formatMs,
  Fps,
  idleFactor,
  IDLE_AFTER_MS,
  ignition,
  IGNITION_MS,
  motePosition,
  motes,
  REST_RADIUS,
  ribbon,
  ringSpecs,
  sweepAngle,
} from "./reactor";
import { BAND_COUNT } from "./spectrum";

const bands = (value: number, n = BAND_COUNT) => new Float32Array(n).fill(value);

describe("flow — the whole idea", () => {
  it("pulls inward while hearing and pushes outward while speaking", () => {
    // The thing that makes this more than a circular volume meter: you can
    // tell what is happening from the SHAPE, without reading the badge.
    expect(flowOf("hearing")).toBe("in");
    expect(flowOf("speaking")).toBe("out");
  });

  it("is still for every state where nothing is crossing the boundary", () => {
    expect(flowOf("waiting")).toBe("still");
    expect(flowOf("thinking")).toBe("still");
    expect(flowOf("off")).toBe("still");
  });
});

describe("ringSpecs", () => {
  it("grows bars outward from the rest radius when speaking", () => {
    const [bar] = ringSpecs(bands(1), "out");
    expect(bar.from).toBeCloseTo(REST_RADIUS, 5);
    expect(bar.to).toBeGreaterThan(REST_RADIUS);
  });

  it("grows bars INWARD, toward the core, when hearing", () => {
    const [bar] = ringSpecs(bands(1), "in");
    expect(bar.to).toBeLessThan(bar.from);
  });

  it("never lets an inward bar punch through the middle", () => {
    // A bar that reaches past the centre and out the other side reads as a
    // glitch rather than as intensity.
    for (const bar of ringSpecs(bands(1), "in", 10)) {
      expect(bar.to).toBeGreaterThanOrEqual(CORE_RADIUS);
    }
  });

  it("sits symmetric about the rest radius when nothing is flowing", () => {
    const [bar] = ringSpecs(bands(0.6), "still");
    expect((bar.from + bar.to) / 2).toBeCloseTo(REST_RADIUS, 5);
    expect(bar.to).toBeGreaterThan(bar.from);
  });

  it("collapses to a plain circle in silence, whatever the flow", () => {
    for (const flow of ["in", "out", "still"] as const) {
      for (const bar of ringSpecs(bands(0), flow)) {
        expect(bar.from).toBeCloseTo(REST_RADIUS, 5);
        expect(bar.to).toBeCloseTo(REST_RADIUS, 5);
      }
    }
  });

  it("mirrors the bands, so the ring has no visible seam", () => {
    // A spectrum that starts at 3 o'clock and ends there shows a hard join
    // every single frame. Mirroring makes it read as one object.
    const varied = new Float32Array([0.1, 0.9, 0.3]);
    const specs = ringSpecs(varied, "out");
    expect(specs).toHaveLength(6);
    for (let i = 0; i < 3; i += 1) {
      expect(specs[i].strength).toBeCloseTo(specs[5 - i].strength, 6);
      expect(specs[i].to).toBeCloseTo(specs[5 - i].to, 6);
    }
  });

  it("spreads the bands over a full turn without overlapping", () => {
    const specs = ringSpecs(bands(0.5, 8), "out");
    const angles = specs.map((s) => ((s.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
    for (let i = 1; i < angles.length; i += 1) expect(angles[i]).toBeGreaterThan(angles[i - 1]);
  });

  it("reuses its output array rather than allocating one per frame", () => {
    const out = ringSpecs(bands(0.5), "out");
    expect(ringSpecs(bands(0.7), "out", 0.34, out)).toBe(out);
  });

  it("clamps a band outside 0..1 rather than drawing off the canvas", () => {
    const wild = new Float32Array([5, -3]);
    for (const bar of ringSpecs(wild, "out")) {
      expect(bar.strength).toBeGreaterThanOrEqual(0);
      expect(bar.strength).toBeLessThanOrEqual(1);
    }
  });
});

describe("coreRadius", () => {
  it("CONTRACTS while thinking, because there is no sound to swell for", () => {
    // The one state with no audio at all. A core that swells here would be
    // inventing activity that is not happening.
    const thinking = coreRadius("thinking", 0, 0);
    const waiting = coreRadius("waiting", 0, 0);
    expect(thinking).toBeLessThan(waiting);
  });

  it("swells with loudness while speaking", () => {
    expect(coreRadius("speaking", 1, 0)).toBeGreaterThan(coreRadius("speaking", 0, 0));
  });

  it("is never a dead dot — it breathes even in silence", () => {
    const a = coreRadius("waiting", 0, 0);
    const b = coreRadius("waiting", 0, 1.1);
    expect(a).not.toBeCloseTo(b, 4);
  });

  it("is smallest when off", () => {
    expect(coreRadius("off", 0, 0)).toBeLessThan(coreRadius("thinking", 0, 0));
  });

  it("stays positive and finite for any input", () => {
    for (const state of ["off", "waiting", "hearing", "thinking", "speaking"] as const) {
      for (const t of [0, 1.7, 99]) {
        const r = coreRadius(state, 1, t);
        expect(r).toBeGreaterThan(0);
        expect(Number.isFinite(r)).toBe(true);
      }
    }
  });
});

describe("sweepAngle", () => {
  it("spins fastest while thinking, which is the state with nothing else to show", () => {
    const at = (state: Parameters<typeof sweepAngle>[0]) => sweepAngle(state, 1);
    expect(at("thinking")).toBeGreaterThan(at("speaking"));
    expect(at("speaking")).toBeGreaterThan(at("waiting"));
  });

  it("stays within one turn", () => {
    for (let t = 0; t < 100; t += 3.1) {
      const a = sweepAngle("waiting", t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
    }
  });

  it("slows down as the room goes quiet", () => {
    expect(sweepAngle("waiting", 1, 0.35)).toBeLessThan(sweepAngle("waiting", 1, 1));
  });
});

describe("idleFactor — a quiet room should look quiet", () => {
  it("stays fully awake until the silence has run on a while", () => {
    expect(idleFactor("waiting", 0)).toBe(1);
    expect(idleFactor("waiting", IDLE_AFTER_MS - 1)).toBe(1);
  });

  it("eases down to its floor and no further", () => {
    expect(idleFactor("waiting", IDLE_AFTER_MS + 5000)).toBeLessThan(1);
    expect(idleFactor("waiting", IDLE_AFTER_MS + 60_000)).toBeCloseTo(0.35, 5);
  });

  it("never dims a state that is actually doing something", () => {
    for (const state of ["hearing", "thinking", "speaking"] as const) {
      expect(idleFactor(state, 999_999)).toBe(1);
    }
  });
});

describe("ignition — you can see it hear its name", () => {
  it("flashes hard and decays fast", () => {
    // The wake word currently lands a second before anything is captured, with
    // nothing on screen moving. This is that missing moment.
    expect(ignition(1000, 1000)).toBeCloseTo(1, 5);
    const early = ignition(1000, 1000 + IGNITION_MS * 0.25);
    const late = ignition(1000, 1000 + IGNITION_MS * 0.75);
    expect(early).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0);
  });

  it("is nothing before it fires and nothing after it has burned out", () => {
    expect(ignition(0, 5000)).toBe(0);
    expect(ignition(1000, 1000 + IGNITION_MS + 1)).toBe(0);
    expect(ignition(1000, 999)).toBe(0);
  });
});

describe("Fps", () => {
  it("reads a steady 60 from 16.67ms frames", () => {
    const fps = new Fps();
    for (let i = 0; i < 30; i += 1) fps.tick(i * (1000 / 60));
    expect(fps.value).toBeCloseTo(60, 0);
  });

  it("reports nothing rather than a made-up number before it has frames", () => {
    expect(new Fps().value).toBe(0);
    expect(formatFps(0)).toBe("—");
  });

  it("forgets old frames, so a stall does not haunt the readout forever", () => {
    const fps = new Fps(10);
    fps.tick(0);
    for (let i = 1; i <= 20; i += 1) fps.tick(1000 + i * (1000 / 60));
    expect(fps.value).toBeCloseTo(60, 0);
  });

  it("survives two frames at the same timestamp", () => {
    const fps = new Fps();
    fps.tick(5);
    fps.tick(5);
    expect(Number.isFinite(fps.value)).toBe(true);
  });
});

describe("formatMs", () => {
  it("shows an em dash rather than a lying zero when there is nothing to report", () => {
    expect(formatMs(null)).toBe("—");
    expect(formatMs(Number.NaN)).toBe("—");
    expect(formatMs(-1)).toBe("—");
  });

  it("switches to seconds once milliseconds stop being readable", () => {
    expect(formatMs(249)).toBe("249 ms");
    expect(formatMs(2480)).toBe("2.5 s");
  });
});

describe("ribbon", () => {
  it("tapers to nothing at both ends, so it is not cut off by the canvas edge", () => {
    const ys = ribbon(bands(1, 9));
    expect(ys[0]).toBeCloseTo(0, 5);
    expect(ys[8]).toBeCloseTo(0, 5);
    expect(ys[4]).toBeGreaterThan(0.9);
  });

  it("is flat for silence", () => {
    expect([...ribbon(bands(0, 5))].every((y) => y === 0)).toBe(true);
  });
});

describe("motes", () => {
  it("is the same field every time, so it is recognisably the owner's reactor", () => {
    // A particle field that differs on every page load cannot be recognised.
    expect(motes(20, 7)).toEqual(motes(20, 7));
  });

  it("gives a different field for a different seed", () => {
    expect(motes(20, 1)).not.toEqual(motes(20, 2));
  });

  it("counter-rotates, so the field has depth rather than spinning as one disc", () => {
    const field = motes(60);
    expect(field.some((m) => m.speed > 0)).toBe(true);
    expect(field.some((m) => m.speed < 0)).toBe(true);
  });

  it("keeps every mote inside the canvas", () => {
    for (const m of motes(80)) {
      expect(m.orbit).toBeGreaterThan(0);
      expect(m.orbit).toBeLessThanOrEqual(0.76);
      expect(m.band).toBeGreaterThanOrEqual(0);
      expect(m.band).toBeLessThan(BAND_COUNT);
    }
  });
});

describe("motePosition — the same idea, expressed twice", () => {
  const field = motes(10, 3);

  it("pushes motes out while speaking and pulls them in while hearing", () => {
    const loud = bands(1);
    const out = motePosition(field[0], loud, "out", 0);
    const inward = motePosition(field[0], loud, "in", 0);
    const r = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
    expect(r(out)).toBeGreaterThan(r(inward));
  });

  it("never collapses a mote into the exact centre", () => {
    for (const m of field) {
      const p = motePosition(m, bands(1), "in", 0);
      expect(Math.hypot(p.x, p.y)).toBeGreaterThan(0.05);
    }
  });

  it("does not read past the end of a short band array", () => {
    expect(() => motePosition(field[0], new Float32Array([0.5]), "out", 0)).not.toThrow();
    expect(() => motePosition(field[0], new Float32Array(0), "out", 0)).not.toThrow();
  });
});

describe("badges and colours", () => {
  it("names every state", () => {
    for (const state of ["off", "waiting", "hearing", "thinking", "speaking"] as const) {
      expect(badgeOf(state).length).toBeGreaterThan(0);
      expect(colourVar(state).startsWith("--color-")).toBe(true);
    }
  });

  it("gives hearing, speaking and thinking three different colours", () => {
    const set = new Set([colourVar("hearing"), colourVar("speaking"), colourVar("thinking")]);
    expect(set.size).toBe(3);
  });
});

describe("activity", () => {
  it("is zero when off and when thinking, because neither is making a sound", () => {
    expect(activity(bands(1), "off")).toBe(0);
    expect(activity(bands(1), "thinking")).toBe(0);
  });

  it("follows the bands otherwise", () => {
    expect(activity(bands(0.5), "speaking")).toBeCloseTo(0.5, 5);
  });
});
