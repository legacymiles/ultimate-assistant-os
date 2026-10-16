import { describe, expect, it } from "vitest";
import { githubRepoDestination } from "./githubRepo";
import { musicClassifiedDestination } from "./musicClassified";

describe("music-classified destination", () => {
  it("needs a title", () => {
    expect(musicClassifiedDestination.parse({ artist: "Someone" })).toBeNull();
  });

  it("previews into the Classifier and flags a guess", () => {
    const f = musicClassifiedDestination.parse({ title: "Song", artist: "Artist", guessed: true })!;
    const p = musicClassifiedDestination.preview(f);
    expect(p.where).toBe("Audio Studio › Classifier");
    expect(p.title).toBe("Song — Artist");
    expect(p.unverified).toBeTruthy();
  });
});

describe("github-repo destination", () => {
  it("drops a capture with nothing to look up", () => {
    expect(githubRepoDestination.parse({ owner: "x" })).toBeNull();
  });

  it("keeps a search-only capture, flagged as unverified", () => {
    const f = githubRepoDestination.parse({ query: "open interpreter" })!;
    const p = githubRepoDestination.preview(f);
    expect(p.where).toBe("Folders › Repos");
    expect(p.unverified).toBeTruthy();
  });

  it("is verified when owner and name were read", () => {
    const f = githubRepoDestination.parse({ owner: "vercel", name: "next.js" })!;
    expect(githubRepoDestination.preview(f).unverified).toBeUndefined();
    expect(githubRepoDestination.preview(f).title).toBe("vercel/next.js");
  });
});
