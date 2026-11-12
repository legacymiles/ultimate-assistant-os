import { describe, expect, it } from "vitest";
import { builderProject, createProject, sendToClient } from "./logic";
import { countFiles, folderTree, handover, hubSlugFor, moveStep, pluginsBrief, readableSize, repoHasNoSite, repoNameFor, repoOf, repoUrl, siteFileCount, type RepoEntry } from "./handover";
import type { ClientProject } from "./types";

const T = "2026-11-10T10:00:00.000Z";
const HUB = "legacymiles/ultimate-assistant-os";

/**
 * A site as App Builder opens it: unsent, no repository, nothing live yet —
 * which is exactly what BuildFlip 2 was when the owner first pressed Ship.
 * `createProject` is the OTHER door (the owner's "+ New"), and it marks a
 * project sent on the spot, so a test built on it would never see the state
 * this screen exists for.
 */
function site(name = "BuildFlip 2", extra: Partial<ClientProject> = {}): ClientProject {
  return { ...builderProject({ name, clientName: "Dana" }, T).project, ...extra };
}

describe("the name a new repository gets", () => {
  it("slugs the site's own name", () => {
    expect(repoNameFor("BuildFlip 2")).toBe("buildflip-2");
    expect(repoNameFor("  Glow & Co. Spa  ")).toBe("glow-co-spa");
  });

  it("never collides with one the account already has, whatever its case", () => {
    expect(repoNameFor("Portfolio", ["legacymiles/Portfolio"])).toBe("portfolio-2");
    expect(repoNameFor("Portfolio", ["portfolio", "portfolio-2"])).toBe("portfolio-3");
  });

  it("falls back rather than making an empty name", () => {
    expect(repoNameFor("!!!")).toBe("client-site");
  });
});

describe("reading the repository back off a project", () => {
  it("takes owner/name out of whatever shape it was stored in", () => {
    expect(repoOf("https://github.com/legacymiles/buildflip-2.git")).toBe("legacymiles/buildflip-2");
    expect(repoOf("  legacymiles/buildflip-2 ")).toBe("legacymiles/buildflip-2");
    expect(repoOf("git@github.com:legacymiles/buildflip-2.git")).toBe("legacymiles/buildflip-2");
  });

  it("says there is none rather than guessing, and never throws at a screen", () => {
    expect(repoOf("buildflip")).toBe("");
    expect(repoOf("https://example.com/a/b/c")).toBe("");
    expect(repoOf(undefined)).toBe("");
  });

  it("links at GitHub", () => {
    expect(repoUrl("legacymiles/buildflip-2")).toBe("https://github.com/legacymiles/buildflip-2");
  });
});

describe("what Ship may offer for this project", () => {
  it("a site with no repo: sending makes one", () => {
    const h = handover(site(), HUB);
    expect(h.kind).toBe("site");
    expect(h.makesRepo).toBe(true);
    expect(h.sent).toBe(false);
  });

  it("a site that already has a repo never makes a second", () => {
    const h = handover(site("BuildFlip 2", { repo: "legacymiles/buildflip-2" }), HUB);
    expect(h.makesRepo).toBe(false);
    expect(h.repo).toBe("legacymiles/buildflip-2");
  });

  it("one of the owner's own hub apps is neither handed over nor re-absorbed", () => {
    const app = site("Cook Connect", { appSlug: "cook-connect", appPath: "/apps/cook-connect", repo: HUB });
    const h = handover(app, HUB);
    expect(h.kind).toBe("hub-app");
    expect(h.makesRepo).toBe(false);
    expect(h.pluginsBlocked).toBe("already-in");
    expect(h.hubPath).toBe("/apps/cook-connect");
  });

  it("treats the hub's own repo as a hub app even without a slug, so it is never handed to a client", () => {
    expect(handover(site("Scratch", { repo: HUB.toUpperCase() }), HUB).kind).toBe("hub-app");
  });

  it("will not move a site into the hub before anything has been built", () => {
    expect(handover(site(), HUB).pluginsBlocked).toBe("nothing-built");
  });

  it("clears the way once a version is live", () => {
    const p = site();
    p.versions[0] = { ...p.versions[0], status: "review", siteUrl: "https://buildflip.example" };
    expect(handover(p, HUB).pluginsBlocked).toBe("");
  });

  it("counts a claimed project as sent even with no sentAt, like the rest of the app", () => {
    expect(handover(sendToClient(site(), T), HUB).sent).toBe(true);
    expect(handover(site("x", { claimedAt: T }), HUB).sent).toBe(true);
  });

  it("a project made by hand is sent from the start, so Ship never offers to send it again", () => {
    expect(handover(createProject({ name: "Glow Spa", clientName: "Dana" }, T), HUB).sent).toBe(true);
  });
});

