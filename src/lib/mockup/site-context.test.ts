import { describe, expect, it } from "vitest";

import { editBrief, editLanes, readingsUser } from "./edit";
import {
  cleanFont,
  cleanPath,
  coerceScan,
  crawlOrder,
  designMd,
  lockedStyleLine,
  lockFor,
  pageBrief,
  pageSlug,
  palette,
  scanFacts,
  siteMd,
  siteSlug,
  type PageScan,
  type SiteContext,
} from "./site-context";

function page(over: Partial<PageScan> = {}): PageScan {
  return {
    url: "https://bloom.co/",
    path: "/",
    title: "Bloom Florist",
    description: "Flowers delivered same day",
    height: 4000,
    width: 1280,
    colors: [
      { hex: "#fbf7f2", role: "bg", weight: 900_000 },
      { hex: "#1f3d2b", role: "bg", weight: 300_000 },
      { hex: "#1a1a1a", role: "text", weight: 2000 },
      { hex: "#e0577a", role: "accent", weight: 9000 },
      { hex: "#111111", role: "accent", weight: 20000 },
    ],
    type: {
      h1: { family: "Fraunces", size: 64, weight: 700, lineHeight: 64, letterSpacing: -1 },
      body: { family: "Inter", size: 16, weight: 400, lineHeight: 26 },
    },
    radii: [999, 12],
    sections: [
      { kind: "header", heading: "", top: 0, height: 80, bg: "#fbf7f2" },
      { kind: "hero", heading: "Fresh flowers, today", top: 80, height: 700, bg: "#1f3d2b", holds: ["image", "2 buttons"] },
      { kind: "content", heading: "Bestsellers", top: 780, height: 900, bg: "#fbf7f2", holds: ["6 cards"] },
      { kind: "form", heading: "Order by phone", top: 1680, height: 500, holds: ["form"] },
      { kind: "footer", heading: "Shop", top: 2180, height: 300 },
    ],
    nav: ["Shop", "Weddings", "About", "Contact"],
    ctas: [{ text: "Order now", href: "/order", bg: "#e0577a", color: "#ffffff", radius: 999 }],
    forms: [{ name: "Order by phone", fields: ["Name", "Phone"], submit: "Call me back", action: "/api/callback" }],
    embeds: ["Google map", "tap-to-call phone link"],
    links: ["/shop", "/weddings", "/about", "/privacy", "/logo.png", "/contact", "/shop"],
    text: "H1: Fresh flowers, today",
    ...over,
  };
}

const ctx: SiteContext = {
  name: "Bloom Florist",
  origin: "https://bloom.co",
  scannedAt: "2026-11-11T10:00:00.000Z",
  device: "desktop",
  pages: [page(), page({ path: "/weddings", url: "https://bloom.co/weddings", title: "Weddings", forms: [], ctas: [], embeds: [] })],
};

describe("site context — names and paths", () => {
  it("normalises paths and makes file-safe names", () => {
    expect(cleanPath("/about/")).toBe("/about");
    expect(cleanPath("")).toBe("/");
    expect(cleanPath("/shop?x=1#top")).toBe("/shop");
    expect(pageSlug("/")).toBe("home");
    expect(pageSlug("/blog/Post-1/")).toBe("blog-post-1");
    expect(siteSlug("https://www.bloom-florist.co.uk/x")).toBe("bloom-florist-co-uk");
    expect(siteSlug("http://localhost:3000/apps/x")).toBe("localhost-3000");
  });
});

