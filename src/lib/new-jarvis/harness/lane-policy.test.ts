// ---------------------------------------------------------------------------
// The gate's auto-allow policy.
//
// This reaches across into the bridge's own `harness-gate.mjs` rather than
// re-stating the rule in TypeScript, because a second copy of a security
// decision is a second copy that can disagree with the first. The bridge runs
// as plain ESM in a separate Node process; the module is pure, so it imports
// here without starting anything.
//
// What is being protected: `laneWrites` lets a bake-off lane write without
// asking, and the only thing standing between that and the owner's real
// checkout is `insideWorktree`. Every case below is a way that check could be
// talked out of saying no.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { autoAllow, insideWorktree } from "../../../../tools/jarvis-bridge/harness-gate.mjs";

const read = { kind: "read", path: "src/app/page.tsx" };
const write = (path: string) => ({ kind: "write", path });
const run = { kind: "run", path: "", command: "npm install three" };
const other = { kind: "other", path: "" };

describe("insideWorktree", () => {
  it("accepts a plain relative path, which is what the gate hands it for a file in the worktree", () => {
    expect(insideWorktree("src/lib/foo.ts")).toBe(true);
    expect(insideWorktree("package.json")).toBe(true);
    expect(insideWorktree("src\\lib\\foo.ts")).toBe(true);
  });

  it("refuses an absolute path, which is how the gate spells a file OUTSIDE the worktree", () => {
    expect(insideWorktree("C:/Users/honey/OneDrive/Desktop/claude code files/.env.local")).toBe(false);
    expect(insideWorktree("c:/windows/system32/drivers/etc/hosts")).toBe(false);
    expect(insideWorktree("/etc/passwd")).toBe(false);
    expect(insideWorktree("//server/share/thing")).toBe(false);
  });

  it("refuses a relative path that climbs out — the case the naive check gets wrong", () => {
    expect(insideWorktree("../.env.local")).toBe(false);
    expect(insideWorktree("src/../../../.env.local")).toBe(false);
    expect(insideWorktree("src\\..\\..\\secrets.txt")).toBe(false);
  });

  it("does not mistake a filename that merely contains dots for a climb", () => {
    expect(insideWorktree("src/lib/..foo.ts")).toBe(true);
    expect(insideWorktree("docs/a..b/file.md")).toBe(true);
  });

  it("refuses an empty path, because a write nobody can locate is a write nobody can vouch for", () => {
    expect(insideWorktree("")).toBe(false);
    expect(insideWorktree(undefined)).toBe(false);
    expect(insideWorktree(null)).toBe(false);
  });
});

describe("autoAllow", () => {
  it("passes reads by default", () => {
    expect(autoAllow(read)).toBe(true);
  });

  it("gates reads under strict", () => {
    expect(autoAllow(read, { strict: true })).toBe(false);
  });

  it("gates every write unless the caller asked for lane writes", () => {
    expect(autoAllow(write("src/app/page.tsx"))).toBe(false);
    expect(autoAllow(write("src/app/page.tsx"), { laneWrites: true })).toBe(true);
  });

  it("gates a lane's write that resolves outside its worktree", () => {
    expect(autoAllow(write("../../.env.local"), { laneWrites: true })).toBe(false);
    expect(autoAllow(write("C:/Users/honey/.claude/settings.json"), { laneWrites: true })).toBe(false);
  });

  it("never passes something that RUNS, lane or not — a command can write anywhere", () => {
    expect(autoAllow(run, { laneWrites: true })).toBe(false);
    expect(autoAllow(other, { laneWrites: true })).toBe(false);
  });

  it("lets strict win over laneWrites, so the stricter of two settings is the one that applies", () => {
    expect(autoAllow(write("src/app/page.tsx"), { laneWrites: true, strict: true })).toBe(false);
  });
});
