import { describe, expect, it } from "vitest";

import { allowedUrl, keepRealLinks } from "./web-context";

/**
 * These are the last thing standing between a model's output and an href on
 * someone's build plan, so they are tested rather than trusted.
 *
 * `allowedUrl` exists because a model copying twenty URLs out of a prompt
 * eventually produces one that is close rather than identical. Ads and search
 * redirects are not filtered here at all — that belongs to the search
 * service's provider layer (`serveableUrl`), and is tested there.
 */

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
