// node --test tools/h3-lab-worker/lib/
import test from "node:test";
import assert from "node:assert/strict";
import { estimateShift, estimateZoom, estimateMotion, classifyMove, parabolaOffset } from "./motion.mjs";

const W = 96;
const H = 54;

/** Deterministic smooth texture: bilinear value noise over a coarse random grid, sampled at any real coordinate. */
function makeTexture(seed = 7, cell = 6) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const gw = 80;
  const gh = 60;
  const grid = Array.from({ length: gw * gh }, () => rnd() * 255);
  const g = (i, j) => grid[(((j % gh) + gh) % gh) * gw + (((i % gw) + gw) % gw)];
  return (x, y) => {
    const u = x / cell + 20;
    const v = y / cell + 20;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const top = g(i, j) * (1 - fu) + g(i + 1, j) * fu;
    const bot = g(i, j + 1) * (1 - fu) + g(i + 1, j + 1) * fu;
    return top * (1 - fv) + bot * fv;
  };
}

/** Render the texture with the CONTENT shifted by (sx, sy) and magnified by `scale` about the centre. */
function render(tex, { sx = 0, sy = 0, scale = 1, noise = 0, seed = 1 } = {}) {
  const out = new Uint8Array(W * H);
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  let s = seed >>> 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let v = tex(cx + (x - cx - sx) / scale, cy + (y - cy - sy) / scale);
      if (noise) {
        s = (s * 1664525 + 1013904223) >>> 0;
        v += (s / 2 ** 32 - 0.5) * 2 * noise;
      }
      out[y * W + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return out;
}

test("parabola vertex sits between the samples", () => {
  assert.equal(parabolaOffset(1, 0, 1), 0);
  assert.ok(parabolaOffset(2, 1, 1.5) > 0);
  assert.ok(parabolaOffset(1.5, 1, 2) < 0);
});

test("content shifted +3 px right reads as camera dx ≈ -3 (pan left)", () => {
  const tex = makeTexture();
  const a = render(tex);
  const b = render(tex, { sx: 3 });
  const s = estimateShift(a, b, W, H);
  assert.ok(Math.abs(s.sx - 3) < 0.25, `content sx ${s.sx}`);
  assert.ok(Math.abs(s.sy) < 0.25, `content sy ${s.sy}`);
  const m = estimateMotion([a, b], W, H);
  assert.ok(Math.abs(m.motion.dx + 3) < 0.25, `camera dx ${m.motion.dx}`);
});

test("sub-pixel shifts are recovered, not rounded away", () => {
  const tex = makeTexture(11);
  const a = render(tex);
  const b = render(tex, { sx: -1.4, sy: 0.6 });
  const s = estimateShift(a, b, W, H);
  assert.ok(Math.abs(s.sx + 1.4) < 0.3, `sx ${s.sx}`);
  assert.ok(Math.abs(s.sy - 0.6) < 0.3, `sy ${s.sy}`);
});

test("a 4% magnification reads as zoom ≈ +4", () => {
  const tex = makeTexture(3);
  const a = render(tex);
  const b = render(tex, { scale: 1.04 });
  const z = estimateZoom(a, b, W, H, { sx: 0, sy: 0 });
  assert.ok(Math.abs(z.scale - 1.04) < 0.006, `scale ${z.scale}`);
});

test("a steady slide of the picture to the LEFT is a pan RIGHT", () => {
  const tex = makeTexture(5);
  const frames = Array.from({ length: 6 }, (_, i) => render(tex, { sx: -1.5 * i }));
  const m = estimateMotion(frames, W, H);
  assert.ok(m.motion.dx > 6, `dx ${m.motion.dx}`);
  assert.equal(classifyMove(m), "pan-right");
});

test("the picture sliding DOWN is a tilt UP", () => {
  const tex = makeTexture(9);
  const frames = Array.from({ length: 6 }, (_, i) => render(tex, { sy: 1 * i }));
  const m = estimateMotion(frames, W, H);
  assert.ok(m.motion.dy < -4, `dy ${m.motion.dy}`);
  assert.equal(classifyMove(m), "tilt-up");
});

test("steady magnification is a push-in; shrinking is a pull-out", () => {
  const tex = makeTexture(13);
  const inFrames = Array.from({ length: 6 }, (_, i) => render(tex, { scale: 1.02 ** i }));
  const mi = estimateMotion(inFrames, W, H);
  assert.ok(mi.motion.zoom > 8, `zoom ${mi.motion.zoom}`);
  assert.equal(classifyMove(mi), "push-in");
  const outFrames = Array.from({ length: 6 }, (_, i) => render(tex, { scale: 1.1 / 1.02 ** i }));
  const mo = estimateMotion(outFrames, W, H);
  assert.ok(mo.motion.zoom < -8, `zoom ${mo.motion.zoom}`);
  assert.equal(classifyMove(mo), "pull-out");
});

test("a still picture with sensor noise is static", () => {
  const tex = makeTexture(17);
  const frames = Array.from({ length: 8 }, (_, i) => render(tex, { noise: 6, seed: i + 1 }));
  const m = estimateMotion(frames, W, H);
  assert.equal(classifyMove(m), "static");
  assert.ok(Math.abs(m.motion.dx) < 1 && Math.abs(m.motion.dy) < 1 && Math.abs(m.motion.zoom) < 1);
});

test("shifts that keep reversing with no net travel are handheld", () => {
  const tex = makeTexture(19);
  const offsets = [0, 2, -1, 2.5, -1.5, 2, -1, 1.5];
  const frames = offsets.map((o, i) => render(tex, { sx: o, sy: (i % 2 ? 0.8 : -0.6) }));
  const m = estimateMotion(frames, W, H);
  assert.equal(classifyMove(m), "handheld");
});

test("source-pixel scaling multiplies dx by srcWidth / w", () => {
  const tex = makeTexture(23);
  const m = estimateMotion([render(tex), render(tex, { sx: -2 })], W, H, { srcWidth: W * 8 });
  assert.ok(Math.abs(m.motion.dx - 16) < 2, `dx ${m.motion.dx}`);
});

test("no pairs → unknown, zero motion", () => {
  const m = estimateMotion([new Uint8Array(W * H)], W, H);
  assert.equal(classifyMove(m), "unknown");
  assert.deepEqual(m.motion, { dx: 0, dy: 0, rot: 0, zoom: 0, energy: 0 });
});
