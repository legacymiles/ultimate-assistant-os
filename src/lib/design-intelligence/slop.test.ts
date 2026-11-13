import { describe, expect, it } from "vitest";
import { report, scanPage, scanSource, verdict, type PageSnapshot } from "./slop";

const rules = (fs: { rule: string }[]) => fs.map((f) => f.rule);

describe("scanSource", () => {
  it("fails placeholder copy and stand-in images, with the line", () => {
    const f = scanSource([
      { path: "app/page.tsx", text: 'export default () => (\n<main>\n<h2>Feature 1</h2>\n<p>Lorem ipsum dolor sit amet</p>\n<img src="https://via.placeholder.com/300" />\n</main>)' },
    ]);
    const placeholder = f.filter((x) => x.rule === "placeholder-copy");
    expect(placeholder.length).toBeGreaterThanOrEqual(2);
    expect(placeholder.every((x) => x.severity === "fail")).toBe(true);
    expect(placeholder.map((x) => x.where)).toContain("app/page.tsx:3");
    expect(rules(f)).toContain("placeholder-image");
  });

  it("ignores words that only appear in comments, tests and node_modules", () => {
    const f = scanSource([
      { path: "app/page.tsx", text: "// never ship lorem ipsum\n/* Feature 1 */\nconst x = 1; const font = 'next/font';" },
      { path: "app/page.test.tsx", text: "expect('Lorem ipsum')" },
      { path: "node_modules/x/index.js", text: "Lorem ipsum" },
    ]);
    expect(rules(f)).not.toContain("placeholder-copy");
  });

  it("warns on the stock blue, the AI gradient and no font choice", () => {
    const f = scanSource([
      { path: "src/Hero.tsx", text: '<button className="bg-blue-600 text-white">Go</button><div className="bg-gradient-to-r from-purple-500 to-pink-500" />' },
    ]);
    expect(rules(f)).toEqual(expect.arrayContaining(["default-blue", "ai-gradient", "no-type-choice"]));
    expect(f.every((x) => x.severity === "warn")).toBe(true);
  });

  it("is quiet on a project that chose its type and wrote its own copy", () => {
    const f = scanSource([
      { path: "src/app/layout.tsx", text: 'import localFont from "next/font/local"; const display = localFont({ src: "./Fraunces.woff2" });' },
      { path: "src/app/page.tsx", text: "<h1>Brokerage for people who read the prospectus</h1>" },
    ]);
    expect(f).toEqual([]);
  });

  it("does not mistake real numbered content for a placeholder", () => {
    const f = scanSource([{ path: "a.tsx", text: "<p>Step into the studio. Plan 2026 with us. Fund III closed at $40m.</p>" }]);
    expect(rules(f)).not.toContain("placeholder-copy");
  });
});

const clean: PageSnapshot = {
  url: "http://localhost:3000/",
  width: 1440,
  text: "Northwind Capital. Long-horizon portfolios for families who plan in decades.",
  fonts: ['"Fraunces", serif', '"Söhne", sans-serif'],
  fontSizes: [14, 16, 20, 32, 72],
  overflowX: false,
  consoleErrors: [],
  brokenImages: 0,
  imagesMissingAlt: 0,
  standouts: ["compounding curve you can drag"],
  cardGrids: 1,
  animated: 6,
  lowContrast: 0,
  smallTargets: 0,
  bodyBg: "rgb(14, 20, 18)",
  buttonBgs: ["rgb(212, 175, 98)"],
  h1Count: 1,
};

