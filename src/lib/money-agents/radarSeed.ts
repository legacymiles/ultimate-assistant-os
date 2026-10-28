// ---------------------------------------------------------------------------
// Opportunity Radar — the researched starting data: the release calendar and
// the smart-company list. Every figure carries its date and source, and the
// tab says when it was checked. Filled from a fresh web check (27 Oct 2026),
// never memory. Times are US Eastern: EDT (-04:00) until 1 Nov 2026, EST
// (-05:00) after. "tentative" = reported or projected, not confirmed.
// ---------------------------------------------------------------------------

import type { Catalyst, Company } from "./radar";

export const RADAR_SEEDED_ON = "2026-10-27";

const BLS_CPI = "https://www.bls.gov/schedule/news_release/cpi.htm";
const BLS_JOBS = "https://www.bls.gov/schedule/news_release/empsit.htm";
const BEA = "https://www.bea.gov/news/schedule";
const FED = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const BLS_2027 = "https://www.bls.gov/schedule/2027/home.htm";

const MACRO = ["GC=F", "^GSPC", "^IXIC", "DX-Y.NYB", "BTC-USD"];

const CPI_NOTE = "Hotter than expected usually hits stocks and gold the same morning; cooler lifts both. Sept CPI was +3.7% a year.";
const JOBS_NOTE = "Strong hiring keeps the Fed hawkish (dollar up, gold down); a miss does the opposite.";
const FED_NOTE = "Rates were raised to 3.75–4.00% in Sept; the Fed's own projection shows one more hike this year.";
const PCE_NOTE = "The Fed's favourite inflation gauge — smaller moves than CPI, but it can confirm a trend.";

export const CATALYSTS: Catalyst[] = [
  { id: "fomc-2026-10", at: "2026-10-28T14:00:00-04:00", name: "Fed rate decision", kind: "fomc", watch: MACRO, note: `${FED_NOTE} Press conference 2:30 PM.`, source: FED },
  { id: "jobs-2026-11", at: "2026-11-06T08:30:00-05:00", name: "Jobs report (October)", kind: "jobs", watch: MACRO, note: JOBS_NOTE, source: BLS_JOBS },
  { id: "cpi-2026-11", at: "2026-11-10T08:30:00-05:00", name: "CPI inflation (October)", kind: "cpi", watch: MACRO, note: CPI_NOTE, source: BLS_CPI },
  { id: "pce-2026-11", at: "2026-11-25T08:30:00-05:00", name: "PCE inflation + GDP (Q3, 2nd look)", kind: "pce", watch: MACRO, note: PCE_NOTE, source: BEA },
  {
    id: "ipo-anthropic",
    at: "2026-11-25",
    name: "Anthropic IPO (Nasdaq: ANT) — reported target",
    kind: "ipo",
    watch: ["^IXIC", "NVDA"],
    note: "Public S-1 filed 26 Oct 2026; no price range yet. Reported aim: list before Thanksgiving at a ~$2T valuation — not confirmed. Day-one pops mostly go to insiders; the ~180-day lock-up expiry is often the cheaper entry.",
    source: "https://www.sec.gov/Archives/edgar/data/0002130357/000162828026067168/anthropicpbc-sx1.htm",
    tentative: true,
  },
  {
    id: "ipo-dangote",
    at: "2026-11-30",
    name: "Dangote Refinery starts trading on NGX (Nigeria)",
    kind: "ipo",
    watch: [],
    note: "Offer closed 27 Oct at ₦525 (~$47B value). Trading expected in November, date not set. $4.73B net profit in the first 9 months of 2026. NGX only — no US listing until a possible NYSE listing after ~2029; a US buyer needs an NGX broker or an app like Daba (US eligibility unverified).",
    source: "https://dabafinance.com/en/news/dangote-refinery-posts-4-73-billion-profit-as-ipo-demand-surges",
    tentative: true,
  },
  { id: "jobs-2026-12", at: "2026-12-04T08:30:00-05:00", name: "Jobs report (November)", kind: "jobs", watch: MACRO, note: JOBS_NOTE, source: BLS_JOBS },
  { id: "fomc-2026-12", at: "2026-12-09T14:00:00-05:00", name: "Fed rate decision + projections", kind: "fomc", watch: MACRO, note: `${FED_NOTE} New dot-plot with this one.`, source: FED },
  { id: "cpi-2026-12", at: "2026-12-10T08:30:00-05:00", name: "CPI inflation (November)", kind: "cpi", watch: MACRO, note: CPI_NOTE, source: BLS_CPI },
  { id: "pce-2026-12", at: "2026-12-23T08:30:00-05:00", name: "PCE inflation + GDP (Q3, final)", kind: "pce", watch: MACRO, note: PCE_NOTE, source: BEA },
  {
    id: "earn-mu-2026-12",
    at: "2026-12-23T16:05:00-05:00",
    name: "Micron earnings (Q1 FY27)",
    kind: "earnings",
    watch: ["MU", "NVDA", "^IXIC"],
    note: "Projected date, not confirmed. Guidance: ~$61.5B revenue, ~86% gross margin. Beats are expected — the move comes from the size of the beat and next quarter's guide.",
    source: "https://www.wallstreethorizon.com/micron-earnings-calendar",
    tentative: true,
  },
  { id: "jobs-2027-01", at: "2027-01-08T08:30:00-05:00", name: "Jobs report (December)", kind: "jobs", watch: MACRO, note: JOBS_NOTE, source: BLS_JOBS },
  { id: "cpi-2027-01", at: "2027-01-13T08:30:00-05:00", name: "CPI inflation (December)", kind: "cpi", watch: MACRO, note: CPI_NOTE, source: BLS_CPI },
  { id: "ppi-2027-01", at: "2027-01-14T08:30:00-05:00", name: "PPI producer prices (December)", kind: "other", watch: MACRO, note: "Wholesale inflation — a hint of where CPI is heading.", source: BLS_2027 },
  { id: "fomc-2027-01", at: "2027-01-27T14:00:00-05:00", name: "Fed rate decision", kind: "fomc", watch: MACRO, note: FED_NOTE, source: FED },
  { id: "eci-2027-01", at: "2027-01-29T08:30:00-05:00", name: "Employment Cost Index (Q4)", kind: "other", watch: MACRO, note: "Wage growth — a sticky-inflation signal the Fed watches.", source: BLS_2027 },
  { id: "pce-2027-01", at: "2027-01-29", name: "PCE inflation (December)", kind: "pce", watch: MACRO, note: `${PCE_NOTE} Date expected, not yet published.`, source: BEA, tentative: true },
];