describe("the repository shown as folders", () => {
  const entries: RepoEntry[] = [
    { path: "README.md", type: "blob", size: 820 },
    { path: "src/app/page.tsx", type: "blob", size: 4096 },
    { path: "src/app/layout.tsx", type: "blob", size: 1200 },
    { path: "package.json", type: "blob", size: 640 },
    { path: "public/logo.svg", type: "blob", size: 2048 },
  ];

  it("builds the folders GitHub left out of a sparse tree", () => {
    const tree = folderTree(entries);
    const src = tree.find((n) => n.name === "src");
    expect(src?.kind).toBe("dir");
    expect(src?.children[0].name).toBe("app");
    expect(src?.children[0].children.map((c) => c.name)).toEqual(["layout.tsx", "page.tsx"]);
  });

  it("puts folders before files and sorts each level A→Z", () => {
    // Case-insensitive, the way an editor's explorer orders them — not
    // GitHub's capitals-first, which puts README above everything.
    expect(folderTree(entries).map((n) => n.name)).toEqual(["public", "src", "package.json", "README.md"]);
  });

  it("keeps a folder GitHub listed on its own, even when it holds nothing yet", () => {
    const tree = folderTree([{ path: "docs", type: "tree" }]);
    expect(tree).toEqual([{ name: "docs", path: "docs", kind: "dir", children: [] }]);
  });

  it("never shows the same file twice when the tree repeats it", () => {
    const tree = folderTree([...entries, { path: "README.md", type: "blob", size: 820 }]);
    expect(tree.filter((n) => n.name === "README.md")).toHaveLength(1);
  });

  it("counts every file under a folder, so a collapsed one still says something", () => {
    expect(countFiles(folderTree(entries))).toBe(5);
  });

  it("ignores an empty path rather than making a nameless row", () => {
    expect(folderTree([{ path: "", type: "blob" }])).toEqual([]);
  });
});

describe("sizes a person reads", () => {
  it("reads bytes, kilobytes and megabytes", () => {
    expect(readableSize(820)).toBe("820 B");
    expect(readableSize(4096)).toBe("4 KB");
    expect(readableSize(3_000_000)).toBe("2.9 MB");
  });

  it("says nothing rather than NaN when GitHub gave no size", () => {
    expect(readableSize(undefined)).toBe("");
  });
});

describe("the brief that moves a site into the hub", () => {
  const brief = pluginsBrief(site(), { repo: "legacymiles/buildflip-2", liveUrl: "https://buildflip.example" });

  it("names the route, the catalog and the live address", () => {
    expect(hubSlugFor("BuildFlip 2")).toBe("buildflip-2");
    expect(brief).toContain("src/app/apps/buildflip-2/page.tsx");
    expect(brief).toContain("src/lib/catalog.ts");
    expect(brief).toContain("https://buildflip.example");
  });

  it("keeps the source repository read-only and leaves the merge to the owner", () => {
    expect(brief).toContain("READ-ONLY");
    expect(brief).toContain("Do NOT merge it");
  });

  it("asks for the one line the console reads back", () => {
    expect(brief).toContain("`PR: <url>`");
  });
});

describe("what counts as a site being in the repository", () => {
  it("does not count the README Jarvis writes when it makes the repo", () => {
    expect(repoHasNoSite([{ path: "README.md", type: "blob" }])).toBe(true);
    expect(siteFileCount([{ path: "README.md", type: "blob" }])).toBe(0);
  });

  it("does not count a licence or a .gitignore either", () => {
    const housekeeping = [
      { path: "README.md", type: "blob" as const },
      { path: "LICENSE", type: "blob" as const },
      { path: "licence.txt", type: "blob" as const },
      { path: ".gitignore", type: "blob" as const },
      { path: ".gitattributes", type: "blob" as const },
    ];
    expect(repoHasNoSite(housekeeping)).toBe(true);
  });

  it("counts one real file as a site", () => {
    expect(repoHasNoSite([{ path: "README.md", type: "blob" }, { path: "index.html", type: "blob" }])).toBe(false);
  });

  it("does not count folders — a tree entry is not a file", () => {
    expect(repoHasNoSite([{ path: "src", type: "tree" }, { path: "README.md", type: "blob" }])).toBe(true);
  });

  it("is not fooled by a file whose name merely starts with readme", () => {
    expect(repoHasNoSite([{ path: "readme-generator.js", type: "blob" }])).toBe(false);
  });
});

describe("the brief puts the app where the owner looks for it", () => {
  it("tells it to add the slug to PLUGIN_SLUGS, not only to the catalog", () => {
    const brief = pluginsBrief(site(), { repo: "legacymiles/buildflip-2", liveUrl: "" });
    expect(brief).toContain("PLUGIN_SLUGS");
    expect(brief).toContain("src/lib/studio/plugins.ts");
    // The catalog row alone was what left a moved app with no card on App
    // plugins and nothing but a tile on the hub grid.
    expect(brief).toContain("PROJECTS");
  });

  it("names the app's own slug in that instruction", () => {
    const brief = pluginsBrief(site(), { repo: "a/b", liveUrl: "" });
    expect(brief).toContain(`"${hubSlugFor(site().name)}"`);
  });

  it("makes checking the card part of done", () => {
    expect(pluginsBrief(site(), { repo: "a/b", liveUrl: "" })).toContain("App plugins");
  });
});

