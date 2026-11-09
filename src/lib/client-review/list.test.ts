import { describe, expect, it } from "vitest";
import { admit, builderProject, createProject, isSentToClient, sendToClient, shipPreview, unsendFromClient, ReviewError } from "./logic";
import { DEFAULT_SORT, isBeingCreated, listProjects, projectState, searchProjects, sortProjects } from "./list";
import type { ClientProject } from "./types";

const T = "2026-11-02T10:00:00.000Z";

function at(iso: string, name: string, clientName = ""): ClientProject {
  return createProject({ name, clientName, siteUrl: "example.com" }, iso);
}

describe("what the client is allowed to see", () => {
  it("hides a project the owner has not sent, even from someone holding the token", () => {
    const { project } = builderProject({ name: "WalkBook" }, T);
    expect(isSentToClient(project)).toBe(false);
  });

  it("shows it once the owner sends it", () => {
    const { project } = builderProject({ name: "WalkBook" }, T);
    expect(isSentToClient(sendToClient(project, T))).toBe(true);
  });

  it("grandfathers a project the client had already claimed", () => {
    // Exactly what an old stored project looks like: claimed by the client,
    // with no sentAt, because the field did not exist when it was shared.
    const claimed: ClientProject = { ...createProject({ name: "Glow Spa" }, T), sentAt: undefined, clientUserId: "user_1", claimedAt: T };
    expect(claimed.sentAt).toBeUndefined();
    expect(isSentToClient(claimed)).toBe(true);
  });

  it("does not send twice, so the first send stays the record", () => {
    const first = sendToClient(createProject({ name: "A" }, T), T);
    const again = sendToClient(first, "2026-12-01T00:00:00.000Z");
    expect(again.sentAt).toBe(first.sentAt);
  });

  it("can be taken back before the client has opened it", () => {
    const sent = sendToClient(createProject({ name: "A" }, T), T);
    expect(isSentToClient(unsendFromClient(sent, T))).toBe(false);
  });

  it("refuses to take it back once the client has it, rather than cutting them off", () => {
    const sent: ClientProject = { ...sendToClient(createProject({ name: "A" }, T), T), clientUserId: "user_1", claimedAt: T };
    expect(() => unsendFromClient(sent, T)).toThrow(ReviewError);
  });
});

describe("an app that does not exist yet", () => {
  it("is 'being created' while nothing has ever shipped", () => {
    const { project } = builderProject({ name: "WalkBook" }, T);
    expect(isBeingCreated(project)).toBe(true);
    expect(projectState(project)).toBe("being-created");
  });

  it("stops being 'created' once it has an address", () => {
    const { project, version } = builderProject({ name: "WalkBook" }, T);
    const live = shipPreview(project, { versionId: version.id, siteUrl: "walkbook.vercel.app" }, T).project;
    expect(isBeingCreated(live)).toBe(false);
  });

  it("is not confused with a rebuild of a site that is already live", () => {
    const { project, version } = builderProject({ name: "WalkBook" }, T);
    const live = shipPreview(project, { versionId: version.id, siteUrl: "walkbook.vercel.app" }, T).project;
    // A later version goes back into "building" — that is a rebuild, not a birth.
    const rebuilding: ClientProject = {
      ...live,
      versions: [...live.versions, { id: "ver_2", number: "v2", siteUrl: "", summary: "", status: "building", createdAt: T }],
    };
    expect(isBeingCreated(rebuilding)).toBe(false);
    expect(projectState(rebuilding)).toBe("building");
  });

  it("calls an unsent, finished app 'not sent' rather than live", () => {
    const { project, version } = builderProject({ name: "WalkBook" }, T);
    const live = shipPreview(project, { versionId: version.id, siteUrl: "walkbook.vercel.app" }, T).project;
    expect(projectState(live)).toBe("unsent");
    expect(projectState(sendToClient(live, T))).toBe("live");
  });

  it("puts archived above everything else", () => {
    const { project } = builderProject({ name: "WalkBook" }, T);
    expect(projectState({ ...project, archived: true })).toBe("archived");
  });
});

describe("finding one among many", () => {
  const list = [
    at("2026-01-01T00:00:00.000Z", "Glow Spa", "Dana"),
    at("2026-06-01T00:00:00.000Z", "WalkBook", "Sam"),
    at("2026-03-01T00:00:00.000Z", "Baker Street", "O'Brien"),
  ];

  it("defaults to newest first", () => {
    expect(sortProjects(list, DEFAULT_SORT).map((p) => p.name)).toEqual(["WalkBook", "Baker Street", "Glow Spa"]);
  });

  it("sorts oldest, A–Z and Z–A", () => {
    expect(sortProjects(list, "oldest").map((p) => p.name)).toEqual(["Glow Spa", "Baker Street", "WalkBook"]);
    expect(sortProjects(list, "az").map((p) => p.name)).toEqual(["Baker Street", "Glow Spa", "WalkBook"]);
    expect(sortProjects(list, "za").map((p) => p.name)).toEqual(["WalkBook", "Glow Spa", "Baker Street"]);
  });

  it("searches the client's name as well as the app's", () => {
    expect(searchProjects(list, "sam").map((p) => p.name)).toEqual(["WalkBook"]);
  });

  it("ignores case and punctuation, so a name is reachable without its apostrophe", () => {
    expect(searchProjects(list, "obrien").map((p) => p.name)).toEqual(["Baker Street"]);
    expect(searchProjects(list, "glow-spa").map((p) => p.name)).toEqual(["Glow Spa"]);
  });

  it("returns everything for an empty or blank query", () => {
    expect(searchProjects(list, "").length).toBe(3);
    expect(searchProjects(list, "   ").length).toBe(3);
  });

  it("never reorders the caller's array", () => {
    const before = list.map((p) => p.name);
    sortProjects(list, "az");
    expect(list.map((p) => p.name)).toEqual(before);
  });

  it("searches then sorts, in that order", () => {
    const out = listProjects(list, { query: "a", sort: "az" });
    expect(out.map((p) => p.name)).toEqual(["Baker Street", "Glow Spa", "WalkBook"]);
  });
});

describe("claiming an unsent project", () => {
  const client = { id: "user_1", email: "sam@example.com", owner: false } as const;

  it("is refused, so a leaked token cannot grant itself access", () => {
    const { project } = builderProject({ name: "WalkBook" }, T);
    expect(() => admit(project, client, T)).toThrow(ReviewError);
  });

  it("is allowed once the owner has sent it", () => {
    const sent = sendToClient(builderProject({ name: "WalkBook" }, T).project, T);
    const out = admit(sent, client, T);
    expect(out.claimed).toBe(true);
    expect(out.project.clientUserId).toBe("user_1");
  });

  it("still lets the owner look at an unsent one", () => {
    const { project } = builderProject({ name: "WalkBook" }, T);
    expect(admit(project, { id: "owner", email: "me@example.com", owner: true }, T).claimed).toBe(false);
  });
});
