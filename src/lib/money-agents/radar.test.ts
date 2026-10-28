import { describe, expect, it } from "vitest";
import {
  EMPTY_RADAR,
  addCatches,
  botBrief,
  checkRule,
  countdown,
  dedupeNews,
  inWindow,
  newRule,
  normalizeOpportunities,
  normalizeRadar,
  paperResult,
  parseCoingeckoChart,
  parseRss,
  parseStooqHistory,
  parseYahooChart,
  ruleScore,
  scorecard,
  stooqSymbol,
  symbolsToQuote,
  timing,
  toSymbol,
  upcoming,
  upsertRule,
  visiblePlays,
  type Catalyst,
  type Quote,
} from "./radar";

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Dangote Refinery posts $4.7 billion profit ahead of Africa's biggest IPO - Bloomberg</title>
<link>https://news.example.com/a</link><pubDate>Mon, 26 Oct 2026 14:00:00 GMT</pubDate><source url="https://bloomberg.com">Bloomberg</source></item>
<item><title><![CDATA[Gold &amp; silver rally before CPI - Reuters]]></title>
<link>https://news.example.com/b</link><pubDate>Tue, 27 Oct 2026 09:00:00 GMT</pubDate></item>
<item><title>No link here</title></item>
</channel></rss>`;

const q = (over: Partial<Quote> = {}): Quote => ({
  symbol: "GC=F",
  price: 100,
  prevClose: 100,
  changePct: 0,
  monthPct: 0,
  closes: [],
  currency: "USD",
  at: "2026-10-27T12:00:00Z",
  by: "yahoo",
  ...over,
});

describe("news", () => {
  it("parses Google News RSS, splits the source off the title, skips broken items", () => {
    const items = parseRss(RSS);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Dangote Refinery posts $4.7 billion profit ahead of Africa's biggest IPO");
    expect(items[0].source).toBe("Bloomberg");
    expect(items[1].title).toBe("Gold & silver rally before CPI");
    expect(items[1].source).toBe("Reuters");
    expect(items[1].publishedAt).toBe("2026-10-27T09:00:00.000Z");
  });

  it("keeps one copy of the same story, newest first", () => {
    const a = { title: "Micron shares soar after record earnings beat", url: "u1", source: "A", publishedAt: "2026-10-20T00:00:00Z" };
    const b = { ...a, url: "u2", source: "B", publishedAt: "2026-10-21T00:00:00Z" };
    const c = { title: "Gold hits record high", url: "u3", source: "C", publishedAt: "2026-10-22T00:00:00Z" };
    const out = dedupeNews([a, b, c]);
    expect(out.map((x) => x.url)).toEqual(["u3", "u2"]);
  });

  it("scores by rules without AI, never above 85, and finds what to watch", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    const ipo = ruleScore(parseRss(RSS)[0], now);
    expect(ipo.kind).toBe("ipo");
    expect(ipo.score).toBeGreaterThan(50);
    expect(ipo.score).toBeLessThanOrEqual(85);
    expect(ipo.by).toBe("rules");
    const xrp = ruleScore({ title: "SEC approves spot XRP ETF", url: "x", source: "", publishedAt: "" }, now);
    expect(xrp.kind).toBe("crypto");
    expect(xrp.watch).toContain("XRP-USD");
    const macro = ruleScore({ title: "CPI inflation report due Thursday", url: "y", source: "", publishedAt: "" }, now);
    expect(macro.kind).toBe("macro");
    expect(macro.watch).toContain("GC=F");
  });
});

describe("AI answers are checked", () => {
  const news = parseRss(RSS);
  it("keeps only plays whose url was in the news, clamps the score, fixes symbols", () => {
    const out = normalizeOpportunities(
      {
        plays: [
          { url: "https://news.example.com/b", kind: "gold", score: 140, horizon: "weeks", watch: ["gold", "silver", "!!"], why: "w", risk: "r", howToGetIn: "GLD", catalystDate: "2026-11-10" },
          { url: "https://invented.example.com", kind: "ipo", score: 99 },
          { url: "https://news.example.com/a", kind: "nonsense", score: 70, horizon: "decade", catalystDate: "soon" },
        ],
      },
      news,
    );
    expect(out.map((o) => o.url)).toEqual(["https://news.example.com/b", "https://news.example.com/a"]);
    expect(out[0].score).toBe(100);
    expect(out[0].watch).toEqual(["GC=F", "SI=F"]);
    expect(out[0].catalystDate).toBe("2026-11-10");
    expect(out[1].kind).toBe("stock");
    expect(out[1].horizon).toBe("months");
    expect(out[1].catalystDate).toBe("");
  });
});

describe("symbols", () => {
  it("turns what people type into symbols", () => {
    expect(toSymbol("gold")).toBe("GC=F");
    expect(toSymbol("$nvda")).toBe("NVDA");
    expect(toSymbol("xrp")).toBe("XRP-USD");
    expect(toSymbol("s&p 500")).toBe("^GSPC");
    expect(toSymbol("hello world!")).toBe("");
    expect(stooqSymbol("MU")).toBe("mu.us");
    expect(stooqSymbol("^GSPC")).toBeNull();
  });
});

describe("quotes", () => {
  it("reads Yahoo's chart: day change vs previous close, month change vs range start", () => {
    const qt = parseYahooChart({
      chart: {
        result: [
          {
            meta: { symbol: "MU", regularMarketPrice: 110, previousClose: 100, currency: "USD" },
            indicators: { quote: [{ close: [80, null, 95, 100, 110] }] },
          },
        ],
      },
    })!;
    expect(qt.changePct).toBeCloseTo(10);
    expect(qt.monthPct).toBeCloseTo(37.5);
    expect(qt.closes).toEqual([80, 95, 100, 110]);
  });

  it("returns null for an empty Yahoo answer", () => {
    expect(parseYahooChart({ chart: { result: null } })).toBeNull();
  });

  it("reads Stooq history and CoinGecko charts", () => {
    const s = parseStooqHistory("MU", "Date,Open,High,Low,Close,Volume\n2026-10-01,1,1,1,50,1\n2026-10-26,1,1,1,60,1\n2026-10-27,1,1,1,66,1")!;
    expect(s.price).toBe(66);
    expect(s.changePct).toBeCloseTo(10);
    expect(s.monthPct).toBeCloseTo(32);
    const c = parseCoingeckoChart("XRP-USD", { prices: [[1, 2], [2, 2.5], [3, 3]] })!;
    expect(c.changePct).toBeCloseTo(20);
    expect(c.monthPct).toBeCloseTo(50);
  });

  it("labels late vs early so FOMO is visible", () => {
    expect(timing(q({ monthPct: 40 })).state).toBe("late");
    expect(timing(q({ monthPct: 10 })).state).toBe("moving");
    expect(timing(q({ monthPct: 2 })).state).toBe("early");
    expect(timing(q({ monthPct: -30 })).state).toBe("beaten");
    expect(timing(null).state).toBe("unknown");
  });
});

describe("catalysts", () => {
  const cpi: Catalyst = { id: "cpi-nov", at: "2026-11-10T08:30:00-05:00", name: "CPI (Oct data)", kind: "cpi", watch: ["GC=F", "^GSPC"], note: "", source: "" };
  const old: Catalyst = { ...cpi, id: "old", at: "2026-09-01T08:30:00-04:00" };
  const dateOnly: Catalyst = { ...cpi, id: "d", at: "2026-12-01" };

  it("lists upcoming in order, keeps the live window, drops the past", () => {
    const now = new Date("2026-11-10T14:00:00Z"); // 09:00 ET — 30 min after CPI
    const list = upcoming([dateOnly, old, cpi], now);
    expect(list.map((c) => c.id)).toEqual(["cpi-nov", "d"]);
    expect(inWindow(cpi, now)).toBe(true);
    expect(countdown(cpi, now)).toBe("Live now");
    expect(inWindow(dateOnly, new Date("2026-12-01T12:00:00Z"))).toBe(false);
  });

  it("counts down in plain words", () => {
    expect(countdown(cpi, new Date("2026-11-10T13:00:00Z"))).toBe("in 30 min");
    expect(countdown(cpi, new Date("2026-11-08T13:30:00Z"))).toBe("in 2 days");
  });
});

describe("the move bot", () => {
  const cpi: Catalyst = { id: "cpi", at: "2026-11-10T08:30:00-05:00", name: "CPI", kind: "cpi", watch: ["GC=F"], note: "", source: "" };
  const rule = newRule("GC=F", "Gold", { id: "g", movePct: 1.5, eventPct: 0.6 });
  const now = new Date("2026-11-10T13:45:00Z");

  it("catches a big daily move once per day per direction", () => {
    const c = checkRule(rule, q({ price: 102, changePct: 2 }), [], [], now)!;
    expect(c.reason).toMatch(/Big move/);
    expect(c.dir).toBe("up");
    expect(checkRule(rule, q({ price: 103, changePct: 3 }), [c], [], now)).toBeNull();
    const down = checkRule(rule, q({ price: 97, changePct: -3 }), [c], [], now)!;
    expect(down.dir).toBe("down");
  });

  it("uses the smaller event threshold inside a catalyst window", () => {
    const c = checkRule(rule, q({ price: 100.8, changePct: 0.8 }), [], [cpi], now)!;
    expect(c.reason).toMatch(/during CPI/);
    expect(checkRule(rule, q({ price: 100.8, changePct: 0.8 }), [], [], now)).toBeNull();
  });

  it("fires price levels, and a paused rule never fires", () => {
    const lvl = { ...rule, above: 4000 };
    expect(checkRule(lvl, q({ price: 4010, changePct: 0.1 }), [], [], now)!.reason).toMatch(/above 4000/);
    expect(checkRule({ ...rule, on: false }, q({ changePct: 9 }), [], [], now)).toBeNull();
  });

  it("scores catches as paper trades in their direction", () => {
    const up = checkRule(rule, q({ price: 100, changePct: 2 }), [], [], now)!;
    const down = { ...up, id: "d", dir: "down" as const, key: "x" };
    expect(paperResult(up, q({ price: 110 }))).toBeCloseTo(10);
    expect(paperResult(down, q({ price: 110 }))).toBeCloseTo(-10);
    const s = scorecard([up, down], { "GC=F": q({ price: 110 }) });
    expect(s).toEqual({ n: 2, wins: 1, avg: 0 });
  });
});

describe("state", () => {
  it("repairs junk and keeps one rule per symbol", () => {
    const st = normalizeRadar({ rules: [{ symbol: "GC=F", movePct: "2" }, { symbol: "GC=F" }, null], catches: "x", hidden: [1, "a"] });
    expect(st.rules).toHaveLength(1);
    expect(st.rules[0].movePct).toBe(2);
    expect(st.catches).toEqual([]);
    expect(st.hidden).toEqual(["a"]);
    expect(normalizeRadar(null).rules.length).toBeGreaterThan(0);
  });

  it("adds catches without duplicates, newest first", () => {
    const now = new Date("2026-11-10T13:45:00Z");
    const c = checkRule(newRule("MU", "Micron", { id: "m" }), q({ symbol: "MU", changePct: 9 }), [], [], now)!;
    const s1 = addCatches(EMPTY_RADAR, [c]);
    expect(addCatches(s1, [c])).toBe(s1);
  });

  it("won't add a second rule for the same symbol", () => {
    const s = upsertRule(EMPTY_RADAR, newRule("GC=F", "Gold again"));
    expect(s.rules.filter((r) => r.symbol === "GC=F")).toHaveLength(1);
  });

  it("shows saved plays first and hides dismissed ones", () => {
    const now = new Date();
    const a = ruleScore({ title: "Gold record high", url: "a", source: "", publishedAt: "" }, now);
    const b = { ...ruleScore({ title: "IPO", url: "b", source: "", publishedAt: "" }, now), score: 10 };
    const c = ruleScore({ title: "Bitcoin ETF", url: "c", source: "", publishedAt: "" }, now);
    const st = { ...EMPTY_RADAR, saved: [b], hidden: [c.id] };
    expect(visiblePlays([a, b, c], st).map((o) => o.url)).toEqual(["b", "a"]);
  });

  it("asks for each price once", () => {
    const syms = symbolsToQuote(EMPTY_RADAR, [], [{ ticker: "MU", name: "", bucket: "margin", metric: "", why: "", asOf: "", source: "" }]);
    expect(syms.filter((s) => s === "MU")).toHaveLength(1);
    expect(syms).toContain("GC=F");
  });

  it("writes a paper-only bot brief for Trading Studio", () => {
    const t = botBrief({ title: "CPI", url: "u", watch: ["GC=F"], why: "", catalystDate: "2026-11-10" });
    expect(t).toMatch(/never place live trades/);
    expect(t.length).toBeLessThan(4000);
  });
});

import { CATALYSTS, COMPANIES } from "./radarSeed";
import { catalystTime } from "./radar";

describe("seed data", () => {
  it("every catalyst has a real time, a unique id and a source", () => {
    expect(new Set(CATALYSTS.map((c) => c.id)).size).toBe(CATALYSTS.length);
    for (const c of CATALYSTS) {
      expect(Number.isFinite(catalystTime(c))).toBe(true);
      expect(c.source).toMatch(/^https:\/\//);
    }
  });
  it("every company has a valid symbol, a bucket, a date and a source", () => {
    expect(new Set(COMPANIES.map((c) => c.ticker)).size).toBe(COMPANIES.length);
    for (const c of COMPANIES) {
      expect(toSymbol(c.ticker)).toBe(c.ticker);
      expect(c.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.source).toMatch(/^https:\/\//);
    }
  });
  it("the Fed decision tomorrow is live for two hours after 2 PM ET", () => {
    const fed = CATALYSTS.find((c) => c.id === "fomc-2026-10")!;
    expect(inWindow(fed, new Date("2026-10-28T18:30:00Z"))).toBe(true);
  });
});

import { salvagePlays } from "./radar";

describe("a reply cut off mid-list", () => {
  it("keeps every complete play before the cut", () => {
    const cut = '{"plays":[{"url":"a","why":"has a } and \\" inside"},{"url":"b","watch":["GC=F"]},{"url":"c","why":"cut off he';
    expect(salvagePlays(cut).plays).toEqual([{ url: "a", why: 'has a } and " inside' }, { url: "b", watch: ["GC=F"] }]);
    expect(salvagePlays("nothing here").plays).toEqual([]);
  });

  it("ranks foreign-only market stories lower for a US investor", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    const india = ruleScore({ title: "Defence stocks soar 9% as DAC clears ₹2.12 lakh crore", url: "i", source: "", publishedAt: "" }, now);
    const us = ruleScore({ title: "Defence stocks soar 9% after record Pentagon contract", url: "u", source: "", publishedAt: "" }, now);
    expect(india.score).toBeLessThan(us.score - 20);
  });
});
