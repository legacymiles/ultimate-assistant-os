import { describe, expect, it } from "vitest";

import {
  MAX_ROUNDS, afterRun, crawlLinks, fingerprint, finishLinks, isPublicAddress, judgeResponse,
  designFailures, designPlan, managerOf, planChecks, repairPrompt, resumeAction, sameFailures, scrubEnv,
} from "./harness-verify.mjs";

const NEXT_APP = {
  scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint", test: "vitest run" },
  dependencies: { next: "15.0.0" },
  devDependencies: { typescript: "5.6.0", vitest: "2.1.9" },
};
const ids = (plan) => plan.steps.map((s) => s.id);

describe("which checks a folder gets", () => {
  it("a new project installs, typechecks, lints, tests, builds and starts", () => {
    const plan = planChecks({ pkg: NEXT_APP, names: ["package.json", "package-lock.json", "tsconfig.json"], project: true, has: {} });
    expect(ids(plan)).toEqual(["install", "typecheck", "lint", "test", "build"]);
    expect(plan.steps[0].run.shell).toBe("npm ci");
    expect(plan.boot).toEqual({ kind: "shell", command: "npm run start" });
  });

  it("never installs or builds in a hub worktree, and tests only what changed", () => {
    // No `modules: true` here on purpose: the ONLY thing stopping an install
    // must be that this is not a project folder.
    const plan = planChecks({ pkg: NEXT_APP, names: ["package.json", "tsconfig.json"], project: false, base: "main", has: { devPreview: true } });
    expect(ids(plan)).toEqual(["typecheck", "lint", "test"]);
    expect(plan.steps[2].run.node).toEqual(["node_modules/vitest/vitest.mjs", "run", "--changed", "main"]);
    expect(plan.boot).toEqual({ kind: "node", args: ["scripts/dev-preview.mjs", "{port}", "--no-auth"] });
  });

  it("skips install when the packages are already there, or there are none to install", () => {
    expect(ids(planChecks({ pkg: NEXT_APP, names: ["package.json"], project: true, has: { modules: true } }))).not.toContain("install");
    expect(ids(planChecks({ pkg: { scripts: { build: "node build.mjs" } }, names: ["package.json"], project: true, has: {} }))).toEqual(["build"]);
  });

  it("lint is advice, never a failure", () => {
    const lint = planChecks({ pkg: NEXT_APP, names: ["package.json"], project: true, has: { modules: true } }).steps.find((s) => s.id === "lint");
    expect(lint.advisory).toBe(true);
  });

  it("will not put a strange base name on a command line", () => {
    const test = planChecks({ pkg: NEXT_APP, names: ["package.json"], project: false, base: "main; rm -rf .", has: { modules: true } }).steps.find((s) => s.id === "test");
    expect(test.run.shell).toBe("npm run test");
    const dashed = planChecks({ pkg: NEXT_APP, names: ["package.json"], project: false, base: "--config=evil", has: { modules: true } }).steps.find((s) => s.id === "test");
    expect(dashed.run.shell).toBe("npm run test");
  });

  it("does not count npm's placeholder test script as a test", () => {
    const pkg = { scripts: { test: 'echo "Error: no test specified" && exit 1', build: "node build.mjs" } };
    expect(ids(planChecks({ pkg, names: ["package.json"], project: true, has: {} }))).toEqual(["build"]);
  });

  it("survives a folder it could not read", () => {
    expect(planChecks({ pkg: null, names: null, has: null, base: null })).toEqual({ pm: "npm", steps: [], boot: null, design: null });
  });

  it("uses the lockfile's package manager", () => {
    expect(managerOf(["pnpm-lock.yaml"])).toBe("pnpm");
    expect(managerOf(["yarn.lock"])).toBe("yarn");
    expect(managerOf(["bun.lockb"])).toBe("bun");
    expect(managerOf(["package-lock.json"])).toBe("npm");
  });

  it("falls back to dev, then to a plain folder with an index.html, then to nothing", () => {
    expect(planChecks({ pkg: { scripts: { dev: "vite" } }, names: [], project: true, has: {} }).boot).toEqual({ kind: "shell", command: "npm run dev" });
    expect(planChecks({ pkg: null, names: ["index.html"], project: true, has: { staticDir: "." } }).boot).toEqual({ kind: "static", dir: "." });
    expect(planChecks({ pkg: null, names: [], project: true, has: {} }).boot).toBeNull();
  });
});

