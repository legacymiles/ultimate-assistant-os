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

import { autoAllow, describeTool, insideWorktree } from "../../../../tools/jarvis-bridge/harness-gate.mjs";

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

// ---------------------------------------------------------------------------
// The trust level.
//
// Added because the policy above, correct as it is, left an ordinary thread —
// write a file, run the build, commit — asking at every single step, and forty
// gates in a row is a gate nobody reads. The level widens what passes. These
// tests are mostly about what it still must not.
// ---------------------------------------------------------------------------

describe("autoAllow — trust levels", () => {
  const grave = (command: string) => describeTool("Bash", { command }, "C:/wt/app");

  it("defaults to the careful answer when a caller passes nothing", () => {
    // The level a THREAD gets is "trusted", and that default lives in
    // startThread. The policy on its own stays strict, so a future caller
    // that forgets to pass anything is not quietly widened.
    expect(autoAllow(write("src/app/page.tsx"))).toBe(false);
    expect(autoAllow(run)).toBe(false);
  });

  it("lets a trusted thread write in its own worktree and run its build", () => {
    expect(autoAllow(write("src/app/page.tsx"), { trust: "trusted" })).toBe(true);
    expect(autoAllow(grave("npm run build"), { trust: "trusted" })).toBe(true);
    expect(autoAllow(describeTool("Edit", { file_path: "C:/wt/app/src/a.ts" }, "C:/wt/app"), { trust: "trusted" })).toBe(true);
  });

  it("still asks before a grave act, at every level", () => {
    for (const trust of ["ask", "trusted", "auto"]) {
      expect(autoAllow(grave("rm -rf src"), { trust })).toBe(false);
      expect(autoAllow(grave("git push origin main"), { trust })).toBe(false);
      // node_modules is junctioned to the main checkout, which is why this one
      // was grave in the first place.
      expect(autoAllow(grave("npm install three"), { trust })).toBe(false);
    }
  });

  it("still asks before a write that leaves the worktree, at every level", () => {
    for (const trust of ["ask", "trusted", "auto"]) {
      expect(autoAllow(write("../../.env.local"), { trust })).toBe(false);
      expect(autoAllow(describeTool("Write", { file_path: "C:/Users/honey/.claude/settings.json" }, "C:/wt/app"), { trust })).toBe(false);
    }
  });

  it("holds an MCP tool back until Auto, because its reach cannot be read", () => {
    const mcp = describeTool("mcp__blender__execute_blender_code", { code: "x" }, "C:/wt/app");
    expect(mcp.mcp).toBe(true);
    expect(autoAllow(mcp, { trust: "trusted" })).toBe(false);
    expect(autoAllow(mcp, { trust: "auto" })).toBe(true);
  });

  it("keeps strict as the override it always was", () => {
    expect(autoAllow(read, { strict: true, trust: "auto" })).toBe(false);
    expect(autoAllow(write("src/a.ts"), { strict: true, trust: "auto" })).toBe(false);
  });
});
