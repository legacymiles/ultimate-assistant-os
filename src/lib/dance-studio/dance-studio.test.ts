import { describe, expect, it } from "vitest";

import { composeMotionPrompt } from "./h3prompt";
import { aspectFor, estimateCostUsd, outputSeconds, prepReason } from "./limits";
import { readMp4Info } from "./mp4";

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function mvhd(timescale: number, duration: number): Uint8Array {
  const p = new Uint8Array(100);
  const dv = new DataView(p.buffer);
  dv.setUint32(12, timescale);
  dv.setUint32(16, duration);
  return box("mvhd", p);
}

function tkhd(width: number, height: number, rotated = false): Uint8Array {
  const p = new Uint8Array(84);
  const dv = new DataView(p.buffer);
  if (rotated) {
    dv.setInt32(44, 65536);
    dv.setInt32(52, -65536);
  } else {
    dv.setInt32(40, 65536);
    dv.setInt32(56, 65536);
  }
  dv.setUint32(76, width * 65536);
  dv.setUint32(80, height * 65536);
  return box("tkhd", p);
}

function mp4(...traks: Uint8Array[]): Uint8Array {
  return concat(
    box("ftyp", new Uint8Array(8)),
    box("moov", concat(mvhd(1000, 12500), ...traks.map((t) => box("trak", t)))),
  );
}

describe("readMp4Info", () => {
  it("reads duration and size", () => {
    const info = readMp4Info(mp4(tkhd(0, 0), tkhd(1080, 1920)));
    expect(info).toEqual({ isMp4: true, durationSec: 12.5, width: 1080, height: 1920 });
  });

  it("applies a sideways phone rotation", () => {
    const info = readMp4Info(mp4(tkhd(1920, 1080, true)));
    expect([info.width, info.height]).toEqual([1080, 1920]);
  });

  it("rejects something that isn't an mp4", () => {
    expect(readMp4Info(new TextEncoder().encode("<html>login required</html>")).isMp4).toBe(false);
  });
});

describe("limits", () => {
  it("follows the clip's framing", () => {
    expect(aspectFor(1080, 1920)).toBe("9:16");
    expect(aspectFor(1920, 1080)).toBe("16:9");
    expect(aspectFor(1000, 1000)).toBe("1:1");
  });

  it("keeps output inside what H3 renders", () => {
    expect(outputSeconds(2.4)).toBe(4);
    expect(outputSeconds(9.6)).toBe(10);
    expect(outputSeconds(15.2)).toBe(15);
  });

  it("says why a clip needs preparing", () => {
    expect(prepReason({ durationSec: 42, contentType: "video/mp4" })).toMatch(/pick the part/);
    expect(prepReason({ durationSec: 9, contentType: "video/quicktime" })).toMatch(/converted/);
    expect(prepReason({ durationSec: 9, contentType: "video/mp4", sizeBytes: 80e6 })).toMatch(/50 MB/);
    expect(prepReason({ durationSec: 9, contentType: "video/mp4", sizeBytes: 8e6 })).toBeNull();
  });

  it("estimates cost from the provider's price card", () => {
    const pricing = { outputPerSec: { "768p": 0.04, "2k": 0.065 }, referenceVideoPerSec: 0.065, perImage: 0.02 };
    expect(estimateCostUsd(pricing, { resolution: "768p", durationSec: 10 }, 10, 1)).toBe(1.07);
  });
});

describe("composeMotionPrompt", () => {
  it("separates motion from identity", () => {
    const text = composeMotionPrompt({ characterName: "Pixel", description: "blue robot", imageCount: 2 });
    expect(text).toContain("Video 1 is the motion reference");
    expect(text).toContain("Images 1 to 2 are the character reference for Pixel");
    expect(text).toContain("Do not take the dancer's face");
    expect(text).toContain("(blue robot)");
    expect(text).toContain("Keep the setting");
  });

  it("uses the user's direction when given", () => {
    const text = composeMotionPrompt({ characterName: "Pixel", imageCount: 1, userPrompt: "on a neon rooftop" });
    expect(text).toContain("Image 1 is the character reference");
    expect(text).toContain("Additional direction: on a neon rooftop");
    expect(text).not.toContain("Keep the setting");
  });
});