describe("the environment the app under test gets", () => {
  it("keeps what a process needs and drops every key", () => {
    const env = scrubEnv({ Path: "C:\\bin", SystemRoot: "C:\\Windows", OPENROUTER_API_KEY: "sk-1", SUPABASE_SERVICE_ROLE_KEY: "x", ANTHROPIC_AUTH_TOKEN: "y" }, { PORT: "4100" });
    expect(env).toEqual({ Path: "C:\\bin", SystemRoot: "C:\\Windows", CI: "1", NO_COLOR: "1", PORT: "4100" });
  });
});

describe("telling two failures apart", () => {
  it("is the same id when only paths, line numbers and timings differ", () => {
    const a = fingerprint({ step: "typecheck", evidence: "C:\\Users\\a\\proj\\src\\app.ts(3,7): error TS2322 in 1.2s" });
    const b = fingerprint({ step: "typecheck", evidence: "C:\\other\\src\\app.ts(9,1): error TS2322 in 4.8s" });
    expect(a).toBe(b);
  });
  it("is a different id for a different error or a different page", () => {
    expect(fingerprint({ step: "crawl", page: "/a", evidence: "x is not defined" })).not.toBe(fingerprint({ step: "crawl", page: "/b", evidence: "x is not defined" }));
    expect(fingerprint({ step: "build", evidence: "Module not found" })).not.toBe(fingerprint({ step: "build", evidence: "Type error" }));
    // Two different compiler errors on the same line are two failures.
    expect(fingerprint({ step: "typecheck", evidence: "app.ts(3,7): error TS2322" })).not.toBe(fingerprint({ step: "typecheck", evidence: "app.ts(3,7): error TS2345" }));
  });
  it("only calls two runs the same when both failed the same things", () => {
    expect(sameFailures(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameFailures(["a"], ["a", "b"])).toBe(false);
    expect(sameFailures([], [])).toBe(false);
    expect(sameFailures(["x", "x"], ["x", "y"])).toBe(false);
  });
  it("is the same id when only a timestamp or a size differs", () => {
    expect(fingerprint({ step: "build", evidence: "at 2026-11-10T12:34:56.789Z boom, bundle 2.5kB" }))
      .toBe(fingerprint({ step: "build", evidence: "at 2026-11-11T01:02:03.004Z boom, bundle 2.7kB" }));
  });
});

describe("what happens after a check", () => {
  it("passes", () => {
    expect(afterRun({ passed: true, ids: [] }).state).toBe("passed");
  });
  it("sends a first failure back to be fixed", () => {
    expect(afterRun({ passed: false, ids: ["a"], lastIds: [], rounds: 0 }).state).toBe("repairing");
  });
  it("stops when the same failures come back", () => {
    const r = afterRun({ passed: false, ids: ["a"], lastIds: ["a"], rounds: 1 });
    expect(r.state).toBe("failed");
    expect(r.why).toMatch(/twice in a row/);
  });
  it("still repairs on the last round it is allowed", () => {
    expect(afterRun({ passed: false, ids: ["c"], lastIds: ["b"], rounds: MAX_ROUNDS - 1 }).state).toBe("repairing");
  });
  it("stops after the last round", () => {
    const r = afterRun({ passed: false, ids: ["c"], lastIds: ["b"], rounds: MAX_ROUNDS });
    expect(r.state).toBe("failed");
    expect(r.why).toContain(String(MAX_ROUNDS));
  });
  it("never repairs when asked only to look", () => {
    expect(afterRun({ passed: false, ids: ["a"], repair: false }).state).toBe("failed");
  });
});

describe("the message the agent gets", () => {
  const report = {
    failures: [
      { step: "typecheck", title: "Typecheck failed", ran: "node node_modules/typescript/bin/tsc --noEmit", page: "", evidence: "src/app.ts(3,7): error TS2322" },
      { step: "crawl", title: "A page threw an error: /settings", ran: "", page: "/settings", evidence: "settings is not defined" },
    ],
  };
  it("names every failure with what ran and what it said", () => {
    const text = repairPrompt(report, { round: 2, max: 3 });
    expect(text).toContain("round 2 of 3");
    expect(text).toContain("Typecheck failed");
    expect(text).toContain("error TS2322");
    expect(text).toContain("Page: /settings");
    expect(text).toMatch(/Do not delete, skip or weaken/);
  });
  it("counts what it leaves out", () => {
    const many = { failures: Array.from({ length: 11 }, (_, i) => ({ step: "crawl", title: `t${i}`, evidence: "e" })) };
    expect(repairPrompt(many, { round: 1, max: 3 })).toContain("and 3 more");
  });
});

describe("judging what the crawl saw", () => {
  const origin = "http://127.0.0.1:4100";
  it("fails a server error and a missing page or file", () => {
    expect(judgeResponse({ url: `${origin}/x`, origin, status: 500 })).toBe("fail");
    expect(judgeResponse({ url: `${origin}/missing`, origin, status: 404 })).toBe("fail");
    expect(judgeResponse({ url: `${origin}/login`, origin, status: 403, document: true })).toBe("fail");
  });
  it("only notes a 4xx from the app's own API", () => {
    expect(judgeResponse({ url: `${origin}/api/me`, origin, status: 401 })).toBe("note");
    expect(judgeResponse({ url: `${origin}/api/me`, origin, status: 500 })).toBe("fail");
  });
  it("ignores other sites and good answers", () => {
    expect(judgeResponse({ url: "https://fonts.googleapis.com/css", origin, status: 404 })).toBe("");
    expect(judgeResponse({ url: `${origin}/`, origin, status: 200 })).toBe("");
  });
  it("follows only this app's own pages", () => {
    expect(crawlLinks([`${origin}/about#team`, `${origin}/about`, `${origin}/api/x`, "https://x.com/a", "mailto:a@b.c", `${origin}/file.pdf`, `${origin}/shop?p=2`], origin))
      .toEqual(["/about", "/shop?p=2"]);
  });
  it("does not follow a link that does something instead of showing something", () => {
    const acts = ["/logout", "/log-out", "/signout", "/auth/sign-out", "/Delete/3", "/items/3/remove", "/account/DESTROY", "/delete?id=3"];
    expect(crawlLinks(acts.map((p) => `${origin}${p}`), origin)).toEqual([]);
    // Only a whole segment counts: these are pages that merely start the same.
    const pages = ["/deleted-items", "/removal", "/logouts", "/blog/how-to-delete-a-file", "/about"];
    expect(crawlLinks(pages.map((p) => `${origin}${p}`), origin)).toEqual(pages);
  });
});

describe("which addresses the bridge will fetch", () => {
  const no = (url) => expect(isPublicAddress(url), url).toBe(false);
  it("fetches an ordinary public site", () => {
    expect(isPublicAddress("https://a.vercel.app")).toBe(true);
    expect(isPublicAddress("http://example.com:8080/apps/x?y=1")).toBe(true);
    expect(isPublicAddress("https://8.8.8.8/")).toBe(true);
    expect(isPublicAddress("https://[2606:4700:4700::1111]/")).toBe(true);
    // Public addresses that only sit next to a private range.
    expect(isPublicAddress("http://172.15.0.1/")).toBe(true);
    expect(isPublicAddress("http://172.32.0.1/")).toBe(true);
    expect(isPublicAddress("http://11.0.0.1/")).toBe(true);
    expect(isPublicAddress("http://192.169.0.1/")).toBe(true);
    expect(isPublicAddress("https://localhost.example.com/")).toBe(true);
  });
  it("never anything that is not a web address", () => {
    ["", "not a url", "ftp://example.com/x", "file:///C:/Users/a/secret.txt", "javascript:alert(1)", null, undefined].forEach(no);
  });
  it("never this PC by name", () => {
    ["http://localhost", "http://LOCALHOST:3000/x", "http://localhost./", "http://app.localhost:3000", "http://user:pw@localhost/"].forEach(no);
  });
  it("never a name that only exists on a private network", () => {
    ["http://printer.local/", "http://nas.LOCAL:5000", "http://metadata.google.internal/computeMetadata/v1/", "https://db.corp.internal"].forEach(no);
  });
  it("never IPv4 loopback, however it is spelled", () => {
    ["http://127.0.0.1:42020/", "http://127.1.2.3/", "http://127.1/", "http://2130706433/", "http://0x7f.0.0.1/", "http://0.0.0.0:3000/"].forEach(no);
  });
  it("never a private IPv4 network", () => {
    ["http://10.0.0.5/", "http://10.255.255.255/", "http://172.16.0.1/", "http://172.31.255.254/", "http://192.168.1.1/admin"].forEach(no);
  });
  it("never a link-local IPv4 address, where cloud machines keep their keys", () => {
    ["http://169.254.169.254/latest/meta-data/", "http://169.254.0.1/"].forEach(no);
  });
  it("never IPv6 loopback, link-local or unique-local", () => {
    [
      "http://[::1]:3000/", "http://[0:0:0:0:0:0:0:1]/", "http://[::]/",
      "http://[fe80::1]/", "http://[febf::1]/",
      "http://[fc00::1]/", "http://[fd12:3456:789a::1]/",
      // IPv4 written inside an IPv6 address is still that IPv4 address.
      "http://[::ffff:127.0.0.1]/", "http://[::ffff:192.168.1.1]/",
    ].forEach(no);
    expect(isPublicAddress("http://[fec0::1]/")).toBe(true);
    expect(isPublicAddress("http://[::ffff:8.8.8.8]/")).toBe(true);
  });
});

describe("reading the finish lines", () => {
  it("takes the last live address, and nothing for `none`", () => {
    expect(finishLinks("Repo: https://github.com/a/b\nLive: https://a.vercel.app.").live).toBe("https://a.vercel.app");
    expect(finishLinks("PR: https://github.com/a/b/pull/1\nPreview: https://b.vercel.app/apps/x").live).toBe("https://b.vercel.app/apps/x");
    expect(finishLinks("Preview: none\nThe deploy failed.").live).toBe("");
    expect(finishLinks("Live: https://old.app\nsome words\nLive: https://new.app").live).toBe("https://new.app");
    expect(finishLinks("Live: https://prod.app\nPreview: none").live).toBe("https://prod.app");
    expect(finishLinks("Live: <https://a.app>").live).toBe("https://a.app");
    expect(finishLinks("Live: `https://a.app`").live).toBe("https://a.app");
    expect(finishLinks("Live: https://en.wikipedia.org/wiki/Foo_(bar)").live).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
    expect(finishLinks("(Live: https://a.app)").live).toBe("");
  });
});

describe("a restart", () => {
  it("re-runs the check when it died mid-check, and re-sends the brief otherwise", () => {
    expect(resumeAction({ verify: { state: "checking" } })).toBe("verify");
    expect(resumeAction({ verify: { state: "repairing" } })).toBe("verify");
    expect(resumeAction({ verify: { state: "failed" } })).toBe("prompt");
    expect(resumeAction({ verify: { state: "idle" } })).toBe("prompt");
    expect(resumeAction({})).toBe("prompt");
  });
});

describe("the design check, run by the bridge", () => {
  const SITE = { scripts: { start: "node server.mjs" } };

  it("comes after the crawl of anything it can start, and judges the home page by default", () => {
    const plan = planChecks({ pkg: SITE, names: ["package.json"], project: true, has: {} });
    expect(plan.design).toEqual({ id: "design", label: "Design check", limit: 300_000, important: ["/"], follow: true, source: true, maxPages: 6 });
  });

  it("in a worktree judges only the pages the thread was started with, and reads no source", () => {
    const plan = planChecks({ pkg: NEXT_APP, names: ["package.json"], project: false, base: "main", has: { modules: true, devPreview: true }, paths: ["/apps/cook-connect", "/apps/cook-connect"] });
    expect(plan.design).toMatchObject({ important: ["/apps/cook-connect"], follow: false, source: false, maxPages: 1 });
  });

  it("is not planned when there is nothing to start, or when it is switched off", () => {
    expect(planChecks({ pkg: { scripts: { build: "tsc" } }, names: ["package.json"], project: true, has: {} }).design).toBeNull();
    expect(planChecks({ pkg: SITE, names: ["package.json"], project: true, has: {}, design: false }).design).toBeNull();
  });

  it("only takes site-relative pages as important", () => {
    expect(designPlan({ paths: ["//evil.example", "https://x.example/", 3, "/ok"] }).important).toEqual(["/ok"]);
    expect(designPlan({ paths: [] }).important).toEqual(["/"]);
  });

  const verdict = (fails) => ({ pass: !fails.length, score: 5, fails, warnings: [] });
  const noStandout = (port, width) => ({ rule: "no-standout", severity: "fail", where: `http://127.0.0.1:${port}/pricing @ ${width}px`, message: "Nothing on this page is memorable.", fix: "Give it one data-standout." });

  it("turns each must-fix finding into a failure, by page and rule, without the port or the width", () => {
    const found = designFailures(verdict([noStandout(4100, 1440), noStandout(4100, 390), { rule: "placeholder-copy", severity: "fail", where: "src/app/page.tsx", message: "Lorem ipsum is still on the page.", fix: "Write the real words." }]));
    expect(found.map((f) => [f.step, f.page, f.rule])).toEqual([["design", "/pricing", "no-standout"], ["design", "src/app/page.tsx", "placeholder-copy"]]);
    expect(found[0].evidence).toBe("Nothing on this page is memorable.\nFix: Give it one data-standout.");
  });

  it("keeps the same id when the same problem comes back on a new port, so a repair that changed nothing is seen", () => {
    const a = designFailures(verdict([noStandout(4100, 1440)])).map((f) => f.id);
    const b = designFailures(verdict([noStandout(5233, 1440)])).map((f) => f.id);
    expect(a).toEqual(b);
    expect(sameFailures(a, b)).toBe(true);
  });

  it("hands the agent the design check's own report, with every fix, and how to run it again", () => {
    const failures = [
      { id: "t", step: "test", title: "Its own tests failed", ran: "npm run test", evidence: "1 failed" },
      ...designFailures(verdict([noStandout(4100, 1440)])),
    ];
    const text = repairPrompt({ failures, design: { important: ["/pricing"], text: "Design check: FAIL · score 7.5/10\nMust fix:\n- [no-standout] /pricing — Nothing on this page is memorable. Fix: Give it one data-standout." } });
    expect(text).toContain("2 checks failed");
    expect(text).toContain("## Its own tests failed");
    expect(text).toContain("## The design check failed (1 must-fix)");
    expect(text).toContain("Fix: Give it one data-standout.");
    expect(text).toContain('node "$JARVIS_DESIGN_CHECK" <the app\'s local address> --important /pricing');
    // Said once, in the report, not again as a block of its own.
    expect(text).not.toContain("## Design check: no-standout");
  });
});
