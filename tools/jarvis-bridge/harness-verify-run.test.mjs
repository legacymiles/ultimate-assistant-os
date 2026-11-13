import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer as createNet } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { planChecks, scrubEnv } from "./harness-verify.mjs";
import { asFailure, canBrowse, checkLive, freePort, readFacts, runGate, runStep, startApp } from "./harness-verify-run.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "verify");
const fx = (name) => path.join(FIX, name);

// Every folder this file makes in %TEMP%, so the run can take them away again.
// Only these: other runs, and the bridge itself, keep reports there too.
const made = [];
const out = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jarvis-verify-"));
  made.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** Can this PC listen on IPv6 loopback at all? Some have it switched off. */
const ipv6 = await new Promise((resolve) => {
  const probe = createNet();
  probe.once("error", () => resolve(false));
  probe.listen(0, "::1", () => probe.close(() => resolve(true)));
});

describe("reading a folder", () => {
  it("finds the scripts and plans a build and a start", () => {
    const facts = readFacts(fx("clean"));
    expect(facts.pkg.scripts.build).toBe("node build.mjs");
    const plan = planChecks({ ...facts, project: true });
    expect(plan.steps.map((s) => s.id)).toEqual(["build"]);
    expect(plan.boot.kind).toBe("shell");
  });
});

describe("running one step", () => {
  it("passes a build that exits 0", async () => {
    const [build] = planChecks({ ...readFacts(fx("clean")), project: true }).steps;
    const row = await runStep(build, { cwd: fx("clean"), env: scrubEnv(process.env) });
    expect(row).toMatchObject({ id: "build", ok: true, skipped: false });
    expect(row.tail).toContain("built");
  }, 30_000);

  it("fails a build that exits 1, and keeps what it said", async () => {
    const [build] = planChecks({ ...readFacts(fx("build-fails")), project: true }).steps;
    const row = await runStep(build, { cwd: fx("build-fails"), env: scrubEnv(process.env) });
    expect(row.ok).toBe(false);
    expect(row.tail).toContain("TS2322");
  }, 30_000);

  it("kills a step that runs past its ceiling", async () => {
    const row = await runStep(
      { id: "test", label: "Its own tests", limit: 500, run: { node: ["-e", "setInterval(() => {}, 1000)"] } },
      { cwd: fx("clean"), env: scrubEnv(process.env) },
    );
    expect(row.ok).toBe(false);
    expect(row.tail).toMatch(/was stopped/);
  }, 15_000);

  it("never hands the owner's keys to what it runs", async () => {
    const row = await runStep(
      { id: "test", label: "Its own tests", limit: 10_000, run: { node: ["-e", "console.log(Object.keys(process.env).join(','))"] } },
      { cwd: fx("clean"), env: scrubEnv({ ...process.env, OPENROUTER_API_KEY: "sk-test", SUPABASE_SERVICE_ROLE_KEY: "x" }) },
    );
    expect(row.tail).not.toMatch(/OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
    expect(row.tail).toMatch(/CI/);
  }, 15_000);
});

describe("starting the app", () => {
  it("starts it on a free port and stops it again", async () => {
    const { boot } = planChecks({ ...readFacts(fx("clean")), project: true });
    const app = await startApp({ cwd: fx("clean"), boot, env: scrubEnv(process.env) });
    try {
      const res = await fetch(`${app.url}/about`);
      expect(res.status).toBe(200);
    } finally {
      await app.stop();
    }
  }, 60_000);

  it("serves a plain folder that has only an index.html", async () => {
    const app = await startApp({ cwd: FIX, boot: { kind: "static", dir: "static" }, env: {} });
    try {
      expect((await fetch(`${app.url}/`)).status).toBe(200);
      expect((await fetch(`${app.url}/nope.html`)).status).toBe(404);
      expect((await fetch(`${app.url}/..%2Fserve.mjs`)).status).not.toBe(200);
    } finally {
      await app.stop();
    }
  }, 30_000);

  it("hands out a port nothing is using", async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(1023);
  });

  // Skipped, and only these two, on a PC with no IPv6 loopback: there is
  // nothing for the app to listen on there.
  it.skipIf(!ipv6)("finds an app that answers on IPv6 only (needs IPv6 loopback on this PC)", async () => {
    const { boot } = planChecks({ ...readFacts(fx("ipv6-only")), project: true });
    const app = await startApp({ cwd: fx("ipv6-only"), boot, env: scrubEnv(process.env), limit: 30_000 });
    try {
      expect(app.url).toMatch(/^http:\/\/\[::1\]:\d+$/);
      expect((await fetch(`${app.url}/`)).status).toBe(200);
    } finally {
      await app.stop();
    }
  }, 60_000);

  it.skipIf(!ipv6)("finds one that chose its own port and answers on IPv6 only (needs IPv6 loopback on this PC)", async () => {
    const { boot } = planChecks({ ...readFacts(fx("ipv6-only")), project: true });
    const app = await startApp({ cwd: fx("ipv6-only"), boot, env: { ...scrubEnv(process.env), OWN_PORT: "1" }, limit: 30_000 });
    try {
      expect(app.url).toMatch(/^http:\/\/\[::1\]:\d+$/);
      expect(app.log()).toContain(`http://localhost:${new URL(app.url).port}/`);
      expect((await fetch(`${app.url}/`)).status).toBe(200);
    } finally {
      await app.stop();
    }
  }, 60_000);
});

