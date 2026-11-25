import { describe, expect, it } from "vitest";
import type { Folder, Item } from "./types";
import { allFolderPaths, buildOutline, foldersNamedIn, resolveDestination, retrieveContext, stem } from "./rag";
import { buildAgentPrompt, parseAgentJson } from "./agentPrompt";

const folders = [
  { id: "f_tr", name: "Trading", parentId: null },
  { id: "f_gold", name: "Gold Strategies", parentId: "f_tr" },
  { id: "f_deep", name: "London Open", parentId: "f_gold" },
  { id: "f_ai", name: "AI Development", parentId: null },
  { id: "f_rank", name: "AI Rankings", parentId: null },
] as unknown as Folder[];

const item = (id: string, title: string, folderId: string | null, body = "", createdAt = "2026-11-01T00:00:00Z", kind = "note") =>
  ({ id, title, folderId, body, summary: "", tags: [], kind, createdAt }) as unknown as Item;

const items = [
  item("i1", "XAU London-open breakout", "f_deep", "Buy the break of the Asian range high on gold."),
  item("i2", "Video generator notes", "f_ai", "WanGP + MiniMax H3 pipeline", "2026-11-05T00:00:00Z"),
  item("i3", "Immich setup", "f_ai", "docker compose for immich", "2026-11-03T00:00:00Z"),
  item("i4", "Broker login", "f_tr", "user/pass", "2026-11-06T00:00:00Z", "credential"),
];

describe("stem", () => {
  it("folds simple plurals", () => {
    expect(stem("strategies")).toBe("strategy");
    expect(stem("notes")).toBe("note");
    expect(stem("glass")).toBe("glass");
  });
});

describe("foldersNamedIn", () => {
  it("matches a multi-word folder only when every word is named", () => {
    expect(foldersNamedIn("Summarise what I have stored in my AI development folder", folders).map((f) => f.id)).toEqual(["f_ai"]);
  });
  it("matches through plurals", () => {
    expect(foldersNamedIn("where is my gold strategy", folders).map((f) => f.id)).toContain("f_gold");
  });
});

describe("retrieveContext", () => {
  it("pulls items from nested subfolders of a named folder", () => {
    const hits = retrieveContext("what's in my Gold Strategies folder", { items, folders }).map((i) => i.id);
    expect(hits[0]).toBe("i1"); // two levels down, no keyword in common with the question
  });
  it("never returns credentials", () => {
    const hits = retrieveContext("broker login trading", { items, folders }).map((i) => i.id);
    expect(hits).not.toContain("i4");
  });
  it("scopes a folder summary to that folder first", () => {
    const hits = retrieveContext("summarise my AI development folder", { items, folders }).map((i) => i.id);
    expect(hits.slice(0, 2).sort()).toEqual(["i2", "i3"]);
  });
});

describe("buildOutline", () => {
  it("lists every shareable item with its full nested path, skipping the shortlist", () => {
    const { entries } = buildOutline({ items, folders }, { skip: new Set(["i2"]) });
    expect(entries.map((e) => e.id).sort()).toEqual(["i1", "i3"]);
    expect(entries.find((e) => e.id === "i1")?.path).toContain("London Open");
  });
  it("caps by characters and reports what it left out", () => {
    const { entries, omitted } = buildOutline({ items, folders }, { maxChars: 60 });
    expect(entries.length + omitted).toBe(3);
    expect(omitted).toBeGreaterThan(0);
  });
});

describe("resolveDestination", () => {
  it("walks existing folders case-insensitively", () => {
    const steps = resolveDestination(["trading", "gold strategies"], folders);
    expect(steps.map((s) => [s.name, s.exists])).toEqual([
      ["Trading", true],
      ["Gold Strategies", true],
    ]);
  });
  it("marks every step after the first missing one as new", () => {
    const steps = resolveDestination(["Trading", "Silver", "London Open"], folders);
    expect(steps.map((s) => s.exists)).toEqual([true, false, false]);
  });
});

describe("allFolderPaths", () => {
  it("gives root-first paths for nested folders", () => {
    expect(allFolderPaths(folders)).toContainEqual(["Trading", "Gold Strategies", "London Open"]);
  });
});

describe("agent prompt", () => {
  it("carries the outline, history and the confirm-before-saving rule", () => {
    const { system, user } = buildAgentPrompt({
      question: "save this in Trading > Gold Strategies",
      outline: [{ id: "i1", title: "XAU breakout", path: "Trading › Gold Strategies", kind: "note", gist: "" }],
      history: [{ role: "user", content: "earlier question" }],
    });
    expect(system).toMatch(/NOTHING IS SAVED until the owner presses Save/);
    expect(user).toContain("[i1] XAU breakout — Trading › Gold Strategies");
    expect(user).toContain("OWNER: earlier question");
  });
  it("parses a fenced JSON reply", () => {
    const p = parseAgentJson('```json\n{"answer":"Saved in X","citations":["i1"],"actions":[],"read":["i2"]}\n```');
    expect(p).toEqual({ answer: "Saved in X", citations: ["i1"], actions: [], read: ["i2"] });
  });
  it("returns null for prose", () => {
    expect(parseAgentJson("I think so.")).toBeNull();
  });
});
