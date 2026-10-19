import { describe, expect, it } from "vitest";
import { LIMITS, buildMap, neighbourhood, searchMap, type MapInputs } from "./build";

const input: MapInputs = {
  queue: [
    { id: "app:client-review", kind: "app", name: "Client Review", blurb: "Clients review their site", group: "Business", href: "/apps/client-review", state: "done" },
    { id: "app:ea-world", kind: "app", name: "EA World", blurb: "Trading bots", group: "Trading", href: "/apps/ea-world", state: "wip", note: "replay speed" },
    { id: "task:1", kind: "task", name: "Finish onboarding", blurb: "", group: "Priority", state: "wip" },
    { id: "skill:felix", kind: "skill", name: "felix", blurb: "", group: "Personal", state: "done" },
    { id: "flow:x", kind: "workflow", name: "A workflow", blurb: "", group: "Video workflow", state: "done" },
  ],
  skills: [
    { slug: "felix", title: "felix", overview: "End goal first", categories: ["Prompt Engineering", "Planning"], nicknames: ["be ambitious"], command: "/felix" },
    { slug: "ea-tester", title: "ea-tester", overview: "Backtests bots inside EA World", categories: ["Trading"], nicknames: [], command: "/ea-tester" },
  ],
  clients: [{ id: "c1", name: "Barber Shop", clientName: "Mike" }],
  crashes: [
    { id: "hub-1", site: "hub", message: "Cannot read items", count: 12, urls: ["/apps/ea-world"], lastSeen: "2026-10-18T10:00:00Z" },
    { id: "barber-1", site: "Barber Shop", message: "Form failed", count: 1, urls: [], lastSeen: "2026-10-18T11:00:00Z" },
    { id: "food-1", site: "food-truck", message: "Map failed", count: 2, urls: [], lastSeen: "2026-10-18T09:00:00Z" },
  ],
  memories: [
    { id: "m1", title: "Barber shop wants online booking", content: "Mike asked for booking on the Barber Shop site", source: "chat", capturedAt: "2026-10-17T00:00:00Z" },
    { id: "m2", title: "Likes tea", content: "drinks tea", source: "note", capturedAt: "2026-10-16T00:00:00Z" },
    { id: "m3", title: "skill row", content: "x", source: "skill", capturedAt: "2026-10-16T00:00:00Z" },
  ],
  notes: [
    { key: "a.md", title: "A", links: ["b.md"], kind: "note", strength: 0.5 },
    { key: "b.md", title: "B", links: [], kind: "note", strength: 0.2 },
    { key: "ghost:c", title: "C", links: [], kind: "ghost", strength: 0.2 },
  ],
};

const has = (g: ReturnType<typeof buildMap>, a: string, b: string) => g.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

describe("buildMap", () => {
  const g = buildMap(input);

  it("everything hangs off you through the hubs", () => {
    expect(has(g, "you", "hub:app")).toBe(true);
    expect(has(g, "you", "hub:skill")).toBe(true);
    expect(has(g, "you", "hub:crash")).toBe(true);
    // every node can reach "you"
    expect(neighbourhood(g, "you", 6).size).toBe(g.nodes.length);
  });

  it("clusters apps by category and skills by their categories", () => {
    expect(has(g, "app:ea-world", "group:app:trading")).toBe(true);
    expect(has(g, "skill:felix", "group:skill:prompt-engineering")).toBe(true);
    expect(has(g, "skill:felix", "group:skill:planning")).toBe(false);
    expect(g.nodes.find((n) => n.key === "app:ea-world")?.state).toBe("wip");
    expect(g.nodes.find((n) => n.key === "skill:felix")?.command).toBe("/felix");
  });

  it("wires crashes to the app or client they hit, making a client from an unknown site", () => {
    expect(has(g, "crash:hub-1", "app:ea-world")).toBe(true);
    expect(has(g, "crash:barber-1", "client:c1")).toBe(true);
    expect(g.nodes.some((n) => n.key === "client:food-truck" && n.type === "client")).toBe(true);
    expect(has(g, "crash:food-1", "client:food-truck")).toBe(true);
  });

  it("wires memories to what they mention, and only loose ones to the hub", () => {
    expect(has(g, "memory:m1", "client:c1")).toBe(true);
    expect(has(g, "memory:m1", "hub:memory")).toBe(false);
    expect(has(g, "memory:m2", "hub:memory")).toBe(true);
    expect(g.nodes.some((n) => n.key === "memory:m3")).toBe(false);
  });

  it("links a skill to the app it names", () => {
    expect(has(g, "skill:ea-tester", "app:ea-world")).toBe(true);
  });

  it("keeps vault notes and their links, drops ghosts and workflows", () => {
    expect(has(g, "note:a.md", "note:b.md")).toBe(true);
    expect(g.nodes.some((n) => n.key.includes("ghost"))).toBe(false);
    expect(g.nodes.some((n) => n.key.includes("flow:"))).toBe(false);
  });

  it("counts items by type", () => {
    expect(g.counts).toMatchObject({ app: 2, skill: 2, client: 2, crash: 3, task: 1, memory: 2, note: 2 });
  });

  it("stays under the node ceiling however much comes in", () => {
    const many = buildMap({ memories: Array.from({ length: 2000 }, (_, i) => ({ id: `m${i}`, title: `t${i}`, content: "c", source: "chat", capturedAt: `2026-10-${String((i % 28) + 1).padStart(2, "0")}` })) });
    expect(many.nodes.length).toBeLessThanOrEqual(LIMITS.total + 10);
    expect(many.counts.memory).toBe(LIMITS.memories);
  });
});

describe("search and neighbourhood", () => {
  const g = buildMap(input);
  it("finds by title, command and detail", () => {
    expect(searchMap(g, "/felix").has("skill:felix")).toBe(true);
    expect(searchMap(g, "booking").has("memory:m1")).toBe(true);
    expect(searchMap(g, "").size).toBe(0);
  });
  it("one hop around a client shows its crash and memory", () => {
    const n = neighbourhood(g, "client:c1");
    expect(n.has("crash:barber-1")).toBe(true);
    expect(n.has("memory:m1")).toBe(true);
  });
});
