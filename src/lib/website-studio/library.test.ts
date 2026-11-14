import { describe, expect, it } from "vitest";
import type { BuilderProject } from "@/lib/app-builder/types";
import { appProject, editableApps } from "@/lib/client-review/apps";
import { createProject } from "@/lib/client-review/logic";
import type { ClientProject } from "@/lib/client-review/types";
import { ago, filterCards, filterCounts, hostOf, libraryCards, thumbOf, workspaceHref } from "./library";

const T0 = "2026-11-01T10:00:00.000Z";

function site(name: string, over: Partial<ClientProject> = {}, siteUrl = "https://glow-spa.example"): ClientProject {
  const p = createProject({ name, clientName: "Dana", siteUrl, summary: "First version." }, T0);
  return { ...p, ...over };
}

function draft(id: string, over: Partial<BuilderProject> = {}): BuilderProject {
  return {
    id,
    createdAt: T0,
    updatedAt: T0,
    idea: "A booking site for a mobile dog groomer",
    stage: "features",
    questions: [],
    answers: {},
    features: [],
    chat: [],
    ...over,
  } as BuilderProject;
}

describe("one library, nothing copied", () => {
  it("shows a client site with what a card needs, and opens it by its own link secret", () => {
    const p = site("Glow Spa");
    const [c] = libraryCards({ projects: [p] });
    expect(c).toMatchObject({ key: p.id, kind: "site", title: "Glow Spa", client: "Dana", host: "glow-spa.example", version: "v1" });
    expect(c.open).toEqual({ site: p.token });
    expect(workspaceHref(c.open)).toBe(`/apps/website-studio?site=${p.token}`);
  });

  it("keeps every existing project — ids and tokens are passed through untouched", () => {
    const ps = [site("A"), site("B"), site("C")];
    const cards = libraryCards({ projects: ps });
    expect(cards.map((c) => c.key).sort()).toEqual(ps.map((p) => p.id).sort());
    expect(cards.map((c) => ("site" in c.open ? c.open.site : "")).sort()).toEqual(ps.map((p) => p.token).sort());
  });

  it("leaves archived projects out of the library", () => {
    expect(libraryCards({ projects: [site("Old", { archived: true })] })).toEqual([]);
  });

  it("lists a build once: the draft folds into the website it opened", () => {
    const p = site("Paws & Go");
    const linked = draft("b1", { handoff: { at: T0, review: { id: p.id, versionId: p.versions[0].id, token: p.token, number: "v1", at: T0 } } });
    const loose = draft("b2");
    const cards = libraryCards({ projects: [p], drafts: [linked, loose] });
    expect(cards.map((c) => c.key)).toEqual([p.id, "draft:b2"]);
  });

  it("an edit to an existing site is not a website of its own", () => {
    const edit = draft("b3", { edit: { reviewId: "crp_x", batchId: "bat", siteName: "Glow", clientName: "Dana" } as BuilderProject["edit"] });
    expect(libraryCards({ projects: [], drafts: [edit] })).toEqual([]);
  });

  it("a hub app shows once: as its project when it has one, else as not opened yet", () => {
    const apps = editableApps().slice(0, 2);
    const opened = appProject(apps[0].slug, T0);
    const cards = libraryCards({ projects: [opened], apps });
    expect(cards.filter((c) => c.title === apps[0].title)).toHaveLength(1);
    expect(cards.find((c) => c.title === apps[0].title)).toMatchObject({ kind: "app", host: apps[0].path });
    expect(cards.find((c) => c.key === `app:${apps[1].slug}`)).toMatchObject({ state: "not-opened", open: { app: apps[1].slug } });
  });

  it("a redesign draft carries the address it is redesigning", () => {
    const d = draft("b4", { redesign: { url: "https://www.old-site.example/about" } as BuilderProject["redesign"] });
    const [c] = libraryCards({ projects: [], drafts: [d] });
    expect(c).toMatchObject({ kind: "draft", host: "old-site.example", stateLabel: "Redesign draft" });
    expect(workspaceHref(c.open)).toBe("/apps/website-studio?p=b4");
  });
});

describe("thumbnails", () => {
  it("uses the newest screenshot, then a shared mockup, then nothing", () => {
    const p = site("Glow Spa");
    expect(thumbOf(p)).toBe("");
    const mocked = { ...p, mockups: { edit: "x", at: T0, lanes: [{ lane: "faithful" as const, image: "data:mock" }] } };
    expect(thumbOf(mocked)).toBe("data:mock");
    const shot = { ...mocked, versions: [{ ...p.versions[0], image: "data:shot" }] };
    expect(thumbOf(shot)).toBe("data:shot");
  });
});

describe("search and filter", () => {
  const glow = site("Glow Spa", { updatedAt: "2026-11-10T10:00:00.000Z" });
  const obrien = site("O'Brien Roofing", { clientName: "Pat", updatedAt: "2026-11-12T10:00:00.000Z" }, "https://obrien.example");
  const cards = libraryCards({ projects: [glow, obrien], drafts: [draft("d1")], apps: editableApps().slice(0, 1) });

  it("finds by name, client or address, ignoring case and punctuation", () => {
    expect(filterCards(cards, { query: "glow-spa" }).map((c) => c.title)).toEqual(["Glow Spa"]);
    expect(filterCards(cards, { query: "obrien" }).map((c) => c.title)).toEqual(["O'Brien Roofing"]);
    expect(filterCards(cards, { query: "pat" }).map((c) => c.title)).toEqual(["O'Brien Roofing"]);
    expect(filterCards(cards, { query: "glow-spa.example" })).toHaveLength(1);
    expect(filterCards(cards, { query: "zzz" })).toEqual([]);
  });

  it("filters by kind, with counts that match what each filter shows", () => {
    const counts = filterCounts(cards);
    expect(counts).toMatchObject({ all: 4, client: 2, apps: 1, drafts: 1 });
    for (const f of ["all", "client", "apps", "drafts", "active"] as const) {
      expect(filterCards(cards, { filter: f })).toHaveLength(counts[f]);
    }
  });

  it("leads with recent work and sinks never-opened apps to the bottom", () => {
    const order = filterCards(cards).map((c) => c.title);
    expect(order[0]).toBe("O'Brien Roofing");
    expect(order[1]).toBe("Glow Spa");
    expect(filterCards(cards).at(-1)!.state).toBe("not-opened");
  });
});

describe("small things the cards print", () => {
  it("hosts", () => {
    expect(hostOf("https://www.glow-spa.example/pricing")).toBe("glow-spa.example");
    expect(hostOf("/apps/jarvis")).toBe("/apps/jarvis");
    expect(hostOf("")).toBe("");
  });

  it("how long ago", () => {
    const now = Date.parse("2026-11-13T12:00:00.000Z");
    expect(ago("2026-11-13T11:59:40.000Z", now)).toBe("just now");
    expect(ago("2026-11-13T11:48:00.000Z", now)).toBe("12 min ago");
    expect(ago("2026-11-13T09:00:00.000Z", now)).toBe("3 h ago");
    expect(ago("2026-11-12T10:00:00.000Z", now)).toBe("yesterday");
    expect(ago("2026-11-04T12:00:00.000Z", now)).toBe("9 days ago");
    expect(ago("not a date", now)).toBe("");
  });
});
