// ---------------------------------------------------------------------------
// A trade setup, and the arithmetic of it.
//
// The numbers in here are computed LOCALLY and never by a language model. Not
// as a performance choice — as a correctness one. Risk-to-reward, breakeven win
// rate and position size are four lines of arithmetic each, they are the part
// of a setup that is actually decidable, and a model that gets one of them
// wrong by a factor of ten is wrong about money. So the model is never asked.
// It is handed these figures, already correct, and asked about the reasoning.
//
// What this module deliberately does NOT do: decide whether a trade is a good
// idea. It checks whether a setup is internally consistent — a stop on the
// wrong side of entry, a target that implies a win rate nobody sustains — and
// hands back what has to be true for it to pay. Whether it will is not a
// question arithmetic answers.
// ---------------------------------------------------------------------------

export type Direction = "long" | "short";

export interface Setup {
  /** Free text: "EURUSD", "NAS100", "BTC". Never validated against a feed. */
  instrument: string;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  /** Timeframe as the owner writes it: "4h", "daily", "15m". */
  timeframe: string;
  /** Why they think it works. This is the part the agent argues with. */
  thesis: string;
}

export interface Account {
  /** Account size in its own currency. */
  size: number;
  /** Share of the account risked on this trade, as a percentage. */
  riskPct: number;
}

export interface Numbers {
  /** Currency moved against you per unit if the stop fills. */
  riskPerUnit: number;
  /** Currency moved for you per unit if the target fills. */
  rewardPerUnit: number;
  /** Reward ÷ risk. 2 means the target is twice as far away as the stop. */
  rr: number;
  /**
   * The share of these trades that must win to break even, ignoring costs.
   *
   * This is the number that makes a setup honest. A 1:1 needs 50%; a 1:3 needs
   * 25%. Writing it down next to the thesis is what stops "it's a 1:5, I only
   * need to be right sometimes" from going unexamined.
   */
  breakevenWinRate: number;
  /** Currency at risk, from the account and its risk share. */
  riskAmount: number;
  /** Units (lots, shares, contracts) that put exactly `riskAmount` behind the stop. */
  units: number;
  /** Currency returned if the target fills at that size. */
  rewardAmount: number;
}

/** A problem with the setup itself, found by arithmetic rather than opinion. */
export interface Flaw {
  /** `structure` = the setup contradicts itself. `scale` = it is sized oddly. */
  kind: "structure" | "scale";
  /** Blocking flaws make the numbers meaningless, so nothing is computed. */
  blocking: boolean;
  message: string;
}

const round = (n: number, dp: number) => Number(n.toFixed(dp));

/**
 * What is wrong with this setup before anyone reasons about it.
 *
 * Ordered with blocking flaws first, because a caller that only shows the first
 * one should show the one that makes the rest moot.
 */
