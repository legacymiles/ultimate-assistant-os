import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientProject, ReviewIndex } from "./types";

vi.mock("server-only", () => ({}));

const pushed: { title: string; url: string }[] = [];
vi.mock("./push", () => ({
  pushToClient: async (_p: unknown, msg: { title: string; url: string }) => {
    pushed.push(msg);
    return { gone: [] };
  },
}));

// The real store is Supabase or .data files; an in-memory one keeps this a unit test.
const docs = new Map<string, ClientProject>();
let index: ReviewIndex = { projects: [], events: [] };
vi.mock("./store", () => ({
  readProject: async (id: string) => structuredClone(docs.get(id) ?? null),
  writeProject: async (p: ClientProject) => void docs.set(p.id, structuredClone(p)),
  updateProject: async (id: string, fn: (p: ClientProject) => { project: ClientProject; result: unknown }) => {
    const cur = docs.get(id);
    if (!cur) throw new Error("missing");
    const out = await fn(structuredClone(cur));
    docs.set(id, structuredClone(out.project));
    return out;
  },
  updateIndex: async (fn: (i: ReviewIndex) => ReviewIndex) => (index = fn(index)),
}));

const { addRequest, approveBatch, createProject, sendToJarvis } = await import("./logic");
const { shipPreviewNow } = await import("./ship");

function seed() {
  let p = createProject({ name: "Glow Spa", clientName: "Dana", siteUrl: "glowspa.vercel.app", repo: "a/glow" });
  p = addRequest(p, { versionId: p.versions[0].id, text: "Bigger logo" }).project;
  const sent = sendToJarvis(p, p.versions[0].id);
  const out = approveBatch(sent.project, { batchId: sent.batch.id });
  docs.set(out.project.id, out.project);
  return out;
}

describe("client_review_preview — the connector posting a finished build", () => {
  beforeEach(() => {
    docs.clear();
    pushed.length = 0;
    index = { projects: [], events: [] };
  });

  it("puts the preview on the client's link, notifies them and tells the owner", async () => {
    const { project, version } = seed();
    const out = await shipPreviewNow(
      { reviewId: project.id, versionId: version.id, siteUrl: "https://glow-git-jarvis.vercel.app", prUrl: "https://github.com/a/glow/pull/2" },
      "https://hub.example",
    );
    expect(out.already).toBe(false);
    expect(docs.get(project.id)?.versions.find((v) => v.id === version.id)).toMatchObject({
      status: "review",
      siteUrl: "https://glow-git-jarvis.vercel.app/",
      prUrl: "https://github.com/a/glow/pull/2",
    });
    expect(pushed).toEqual([expect.objectContaining({ title: "v2 is ready", url: `https://hub.example/apps/client-review?site=${project.token}` })]);
    expect(index.events.at(-1)).toMatchObject({ kind: "preview_sent", projectId: project.id });
    expect(index.projects[0].id).toBe(project.id);
  });

  it("doesn't notify twice when the tool is retried", async () => {
    const { project, version } = seed();
    const input = { reviewId: project.id, versionId: version.id, siteUrl: "https://glow-git-jarvis.vercel.app/" };
    await shipPreviewNow(input, "https://hub.example");
    const again = await shipPreviewNow(input, "https://hub.example");
    expect(again.already).toBe(true);
    expect(pushed).toHaveLength(1);
    expect(index.events).toHaveLength(1);
  });

  it("explains a wrong id instead of failing silently", async () => {
    await expect(shipPreviewNow({ reviewId: "crp_nope", versionId: "x", siteUrl: "https://a.vercel.app" }, "")).rejects.toThrow(
      /No Client Review project/,
    );
    await expect(shipPreviewNow({ reviewId: "", versionId: "x", siteUrl: "https://a.vercel.app" }, "")).rejects.toThrow(/review_id/);
  });
});
