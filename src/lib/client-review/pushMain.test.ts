import { describe, expect, it } from "vitest";
import { shipItems } from "./pushMain";
import type { ClientProject } from "./types";

/** A project with just the fields the selector reads — the rest is irrelevant here. */
function project(extra: Partial<ClientProject> = {}): ClientProject {
  return {
    id: "crp_1",
    token: "t",
    name: "Money Agent Studio",
    clientName: "",
    lane: "auto",
    versions: [],
    requests: [],
    batches: [],
    settings: { notify: false },
    pushSubs: [],
    notices: [],
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
    ...extra,
  };
}

const version = (id: string, number: string, status: "building" | "review") => ({
  id,
  number,
  siteUrl: "",
  summary: "",
  status,
  createdAt: "2026-11-08T00:00:00.000Z",
});

const batch = (nextVersionId: string, build?: { builderId: string; threadId?: string; queueId?: string }) => ({
  id: `bat_${nextVersionId}`,
  versionId: "ver_1",
  requestIds: [],
  sentAt: "2026-11-08T00:00:00.000Z",
  status: "approved" as const,
  nextVersionId,
  ...(build ? { build: { at: "2026-11-08T00:00:00.000Z", ...build } } : {}),
});

describe("what is waiting to be pushed", () => {
  it("lists a building version that has a build, with its thread", () => {
    const p = project({
      appSlug: "money-agent-studio",
      appPath: "/apps/money-agent-studio",
      versions: [version("ver_2", "v2", "building")],
      batches: [batch("ver_2", { builderId: "ab_1", threadId: "th_1" })],
    });
    expect(shipItems([p])).toEqual([
      {
        projectId: "crp_1",
        name: "Money Agent Studio",
        appSlug: "money-agent-studio",
        appPath: "/apps/money-agent-studio",
        versionId: "ver_2",
        version: "v2",
        threadId: "th_1",
      },
    ]);
  });

  it("still lists one filed in In Queue, flagged with its queue id", () => {
    const p = project({
      versions: [version("ver_2", "v2", "building")],
      batches: [batch("ver_2", { builderId: "ab_1", queueId: "q-123" })],
    });
    expect(shipItems([p])[0]).toMatchObject({ versionId: "ver_2", queueId: "q-123" });
  });

  it("ignores a version that is live, archived, or has no build at all", () => {
    const live = project({ versions: [version("ver_2", "v2", "review")], batches: [batch("ver_2", { builderId: "ab_1", threadId: "th" })] });
    const archived = project({ archived: true, versions: [version("ver_3", "v3", "building")], batches: [batch("ver_3", { builderId: "ab_2", threadId: "th2" })] });
    const unbuilt = project({ versions: [version("ver_4", "v4", "building")], batches: [batch("ver_4")] });
    expect(shipItems([live, archived, unbuilt])).toEqual([]);
  });

  it("sorts by name, then version", () => {
    const a = project({ id: "a", name: "Alpha", versions: [version("va", "v2", "building")], batches: [batch("va", { builderId: "x", threadId: "t" })] });
    const b = project({ id: "b", name: "Beta", versions: [version("vb", "v2", "building")], batches: [batch("vb", { builderId: "y", threadId: "t" })] });
    expect(shipItems([b, a]).map((i) => i.name)).toEqual(["Alpha", "Beta"]);
  });
});