describe("scanPage", () => {
  it("passes a considered page", () => {
    expect(scanPage(clean, { important: true })).toEqual([]);
  });

  it("fails an important page with no standout, but not an ordinary page", () => {
    const none = { ...clean, standouts: [] };
    expect(rules(scanPage(none, { important: true }))).toContain("no-standout");
    expect(rules(scanPage(none))).not.toContain("no-standout");
  });

  it("warns when standouts compete", () => {
    expect(rules(scanPage({ ...clean, standouts: ["a", "b", "c"] }, { important: true }))).toContain("too-many-standouts");
  });

  it("fails the full default look and only warns on two of its three tells", () => {
    const all = scanPage({ ...clean, fonts: ["Inter, sans-serif"], bodyBg: "rgb(255, 255, 255)", buttonBgs: ["rgb(37, 99, 235)"] });
    expect(all.find((f) => f.rule === "default-look")?.severity).toBe("fail");
    const two = scanPage({ ...clean, fonts: ["Inter, sans-serif"], bodyBg: "rgb(255, 255, 255)" });
    expect(two.find((f) => f.rule === "default-look")?.severity).toBe("warn");
    const one = scanPage({ ...clean, bodyBg: "rgb(255, 255, 255)" });
    expect(rules(one)).not.toContain("default-look");
  });

  it("fails breakage: sideways scroll, console errors, broken images", () => {
    const f = scanPage({ ...clean, overflowX: true, consoleErrors: ["TypeError: x is undefined"], brokenImages: 2 });
    expect(rules(f)).toEqual(expect.arrayContaining(["sideways-scroll", "console-errors", "broken-images"]));
  });

  it("ignores the favicon and DevTools console noise", () => {
    expect(rules(scanPage({ ...clean, consoleErrors: ["Failed to load resource: favicon.ico 404"] }))).not.toContain("console-errors");
  });

  it("a refused request warns; the page's own error fails", () => {
    const refused = scanPage({ ...clean, consoleErrors: ["Failed to load resource: the server responded with a status of 403 ()"] });
    expect(rules(refused)).toEqual(["resource-errors"]);
    expect(refused[0].severity).toBe("warn");
    expect(scanPage({ ...clean, consoleErrors: ["Uncaught TypeError: x is undefined"] })[0].severity).toBe("fail");
  });

  it("unreadable text fails; text that only misses AA warns", () => {
    expect(scanPage({ ...clean, lowContrast: 21, unreadable: 0 }).find((f) => f.rule === "low-contrast")?.severity).toBe("warn");
    expect(scanPage({ ...clean, lowContrast: 5, unreadable: 3 }).find((f) => f.rule === "unreadable-text")?.severity).toBe("fail");
  });

  it("grades card grids: 3 warns, 4 fails", () => {
    expect(scanPage({ ...clean, cardGrids: 3 }).find((f) => f.rule === "card-grid-everywhere")?.severity).toBe("warn");
    expect(scanPage({ ...clean, cardGrids: 4 }).find((f) => f.rule === "card-grid-everywhere")?.severity).toBe("fail");
  });

  it("only counts small tap targets on a phone", () => {
    expect(rules(scanPage({ ...clean, width: 390, smallTargets: 5 }))).toContain("small-tap-targets");
    expect(rules(scanPage({ ...clean, width: 1440, smallTargets: 5 }))).not.toContain("small-tap-targets");
  });

  it("fails placeholder copy that reached the page", () => {
    expect(rules(scanPage({ ...clean, text: "Trusted by teams at\nAcme Corp\nYour Company" }))).toContain("placeholder-copy");
    expect(rules(scanPage({ ...clean, text: "Our services\nFeature 1\nFeature 2" }))).toContain("placeholder-copy");
  });

  // Calibration: copy from stripe.com and linear.app that the first version wrongly failed.
  it("does not fail real sentences that merely contain a stand-in's words", () => {
    const real = [
      "Financial infrastructure to grow your company",
      "Item 1 of 5",
      "Feature 1 of 3: issue tracking",
      "Step 1\nCreate an account",
      "Built for your company's next decade",
      "Plan 2026 with confidence",
    ].join("\n");
    expect(rules(scanPage({ ...clean, text: real }))).not.toContain("placeholder-copy");
  });
});

describe("verdict and report", () => {
  it("any fail fails; the score is a guide", () => {
    const v = verdict(scanPage({ ...clean, overflowX: true, imagesMissingAlt: 1 }));
    expect(v.pass).toBe(false);
    expect(v.score).toBe(7);
    expect(report(v)).toMatch(/^Design check: FAIL · score 7\/10 · 1 fail, 1 warning/);
    expect(report(v)).toContain("Must fix:");
  });

  it("warnings alone pass", () => {
    const v = verdict(scanPage({ ...clean, imagesMissingAlt: 2 }));
    expect(v.pass).toBe(true);
    expect(report(v)).toMatch(/^Design check: PASS/);
  });
});
