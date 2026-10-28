import { describe, expect, it } from "vitest";
import { clientEditProject, editQueueText } from "../app-builder/clientEdit";
import { absoluteSiteUrl, appEntry, appProject, editableApp, editableApps, HUB_ORIGIN, HUB_REPO } from "./apps";
import { addRequest, approveBatch, currentVersion, emptyIndex, portalView, sendToJarvis, upsertIndex } from "./logic";

const T = "2026-10-28T23:00:00.000Z";

describe("the owner's apps in Client Review", () => {
  it("lists every live app A→Z, without merged apps or Client Review itself", () => {
    const apps = editableApps();
    const slugs = apps.map((a) => a.slug);
    expect(slugs).toContain("cook-connect");
    expect(slugs).toContain("jarvis");
    expect(slugs).toContain("game-studio");
    // Merged into a studio home — the home is listed instead.
    expect(slugs).not.toContain("game-creator");
    expect(slugs).not.toContain("ea-world");
    expect(slugs).not.toContain("client-review");
    expect(new Set(slugs).size).toBe(slugs.length);
    const titles = apps.map((a) => a.title);
    expect([...titles].sort((a, b) => a.localeCompare(b))).toEqual(titles);
    expect(apps.every((a) => a.path.startsWith("/apps/"))).toBe(true);
  });

  it("makes a project that frames the app's own route and builds in the hub repo", () => {
    const p = appProject("cook-connect", T);
    expect(p.appSlug).toBe("cook-connect");
    expect(p.appPath).toBe("/apps/cook-connect");
    expect(p.repo).toBe(HUB_REPO);
    expect(currentVersion(p)?.siteUrl).toBe("/apps/cook-connect");
    expect(portalView(p, null).isApp).toBe(true);
    expect(() => appProject("client-review", T)).toThrow();
    expect(() => appProject("not-an-app", T)).toThrow();
    expect(editableApp(42)).toBeNull();
  });

  it("finds an app's project again from the index, so opening it twice never makes two", () => {
    const p = appProject("jarvis", T);
    const index = upsertIndex(emptyIndex(), p);
    expect(index.projects[0].appSlug).toBe("jarvis");
    expect(appEntry(index, "jarvis")?.id).toBe(p.id);
    expect(appEntry(index, "cook-connect")).toBeNull();
  });

  it("hands Claude Code the app's path, an absolute 'before' address and where to post the preview", () => {
    let p = appProject("cook-connect", T);
    const v1 = p.versions[0].id;
    p = addRequest(p, { versionId: v1, text: "Make the Cookbook/Connect switch bigger", pin: { x: 0.5, y: 0.04, viewport: 1280 } }, T).project;
    const sent = sendToJarvis(p, v1, T);
    const out = approveBatch(sent.project, { batchId: sent.batch.id }, T);
    const b = clientEditProject(out.project, sent.batch.id, new Date(T), "ab_app");
    expect(b.edit).toMatchObject({ appPath: "/apps/cook-connect", repo: HUB_REPO, fromUrl: `${HUB_ORIGIN}/apps/cook-connect` });
    const text = editQueueText(b);
    expect(text).toContain("App: /apps/cook-connect");
    expect(text).toContain("+ /apps/cook-connect");
  });

  it("leaves real addresses alone", () => {
    expect(absoluteSiteUrl("https://glowspa.vercel.app/")).toBe("https://glowspa.vercel.app/");
    expect(absoluteSiteUrl("/apps/jarvis")).toBe(`${HUB_ORIGIN}/apps/jarvis`);
  });
});
