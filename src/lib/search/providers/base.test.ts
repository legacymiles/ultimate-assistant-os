import { describe, expect, it } from "vitest";

import { dedupe, serveableUrl, sourceOf, tidy, toIso } from "./base";
import type { SearchResult } from "../types";

/**
 * `serveableUrl` is the service's promise that a result URL is a page.
 *
 * It is here, at the provider layer, because every adapter returns through
 * `dedupe` and every caller has the same problem. The case that put it here:
 * DuckDuckGo's top result for "2x4x8 pressure treated lumber price buy" was a
 * 1,200-character sponsored click-through titled "Amazon Official Site", and it
 * reached BuildFlip's pricing prompt, where it would have become a buy link on
 * someone's build plan.
 */

const row = (url: string, title = "a page"): SearchResult =>
  ({ title, url, description: "", source: sourceOf(url) }) as SearchResult;

describe("serveableUrl", () => {
  it("keeps an ordinary page", () => {
    expect(serveableUrl("https://www.homedepot.com/p/2x4-8ft-lumber/202089032")).toBe(true);
    expect(serveableUrl("http://example.org/a/b?c=1#d")).toBe(true);
  });

  it("drops a search engine's own click-through", () => {
    expect(serveableUrl("https://duckduckgo.com/y.js?ad_domain=amazon.com")).toBe(false);
    expect(serveableUrl("https://www.bing.com/aclick?ld=abc")).toBe(false);
    expect(serveableUrl("https://www.google.com/url?q=https://x.com")).toBe(false);
    expect(serveableUrl("https://google.co.uk/url?q=x")).toBe(false);
    expect(serveableUrl("https://r.search.yahoo.com/_ylt=abc")).toBe(false);
  });

  it("drops an ad network's tracker", () => {
    expect(serveableUrl("https://ad.doubleclick.net/ddm/clk/123")).toBe(false);
    expect(serveableUrl("https://www.googleadservices.com/pagead/aclk?sa=L")).toBe(false);
  });

  it("keeps a host that merely looks like one of those", () => {
    // Anchored matching: a real site must not be thrown away for its name.
    expect(serveableUrl("https://notduckduckgo.com/p/1")).toBe(true);
    expect(serveableUrl("https://bing.example.com/p/1")).toBe(true);
  });

  it("drops a URL too long to be a page", () => {
    expect(serveableUrl(`https://shop.example.com/p?${"x".repeat(420)}`)).toBe(false);
  });

  it("drops anything that is not http(s)", () => {
    expect(serveableUrl("javascript:alert(1)")).toBe(false);
    expect(serveableUrl("data:text/html,<p>hi")).toBe(false);
    expect(serveableUrl("ftp://files.example.com/x")).toBe(false);
    expect(serveableUrl("not a url")).toBe(false);
    expect(serveableUrl("")).toBe(false);
  });
});

describe("dedupe", () => {
  it("drops click-throughs along with the usual junk", () => {
    const out = dedupe([
      row("https://duckduckgo.com/y.js?ad_domain=amazon.com", "Amazon Official Site"),
      row("https://www.lowes.com/pd/x/1"),
      row("https://www.lowes.com/pd/x/1#reviews"),
      row("not a url"),
      row("https://www.lowes.com/pd/x/2", ""),
    ]);
    expect(out.map((r) => r.url)).toEqual(["https://www.lowes.com/pd/x/1"]);
  });

  it("keeps the first of two that differ only by fragment", () => {
    const out = dedupe([row("https://a.example/p#one"), row("https://a.example/p#two")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe("https://a.example/p#one");
  });
});

describe("toIso", () => {
  it("takes a real date and refuses the rest", () => {
    expect(toIso("2026-02-02")).toBe("2026-02-02T00:00:00.000Z");
    expect(toIso("None")).toBeNull();
    expect(toIso("2 days ago")).toBeNull();
    expect(toIso("1970-01-01")).toBeNull();
    expect(toIso(null)).toBeNull();
  });
});

describe("tidy", () => {
  it("collapses the whitespace a snippet arrives with", () => {
    expect(tidy("  a\n\tb  ")).toBe("a b");
    expect(tidy(undefined)).toBe("");
  });
});