export function flawsIn(setup: Setup, account: Account): Flaw[] {
  const out: Flaw[] = [];
  const { direction, entry, stop, target } = setup;

  for (const [name, v] of [
    ["Entry", entry],
    ["Stop", stop],
    ["Target", target],
  ] as const) {
    if (!Number.isFinite(v)) {
      out.push({ kind: "structure", blocking: true, message: `${name} is not a number.` });
    }
  }
  if (out.length > 0) return out;

  if (entry === stop) {
    out.push({
      kind: "structure",
      blocking: true,
      message: "Entry and stop are the same price, so there is no risk to size against.",
    });
  }
  if (entry === target) {
    out.push({
      kind: "structure",
      blocking: true,
      message: "Entry and target are the same price, so the trade cannot pay.",
    });
  }

  // The stop and the target have to be on opposite sides of entry, and on the
  // sides the direction implies. Getting this wrong is the most common way a
  // setup written down in a hurry turns out to mean something else.
  if (direction === "long") {
    if (stop > entry) {
      out.push({
        kind: "structure",
        blocking: true,
        message: "This is a long, but the stop is ABOVE entry — that is a short's stop.",
      });
    }
    if (target < entry) {
      out.push({
        kind: "structure",
        blocking: true,
        message: "This is a long, but the target is BELOW entry.",
      });
    }
  } else {
    if (stop < entry) {
      out.push({
        kind: "structure",
        blocking: true,
        message: "This is a short, but the stop is BELOW entry — that is a long's stop.",
      });
    }
    if (target > entry) {
      out.push({
        kind: "structure",
        blocking: true,
        message: "This is a short, but the target is ABOVE entry.",
      });
    }
  }

  if (!Number.isFinite(account.size) || account.size <= 0) {
    out.push({ kind: "scale", blocking: true, message: "Account size has to be a positive number." });
  }
  if (!Number.isFinite(account.riskPct) || account.riskPct <= 0) {
    out.push({ kind: "scale", blocking: true, message: "Risk per trade has to be a positive percentage." });
  }

  if (out.some((f) => f.blocking)) return out.sort((a, b) => Number(b.blocking) - Number(a.blocking));

  // Non-blocking: the numbers compute, but they are worth saying out loud.
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rr = reward / risk;
  if (rr < 1) {
    out.push({
      kind: "scale",
      blocking: false,
      message:
        `The target is nearer than the stop (${round(rr, 2)}:1), so this needs to win `
        + `${Math.round((1 / (1 + rr)) * 100)}% of the time just to break even.`,
    });
  }
  if (rr > 10) {
    out.push({
      kind: "scale",
      blocking: false,
      message:
        `A ${round(rr, 1)}:1 target is far enough out that the question is whether it ever fills, `
        + "not whether the ratio is good.",
    });
  }
  if (account.riskPct > 2) {
    out.push({
      kind: "scale",
      blocking: false,
      message:
        `Risking ${round(account.riskPct, 2)}% on one trade means `
        + `${Math.ceil(100 / account.riskPct)} consecutive losses would end the account.`,
    });
  }
  return out;
}

/**
 * The arithmetic, or null when the setup contradicts itself.
 *
 * Null rather than throwing, and null rather than NaN: a caller showing these
 * figures next to a thesis must be able to tell "not computable" from "zero",
 * because a zero reads as a real answer.
 */
export function numbersFor(setup: Setup, account: Account): Numbers | null {
  if (flawsIn(setup, account).some((f) => f.blocking)) return null;

  const riskPerUnit = Math.abs(setup.entry - setup.stop);
  const rewardPerUnit = Math.abs(setup.target - setup.entry);
  const rr = rewardPerUnit / riskPerUnit;
  const riskAmount = (account.size * account.riskPct) / 100;
  const units = riskAmount / riskPerUnit;

  return {
    riskPerUnit,
    rewardPerUnit,
    rr,
    breakevenWinRate: 1 / (1 + rr),
    riskAmount,
    units,
    rewardAmount: units * rewardPerUnit,
  };
}

/**
 * The expectancy of this setup at an assumed win rate, in currency per trade.
 *
 * The win rate is an ASSUMPTION the owner supplies, not something this module
 * knows — which is the whole point of showing it as a curve rather than a
 * single number. Costs are excluded, and a caller that shows this should say so.
 */
export function expectancy(n: Numbers, winRate: number): number {
  const w = Math.min(Math.max(winRate, 0), 1);
  return w * n.rewardAmount - (1 - w) * n.riskAmount;
}

/** How many decimal places this instrument's prices seem to want. */
export function precisionOf(setup: Setup): number {
  const dp = (v: number) => {
    const s = String(v);
    const i = s.indexOf(".");
    return i === -1 ? 0 : s.length - i - 1;
  };
  return Math.min(Math.max(dp(setup.entry), dp(setup.stop), dp(setup.target)), 8);
}

/** The setup as one line, for the agent's prompt and for a saved record. */
export function describe(setup: Setup, n: Numbers | null): string {
  const p = precisionOf(setup);
  const head =
    `${setup.instrument || "unnamed"} ${setup.direction} on the ${setup.timeframe || "unstated"} — `
    + `entry ${setup.entry.toFixed(p)}, stop ${setup.stop.toFixed(p)}, target ${setup.target.toFixed(p)}`;
  if (!n) return `${head} (the numbers do not compute)`;
  return `${head} · ${round(n.rr, 2)}:1 · breakeven win rate ${Math.round(n.breakevenWinRate * 100)}%`;
}
