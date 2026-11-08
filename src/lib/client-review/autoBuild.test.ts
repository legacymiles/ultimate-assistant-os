import { describe, expect, it } from "vitest";
import { buildLinks, CannotBuildHere } from "./autoBuild";

describe("reading the build's last words", () => {
  it("finds the pull request and the preview", () => {
    const text = [
      "Pushed jarvis-money-agent-studio-v2 and opened the pull request.",
      "",
      "PR: https://github.com/legacymiles/ultimate-assistant-os/pull/412",
      "Preview: https://ultimate-assistant-os-git-jarvis-money-agent-studio-v2.vercel.app/apps/money-agent-studio",
    ].join("\n");
    expect(buildLinks(text)).toEqual({
      pr: "https://github.com/legacymiles/ultimate-assistant-os/pull/412",
      preview: "https://ultimate-assistant-os-git-jarvis-money-agent-studio-v2.vercel.app/apps/money-agent-studio",
    });
  });

  it("takes the last pair when the thread said it twice", () => {
    const text = "PR: https://github.com/a/b/pull/1\nPreview: https://old.example/x\n\nPR: https://github.com/a/b/pull/2\nPreview: https://new.example/x";
    expect(buildLinks(text)).toEqual({ pr: "https://github.com/a/b/pull/2", preview: "https://new.example/x" });
  });

  it("does not turn a half-written sentence into a link", () => {
    expect(buildLinks("Preview: none — the preview requires a Vercel login.")).toEqual({ pr: undefined, preview: undefined });
    expect(buildLinks("Preview: https://preview.example/x.")).toEqual({ pr: undefined, preview: "https://preview.example/x" });
    expect(buildLinks("nothing here")).toEqual({ pr: undefined, preview: undefined });
  });

  it("says why the PC can't build it as a value, not a message to parse", () => {
    const e = new CannotBuildHere("pc-off", "no PC");
    expect(e.reason).toBe("pc-off");
    expect(e).toBeInstanceOf(Error);
  });
});
