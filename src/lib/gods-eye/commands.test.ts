import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands";

describe("parseCommand", () => {
  it("flies to a named place", () => {
    expect(parseCommand("Fly to Tokyo")).toEqual([{ type: "fly", place: "tokyo" }]);
    expect(parseCommand("take me to the Eiffel Tower")).toEqual([{ type: "fly", place: "eiffel tower" }]);
  });

  it("switches sensor styles", () => {
    expect(parseCommand("switch to night vision")).toEqual([{ type: "style", style: "nvg" }]);
    expect(parseCommand("thermal")).toEqual([{ type: "style", style: "flir" }]);
    expect(parseCommand("go to normal")).toEqual([{ type: "style", style: "normal" }]);
  });

  it("toggles layers, keeping military separate from flights", () => {
    expect(parseCommand("turn on military flights")).toEqual([{ type: "layer", layer: "military", on: true }]);
    expect(parseCommand("hide the satellites and earthquakes")).toEqual([
      { type: "layer", layer: "satellites", on: false },
      { type: "layer", layer: "quakes", on: false },
    ]);
  });

  it("tracks the ISS by any of its names", () => {
    expect(parseCommand("track the international space station")).toEqual([{ type: "track", query: "ISS" }]);
    expect(parseCommand("follow hubble")).toEqual([{ type: "track", query: "HST" }]);
  });

  it("resets, releases tracking and changes the HUD", () => {
    expect(parseCommand("reset globe")).toEqual([{ type: "reset" }]);
    expect(parseCommand("stop tracking")).toEqual([{ type: "untrack" }]);
    expect(parseCommand("clean view")).toEqual([{ type: "hud", mode: "clean" }]);
  });

  it("returns nothing for chatter", () => {
    expect(parseCommand("hello there")).toEqual([]);
  });
});
