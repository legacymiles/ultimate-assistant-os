import { describe, expect, it } from "vitest";
import {
  addRequest,
  addVersion,
  approveBatch,
  cleanUrl,
  createProject,
  currentVersion,
  deleteDraft,
  editDraft,
  isToken,
  markVersionReady,
  nextVersionNumber,
  portalView,
  rejectBatch,
  reviewRequest,
  sendToJarvis,
  ReviewError,
} from "./logic";
import { isPolicyFailure, lanePlan, looksLikeRefusal } from "./routing";

const T = "2026-10-18T12:00:00.000Z";

function fresh() {
  return createProject({ name: "Glow Spa", clientName: "Dana", siteUrl: "glowspa.vercel.app" }, T);
}

describe("client review flow", () => {
  it("creates v1 live with a private token", () => {
    const p = fresh();
    expect(p.versions).toHaveLength(1);
    expect(p.versions[0]).toMatchObject({ number: "v1", status: "review", siteUrl: "https://glowspa.vercel.app/" });
    expect(isToken(p.token)).toBe(true);
    expect(currentVersion(p)?.number).toBe("v1");
  });

  it("drafts, edits, deletes, then sends a batch", () => {
    let p = fresh();
    const v1 = p.versions[0].id;
    const a = addRequest(p, { versionId: v1, text: "Bigger logo", pin: { x: 0.1, y: 0.05, viewport: 390 } }, T);
    p = a.project;
    p = addRequest(p, { versionId: v1, text: "Pink buttons" }, T).project;
    p = addRequest(p, { versionId: v1, text: "typo" }, T).project;
    p = editDraft(p, { id: a.request.id, text: "Much bigger logo" }, T);
    p = deleteDraft(p, p.requests[2].id, T);
    expect(p.requests.map((r) => r.text)).toEqual(["Much bigger logo", "Pink buttons"]);
    expect(p.requests[0].pin).toEqual({ x: 0.1, y: 0.05, viewport: 390 });

    const sent = sendToJarvis(p, v1, T);
    expect(sent.batch.requestIds).toHaveLength(2);
    expect(sent.project.requests.every((r) => r.status === "sent")).toBe(true);
    // Sent requests are the owner's now.
    expect(() => editDraft(sent.project, { id: a.request.id, text: "x" })).toThrow(ReviewError);
  });

  it("refuses to send nothing", () => {
    const p = fresh();
    expect(() => sendToJarvis(p, p.versions[0].id)).toThrow(/at least one/);
  });

  it("approval opens v2 building, closes v1, and keeps v1 on screen", () => {
    let p = fresh();
    const v1 = p.versions[0].id;
    p = addRequest(p, { versionId: v1, text: "A" }, T).project;
    p = addRequest(p, { versionId: v1, text: "B" }, T).project;
    const { project: sent, batch } = sendToJarvis(p, v1, T);
    let q = reviewRequest(sent, { id: sent.requests[1].id, status: "rejected", adminNote: "Not this round" }, T);
    q = reviewRequest(q, { id: q.requests[0].id, adminText: "A, but in brand pink" }, T);
    const out = approveBatch(q, { batchId: batch.id }, T);
    expect(out.version).toMatchObject({ number: "v2", status: "building", siteUrl: "" });
    expect(out.approved.map((r) => r.id)).toEqual([q.requests[0].id]);
    expect(out.project.batches[0]).toMatchObject({ status: "approved", nextVersionId: out.version.id });
    expect(currentVersion(out.project)?.number).toBe("v1");
    // v1 is closed for new requests.
    expect(() => addRequest(out.project, { versionId: v1, text: "C" })).toThrow(/closed/);
    expect(out.project.notices.at(-1)?.title).toMatch(/building v2/);

    const ready = markVersionReady(out.project, { versionId: out.version.id, siteUrl: "https://v2.glowspa.app" }, T);
    expect(currentVersion(ready.project)?.number).toBe("v2");
    expect(ready.project.requests.find((r) => r.id === q.requests[0].id)?.status).toBe("done");
    expect(ready.project.requests.find((r) => r.id === q.requests[1].id)?.status).toBe("rejected");
    expect(nextVersionNumber(ready.project.versions)).toBe("v3");
  });

  it("a batch with every request rejected can't be approved", () => {
    let p = fresh();
    const v1 = p.versions[0].id;
    p = addRequest(p, { versionId: v1, text: "A" }, T).project;
    const { project, batch } = sendToJarvis(p, v1, T);
    const q = reviewRequest(project, { id: project.requests[0].id, status: "rejected" }, T);
    expect(() => approveBatch(q, { batchId: batch.id })).toThrow(/reject the batch/);
    const r = rejectBatch(q, { batchId: batch.id, note: "Out of scope" }, T);
    expect(r.batches[0].status).toBe("rejected");
    expect(r.requests[0].adminNote).toBe("Out of scope");
  });

  it("approving one batch takes every pending batch on that version", () => {
    let p = fresh();
    const v1 = p.versions[0].id;
    p = addRequest(p, { versionId: v1, text: "A" }, T).project;
    p = sendToJarvis(p, v1, T).project;
    p = addRequest(p, { versionId: v1, text: "B" }, T).project;
    const second = sendToJarvis(p, v1, T);
    const out = approveBatch(second.project, { batchId: second.batch.id }, T);
    expect(out.approved).toHaveLength(2);
    expect(out.project.batches.every((b) => b.status === "approved")).toBe(true);
  });

  it("a hand-added version with a URL goes straight live", () => {
    const out = addVersion(fresh(), { siteUrl: "https://new.example.com", summary: "Rebuilt hero" }, T);
    expect(out.version.number).toBe("v2");
    expect(currentVersion(out.project)?.id).toBe(out.version.id);
  });

  it("the client's view carries no secrets", () => {
    let p = fresh();
    p = addRequest(p, { versionId: p.versions[0].id, text: "A" }, T).project;
    const { project, batch } = sendToJarvis(p, p.versions[0].id, T);
    project.batches[0].brief = "internal brief";
    project.pushSubs = [{ endpoint: "https://push.example/1", keys: { p256dh: "k", auth: "a" }, addedAt: T }];
    const json = JSON.stringify(portalView(project, null));
    expect(json).not.toContain(project.token);
    expect(json).not.toContain("internal brief");
    expect(json).not.toContain("push.example");
    expect(json).not.toContain(batch.id);
  });

  it("only frames http(s) addresses", () => {
    expect(cleanUrl("example.com")).toBe("https://example.com/");
    expect(() => cleanUrl("javascript:alert(1)")).toThrow();
    expect(cleanUrl("")).toBe("");
  });
});