const browser = await canBrowse();
const gate = (name, extra = {}) => runGate({ cwd: fx(name), project: true, dir: out(), ...extra });

describe("a PC that cannot open a browser", () => {
  it("is not a pass and not the build's fault: the gate says it is broken", async () => {
    const dir = out();
    const launch = async () => {
      throw new Error("browserType.launch: Executable doesn't exist at C:\\nowhere\\chrome.exe\nLooks like Playwright was just installed.");
    };
    const report = await runGate({ cwd: fx("clean"), project: true, dir, launch });
    expect(report.passed).toBe(false);
    expect(report.broken).toBe(true);
    expect(report.brokenWhy).toContain("Executable doesn't exist");
    expect(report.brokenWhy).not.toContain("just installed");
    expect(report.failures).toEqual([]);
    expect(report.pages).toEqual([]);
    expect(report.steps.find((s) => s.id === "boot").ok).toBe(true);
    expect(JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8"))).toMatchObject({ passed: false, broken: true });
  }, 60_000);

  it("still sends back what the build itself got wrong", async () => {
    const launch = async () => {
      throw new Error("browserType.launch: Executable doesn't exist");
    };
    const report = await runGate({ cwd: fx("test-fails"), project: true, dir: out(), launch });
    expect(report.passed).toBe(false);
    // Its own tests failed: that is the agent's to fix, so the run is not "broken".
    expect(report.broken).toBeUndefined();
    expect(report.failures.map((f) => f.step)).toEqual(["test"]);
    expect(report.failures[0].evidence).toContain("books a walker");
    expect(report.advice.join("\n")).toMatch(/browser could not start/i);
  }, 60_000);
});

/**
 * A real hidden browser that dies while loading its Nth page, the way one does
 * when the PC runs out of memory part-way through a crawl.
 */
const diesOnPage = (n) => async () => {
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: true });
  const newContext = b.newContext.bind(b);
  let opened = 0;
  b.newContext = async (options) => {
    const cx = await newContext(options);
    const newPage = cx.newPage.bind(cx);
    cx.newPage = async () => {
      const page = await newPage();
      const goto = page.goto.bind(page);
      page.goto = async (...args) => {
        if (++opened >= n) await b.close();
        return goto(...args);
      };
      return page;
    };
    return cx;
  };
  return b;
};

