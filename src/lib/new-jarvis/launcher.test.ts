import { describe, expect, it } from "vitest";
import { withDefaults } from "./launcher";

describe("default favorites", () => {
  it("stars Cook Connect for a brand-new account", () => {
    const d = withDefaults({ favorites: [], recent: [], seeded: [] });
    expect(d.favorites).toEqual(["cook-connect"]);
    expect(d.seeded).toEqual(["cook-connect"]);
  });

  it("adds it for an existing account without losing their stars or duplicating", () => {
    expect(withDefaults({ favorites: ["chess"], recent: [] }).favorites).toEqual(["cook-connect", "chess"]);
    expect(withDefaults({ favorites: ["cook-connect"], recent: [] }).favorites).toEqual(["cook-connect"]);
  });

  it("never re-adds a default the person unstarred", () => {
    const d = withDefaults({ favorites: [], recent: [], seeded: ["cook-connect"] });
    expect(d.favorites).toEqual([]);
  });
});