describe("model lanes", () => {
  it("auto tries Claude then the uncensored lane", () => {
    const plans = lanePlan("auto", { uncensored: "a/b, c/d" });
    expect(plans.map((p) => p.lane)).toEqual(["standard", "uncensored"]);
    expect(plans[1].models).toEqual(["a/b", "c/d"]);
    expect(lanePlan("uncensored").map((p) => p.lane)).toEqual(["uncensored"]);
    expect(lanePlan("standard").map((p) => p.lane)).toEqual(["standard"]);
  });

  it("spots a refusal at the start of a reply, not in the middle of a brief", () => {
    expect(looksLikeRefusal("I can't help with creating that content.")).toBe(true);
    expect(looksLikeRefusal("I'm sorry, but I won't write that.")).toBe(true);
    expect(looksLikeRefusal("")).toBe(true);
    expect(looksLikeRefusal("1. Header\nMake the logo 40% larger. The client can't decide on color — ask.")).toBe(false);
  });

  it("tells a content-policy failure from a billing one", () => {
    expect(isPolicyFailure(403, "Your request was flagged by moderation")).toBe(true);
    expect(isPolicyFailure(400, "violates our content policy")).toBe(true);
    expect(isPolicyFailure(402, "Insufficient credits")).toBe(false);
    expect(isPolicyFailure(403, "Invalid API key")).toBe(false);
  });
});

describe("Jarvis dashboard feed", () => {
  it("turns a sent batch into a Client Review notification", async () => {
    const { clientUpdates } = await import("@/lib/jarvis/updates");
    const rows = clientUpdates(
      [
        { id: "e1", kind: "batch_sent", projectName: "Glow Spa", clientName: "Dana", at: T, detail: "3 edit requests for v1" },
        { id: "e2", kind: "request_added", projectName: "Glow Spa", clientName: "Dana", at: T, detail: "x" },
      ],
      Date.parse(T) + 60_000,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "clients:e1", source: "clients", title: "Dana sent edit requests" });
  });
});

describe("client accounts", () => {
  it("the first account to open a link claims it; others are turned away", async () => {
    const { admit, releaseClaim } = await import("./logic");
    const p = fresh();
    const dana = { id: "u1", email: "Dana@Gmail.com", owner: false };
    const first = admit(p, dana, T);
    expect(first.claimed).toBe(true);
    expect(first.project).toMatchObject({ clientUserId: "u1", clientUserEmail: "dana@gmail.com" });
    expect(admit(first.project, dana).claimed).toBe(false);
    expect(() => admit(first.project, { id: "u2", email: "x@y.com", owner: false })).toThrow(/another account/);
    // The owner always gets in and never claims.
    expect(admit(first.project, { id: "o", email: "me@x.com", owner: true }).claimed).toBe(false);
    // Released, a new account can claim it.
    expect(admit(releaseClaim(first.project), { id: "u2", email: "x@y.com", owner: false }).claimed).toBe(true);
  });

  it("an invite email locks who can claim", async () => {
    const { admit } = await import("./logic");
    const p = createProject({ name: "Site", inviteEmail: "dana@gmail.com" }, T);
    expect(() => admit(p, { id: "u2", email: "other@gmail.com", owner: false })).toThrow(/d\*\*\*@gmail.com/);
    expect(admit(p, { id: "u1", email: "DANA@gmail.com", owner: false }).claimed).toBe(true);
    expect(() => createProject({ name: "Site", inviteEmail: "not-an-email" })).toThrow(/email/);
  });

  it("the client's view never shows who claimed it", () => {
    const p = { ...fresh(), clientUserId: "u1", clientUserEmail: "dana@gmail.com", inviteEmail: "dana@gmail.com" };
    const json = JSON.stringify(portalView(p, null));
    expect(json).not.toContain("u1");
    expect(json).not.toContain("dana@gmail.com");
  });
});
