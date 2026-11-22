// ---------------------------------------------------------------------------
// Tests for the parts that are easy to get wrong and expensive to get wrong:
// the provider adapters' parsing, the fallback chain's ordering, the breaker,
// the cache key, the SSRF guard and the HTML reduction.
//
// `fetch` is stubbed throughout. Nothing here touches the network, so this
// suite runs in CI on a machine with no SearXNG and no Tavily key.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chainFor, isLocalUrl, searxngEndpoints } from "./config";
import { __testables, isPrivateAddress } from "./extract";
import { isOpen, recordFailure, recordSuccess, resetBreakers, toMessage } from "./health";
import { dedupe, sourceOf, tidy, toIso } from "./providers/base";
import { duckduckgoProvider } from "./providers/duckduckgo";
import { searxngProvider } from "./providers/searxng";
import { tavilyProvider } from "./providers/tavily";
import { cacheKeyFor, normalize } from "./orchestrator";
import { SearchError } from "./types";

const ENV_KEYS = [
  "SEARXNG_URL",
  "SEARXNG_LOCAL_URL",
  "SEARXNG_URLS",
  "SEARXNG_TOKEN",
  "TAVILY_API_KEY",
  "SEARCH_ENABLE_DUCKDUCKGO",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  resetBreakers();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Ordering: the whole point of the service
// ---------------------------------------------------------------------------

describe("the provider chain", () => {
  it("prefers a local SearXNG, then the VPS, then the free cloud, then the paid one", () => {
    process.env.SEARXNG_LOCAL_URL = "http://127.0.0.1:8080";
    process.env.SEARXNG_URL = "https://search.example.com";
    process.env.TAVILY_API_KEY = "tvly-test";

    const chain = chainFor("web");
    expect(chain.map((e) => `${e.provider}:${e.location}`)).toEqual([
      "searxng:laptop",
      "searxng:vps",
      "duckduckgo:cloud",
      "tavily:cloud",
    ]);
  });

  it("keeps the paid provider last even when it is the only cloud one left", () => {
    process.env.SEARCH_ENABLE_DUCKDUCKGO = "false";
    process.env.SEARXNG_URL = "https://search.example.com";
    process.env.TAVILY_API_KEY = "tvly-test";
    expect(chainFor("web").map((e) => e.provider)).toEqual(["searxng", "tavily"]);
  });

  it("treats a localhost URL as the laptop even when it arrives in SEARXNG_URL", () => {
    // Someone will put the local instance in the wrong variable. The ordering
    // should follow what the URL IS, not which name it came under.
    process.env.SEARXNG_URL = "http://localhost:8080";
    process.env.SEARXNG_URLS = "https://search.example.com";

    const chain = chainFor("web");
    expect(chain[0].location).toBe("laptop");
    expect(chain[1].location).toBe("vps");
  });

  it("drops duplicate endpoints however they were spelled in", () => {
    process.env.SEARXNG_URL = "https://search.example.com";
    process.env.SEARXNG_URLS = "https://search.example.com/,https://other.example.com";

    expect(searxngEndpoints().map((e) => e.url)).toEqual([
      "https://search.example.com",
      "https://other.example.com",
    ]);
  });

  it("is empty only when the keyless floor is off too", () => {
    // DuckDuckGo is on by default, so a host with no keys at all still
    // searches — which is the behaviour the hub had before this service and
    // must not lose. Turning it off is what leaves nothing in the chain, and
    // that is the case the "no provider configured" message is for.
    expect(chainFor("web").map((e) => e.provider)).toEqual(["duckduckgo"]);
    process.env.SEARCH_ENABLE_DUCKDUCKGO = "false";
    expect(chainFor("web")).toEqual([]);
  });

  it("skips a provider that cannot serve the kind at all", () => {
    // DuckDuckGo's HTML endpoint has no news mode and no dates, so a news
    // request must not be handed to it. The chain still lists it; the
    // orchestrator filters on the adapter's own `kinds`.
    expect(duckduckgoProvider.kinds).not.toContain("news");
    expect(searxngProvider.kinds).toContain("news");
    expect(tavilyProvider.kinds).toContain("news");
  });

  it("narrows to one provider when the dashboard pins it", () => {
    process.env.SEARXNG_URL = "https://search.example.com";
    process.env.TAVILY_API_KEY = "tvly-test";
    expect(chainFor("web", "tavily").map((e) => e.provider)).toEqual(["tavily"]);
  });

  it("recognises the addresses that are only reachable from this machine", () => {
    expect(isLocalUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isLocalUrl("http://searxng.local")).toBe(true);
    expect(isLocalUrl("http://host.docker.internal:8080")).toBe(true);
    expect(isLocalUrl("https://search.example.com")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The breaker
// ---------------------------------------------------------------------------

describe("the circuit breaker", () => {
  const endpoint = {
    provider: "searxng" as const,
    url: "http://127.0.0.1:8080",
    location: "laptop" as const,
    priority: 10,
    token: null,
    label: "test",
  };

  it("stays closed below the threshold and opens at it", () => {
    recordFailure(endpoint, "nope");
    recordFailure(endpoint, "nope");
    expect(isOpen(endpoint)).toBe(false);
    recordFailure(endpoint, "nope");
    expect(isOpen(endpoint)).toBe(true);
  });

  it("closes again on a success", () => {
    recordFailure(endpoint, "nope");
    recordFailure(endpoint, "nope");
    recordFailure(endpoint, "nope");
    expect(isOpen(endpoint)).toBe(true);
    recordSuccess(endpoint, 120);
    expect(isOpen(endpoint)).toBe(false);
  });
});

describe("failure messages", () => {
  it("turns a refused connection into something actionable", () => {
    const error = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const message = toMessage(error, {
      provider: "searxng",
      url: "http://127.0.0.1:8080",
      location: "laptop",
      priority: 10,
      token: null,
      label: "test",
    });
    expect(message).toContain("Nothing is listening at http://127.0.0.1:8080");
  });

  it("says the machine is probably off when a connect times out", () => {
    const error = Object.assign(new Error("fetch failed"), { cause: { code: "ETIMEDOUT" } });
    expect(toMessage(error)).toContain("off or asleep");
  });
});

// ---------------------------------------------------------------------------
// SearXNG parsing
// ---------------------------------------------------------------------------

describe("the SearXNG adapter", () => {
  const endpoint = {
    provider: "searxng" as const,
    url: "http://127.0.0.1:8080",
    location: "laptop" as const,
    priority: 10,
    token: null,
    label: "test",
  };
  const query = {
    query: "test",
    kind: "web" as const,
    limit: 10,
    freshness: "any" as const,
    language: "en",
    safe: true,
  };

  it("standardizes rows and normalizes the unbounded score to 0-1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          results: [
            {
              url: "https://www.example.com/a?x=1",
              title: "  A  title ",
              content: "Some\n snippet",
              score: 12,
              publishedDate: "2026-03-04T00:00:00Z",
            },
            { url: "https://other.org/b", title: "B", content: "", score: 3 },
          ],
        }),
      ),
    );

    const { results } = await searxngProvider.search(endpoint, query, new AbortController().signal);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: "A title",
      source: "example.com",
      description: "Some snippet",
      provider: "searxng",
      score: 1,
      publishedAt: "2026-03-04T00:00:00.000Z",
    });
    expect(results[1].score).toBeCloseTo(0.25, 3);
  });

  it("explains the 403 that everyone hits, by name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })));
    await expect(searxngProvider.search(endpoint, query, new AbortController().signal)).rejects.toThrow(
      /formats: \[html, json\]/,
    );
  });

  it("treats a 200 with no results as a failure, so the chain falls through", async () => {
    // An instance where every upstream engine is blocked answers 200 with an
    // empty list. Returning that as success would read to a caller as "no such
    // thing exists" and would never reach Tavily.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ results: [] })));
    await expect(searxngProvider.search(endpoint, query, new AbortController().signal)).rejects.toThrow(
      /returned no results/,
    );
  });

  it("reads an instant answer in both the old and new shapes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          results: [{ url: "https://example.com", title: "x", content: "y" }],
          answers: [{ answer: "42", url: "https://example.com" }],
        }),
      ),
    );
    const modern = await searxngProvider.search(endpoint, query, new AbortController().signal);
    expect(modern.answer).toBe("42");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          results: [{ url: "https://example.com", title: "x", content: "y" }],
          answers: ["legacy string"],
        }),
      ),
    );
    const legacy = await searxngProvider.search(endpoint, query, new AbortController().signal);
    expect(legacy.answer).toBe("legacy string");
  });

  it("sends the news category and a time range when asked for fresh news", async () => {
    const spy = vi.fn().mockResolvedValue(
      jsonResponse({ results: [{ url: "https://example.com", title: "x", content: "y" }] }),
    );
    vi.stubGlobal("fetch", spy);
    await searxngProvider.search(
      endpoint,
      { ...query, kind: "news", freshness: "week" },
      new AbortController().signal,
    );
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("categories=news");
    expect(url).toContain("time_range=week");
  });
});