describe.skipIf(!browser)("the whole gate, on a real little app", () => {
  it("passes a clean app and leaves a report and two pictures", async () => {
    const dir = out();
    const report = await runGate({ cwd: fx("clean"), project: true, dir });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.pages.map((p) => p.url).sort()).toEqual(["/", "/about"]);
    expect(JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")).passed).toBe(true);
    expect(existsSync(path.join(dir, "home-1280.jpg"))).toBe(true);
    expect(existsSync(path.join(dir, "home-390.jpg"))).toBe(true);
  }, 120_000);

  it("fails a build that does not build, and does not try to start it", async () => {
    const report = await gate("build-fails");
    expect(report.passed).toBe(false);
    expect(report.failures.map((f) => f.step)).toEqual(["build"]);
    expect(report.failures[0].evidence).toContain("TS2322");
    expect(report.steps.find((s) => s.id === "boot").skipped).toBe(true);
  }, 120_000);

  it("fails a page that throws, and names the page", async () => {
    const report = await gate("page-throws");
    const hit = report.failures.find((f) => f.page === "/settings");
    expect(hit?.evidence).toContain("settings is not defined");
    expect(report.passed).toBe(false);
  }, 120_000);

  it("fails a link to a page that is not there", async () => {
    const report = await gate("dead-link");
    expect(report.failures.some((f) => f.page === "/missing" && /404/.test(f.evidence))).toBe(true);
    // The status is part of what the failure IS, so it is part of its id.
    expect(report.failures.find((f) => f.page === "/missing").id).toContain("/missing:status:404");
  }, 120_000);

  it("keeps what it found when the browser dies part-way, and sends that back", async () => {
    const report = await gate("shared-broken", { launch: diesOnPage(2) });
    expect(report.pages.map((p) => p.url)).toEqual(["/"]);
    expect(report.failures.map((f) => f.page)).toEqual(["/logo.png"]);
    expect(report.failures.some((f) => /did not load/i.test(f.title))).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.broken).toBeUndefined();
    expect(report.advice.join("\n")).toMatch(/browser stopped/i);
    expect(report.steps.find((s) => s.id === "crawl").ok).toBe(false);
  }, 120_000);

  it("is broken, not passed, when the browser dies before it found anything", async () => {
    const report = await gate("clean", { launch: diesOnPage(2) });
    expect(report.pages.map((p) => p.url)).toEqual(["/"]);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(false);
    expect(report.broken).toBe(true);
    expect(report.brokenWhy).toMatch(/browser stopped/i);
  }, 120_000);

  it("names the missing viewport tag instead of blaming the layout", async () => {
    const report = await gate("no-viewport");
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].title).toMatch(/viewport/i);
    expect(report.failures[0].evidence).toContain('<meta name="viewport"');
    expect(report.failures[0].evidence).not.toMatch(/px wide/);
    expect(report.failures[0].page).toBe("/");
  }, 120_000);

  it("still fails a page that has the tag and really is too wide for a phone", async () => {
    const report = await gate("too-wide");
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].title).toMatch(/sideways/);
    expect(report.failures[0].evidence).toMatch(/9\d\dpx wide on a 390px screen/);
  }, 120_000);

  it("does not call a download a page that failed to load", async () => {
    const report = await gate("download-link");
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.pages.map((p) => p.url)).toEqual(["/", "/about"]);
  }, 120_000);

  it("counts the app's own console errors and not another site's", async () => {
    const report = await gate("console-noise");
    expect(report.failures.map((f) => [f.page, f.evidence])).toEqual([["/own", "the cart could not be read"]]);
    expect(report.pages.find((p) => p.url === "/").errors).toEqual([]);
  }, 120_000);

  it("reports one broken file once, however many pages use it", async () => {
    const report = await gate("shared-broken");
    expect(report.pages.map((p) => p.url)).toEqual(["/", "/a", "/b"]);
    expect(report.failures.map((f) => f.page)).toEqual(["/logo.png"]);
    expect(report.passed).toBe(false);
  }, 120_000);

  it("starts the app with none of the keys the bridge holds", async () => {
    const report = await gate("prints-env", { env: { ...process.env, OPENROUTER_API_KEY: "sk-test", STRIPE_SECRET_KEY: "x" } });
    expect(report.failures).toEqual([]);
  }, 120_000);

  it("in a worktree it opens only the pages it was told to, and follows no links", async () => {
    const report = await runGate({ cwd: fx("clean"), project: false, dir: out() });
    expect(report.pages.map((p) => p.url)).toEqual(["/"]);
  }, 120_000);

  it("says so when there was nothing it could check", async () => {
    const report = await runGate({ cwd: out(), project: true, dir: out() });
    expect(report.passed).toBe(false);
    expect(report.failures[0].title).toMatch(/nothing to check/i);
  }, 60_000);
});

describe("a crawl failure's id", () => {
  const answered = (status) => asFailure({ kind: "status", where: "/missing", status, evidence: `${status} GET http://127.0.0.1:4100/missing` });
  it("changes when a page goes from missing to crashing", () => {
    expect(answered(404).id).not.toBe(answered(500).id);
    expect(answered(404).id).toBe(asFailure({ kind: "status", where: "/missing", status: 404, evidence: "404 GET http://127.0.0.1:52001/missing" }).id);
  });
  it("leaves the page itself as the plain path", () => {
    expect(answered(404).page).toBe("/missing");
    expect(answered(500).title).toBe("A page or file answered with an error: /missing");
  });
});

describe("a live address the agent should not be able to send the bridge to", () => {
  it("is not fetched when it points at this PC, and says why", async () => {
    let hits = 0;
    const server = createHttp((req, res) => {
      hits += 1;
      res.end("private");
    });
    await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
    try {
      const live = `http://127.0.0.1:${server.address().port}/admin`;
      // An empty folder: this is about the live address, not about a build.
      const report = await runGate({ cwd: out(), project: true, dir: out(), text: `Repo: none\nLive: ${live}` });
      const step = report.steps.find((s) => s.id === "live");
      expect(hits).toBe(0);
      expect(step.skipped).toBe(true);
      expect(step.tail).toContain(live);
      expect(report.failures.some((f) => f.step === "live")).toBe(false);
      expect(report.advice.some((a) => a.includes(live))).toBe(true);
    } finally {
      server.closeAllConnections?.();
      await new Promise((closed) => server.close(closed));
    }
  }, 30_000);
});

describe("the live address", () => {
  const fake = (status, location = "") => async () => ({ status, headers: { get: () => location } });
  it("passes one that answers", async () => {
    expect((await checkLive("https://a.vercel.app", fake(200))).ok).toBe(true);
  });
  it("fails one behind Vercel's login, with the fix", async () => {
    const r = await checkLive("https://a.vercel.app", fake(307, "https://vercel.com/sso/access"));
    expect(r.ok).toBe(false);
    expect(r.evidence).toMatch(/Deployment Protection/);
  });
  it("fails one that is down", async () => {
    expect((await checkLive("https://a.vercel.app", fake(404))).ok).toBe(false);
  });
});
