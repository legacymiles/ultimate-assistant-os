import { describe, expect, it } from "vitest";
import {
  addFinding,
  addLog,
  agentDeleteRefusal,
  agentSource,
  buildRouters,
  dayKey,
  EMPTY_RULES,
  findingsBlock,
  findingsFor,
  findRouter,
  LOG_DAYS,
  normalizeRules,
  recentLog,
  routerIndex,
  vaultFiles,
  workflowKey,
} from "./rules";
import { MEMORY_SOURCES } from "@/lib/jarvis/types";

const NOW = Date.parse("2026-10-25T23:30:00Z");

describe("human vs machine", () => {
  it("never lets an agent save as the owner", () => {
    expect(agentSource("note", MEMORY_SOURCES)).toBe("chat");
    expect(agentSource("profile", MEMORY_SOURCES)).toBe("chat");
    expect(agentSource("vault", MEMORY_SOURCES)).toBe("chat");
    expect(agentSource("master-folder", MEMORY_SOURCES)).toBe("chat");
    expect(agentSource("made-up", MEMORY_SOURCES)).toBe("chat");
    expect(agentSource("email", MEMORY_SOURCES)).toBe("email");
  });
  it("refuses to delete owner-written memories", () => {
    expect(agentDeleteRefusal("note")).toMatch(/owner wrote by hand/);
    expect(agentDeleteRefusal("profile")).toMatch(/owner/);
    expect(agentDeleteRefusal("chat")).toBeNull();
  });
});

describe("daily log", () => {
  it("files by the writer's local day and drops exact repeats", () => {
    let { doc, added } = addLog(EMPTY_RULES, [{ text: "Built the memory map", by: "claude-code", at: "2026-10-25T23:00:00Z", timeZone: "America/Indianapolis" }], NOW);
    expect(added).toBe(1);
    expect(Object.keys(doc.log)).toEqual(["2026-10-25"]);
    ({ doc, added } = addLog(doc, [{ text: "Built the memory map", by: "claude-code", at: "2026-10-25T23:05:00Z", timeZone: "America/Indianapolis" }], NOW));
    expect(added).toBe(0);
    // Same instant in UTC lands on the next day.
    expect(dayKey("2026-10-26T01:00:00Z", "UTC")).toBe("2026-10-26");
    expect(dayKey("2026-10-26T01:00:00Z", "America/Indianapolis")).toBe("2026-10-25");
  });
  it("keeps only the last LOG_DAYS days", () => {
    const old = new Date(NOW - (LOG_DAYS + 3) * 86_400_000).toISOString();
    const { doc } = addLog(EMPTY_RULES, [{ text: "ancient", by: "a", at: old }, { text: "today", by: "a" }], NOW);
    expect(recentLog(doc).map((d) => d.entries[0].text)).toEqual(["today"]);
  });
  it("ignores empty lines and future clocks", () => {
    const { doc, added } = addLog(EMPTY_RULES, [{ text: "  ", by: "a" }, { text: "future", by: "a", at: "2099-01-01T00:00:00Z" }], NOW);
    expect(added).toBe(1);
    expect(recentLog(doc)[0].entries[0].at.startsWith("2026-10-25")).toBe(true);
  });
});

describe("findings", () => {
  it("treats film-3d and studio:film-3d as one workflow", () => {
    let doc = addFinding(EMPTY_RULES, { workflow: "studio:film-3d", text: "Night worlds read too dark on phones", by: "jarvis", kind: "miss" }, NOW).doc;
    doc = addFinding(doc, { workflow: "Film-3D", text: "A 3-beat opener keeps kids watching", by: "owner", kind: "win" }, NOW + 1000).doc;
    expect(findingsFor(doc, "film-3d")).toHaveLength(2);
    const block = findingsBlock(doc, "@film-3d");
    expect(block.split("\n")[1]).toMatch(/^- Avoid: Night worlds/);
    expect(block).toMatch(/Worked: A 3-beat opener/);
  });
  it("does not add the same finding twice", () => {
    const one = addFinding(EMPTY_RULES, { workflow: "felix", text: "Ask the end goal first", by: "a" }, NOW).doc;
    expect(addFinding(one, { workflow: "felix", text: "ask the end goal FIRST", by: "b" }, NOW).added).toBe(false);
  });
  it("rejects junk workflow names", () => {
    expect(workflowKey("../../etc")).toBe("");
    expect(addFinding(EMPTY_RULES, { workflow: "", text: "x", by: "a" }).added).toBe(false);
  });
});

describe("routers", () => {
  const routers = buildRouters({
    apps: [
      { slug: "cook-connect", title: "Cook Connect", category: "Apps", overview: "Recipes and spades" },
      { slug: "film-3d", title: "3D Animation Flow", category: "Video" },
    ],
    skills: [{ slug: "felix", title: "Felix", categories: ["Planning"], command: "/felix" }],
    clients: [{ id: "c1", name: "Beta Bakery", clientName: "Sam" }],
    memories: [
      { id: "m1", title: "Newest first, always", content: "", source: "note" },
      { id: "m2", title: "Said in chat", content: "", source: "chat" },
    ],
    workflowsWithFindings: ["studio:film-3d"],
  });
  it("makes one area per category and keeps owner notes separate", () => {
    expect(routers.map((r) => r.key)).toEqual(["apps/apps", "apps/video", "clients", "findings", "owner-notes", "skills/planning"]);
    expect(findRouter(routers, "owner-notes")!.items).toHaveLength(1);
  });
  it("finds an area by a loose name", () => {
    expect(findRouter(routers, "video")?.key).toBe("apps/video");
    expect(findRouter(routers, "Client")?.key).toBe("clients");
    expect(findRouter(routers, "nope")).toBeNull();
  });
  it("indexes every area and writes a vault copy", () => {
    expect(routerIndex(routers)).toMatch(/`skills\/planning`/);
    const doc = addLog(EMPTY_RULES, [{ text: "hello", by: "jarvis" }], NOW).doc;
    const files = vaultFiles(doc, routers);
    expect(Object.keys(files)).toContain("AGENTS.md");
    expect(Object.keys(files)).toContain("areas/apps--video.md");
    expect(Object.keys(files)).toContain("log/2026-10-25.md");
  });
});

describe("normalize", () => {
  it("drops malformed days and keys", () => {
    const n = normalizeRules({ log: { nope: [{ text: "x" }], "2026-10-01": [{ text: "ok", by: "a", at: "2026-10-01T00:00:00Z" }, { text: "" }] }, findings: { "BAD KEY!!": [{ text: "x" }] } });
    expect(Object.keys(n.log)).toEqual(["2026-10-01"]);
    expect(n.log["2026-10-01"]).toHaveLength(1);
    expect(n.findings).toEqual({});
  });
});
