import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fillFromCheckouts, keyNames, loadIntoEnv, missingFrom, normalizeRemote, parseEnv, shareable } from "./keys.mjs";

function checkout(root, name, env, pkg = "ultimate-assistant-os") {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg }));
  if (env !== null) writeFileSync(join(dir, ".env.local"), env);
  return dir;
}

describe("normalizeRemote", () => {
  it("treats https, ssh and .git forms of one repo as the same", () => {
    const want = "github.com/legacymiles/ultimate-assistant-os";
    expect(normalizeRemote("https://github.com/legacymiles/ultimate-assistant-os.git")).toBe(want);
    expect(normalizeRemote("git@github.com:legacymiles/ultimate-assistant-os.git")).toBe(want);
    expect(normalizeRemote("https://user:tok@github.com/LegacyMiles/ultimate-assistant-os/\n")).toBe(want);
  });
});

describe("parseEnv", () => {
  it("reads quotes, comments, export and blanks", () => {
    const m = parseEnv('# c\nA=1\nexport B="two words"\nC=\nD=x # note\r\n');
    expect(m.get("A")).toBe("1");
    expect(m.get("B")).toBe("two words");
    expect(m.get("C")).toBe("");
    expect(m.get("D")).toBe("x");
  });
});

describe("what is shared", () => {
  it("never shares Claude Code's own login variables", () => {
    expect(shareable("ANTHROPIC_AUTH_TOKEN", "x")).toBe(false);
    expect(shareable("ANTHROPIC_API_KEY", "x")).toBe(false);
    expect(shareable("CLAUDE_CODE_OAUTH_TOKEN", "x")).toBe(false);
    expect(shareable("OPENROUTER_API_KEY", "sk-or")).toBe(true);
    expect(shareable("OPENROUTER_API_KEY", "  ")).toBe(false);
  });

  it("fills only blanks, newest checkout first", () => {
    const own = new Map([["AA_KEY", "mine"], ["BB_KEY", ""]]);
    const add = missingFrom(own, [
      { vars: new Map([["AA_KEY", "theirs"], ["BB_KEY", "new"], ["CC_KEY", "c1"]]), from: "newer" },
      { vars: new Map([["CC_KEY", "c2"], ["DD_KEY", "d"]]), from: "older" },
    ]);
    expect(add.has("AA_KEY")).toBe(false);
    expect(add.get("BB_KEY")?.value).toBe("new");
    expect(add.get("CC_KEY")?.value).toBe("c1");
    expect(add.get("DD_KEY")?.from).toBe("older");
  });
});

describe("fillFromCheckouts", () => {
  it("copies a key entered in another checkout of the same repo, and nothing else", () => {
    const root = mkdtempSync(join(tmpdir(), "keys-"));
    const repo = checkout(root, "front", "# mine\nFISH_API_KEY=fish-mine\nOPENROUTER_API_KEY=\n");
    const old = checkout(root, "old", "OPENROUTER_API_KEY=sk-or-old\nFISH_API_KEY=fish-old\nANTHROPIC_AUTH_TOKEN=nope\n");
    const newer = checkout(root, "newer", "OPENROUTER_API_KEY=sk-or-new\nORCAROUTER_API_KEY=orca\n");
    checkout(root, "unrelated", "SECRET_KEY=other-product\n", "some-other-app");
    utimesSync(join(old, ".env.local"), new Date(2026, 0, 1), new Date(2026, 0, 1));
    utimesSync(join(newer, ".env.local"), new Date(2026, 10, 1), new Date(2026, 10, 1));

    const r = fillFromCheckouts(repo, { roots: [root] });
    expect(r.added.sort()).toEqual(["OPENROUTER_API_KEY", "ORCAROUTER_API_KEY"]);
    const text = readFileSync(join(repo, ".env.local"), "utf8");
    expect(text).toContain("OPENROUTER_API_KEY=sk-or-new");
    expect(text).toContain("FISH_API_KEY=fish-mine");
    expect(text).not.toContain("fish-old");
    expect(text).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(text).not.toContain("other-product");
    expect(text.startsWith("# mine")).toBe(true);

    // Running again adds nothing: the promise is "once".
    expect(fillFromCheckouts(repo, { roots: [root] }).added).toEqual([]);
  });

  it("creates the file when this checkout has none", () => {
    const root = mkdtempSync(join(tmpdir(), "keys-"));
    const repo = checkout(root, "front", null);
    checkout(root, "old", "OPENROUTER_API_KEY=sk-or-old\n");
    expect(fillFromCheckouts(repo, { roots: [root] }).added).toEqual(["OPENROUTER_API_KEY"]);
    expect(readFileSync(join(repo, ".env.local"), "utf8")).toContain("OPENROUTER_API_KEY=sk-or-old");
  });
});

describe("loadIntoEnv", () => {
  it("gives the helper the keys, refreshes ones it loaded, leaves the real env alone", () => {
    const root = mkdtempSync(join(tmpdir(), "keys-"));
    const repo = checkout(root, "front", "OPENROUTER_API_KEY=one\nRESEND_API_KEY=r\nANTHROPIC_AUTH_TOKEN=nope\n");
    const env = { RESEND_API_KEY: "from-real-env", PATH: "x" };
    loadIntoEnv(repo, env);
    expect(env.OPENROUTER_API_KEY).toBe("one");
    expect(env.RESEND_API_KEY).toBe("from-real-env");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();

    writeFileSync(join(repo, ".env.local"), "OPENROUTER_API_KEY=two\n");
    loadIntoEnv(repo, env);
    expect(env.OPENROUTER_API_KEY).toBe("two");
    expect(keyNames(env)).toEqual(["OPENROUTER_API_KEY", "RESEND_API_KEY"]);
  });
});