describe("site context — what the browser rendered", () => {
  it("separates backgrounds, text and accents, and never calls a grey an accent", () => {
    const pal = palette(ctx.pages);
    expect(pal.bg[0]).toBe("#fbf7f2");
    expect(pal.text[0]).toBe("#1a1a1a");
    expect(pal.accent).toContain("#e0577a");
    expect(pal.accent).not.toContain("#111111");
    // A strong colour used as a section background is part of the brand too.
    expect(pal.accent).toContain("#1f3d2b");
  });

  it("DESIGN.md carries real values: colours, type sizes, radii, buttons", () => {
    const md = designMd(ctx);
    expect(md).toMatch(/^# DESIGN\.md — Bloom Florist/);
    expect(md).toContain("#e0577a");
    expect(md).toContain("Fraunces — 64px, weight 700");
    expect(md).toContain("pill");
    expect(md).toContain('Button "Order now": fill #e0577a');
    expect(md).not.toContain("Locked direction");
  });

  it("SITE.md lists every page and what must keep working", () => {
    const md = siteMd(ctx);
    expect(md).toContain("- [x] / — Bloom Florist");
    expect(md).toContain("- [x] /weddings");
    expect(md).toContain("- [ ] /shop — linked, not read yet");
    expect(md).toContain('the "Order by phone" form (Name, Phone → Call me back, posts to /api/callback)');
    expect(md).toContain("Google map");
    expect(md).toMatch(/2\. hero: "Fresh flowers, today" \(bg #1f3d2b\) — image, 2 buttons/);
  });

  it("the page brief walks the page top to bottom and stays bounded", () => {
    const b = pageBrief(ctx, "/");
    expect(b.split("\n")[0]).toContain("Page / of Bloom Florist (2 pages read)");
    expect(b).toContain('3. content "Bestsellers" on #fbf7f2; 6 cards');
    expect(b).toContain("Must keep working:");
    expect(pageBrief(ctx, "/", 120).length).toBeLessThanOrEqual(120);
    // An unknown page falls back to the first one rather than nothing.
    expect(pageBrief(ctx, "/nope")).toContain("Page /");
  });

  it("feeds the facts edit.ts already understands", () => {
    const f = scanFacts(ctx, "/");
    expect(f.fonts).toEqual(["Fraunces", "Inter"]);
    expect(f.sections).toContain("Bestsellers");
    expect(f.features.some((x) => x.includes("Order now"))).toBe(true);
    expect(f.pages).toEqual(["/", "/weddings"]);
  });
});

describe("site context — crawling", () => {
  it("reads nav pages first and skips assets, legal pages and the start page", () => {
    expect(crawlOrder(page(), 5)).toEqual(["/shop", "/weddings", "/about", "/contact"]);
    expect(crawlOrder(page(), 2)).toEqual(["/shop", "/weddings"]);
  });

  it("unhashes the font names build tools generate", () => {
    expect(cleanFont("Degular Display-49792c92be2412d3")).toBe("Degular Display");
    expect(cleanFont("__Inter_d65c78")).toBe("Inter");
    expect(cleanFont("__Inter_Fallback_d65c78")).toBe("Inter");
    expect(cleanFont('"Fraunces"')).toBe("Fraunces");
    expect(cleanFont("Inter Variable")).toBe("Inter Variable");
    const s = coerceScan({ url: "https://x.co/", type: { h1: { family: "Geist-9ddd82506b39c56f", size: 48, weight: 600 } } });
    expect(s?.type.h1?.family).toBe("Geist");
  });

  it("checks a scan that crossed from the browser", () => {
    expect(coerceScan(null)).toBeNull();
    expect(coerceScan({ path: "/" })).toBeNull();
    const s = coerceScan({ url: "https://x.co/a/", path: "/a/", colors: [{ hex: "nope", role: "bg", weight: 1 }, { hex: "#abcdef", role: "text", weight: 2 }], nav: "x" });
    expect(s?.path).toBe("/a");
    expect(s?.colors).toHaveLength(1);
    expect(s?.nav).toEqual([]);
    expect(s?.sections).toEqual([]);
  });
});

describe("site context — a locked direction carries to the next page", () => {
  const locked: SiteContext = {
    ...ctx,
    lock: { page: "/", edit: "make the hero dark", label: "Forest hero", instruction: "Dark forest-green hero with a cream serif headline", tweaks: ["pink button"], image: "C:/x/locked.png", at: "2026-11-11T12:00:00.000Z" },
  };

  it("steers other pages, never the page it was picked on", () => {
    expect(lockFor(locked, "/")).toBeNull();
    expect(lockFor(locked, "/weddings")?.label).toBe("Forest hero");
    expect(lockFor(ctx, "/weddings")).toBeNull();
  });

  it("is written into DESIGN.md and the brief for the next page", () => {
    expect(designMd(locked)).toContain("## 6. Locked direction");
    expect(designMd(locked)).toContain("- then: pink button");
    expect(pageBrief(locked, "/weddings")).toContain("LOCKED DIRECTION");
    expect(pageBrief(locked, "/")).not.toContain("LOCKED DIRECTION");
  });

  it("carries the look in words, and image 2 for look only, never layout", () => {
    const line = lockedStyleLine(locked.lock!);
    expect(line).toContain("Dark forest-green hero");
    expect(line).toMatch(/never its layout, sections or text/);
    expect(lockedStyleLine(locked.lock!, false)).not.toContain("image 2");
    // A look written for every page beats the page-specific instruction.
    const styled = lockedStyleLine({ ...locked.lock!, style: "forest-green #1f3d2b panels, cream serif headings" });
    expect(styled).toContain("forest-green #1f3d2b panels");
    expect(styled).not.toContain("hero");
    const [lane] = editLanes("make the gallery bigger", { siteName: "Bloom", styleRef: styled });
    expect(lane.prompt).toContain("this site's chosen look: forest-green #1f3d2b panels");
  });

  it("without a lock the Flux prompt is unchanged, so the hub's cache still matches", () => {
    const a = editLanes("make the hero dark", { siteName: "Bloom" });
    const b = editLanes("make the hero dark", { siteName: "Bloom", styleRef: undefined });
    expect(b.map((l) => l.prompt)).toEqual(a.map((l) => l.prompt));
    expect(a[0].prompt).not.toContain("image 2");
  });

  it("the build brief points at DESIGN.md, SITE.md and the lock", () => {
    const pick = { lane: "faithful" as const, label: "As asked", edit: "bigger gallery", instruction: "bigger gallery", tweaks: [] };
    const b = editBrief({ siteName: "Bloom", pick, designFile: "D/DESIGN.md", siteFile: "D/SITE.md", lock: { label: "Forest hero", instruction: "Dark forest hero", page: "/" } });
    expect(b).toContain("locked direction, picked on / (\"Forest hero\")");
    expect(b).toContain("design system: D/DESIGN.md");
    expect(b).toContain("what must keep working: D/SITE.md");
  });

  it("the readings model gets the page outline", () => {
    const u = readingsUser({ edit: "x", siteName: "Bloom", outline: pageBrief(locked, "/weddings") });
    expect(u).toContain("Page outline, read from the rendered page:");
    expect(u).toContain("LOCKED DIRECTION");
  });
});
