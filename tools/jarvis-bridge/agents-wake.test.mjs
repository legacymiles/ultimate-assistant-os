import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { agentIdFrom, findConnector } from "./agents-wake.mjs";

describe("telling a brief from an empty answer", () => {
  it("reads the id out of a real brief", () => {
    const brief = "You have picked up 24/7 agent a-fr6lrf. You hold it for the next 20 minutes.\n\nGOAL: Draw the heroes";
    expect(agentIdFrom(brief)).toBe("a-fr6lrf");
  });

  it("finds nothing in the 'nothing waiting' answer", () => {
    // This is the whole check that stops the runner starting a model session
    // for no reason, so it is worth pinning both halves.
    expect(agentIdFrom("No 24/7 agents are waiting.\nThis machine reported: pinokio, shell.")).toBe("");
    expect(agentIdFrom("2 waiting, but this machine hasn't got Blender.")).toBe("");
  });

  it("is not fooled by an agent id mentioned in passing", () => {
    expect(agentIdFrom("Noted on a-fr6lrf.")).toBe("");
    expect(agentIdFrom("Filed 24/7 agent a-abc123. It will be picked up.")).toBe("");
  });

  it("survives junk", () => {
    expect(agentIdFrom("")).toBe("");
    expect(agentIdFrom(null)).toBe("");
    expect(agentIdFrom(undefined)).toBe("");
  });
});

describe("finding the connector this machine already has", () => {
  const write = (name, obj) => {
    const dir = mkdtempSync(path.join(tmpdir(), "agents-wake-"));
    const file = path.join(dir, name);
    writeFileSync(file, typeof obj === "string" ? obj : JSON.stringify(obj));
    return file;
  };

  it("reads a Bearer header out of a nested config", () => {
    const file = write("claude.json", {
      projects: {
        "C:/somewhere": {
          mcpServers: {
            "jarvis-memory": {
              type: "http",
              url: "https://hub.example.com/api/jarvis/memory/mcp",
              headers: { Authorization: "Bearer tok-123" },
            },
          },
        },
      },
    });
    expect(findConnector([file])).toEqual({ token: "tok-123", hub: "https://hub.example.com" });
  });

  it("falls back to a token in the query string, which is how claude.ai stores it", () => {
    const file = write("claude.json", {
      mcpServers: { m: { url: "https://hub.example.com/api/jarvis/memory/mcp?k=tok-xyz" } },
    });
    expect(findConnector([file])?.token).toBe("tok-xyz");
  });

  it("ignores an MCP server that is not this hub's memory", () => {
    const file = write("claude.json", {
      mcpServers: { other: { url: "https://elsewhere.com/api/thing", headers: { Authorization: "Bearer nope" } } },
    });
    expect(findConnector([file])).toBeNull();
  });

  it("ignores a memory server with no token at all", () => {
    const file = write("claude.json", { mcpServers: { m: { url: "https://hub.example.com/api/jarvis/memory/mcp" } } });
    expect(findConnector([file])).toBeNull();
  });

  it("returns null rather than throwing on unreadable or missing files", () => {
    expect(findConnector(["C:/definitely/not/here.json"])).toBeNull();
    expect(findConnector([write("broken.json", "{not json")])).toBeNull();
    expect(findConnector([])).toBeNull();
  });
});
