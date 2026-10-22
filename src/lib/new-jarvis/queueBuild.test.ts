import { describe, expect, it } from "vitest";
import { buildRequest, findApp } from "./queueBuild";

const APPS = [
  { slug: "jarvis", title: "Jarvis" },
  { slug: "cookbook-genie", title: "Cookbook Genie" },
  { slug: "cook-connect", title: "Cook Connect" },
  { slug: "viral-studio-content", title: "Viral Studio Content" },
];

describe("which app the owner means", () => {
  it("matches a slug, a title, or a clear part of a title", () => {
    expect(findApp("cook-connect", APPS)?.slug).toBe("cook-connect");
    expect(findApp("/apps/jarvis", APPS)?.slug).toBe("jarvis");
    expect(findApp("my Cook Connect app", APPS)?.slug).toBe("cook-connect");
    expect(findApp("viral studio", APPS)?.slug).toBe("viral-studio-content");
  });

  it("does not guess between two apps", () => {
    expect(findApp("cook", APPS)).toBeNull();
  });
});

describe("the request Claude Code reads", () => {
  it("files in the app's folder, naming the app and its route", () => {
    const r = buildRequest("Jarvis", "make the chat box bigger on phones", APPS);
    expect(r.folder).toBe("app:jarvis");
    expect(r.text).toBe("Jarvis (/apps/jarvis): make the chat box bigger on phones");
  });

  it("falls back to the Inbox, keeping what was said, when the app is unknown", () => {
    const r = buildRequest("Roofing site", "add a quote form", APPS);
    expect(r.folder).toBe("inbox");
    expect(r.text).toBe("Roofing site: add a quote form");
  });
});
