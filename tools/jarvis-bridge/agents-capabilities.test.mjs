import { describe, expect, it } from "vitest";

import { describeFound, findBlender, findUnreal, firstExisting, needsFrom } from "./agents-capabilities.mjs";

// A machine that overstates what it has is worse than one that is missing:
// it claims the agent, fails, and the work sits still while the owner is told
// nothing is waiting.

describe("turning what was found into what the hub understands", () => {
  it("always offers a terminal", () => {
    expect(needsFrom({})).toEqual(["shell"]);
  });

  it("reports each tool that was actually found", () => {
    const have = needsFrom({ pinokio: true, ffmpeg: true });
    expect(have).toContain("pinokio");
    expect(have).toContain("ffmpeg");
    expect(have).not.toContain("blender");
  });

  it("does not claim a bare GPU when a tool already implies one", () => {
    // The hub treats a GPU tool as proof of a card, so saying both is noise.
    expect(needsFrom({ pinokio: true, gpu: true })).not.toContain("gpu");
  });

  it("claims the card on its own when there is one and no tool for it", () => {
    expect(needsFrom({ gpu: true })).toContain("gpu");
  });

  it("never claims a tool it did not find", () => {
    const have = needsFrom({ pinokio: false, blender: false, unreal: false, ffmpeg: false, gpu: false });
    expect(have).toEqual(["shell"]);
  });
});

describe("finding installs that are not on PATH", () => {
  const exists = (p) => [
    "C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe",
    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe",
    "C:/Program Files/Blender Foundation/Blender 4.1/blender.exe",
  ].includes(p);

  it("finds Unreal under its version folder", () => {
    const ls = () => ["Launcher", "DirectXRedist", "UE_5.8"];
    expect(findUnreal(["C:/Program Files/Epic Games"], ls, exists)).toContain("UE_5.8");
  });

  it("is not fooled by the launcher alone", () => {
    const ls = () => ["Launcher", "DirectXRedist"];
    expect(findUnreal(["C:/Program Files/Epic Games"], ls, exists)).toBe("");
  });

  it("picks the newest Blender when several are installed", () => {
    const ls = () => ["Blender 4.1", "Blender 5.2"];
    expect(findBlender(["C:/Program Files/Blender Foundation"], ls, exists)).toContain("5.2");
  });

  it("survives a folder that is not there", () => {
    const ls = () => {
      throw new Error("ENOENT");
    };
    expect(findUnreal(["C:/nope"], ls, exists)).toBe("");
    expect(findBlender(["C:/nope"], ls, exists)).toBe("");
  });
});

describe("small helpers", () => {
  it("takes the first path that exists", () => {
    expect(firstExisting(["a", "b", "c"], (p) => p === "b")).toBe("b");
    expect(firstExisting(["a"], () => false)).toBe("");
  });

  it("says plainly when a machine has nothing heavy", () => {
    expect(describeFound({ pinokio: false, gpu: false })).toContain("only a terminal");
  });

  it("lists what it did find", () => {
    expect(describeFound({ pinokio: true, ffmpeg: true, gpu: false })).toBe("pinokio, ffmpeg");
  });
});
