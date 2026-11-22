import { describe, expect, it } from "vitest";

import { allowedUrl, keepRealLinks, usable } from "./web-context";
import type { SearchResult } from "@/lib/search/client";

/**
 * These two functions are the only thing standing between a model's output and
 * an href on someone's build plan, so they are tested rather than trusted.
 *
 * Both cases below were found by running the real thing: `usable` exists
 * because DuckDuckGo's top result for a lumber price was a 1,200-character
 * sponsored click-through, and `allowedUrl` exists because a model copying
 * twenty URLs out of a prompt eventually produces one that is close rather
 * than identical.
 */

const result = (url: string): SearchResult =>
  ({ title: "t", url, description: "", source: "s" }) as SearchResult;

describe("usable", () => {
  it("keeps a real product page", () => {
    expect(usable(result("https://www.homedepot.com/p/2x4-8ft-lumber/202089032"))).toBe(true);
  });

  it("drops a search engine's ad redirect", () => {
    expect(
      usable(result("https://duckduckgo.com/y.js?ad_domain=amazon.com&ad_provider=bingv7aa")),
    ).toBe(false);
    expect(usable(result("https://www.bing.com/aclick?ld=abc"))).toBe(false);
  });

  it("drops a URL too long to be a page", () => {
    expect(usable(result(`https://shop.example.com/p?${"x".repeat(420)}`))).toBe(false);
  });

  it("drops anything that is not http(s)", () => {
    expect(usable(result("javascript:alert(1)"))).toBe(false);
    expect(usable(result("not a url"))).toBe(false);
  });
});

describe("allowedUrl", () => {
  const seen = ["https://www.lowes.com/pd/Titebond-III/3045677"];

  it("keeps a URL that was shown", () => {
    expect(allowedUrl(seen[0]!, seen)).toBe(seen[0]);
  });

  it("keeps it past a tracking parameter and a www difference", () => {
    const withParams = "https://lowes.com/pd/Titebond-III/3045677?cm_mmc=shp";
    expect(allowedUrl(withParams, seen)).toBe(withParams);
  });

  it("rejects a near miss", () => {
    expect(allowedUrl("https://www.lowes.com/pd/Titebond-III/3045678", seen)).toBeNull();
    expect(allowedUrl("https://www.lowes.com", seen)).toBeNull();
  });

  it("rejects nothing and nonsense", () => {
    expect(allowedUrl(null, seen)).toBeNull();
    expect(allowedUrl("the home depot", seen)).toBeNull();
  });
});

describe("keepRealLinks", () => {
  const seen = ["https://www.homedepot.com/p/glue/123"];

  it("leaves a verified row alone", () => {
    const [row] = keepRealLinks(
      [{ url: seen[0]!, confidence: "high" as const, note: "exact page" }],
      seen,
    );
    expect(row!.url).toBe(seen[0]);
    expect(row!.confidence).toBe("high");
    expect(row!.note).toBe("exact page");
  });

  it("drops an unverifiable link and says so, instead of leaving a dead href", () => {
    const [row] = keepRealLinks(
      [
        {
          url: "https://www.homedepot.com/p/glue/999",
          confidence: "high" as const,
          note: undefined as string | undefined,
        },
      ],
      seen,
    );
    expect(row!.url).toBeNull();
    expect(row!.confidence).toBe("low");
    expect(row!.note).toMatch(/couldn't be verified/i);
  });

  it("leaves a row that never had a link as it was", () => {
    const [row] = keepRealLinks([{ url: null, confidence: "low" as const, note: "estimate" }], seen);
    expect(row!.url).toBeNull();
    expect(row!.note).toBe("estimate");
  });
});
