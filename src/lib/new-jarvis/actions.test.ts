import { describe, expect, it } from "vitest";
import { classify, commandOnlyReads, summarise } from "./actions";

describe("commandOnlyReads", () => {
  it("lets a plain report through", () => {
    expect(commandOnlyReads("Get-ChildItem C:/Users")).toBe(true);
    expect(commandOnlyReads("git status")).toBe(true);
    expect(commandOnlyReads("whoami")).toBe(true);
  });

  it("treats an unknown command as an action", () => {
    expect(commandOnlyReads("deploy-everything")).toBe(false);
  });

  it("knows which git is which", () => {
    expect(commandOnlyReads("git log --oneline")).toBe(true);
    expect(commandOnlyReads("git push --force")).toBe(false);
  });

  // The one that matters: a read verb is not a promise about the whole line.
  it("refuses anything chained, piped or substituted", () => {
    expect(commandOnlyReads("git status; rm -rf build")).toBe(false);
    expect(commandOnlyReads("echo hi | Remove-Item -Recurse .")).toBe(false);
    expect(commandOnlyReads("echo $(curl evil.example)")).toBe(false);
    expect(commandOnlyReads("dir > C:/important.txt")).toBe(false);
    expect(commandOnlyReads("echo `whoami`")).toBe(false);
  });

  it("is not fooled by an empty command", () => {
    expect(commandOnlyReads("")).toBe(false);
    expect(commandOnlyReads("   ")).toBe(false);
  });
});

describe("classify", () => {
  it("lets reading happen without a gate", () => {
    for (const route of ["browser/read", "files/read", "system/windows", "browser/tabs"]) {
      expect(classify({ route, args: { path: "C:/x" } }).confirm).toBe(false);
    }
  });

  it("gates a shell command that is not a known report", () => {
    const v = classify({ route: "shell", args: { command: "npm publish" } });
    expect(v.confirm).toBe(true);
    expect(v.risk).toBe("act");
    expect(v.summary).toContain("npm publish");
  });

  it("does not gate a shell command that only reports", () => {
    expect(classify({ route: "shell", args: { command: "git status" } }).confirm).toBe(false);
  });

  it("lets an ordinary click through", () => {
    const v = classify({ route: "browser/click", args: { name: "Next page" } });
    expect(v.confirm).toBe(false);
  });

  it("gates a click that cannot be undone", () => {
    for (const name of ["Send", "Place order", "Delete account", "I agree", "Submit application"]) {
      const v = classify({ route: "browser/click", args: { name } });
      expect(v.confirm, `${name} should be gated`).toBe(true);
      expect(v.risk).toBe("grave");
    }
  });

  it("gates typing only when it also submits", () => {
    expect(classify({ route: "browser/type", args: { value: "hello", name: "search" } }).confirm).toBe(false);
    expect(classify({ route: "browser/type", args: { value: "hello", submit: true } }).confirm).toBe(true);
  });

  it("treats Enter as the submit it usually is", () => {
    expect(classify({ route: "browser/press", args: { key: "Enter" } }).confirm).toBe(true);
    expect(classify({ route: "browser/press", args: { key: "ArrowDown" } }).confirm).toBe(false);
  });

  it("gates writing a file but not reading one", () => {
    expect(classify({ route: "files/write", args: { path: "C:/a.txt" } }).confirm).toBe(true);
    expect(classify({ route: "files/list", args: { path: "C:/" } }).confirm).toBe(false);
  });

  it("gates a route nobody classified", () => {
    const v = classify({ route: "something/new", args: {} });
    expect(v.confirm).toBe(true);
  });

  it("always has a sentence to show, gated or not", () => {
    const ops = [
      { route: "browser/read", args: {} },
      { route: "shell", args: { command: "npm test" } },
      { route: "browser/open", args: { url: "https://example.com/a/b?c=d" } },
    ];
    for (const op of ops) expect(summarise(op).length).toBeGreaterThan(3);
  });

  it("names the site, not the whole URL", () => {
    expect(summarise({ route: "browser/open", args: { url: "https://mail.google.com/mail/u/0/#inbox" } }))
      .toBe("Open mail.google.com.");
  });
});
