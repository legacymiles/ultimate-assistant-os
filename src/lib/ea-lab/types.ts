// ---------------------------------------------------------------------------
// EA Lab — the shapes a tested Expert Advisor takes.
//
// One rule runs through all of this: a number is never allowed to travel
// without the conditions that produced it. A profit factor from a 25%-quality
// MT4 run and one from a 99% real-tick MT5 run are not the same kind of fact,
// and a table that sorts them together is lying. So `modelQuality` and
// `sample` ride along with every metric, and the ranking refuses to mix them.
// ---------------------------------------------------------------------------

/** How the tester modelled prices. This decides whether a result means anything. */
export type ModelQuality =
  | { kind: "real-ticks" }                      // MT5, broker tick history — the gold standard
  | { kind: "every-tick"; percent: number }     // MT4/MT5 generated ticks; percent is MT4's figure
  | { kind: "control-points"; percent: number } // MT4 interpolation — indicative only
  | { kind: "open-prices"; percent: number }    // effectively useless for anything intrabar
  | { kind: "unknown" };

/** Which slice of history a run covers. Ratings weight out-of-sample far higher. */
export type Sample = "in-sample" | "out-of-sample" | "full";

export type Platform = "mt4" | "mt5";

/** One closed deal as the tester reported it. */
export interface Trade {
  /** Close time, epoch ms. */
  time: number;
  openTime?: number;
  side: "buy" | "sell";
  lots: number;
  price: number;
  profit: number;
  /** Running account balance after this deal, when the report gives it. */
  balance?: number;
}

/** An EA as the lab knows it, independent of any single run. */
export interface EaRecord {
  id: string;
  name: string;
  platform: Platform;
  /** Absolute path to the .ex4/.ex5 so the runner can find it again. */
  path: string;
  /** Which terminal data folder it was discovered in. */
  terminal: string;
  /** Owner-assigned; the auto-classifier proposes, the owner confirms. */
  strategy?: StrategyClass;
  tags: string[];
  notes: string;
  addedAt: number;
}

/**
 * Strategy families, chosen because they FAIL differently — which is the only
 * classification worth having. Grouping by indicator would put a martingale
 * grid and a fixed-stop breakout in the same bucket for both using an RSI.
 */
export type StrategyClass =
  | "trend"          // breakout, momentum; many small losses, few large wins
  | "mean-reversion" // fades moves; high win rate, fat left tail
  | "grid"           // ladder of orders, no stop; dies on a trend
  | "martingale"     // size increases after losses; dies once, completely
  | "hedge-recovery" // opposite-side legs to lock; dies holding naked size
  | "scalper"        // many tiny trades; dies when spread widens
  | "news"           // event-driven; dies on slippage
  | "arbitrage"      // two-venue; dies when the latency closes
  | "manual-tool"    // panel/utility, not an autonomous strategy
  | "unknown";

/** What the exposure detector found. This is the lab's reason for existing. */
export interface ExposureProfile {
  /** Smallest lot the EA ever opened — the presumed base size. */
  baseLot: number;
  /** Largest single position as a multiple of baseLot. */
  maxLotMultiple: number;
  /** Largest total open volume at any instant, in lots. */
  maxGrossLots: number;
  /**
   * Largest UNHEDGED open volume, in lots. The number that matters: a hedged
   * book can look enormous and be flat, while naked size is what actually
   * kills the account.
   */
  maxNakedLots: number;
  /** How position size responds to losses. */
  progression: "constant" | "scaling" | "martingale";
  /**
   * Of the trades opened right after a loss, the fraction that were LARGER
   * than the trade that lost. Blind martingale sits near 1.0.
   */
  upsizeAfterLossRate: number;
  /**
   * Longest run of CONSECUTIVE escalations after losses. This, not the rate,
   * is what separates a martingale from a strategy that alternates two sizes:
   * alternating upsizes after every loss but never escalates twice in a row.
   */
  maxLadderDepth: number;
  /** 0 (benign) to 100 (a bomb with a timer). */
  riskScore: number;
  /** Plain sentences naming what was found, for the detail panel. */
  findings: string[];
}

/** One tester run, fully qualified by the conditions that produced it. */
export interface TestRun {
  id: string;
  eaId: string;
  symbol: string;
  timeframe: string;
  from: number;
  to: number;
  sample: Sample;
  modelQuality: ModelQuality;
  deposit: number;
  currency: string;
  leverage: number;
  spreadPoints: number | "current";
  /** Broker/server the history came from — results are not portable across these. */
  server: string;
  metrics: RunMetrics;
  exposure: ExposureProfile;
  trades: Trade[];
  ranAt: number;
  /** Set when the run failed; metrics are then meaningless. */
  error?: string;
}

export interface RunMetrics {
  netProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  expectedPayoff: number;
  /** Peak-to-trough on equity, in account currency and as a percent. */
  maxDrawdown: number;
  maxDrawdownPct: number;
  /** Longest stretch, in days, spent below a previous equity peak. */
  maxDrawdownDays: number;
  /** netProfit / maxDrawdown — how much return each unit of pain bought. */
  recoveryFactor: number;
  trades: number;
  winRate: number;
  largestLoss: number;
  /** Longest run of consecutive losers; the thing that ends accounts. */
  maxConsecutiveLosses: number;
  sharpe?: number;
}

/** The lab's verdict for one EA, across everything known about it. */
export interface Rating {
  eaId: string;
  /** 0-100, or null when nothing trustworthy has been measured yet. */
  score: number | null;
  /** Why the score is what it is, in the owner's language. */
  reasons: string[];
  /** Set when the EA cannot be scored, with the reason it cannot. */
  blocked?: string;
  bestRun?: string;
}