describe("the brief asks for the gate CI actually runs", () => {
  // Two moves in a row opened a RED pull request, for two different reasons,
  // and both were invisible to the checks the brief used to name.
  const briefs = () => [
    { door: "Client Review Ship", text: pluginsBrief(site(), { repo: "a/b", liveUrl: "" }) },
    { door: "Client Review Ship, from a folder", text: pluginsBrief(site(), { folder: "C:/work/x", liveUrl: "" }) },
  ];

  it("names one command, and it is the repository's own", () => {
    for (const { door, text } of briefs()) expect(text, door).toContain("npm run verify");
  });

  it("says to regenerate the apps index, because a catalog entry always staleness it", () => {
    for (const { door, text } of briefs()) {
      expect(text, door).toContain("npm run apps:index");
      expect(text, door).toContain("docs/apps/README.md");
    }
  });

  it("says the build is the only check that sees an App Router mistake", () => {
    for (const { door, text } of briefs()) {
      expect(text, door).toContain("npm run build");
      // The exact trap: `ownImagesOnly` exported from a route.ts typechecked
      // clean and failed next build.
      expect(text, door).toMatch(/route\.ts` may export nothing but route handlers/);
      expect(text, door).toContain("tsc --noEmit");
    }
  });

  it("puts a red pull request on the agent, not on the owner", () => {
    expect(pluginsBrief(site(), { repo: "a/b", liveUrl: "" })).toMatch(/not finished work/);
  });
});

describe("deciding whether a finished move goes live by itself", () => {
  const base = { move: {}, prUrl: "", phase: "working", passed: false, unchecked: false, shipping: false };
  const PR = "https://github.com/legacymiles/ultimate-assistant-os/pull/28";

  it("waits while the thread is still working", () => {
    expect(moveStep(base)).toMatchObject({ act: "none", show: "running" });
  });

  it("writes the pull request down before it does anything with it", () => {
    // Its own step on purpose: a thread that dies right after opening the PR
    // must still leave the address on the project.
    expect(moveStep({ ...base, prUrl: PR, phase: "done", passed: true, move: { land: true } })).toMatchObject({
      act: "record-pr",
      prUrl: PR,
    });
  });

  it("lands it once the checks have passed and the address is recorded", () => {
    expect(moveStep({ ...base, phase: "done", passed: true, move: { land: true, prUrl: PR } })).toMatchObject({
      act: "land",
      show: "landing",
      prUrl: PR,
    });
  });

  it("NEVER lands on the phase alone — a thread nobody checked reads as done", () => {
    // phaseOf returns "done" when there is no verify report at all. Landing on
    // that would treat a switched-off gate as permission to push to main.
    const step = moveStep({ ...base, phase: "done", passed: false, unchecked: true, move: { land: true, prUrl: PR } });
    expect(step.act).toBe("none");
    expect(step.show).toBe("unchecked");
    expect(step.why).toMatch(/nothing checked it/);
  });

  it("does not land when the checks are failing, and says which way it failed", () => {
    const step = moveStep({ ...base, phase: "unverified", move: { land: true, prUrl: PR } });
    expect(step.act).toBe("none");
    expect(step.show).toBe("failed");
    expect(step.why).toMatch(/checks are failing/);
  });

  it("does not land twice, whatever the thread says afterwards", () => {
    // The panel re-mounts on every reload and on every device the project is
    // open on. Pushing to main is not a read.
    const landed = { land: true, prUrl: PR, landedAt: "2026-11-12T12:00:00.000Z" };
    expect(moveStep({ ...base, phase: "done", passed: true, move: landed })).toMatchObject({ act: "none", show: "live" });
    expect(moveStep({ ...base, phase: "unverified", move: landed })).toMatchObject({ act: "none", show: "live" });
  });

  it("does not land while a landing is already in flight", () => {
    expect(moveStep({ ...base, phase: "done", passed: true, shipping: true, move: { land: true, prUrl: PR } })).toMatchObject({
      act: "none",
      show: "landing",
    });
  });

  it("stops at the pull request when the owner did not ask for it to go live", () => {
    expect(moveStep({ ...base, phase: "done", passed: true, move: { land: false, prUrl: PR } })).toMatchObject({
      act: "none",
      show: "pr-only",
    });
  });

  it("offers a restart only when it died with no pull request at all", () => {
    expect(moveStep({ ...base, phase: "failed", move: { land: true } })).toMatchObject({ act: "none", show: "restart" });
    // With a PR there is something to keep, so restarting is the wrong offer.
    expect(moveStep({ ...base, phase: "failed", move: { land: true, prUrl: PR } }).show).not.toBe("restart");
  });
});
