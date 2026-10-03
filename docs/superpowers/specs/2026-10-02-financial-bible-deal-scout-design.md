# Financial Bible — Deal Scout

**Date:** 2026-10-02
**Status:** design written, **not approved** — section 11 lists the decisions the owner has to make before this is buildable
**Room:** `/apps/financial-bible?studio=scout` · code in `src/lib/bible/scout/`
**Depends on:** the Build Plans spec (`2026-10-02-financial-bible-build-plans-design.md`) having built the shell

---

## 1. What this is

A scanner for the local second-hand market that tells you which listings are
worth buying to resell. You say what you hunt — categories, radius, budget
ceiling, minimum profit — and it watches Facebook Marketplace, OfferUp and
Craigslist, prices each candidate against what the thing actually sells for, and
ranks what is left by return.

One row of the answer:

| Item | Ask | Sells for | Profit | ROI | Days to sell | Grade | Where |
|---|---|---|---|---|---|---|---|
| DeWalt DCD996 drill kit | $90 | $185 med. | $63 | 70% | ~9 | A | FB · 6 mi |

Profit is after fees, shipping and any refurb cost — not asking price minus
asking price, which is the number every "deal finder" shows and the reason none
of them are useful.

**This is a lead generator, not an oracle.** Every row opens to show the comparable
sales it was priced from, so the owner can reject the number instead of trusting
it. A scout that hides its evidence is a scout that loses money confidently.

## 2. The hard part: two data problems

Neither marketplace data nor resale prices come from an official API. This is the
whole engineering risk of the app and it is worth stating plainly before any code
is written.

### 2a. Getting listings

Facebook Marketplace has **no public API for reading listings** — the old Graph
endpoints cover posting as a seller, not browsing. OfferUp and Craigslist have no
public developer API either. So there are three routes, and they differ in cost,
fragility and exposure:

**Route A — a paid scraper provider (recommended).** Apify actors, Bright Data,
ScrapeCreators and similar sell Marketplace/OfferUp/Craigslist listing data as an
HTTP call, roughly **$2–$5 per 1,000 listings** at the time of writing. Someone
else maintains the breakage, which on Facebook is frequent. The owner's own
Facebook account is never used, so it cannot be banned for this. Costs real money
per scan, which makes the scan cadence a budget decision (section 6).

**Route B — our own browser on the owner's PC.** Playwright (already in this
session's MCP set) driving a logged-in browser on the LOQ, the way `tools/ea-lab`
already puts work on the local rig. Free, and the data is as good as what he can
see. But it runs as his own account against Meta's Automated Data Collection
Terms, which prohibit automated collection without written permission — the
realistic penalty is an account ban, not a lawsuit, and it is his account. It also
breaks whenever Facebook ships a DOM change, and the maintenance lands on us.

**Route C — the conservative route.** Craigslist and OfferUp only, no Facebook,
plus a paste-a-link box so a listing the owner found himself gets priced and
scored like any other. Cheapest and dullest; loses the source with the most
inventory.

**Recommendation: A, behind an adapter.** `ListingSource` is an interface with one
method; the paid provider, a local Playwright runner and a manual paste box are
three implementations of it. The ROI engine never knows which one answered. That
way route A can be swapped for B when the bill annoys him, or for C if a provider
dies, without touching the part of the app that holds the value.

On the law: US courts have broadly held that scraping *publicly visible* pages is
not a computer-crime violation (the hiQ v. LinkedIn line), while Meta's terms
still contractually forbid automated collection. Those are two different things
and the design assumes both are true at once. The mitigations are in section 7
and they are not decoration — they are what keeps this an ordinary market-research
tool rather than a data-harvesting one.

### 2b. Getting resale prices (comps)

ROI is meaningless without a believable "sells for". eBay's official APIs do not
expose completed-sale prices in the general-access tier — Marketplace Insights is
restricted — so sold comps come from the same kind of third-party providers,
priced per 1,000 results.

Design response:

- `CompSource` is its own adapter, same shape as `ListingSource`.
- **Comps are cached hard.** Normalise an item to a key (brand + model + variant +
  condition bucket) and cache its comp set for 30 days in Supabase. A hunt for
  cordless drills prices the tenth DeWalt listing for free. Without this cache the
  app's running cost scales with listings instead of with distinct products, which
  is the difference between cents and dollars per scan.
- When no comps exist, the row is **graded D and says so** rather than falling
  back on a model's guess dressed as data. A model estimate may fill the field
  only when it is labelled `estimate` in the same ESTIMATE/VERIFIED language the
  Build Plans sheet already uses.

## 3. The ROI engine

The one part of this app that must be exactly right, and the one part that is
pure, local and fully testable.