// ---------------------------------------------------------------------------
// Tavily parsing
// ---------------------------------------------------------------------------

describe("the Tavily adapter", () => {
  const endpoint = {
    provider: "tavily" as const,
    url: "https://api.tavily.com",
    location: "cloud" as const,
    priority: 100,
    token: null,
    label: "test",
  };
  const query = {
    query: "test",
    kind: "web" as const,
    limit: 5,
    freshness: "any" as const,
    language: "en",
    safe: true,
  };

  it("sends the key as a bearer token and never in the body", async () => {
    process.env.TAVILY_API_KEY = "tvly-secret";
    const spy = vi.fn().mockResolvedValue(
      jsonResponse({ results: [{ url: "https://example.com", title: "x", content: "y", score: 0.9 }] }),
    );
    vi.stubGlobal("fetch", spy);

    await tavilyProvider.search(endpoint, query, new AbortController().signal);

    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tvly-secret");
    expect(String(init.body)).not.toContain("tvly-secret");
  });

  it("only buys advanced depth for a research query", async () => {
    process.env.TAVILY_API_KEY = "tvly-secret";
    // A fresh Response per call: a body can only be read once, so a single
    // mockResolvedValue would fail the second call rather than the assertion.
    const spy = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ results: [{ url: "https://example.com", title: "x", content: "y" }] }),
      );
    vi.stubGlobal("fetch", spy);

    await tavilyProvider.search(endpoint, query, new AbortController().signal);
    expect(JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body)).search_depth).toBe("basic");

    await tavilyProvider.search(endpoint, { ...query, kind: "research" }, new AbortController().signal);
    expect(JSON.parse(String((spy.mock.calls[1][1] as RequestInit).body)).search_depth).toBe("advanced");
  });

  it("names a bad key rather than returning a bare 401", async () => {
    process.env.TAVILY_API_KEY = "tvly-wrong";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(tavilyProvider.search(endpoint, query, new AbortController().signal)).rejects.toThrow(
      /TAVILY_API_KEY/,
    );
  });
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

