import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveLocal } from "@/lib/sync/appState";
import { byRole, loadNotes, saveNotes, scannedTools, toolRows, TOOL_NOTES_KEY, type ToolRow } from "./toolUsage";

// The shared vitest environment is node and no other test in this repo touches
// storage, so rather than pull jsdom in for one file, stand up the only two
// things appState reaches for. Without a window, loadLocal returns its fallback
// and every assertion about the owner's layer would pass vacuously.
const store = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

beforeEach(() => store.clear());

describe("the committed scan", () => {
  it("carries call sites for every tool it lists", () => {
    const { tools } = scannedTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.sites.length).toBeGreaterThan(0);
      for (const s of t.sites) expect(s.line).toBeGreaterThan(0);
    }
  });

  it("does not read its own inventories back as call sites", () => {
    // status.ts names every env key, toolkit.ts seeds this very tab, and the
    // scanner's service table names them all. Counting those would make the
    // map agree with itself instead of with the code.
    const files = scannedTools().tools.flatMap((t) => t.sites.map((s) => s.file));
    expect(files).not.toContain("src/lib/ai/status.ts");
    expect(files).not.toContain("src/lib/jarvis/toolkit.ts");
    expect(files).not.toContain("scripts/scan-tools.mjs");
  });

  it("counts no test file as a place a tool is wired in", () => {
    const files = scannedTools().tools.flatMap((t) => t.sites.map((s) => s.file));
    expect(files.filter((f) => /\.(test|spec)\./.test(f))).toEqual([]);
  });

  it("only calls a folder an app when the catalog has that slug", () => {
    // "fno", "auth" and "server" are library folders, not products.
    const apps = new Set(scannedTools().tools.flatMap((t) => t.apps));
    for (const invented of ["fno", "auth", "server", "tts", "seed-content"]) {
      expect(apps.has(invented)).toBe(false);
    }
  });

  it("marks a tool global only when a hub-wide file calls it", () => {
    for (const t of scannedTools().tools) {
      if (t.reach !== "global") continue;
      expect(t.sites.some((s) => s.scope === "global")).toBe(true);
    }
  });
});

describe("the owner's layer", () => {
  it("survives a re-scan, because the two halves never share storage", () => {
    saveNotes({ notes: { "qwen/qwen3.8-omni-flash": { purpose: "Image", status: "trial" } } });
    const row = toolRows().find((r) => r.id === "qwen/qwen3.8-omni-flash");
    expect(row?.purpose).toBe("Image");
    // The scan is a static import; nothing the owner writes can reach it.
    const raw = scannedTools().tools as unknown as Record<string, unknown>[];
    expect(raw.some((t) => "purpose" in t || "note" in t || "status" in t)).toBe(false);
  });

  it("keeps a tool the owner wrote about after the code stops calling it", () => {
    saveNotes({ notes: { "openai/gpt-4-turbo": { note: "retired, kept as a reminder" } } });
    const row = toolRows().find((r) => r.id === "openai/gpt-4-turbo");
    expect(row).toBeDefined();
    // No call sites is the signal, not a reason to hide it.
    expect(row?.sites).toEqual([]);
  });

  it("pins two workflows doing the same job to different tools", () => {
    saveNotes({
      bindings: [
        { workflowId: "story-to-video", role: "image", toolId: "qwen/qwen3.8-omni-flash" },
        { workflowId: "product-hero", role: "image", toolId: "google/gemini-3.1-flash-image" },
      ],
    });
    const rows = toolRows();
    expect(rows.find((r) => r.id === "qwen/qwen3.8-omni-flash")?.workflows).toHaveLength(1);
    expect(rows.find((r) => r.id === "google/gemini-3.1-flash-image")?.workflows[0].workflowId).toBe("product-hero");
  });

  it("reads back an empty layer rather than throwing on junk", () => {
    // saveLocal so the value lands under the same per-user key scoping the
    // reader uses; writing the bare key would test nothing.
    saveLocal(TOOL_NOTES_KEY, { notes: null });
    expect(loadNotes().notes).toEqual({});
  });
});

describe("grouping by role", () => {
  const row = (id: string, job = "", purpose = ""): ToolRow => ({
    id, kind: id.includes("/") ? "model" : "service", url: null, reach: "single",
    apps: [], sites: [], job, purpose, note: "", status: undefined, workflows: [],
  });

  it("puts two models doing the same job side by side", () => {
    const groups = byRole([row("qwen/a", "Image"), row("google/b", "Image"), row("x/c", "Video")]);
    expect(groups[0].role).toBe("Image");
    expect(groups[0].tools.map((t) => t.id)).toEqual(["qwen/a", "google/b"]);
  });

  it("never groups on prose, which would give every tool its own heading", () => {
    // The migrated notes are sentences ("Fast rewriting and prompt polish").
    // Grouping on those produced a run of one-row sections — the exact opposite
    // of showing which models compete for the same job.
    const groups = byRole([
      row("anthropic/a", "", "Fast rewriting and prompt polish"),
      row("openai/b", "", "Main brain — coding, reasoning, every agent"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].role).toBe("Language");
  });

  it("falls back to reading the job off the id when nothing is written", () => {
    const groups = byRole([row("google/gemini-3.1-flash-image"), row("openai/text-embedding-3-small")]);
    expect(groups.map((g) => g.role).sort()).toEqual(["Embeddings", "Image"]);
  });
});