```ts
export interface Candidate {
  ask: Money;                  // what the seller wants
  comp: { median: Money; low: Money; high: Money; n: number; ageDays: number };
  /** Everything that comes out of the sale price before you see a cent. */
  costs: {
    platformFeePct: number;    // eBay ~13%, Marketplace/OfferUp shipped sales differ
    paymentFeePct: number;
    shipping?: Money;          // by weight/size band, or 0 for local cash
    refurb?: Money;            // parts, cleaning, a charger it is missing
    travelMiles?: number;      // to collect it, costed at a per-mile rate
  };
  sellThroughDays: number;     // from the comp set, not invented
}

export interface Score {
  profit: Money;               // comp.median − ask − every cost above
  roiPct: number;              // profit / (ask + cash costs)
  daysToSell: number;
  /** profit per day of capital tied up — the number that actually ranks. */
  velocity: number;
  grade: "A" | "B" | "C" | "D";
  /** Plain-language reasons, shown on the row. */
  flags: string[];
}
```

Three rules that fall out of this and matter more than the formula:

1. **Rank by velocity, not profit.** $500 profit over six months is worse than $80
   over three days, because the second one can be done twenty times. The table
   sorts on profit-per-day-of-capital by default, with profit and ROI% as
   alternative sorts.
2. **Floors, not a firehose.** The hunt carries a minimum profit and a minimum
   ROI%, and anything under either is never shown. The owner's time is the scarce
   input, so a scout that returns 200 marginal rows has failed.
3. **Fees are not optional.** A candidate whose fee and shipping model is unknown
   is graded down, not scored as if selling were free.

## 4. Confidence grading

Grade is about the evidence, not the size of the number:

- **A** — 8+ sold comps, under 90 days old, tight spread, strong title match.
- **B** — 4+ comps, or a wider spread, or an older set.
- **C** — thin comps, loose title match, or an unknown fee model.
- **D** — no comps, or the listing itself is too vague to identify (no model
  number, one blurry photo, "make offer").

Grade is shown on every row and is a filter. D rows are kept rather than hidden,
because "I cannot price this" is useful information about a listing that might
still be a steal.

## 5. Data model and where it lives

Unlike Build Plans, this is **not** an `app_state` blob. A scan produces hundreds
of rows that need querying, deduping and ageing out, so it gets real tables:

```
scout_hunts       what the owner hunts: categories, radius, budget, floors, cadence
scout_listings    a listing seen: source, external id, title, ask, location, url,
                  first_seen, last_seen, gone_at          (no seller identity)
scout_comps       cached comp sets keyed by normalised item key, with expiry
scout_scores      the score for a listing at a point in time, with its comp key
scout_verdicts    the owner's own call: chased · bought · passed · sold, + outcome
```

`scout_verdicts` is the table that makes the app compound. Record what he actually
bought and what it actually sold for, and the engine's estimates can be measured
against reality — which is the only way to find out whether its "sells for" is
believable in his city, and the one feature every public deal-finder lacks.

Dedupe on `(source, external_id)`, with a fuzzy second pass on title + price +
location, because the same item is relisted constantly and a scout that shows the
same drill nine times gets closed.

## 6. Scanning

A hunt has a cadence (`hourly · 4× daily · daily · manual`). A Vercel cron hits
`POST /api/bible/scout/scan`, which runs due hunts, fetches listings through the
adapter, prices anything new, writes scores, and marks vanished listings `gone_at`
rather than deleting them — a listing that disappeared in two hours was priced
right and that is a signal about the market.

**Cost control is part of the design, not an afterthought:**

- Per-hunt and per-month caps on listings fetched, enforced in code, with the
  spend shown in the room's header the way `src/lib/ai/spend.ts` already shows AI
  spend elsewhere in this hub.
- A hunt that would exceed its cap stops and says so.
- The comp cache (section 2b) is what keeps the comp bill flat.
- A **dry-run** mode that scans with a tiny limit so a new hunt can be tuned
  without spending a scan's budget on a bad filter.

## 7. Rules this app obeys

Written into the code, not just the spec:

- **No seller identity is ever stored.** Not names, not profile links, not phone
  numbers. The app keeps the item, the price, the location to the precision the
  platform shows publicly, and the listing URL. Everything the ROI engine needs
  is about the object.
- **The app never contacts a seller.** No automated messages, no templated
  offers, no bulk outreach. It produces a link and the owner is the one who talks
  to a human. This is both an anti-spam-law boundary and the line between a
  research tool and a nuisance.
- **Nothing is republished.** Scraped data stays in the owner's private app.
- **Rate limits are respected** whichever adapter is in use, including the local
  one.
- **The provider's terms are the provider's problem under route A, and ours under
  route B** — and the spec says so out loud so the choice in section 11 is made
  with open eyes.

## 8. UI direction

Same discipline as Build Plans: a dense table, `interactive-web-studio` driving
the look, invoked before any component is written.