describe("result hygiene", () => {
  it("refuses a date it cannot trust", () => {
    expect(toIso("2026-03-04")).toBe("2026-03-04T00:00:00.000Z");
    expect(toIso("None")).toBeNull();
    expect(toIso("")).toBeNull();
    expect(toIso("2 days ago")).toBeNull();
    expect(toIso("1823-01-01")).toBeNull();
    expect(toIso("2099-01-01")).toBeNull();
  });

  it("names the source the way a person would", () => {
    expect(sourceOf("https://www.BBC.co.uk/news/x")).toBe("bbc.co.uk");
    expect(sourceOf("not a url")).toBe("");
  });

  it("collapses the whitespace providers leave in snippets", () => {
    expect(tidy("  a \n b\tc ")).toBe("a b c");
  });

  it("dedupes on the URL without its fragment", () => {
    const rows = [
      { title: "a", url: "https://x.com/p#one", description: "", source: "x.com", publishedAt: null, score: null, provider: "s" },
      { title: "b", url: "https://x.com/p#two", description: "", source: "x.com", publishedAt: null, score: null, provider: "s" },
      { title: "c", url: "https://y.com/", description: "", source: "y.com", publishedAt: null, score: null, provider: "s" },
    ];
    expect(dedupe(rows).map((r) => r.title)).toEqual(["a", "c"]);
  });
});

// ---------------------------------------------------------------------------
// Request normalizing and the cache key
// ---------------------------------------------------------------------------

describe("normalizing a request", () => {
  it("rejects an empty query with a 400, not a provider call", () => {
    expect(() => normalize({ query: "   " })).toThrow(SearchError);
    try {
      normalize({ query: "" });
    } catch (error) {
      expect((error as SearchError).status).toBe(400);
    }
  });

  it("caps the limit and the extraction count", () => {
    expect(normalize({ query: "x", limit: 9999 }).limit).toBe(50);
    expect(normalize({ query: "x", extract: 9999 }).extractCount).toBe(10);
    expect(normalize({ query: "x", extract: true }).extractCount).toBe(3);
    expect(normalize({ query: "x" }).extractCount).toBe(0);
  });

  it("gives research a bigger default than web", () => {
    expect(normalize({ query: "x", kind: "research" }).limit).toBe(20);
    expect(normalize({ query: "x", kind: "web" }).limit).toBe(10);
  });
});