const DIV_SRC = "https://www.dividendpower.org/2026-dividend-kings/";

export const COMPANIES: Company[] = [
  // Profit machines
  {
    ticker: "MU",
    name: "Micron",
    bucket: "margin",
    metric: "Net margin ~69.5%, gross 86.8% (Q4 FY26); revenue +379% a year",
    why: "AI memory (HBM) is sold out, so it sets the price. Note: '72% pure profit' is out of date — it's higher now.",
    asOf: "2026-09-30",
    source: "https://www.sec.gov/Archives/edgar/data/0000723125/000072312526000018/a2026q4ex991-pressrelease.htm",
  },
  {
    ticker: "NVDA",
    name: "Nvidia",
    bucket: "margin",
    metric: "Net margin ~62%, gross 75% (Q2 FY27); revenue +106% a year",
    why: "The default chip for AI — nearly every AI company is a customer.",
    asOf: "2026-07-26",
    source: "https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000073/q2fy27pr.htm",
  },
  {
    ticker: "V",
    name: "Visa",
    bucket: "margin",
    metric: "Net margin ~51% (FY26: $23.5B on $45.9B)",
    why: "A toll on card payments worldwide with almost no factories or inventory.",
    asOf: "2026-09-30",
    source: "https://www.sec.gov/Archives/edgar/data/0001403161/000140316126000126/q42026earningsrelease.htm",
  },
  // Dividend payers
  { ticker: "JNJ", name: "Johnson & Johnson", bucket: "dividend", metric: "Yield ~2.1–2.3%; raised 61+ years in a row", why: "Healthcare giant; one of the longest raise streaks there is.", asOf: "2026-10-07", source: DIV_SRC },
  { ticker: "PG", name: "Procter & Gamble", bucket: "dividend", metric: "Yield ~2.8–2.9%; raised 53+ years", why: "People buy soap and diapers in every economy.", asOf: "2026-10-07", source: DIV_SRC },
  { ticker: "KO", name: "Coca-Cola", bucket: "dividend", metric: "Yield ~2.5%; raised 53+ years", why: "Global brand with pricing power; steady cash every quarter.", asOf: "2026-10-07", source: DIV_SRC },
  { ticker: "PEP", name: "PepsiCo", bucket: "dividend", metric: "Yield ~4.1–4.7%; raised 54+ years", why: "Higher yield than usual because the stock is down — check why before buying.", asOf: "2026-10-07", source: DIV_SRC },
  {
    ticker: "O",
    name: "Realty Income",
    bucket: "dividend",
    metric: "Pays monthly, $3.258/yr; 136 raises, 31+ years in a row",
    why: "Landlord to chain stores; a monthly cheque. Rate hikes can weigh on the price.",
    asOf: "2026-09-08",
    source: "https://www.realtyincome.com/sites/realty-income/files/09%2008%2026%20136th%20Common%20Stock%20Monthly%20Dividend%20Increase%20Declared%20by%20Realty%20Income.pdf",
  },
  // Growth bets
  {
    ticker: "PLTR",
    name: "Palantir",
    bucket: "growth",
    metric: "Revenue +94% a year (Q2 2026); 2026 guide above $8.15B",
    why: "AI software for governments and companies; priced for a lot more growth. Q3 results early November.",
    asOf: "2026-08-04",
    source: "https://www.xtb.com/sca-en/market-analysis/news-and-research/palantir-earnings-high-expectations-and-even-bigger-gains",
  },
  {
    ticker: "RKLB",
    name: "Rocket Lab",
    bucket: "growth",
    metric: "Revenue +62% a year (Q2 2026); $2.36B backlog; still losing money",
    why: "The listed small rival to SpaceX; Neutron rocket's first launch is the big catalyst.",
    asOf: "2026-08-10",
    source: "https://www.marketbeat.com/instant-alerts/rocket-lab-q2-earnings-call-highlights-2026-08-10/",
  },
  {
    ticker: "IONQ",
    name: "IonQ",
    bucket: "growth",
    metric: "Revenue +287% a year (Q2 2026); burning cash (−$114M FCF)",
    why: "Quantum computing — huge if it works, very volatile until then.",
    asOf: "2026-09-04",
    source: "https://www.tikr.com/blog/ionq-stock-grew-revenue-287-and-still-sits-53-below-its-high-heres-where-the-stock-could-go",
  },
  {
    ticker: "SPCX",
    name: "SpaceX",
    bucket: "growth",
    metric: "Listed 11 Jun 2026 at $135 — the largest IPO ever ($75B raised)",
    why: "Starlink + launches. Its ~180-day lock-up ends around December — watch for a dip.",
    asOf: "2026-06-11",
    source: "https://www.itiger.com/news/2643215930",
  },
];
