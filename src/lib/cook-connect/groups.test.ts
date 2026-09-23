import { describe, it, expect } from "vitest";
import { hueFor, loadGroups } from "./groups";

/** The slice of the backend loadGroups uses, over fixed rows. */
function stubBackend(groups: unknown[], members: unknown[]) {
  const table = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain;
    q.eq = chain;
    q.order = chain;
    q.then = (resolve: (v: { data: unknown[] }) => unknown) => Promise.resolve(resolve({ data: rows }));
    return q;
  };
  return { from: (name: string) => table(name === "groups" ? groups : members) };
}

const group = (id: string, createdAt: string) => ({
  id, name: id, description: null, hue: 24, created_by: "owner", is_active: true, created_at: createdAt,
});
const member = (groupId: string, userId: string) => ({
  id: `${groupId}-${userId}`, group_id: groupId, user_id: userId, joined_at: "",
});

describe("loadGroups", () => {
  it("counts the members of each group", async () => {
    const rows = await loadGroups(
      stubBackend(
        [group("a", "2026-01-01"), group("b", "2026-01-02")],
        [member("a", "x"), member("a", "y"), member("b", "x")],
      ),
      null,
    );
    expect(rows.find((r) => r.id === "a")?.members).toBe(2);
    expect(rows.find((r) => r.id === "b")?.members).toBe(1);
  });

  it("marks the groups this user is in", async () => {
    const rows = await loadGroups(
      stubBackend([group("a", "2026-01-01"), group("b", "2026-01-02")], [member("a", "me")]),
      "me",
    );
    expect(rows.find((r) => r.id === "a")?.joined).toBe(true);
    expect(rows.find((r) => r.id === "b")?.joined).toBe(false);
  });

  it("marks nothing as joined for a signed-out reader", async () => {
    const rows = await loadGroups(stubBackend([group("a", "2026-01-01")], [member("a", "someone")]), null);
    expect(rows[0].joined).toBe(false);
    expect(rows[0].members).toBe(1);
  });

  it("puts the busiest group first", async () => {
    const rows = await loadGroups(
      stubBackend(
        [group("quiet", "2026-01-03"), group("busy", "2026-01-01")],
        [member("busy", "x"), member("busy", "y"), member("quiet", "z")],
      ),
      null,
    );
    expect(rows.map((r) => r.id)).toEqual(["busy", "quiet"]);
  });

  it("breaks a tie on the newer group, so an empty new one is not buried", async () => {
    const rows = await loadGroups(
      stubBackend([group("older", "2026-01-01"), group("newer", "2026-02-01")], []),
      null,
    );
    expect(rows.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("reports a group nobody has joined as empty rather than dropping it", async () => {
    const rows = await loadGroups(stubBackend([group("lonely", "2026-01-01")], []), null);
    expect(rows).toHaveLength(1);
    expect(rows[0].members).toBe(0);
  });
});

describe("hueFor", () => {
  it("gives the same name the same colour every time", () => {
    expect(hueFor("Sunday Bakers")).toBe(hueFor("Sunday Bakers"));
  });

  it("stays inside the hue circle", () => {
    for (const name of ["a", "Baking", "Spice Heads", "", "a very long group name indeed"]) {
      const h = hueFor(name);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("separates different names", () => {
    expect(hueFor("Baking")).not.toBe(hueFor("Vegetarian"));
  });
});