Three panes. **Hunts** down the left (each with its cadence, spend and hit rate).
The **board** in the middle: scored rows, sortable, filterable by grade and source,
with the floors visible as chips you can drag. A **drawer** on the right for one
candidate: its photos, the comp set it was priced against with each sale listed,
the fee and shipping maths shown as arithmetic rather than a single number, and
four buttons — Chase · Bought · Passed · Sold — that write `scout_verdicts`.

The room's header carries the one number that answers "is this app working":
realised profit from everything marked Sold, against the data spend that found it.

## 9. Testing

The engine is pure and gets the heavy coverage (`npx vitest run src/lib/bible/scout/`):

- `score.test.ts` — profit arithmetic with every fee combination; ROI on zero-cost
  edge cases; velocity ordering (the $80-in-3-days case must outrank the
  $500-in-180-days case); floors excluding correctly.
- `grade.test.ts` — each grade's boundary, including the no-comps D path.
- `normalise.test.ts` — item keys collapse "DeWalt DCD996 20V" and "Dewalt dcd996
  20v drill" to one key and do **not** collapse the kit and the bare tool.
- `dedupe.test.ts` — relists collapse, genuinely distinct items do not.
- `adapters` — each `ListingSource` tested against a recorded fixture, so a
  provider's shape change fails a test instead of silently producing zero rows.
- `budget.test.ts` — caps stop a scan; a stopped scan reports why.

## 10. Files

```
src/components/bible/scout/…                 hunts · board · candidate drawer
src/app/api/bible/scout/scan/route.ts        cron target
src/app/api/bible/scout/hunt/route.ts        CRUD for hunts
src/app/api/bible/scout/price/route.ts       price one pasted link
src/lib/bible/scout/types.ts
src/lib/bible/scout/score.ts      + test     the ROI engine
src/lib/bible/scout/grade.ts      + test
src/lib/bible/scout/normalise.ts  + test     item keys for the comp cache
src/lib/bible/scout/dedupe.ts     + test
src/lib/bible/scout/budget.ts     + test
src/lib/bible/scout/sources/*.ts             ListingSource implementations
src/lib/bible/scout/comps/*.ts               CompSource implementations
supabase/migrations/<date>_scout.sql
```

## 11. Decisions the owner has to make before this is built

1. **Which listing route** — A (paid provider, recommended), B (his own browser on
   his own account), or C (no Facebook).
2. **Monthly data budget.** At $2–5 per 1,000 listings plus comps, a daily hunt
   over a few categories is single-digit dollars a month; hourly hunts over many
   categories is not. The cap belongs in the config, and the number is his.
3. **What he actually hunts.** Tools, phones, appliances, furniture, bikes,
   consoles? The categories decide which comp source is worth paying for — tools
   and electronics price cleanly from sold comps, furniture barely prices at all.
4. **Profit floor and radius** — the two filters that decide whether the board is
   useful or noise.
5. **Where he resells**, since that sets the fee model: eBay shipped, Marketplace
   local cash, OfferUp shipped, or a mix.

## 12. Done means

1. A hunt can be created and scanned on demand, and returns scored rows with real
   comps behind them.
2. The velocity sort genuinely puts the fast flips on top.
3. Opening a row shows the comparable sales and the fee arithmetic, so a number
   can be checked rather than believed.
4. Marking Bought and then Sold records the real outcome, and the header shows
   realised profit against data spend.
5. A scan that hits its budget cap stops and says so instead of billing on.
6. No seller name, profile or phone number exists anywhere in the database.
7. Swapping the listing adapter from provider to local runner changes one config
   value and no engine code.

## 13. Sources consulted

- [Facebook Marketplace scrapers and APIs, 2026 roundup](https://scrapecreators.com/blog/facebook-marketplace-api-tools)
- [Apify — Facebook Marketplace scraper actor](https://apify.com/apify/facebook-marketplace-scraper)
- [Is scraping Facebook legal? What the courts actually say](https://thunderbit.com/blog/is-scraping-facebook-legal)
- [Meta's suit against businesses scraping Facebook and Instagram](https://techcrunch.com/2022/10/03/meta-settles-lawsuit-for-significant-sum-against-businesses-scraping-facebook-and-instagram-data)
- [Apify — eBay sold-comps / resale arbitrage intelligence](https://apify.com/quanmatrix/ebay-sold-comps-arbitrage-intelligence/api)
- [Apify — eBay sold listings, resale price data](https://apify.com/alaudinburki/ebay-sold-listings/api)
- [Apify — OfferUp scraper](https://apify.com/crowdpull/offerup-scraper)
- [ScrapingBee — OfferUp listings](https://www.scrapingbee.com/scrapers/offerup-api/)
- [Spider Cloud — Craigslist scraper](https://spider.cloud/scrapers/craigslist-scraper/)