describe("the cache key", () => {
  it("ignores the calling app, so two apps share one hit", () => {
    const a = cacheKeyFor(normalize({ query: "same", label: "cookbook" }));
    const b = cacheKeyFor(normalize({ query: "same", label: "jarvis" }));
    expect(a).toBe(b);
  });

  it("is case- and whitespace-insensitive on the query", () => {
    expect(cacheKeyFor(normalize({ query: "  Hello   World " }))).toBe(
      cacheKeyFor(normalize({ query: "hello world" })),
    );
  });

  it("separates kinds, freshness and extraction", () => {
    const base = cacheKeyFor(normalize({ query: "q" }));
    expect(cacheKeyFor(normalize({ query: "q", kind: "news" }))).not.toBe(base);
    expect(cacheKeyFor(normalize({ query: "q", freshness: "day" }))).not.toBe(base);
    expect(cacheKeyFor(normalize({ query: "q", extract: 3 }))).not.toBe(base);
  });
});

// ---------------------------------------------------------------------------
// The SSRF guard
// ---------------------------------------------------------------------------

describe("the private-address guard", () => {
  it("refuses loopback, private, link-local and CGNAT space", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.1",
      "172.17.0.2", // docker bridge
      "169.254.169.254", // cloud metadata — the one that hands out credentials
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1", // a private v4 smuggled through a v6 literal
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("refuses anything that is not an address at all", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Page reduction
// ---------------------------------------------------------------------------

describe("reading a page", () => {
  const { toText, bodyOf, titleFrom, publishedFrom, decodeEntities } = __testables;

  it("prefers the article element over the navigation around it", () => {
    const html = `
      <html><head><title>Site</title></head><body>
        <nav><a href="/a">Home</a><a href="/b">About</a></nav>
        <article>
          <p>${"The real body of the piece. ".repeat(20)}</p>
          <p>A second paragraph that matters.</p>
        </article>
        <footer>© Someone</footer>
      </body></html>`;
    const text = toText(bodyOf(html));
    expect(text).toContain("A second paragraph that matters.");
    expect(text).not.toContain("About");
    expect(text).not.toContain("© Someone");
  });

  it("falls back to the densest block of paragraphs when there is no article", () => {
    const html = `
      <html><body>
        <div id="sidebar">${'<a href="/x">link</a>'.repeat(30)}</div>
        <div id="content">
          <p>${"Actual prose that a reader came for. ".repeat(20)}</p>
          <p>More of it.</p>
        </div>
      </body></html>`;
    const text = toText(bodyOf(html));
    expect(text).toContain("More of it.");
    expect(text).not.toContain("link");
  });

  it("strips scripts and styles rather than reading them as text", () => {
    const html = `<body><article><p>Keep this sentence here.</p><script>var secret = "drop me";</script><style>.x{color:red}</style></article></body>`;
    const text = toText(bodyOf(html));
    expect(text).toContain("Keep this sentence");
    expect(text).not.toContain("drop me");
    expect(text).not.toContain("color:red");
  });

  it("takes the title from OpenGraph before the title tag", () => {
    expect(titleFrom('<meta property="og:title" content="The OG one"><title>The tag one</title>')).toBe(
      "The OG one",
    );
    expect(titleFrom("<title>Just the tag</title>")).toBe("Just the tag");
  });

  it("finds the published date in a meta tag, JSON-LD or a time element", () => {
    expect(publishedFrom('<meta property="article:published_time" content="2026-01-02T03:04:05Z">')).toBe(
      "2026-01-02T03:04:05Z",
    );
    expect(publishedFrom('<script type="application/ld+json">{"datePublished":"2026-05-06"}</script>')).toBe(
      "2026-05-06",
    );
    expect(publishedFrom('<time datetime="2026-07-08">July</time>')).toBe("2026-07-08");
    expect(publishedFrom("<p>no date here</p>")).toBeNull();
  });

  it("decodes the entities that would otherwise show up in a model's context", () => {
    expect(decodeEntities("a &amp; b &mdash; c &#39;d&#39; &nbsp;e &#x27;f&#x27;")).toBe(
      "a & b — c 'd'  e 'f'",
    );
  });

  it("breaks blocks into lines instead of gluing words together", () => {
    expect(toText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
    expect(toText("<li>A</li><li>B</li>")).toBe("A\nB");
  });
});
