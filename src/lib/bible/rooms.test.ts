import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM, ROOMS, isRoom, roomDef } from "./rooms";

describe("rooms", () => {
  it("accepts the four room ids and nothing else", () => {
    expect(isRoom("plans")).toBe(true);
    expect(isRoom("scout")).toBe(true);
    expect(isRoom("plays")).toBe(true);
    expect(isRoom("funding")).toBe(true);
    expect(isRoom("nonsense")).toBe(false);
    expect(isRoom(undefined)).toBe(false);
    expect(isRoom(null)).toBe(false);
  });

  it("lands in Build Plans by default", () => {
    expect(DEFAULT_ROOM).toBe("plans");
  });

  // The rail must be honest about what is not built. A room with `built: false`
  // renders a panel saying so; a dead link would be worse than no link.
  it("has Build Plans and Funding built, and the rest say what they will hold", () => {
    expect(ROOMS.filter((r) => r.built).map((r) => r.id)).toEqual(["plans", "funding"]);
    for (const room of ROOMS.filter((r) => !r.built)) {
      expect(room.blurb.length).toBeGreaterThan(40);
    }
  });

  it("falls back to the first room rather than returning undefined", () => {
    expect(roomDef("plans").id).toBe("plans");
    // @ts-expect-error deliberately wrong, because a URL can say anything
    expect(roomDef("nope").id).toBe(ROOMS[0].id);
  });
});
