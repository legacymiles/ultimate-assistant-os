# Gold: Kalshi daily contracts + MT4 zone-recovery hedge

Captured 2026-09-28. Working notes for pairing Kalshi's daily gold market against a
Coinexx XAUUSD position managed by MeetAlgo ZoneRecoveryPro.

## Verified facts (do not re-derive)

| Fact | Value | How verified |
|---|---|---|
| XAUUSD contract size | **100 oz / lot** | Ticket 103117184: sell 0.02 @ 4142.15, px 4143.65, P&L -3.00 = 1.50 x 0.02 x 100 |
| 0.01 lot | $1.00 per $1.00 of price | derived from above |
| Kalshi gold series | `KXGOLDD` "Gold Daily", category Commodities | /series/KXGOLDD |
| Kalshi settlement | **Pyth 1oz Gold/USD index = SPOT**, snapshot at 5:00 PM EDT (21:00 UTC) | /events settlement_sources |
| Kalshi index vs Coinexx | agree within ~1 pt | T4141 quoted 52c while broker spot = 4142.21 |
| GC=F futures vs spot | futures ~ +35 pts | 4177.30 futures vs 4142.21 spot, same minute |
| Fee model | `quadratic`: 0.07 x C x P x (1-P), rounded up | /series/KXGOLDD fee_type |

**Trap:** GC=F is NOT the right reference for a Kalshi gold strike. Kalshi is spot.
Using futures overstated the distance to the 4101 strike by ~35 points (70 vs 41).

## Live snapshot 2026-09-28 ~14:10 UTC

Spot 4142.21 / 4142.41 (20-pt spread). Event `KXGOLDD-26SEP2817`, closes 21:00 UTC.

| Strike | YES bid/ask | NO bid/ask |
|---|---|---|
| Above 4091 | 95 / 97 | 3 / 5 |
| Above 4101 | 93 / 94 | 6 / 7 |
| Above 4111 | 86 / 87 | 13 / 14 |
| Above 4121 | 76 / 77 | 23 / 24 |
| Above 4131 | 66 / 68 | 32 / 34 |
| Above 4141 | 52 / 54 | 46 / 48 |

$50 on YES T4101 @ 94c = 53 contracts, cost $49.82, payout $53.00, fee ~$0.21,
**net +$2.97** if gold > 4101 at 5pm, **-$49.82** if not.

## Why "short gold + Kalshi NO-reach" is not arbitrage

Arbitrage = profit in every state. The naked pairing fails on a rally:

| Gold @ 5pm | Short 0.01 | Kalshi YES | Net |
|---|---|---|---|
| 4101 | +$41.20 | -$49.82 | -$8.62 |
| 4130 | +$12.20 | +$2.97 | +$15.17 |
| flat | $0 | +$2.97 | +$2.97 |
| 4250 | **-$107.80** | +$2.97 | **-$104.83** |

The short's loss is unbounded; the $2.97 covers $2.97 of it. It is income against an
uncapped position, not a hedge.

One genuine asymmetry in your favour: the MT4 TP is a **touch** (fills any time price
tags the level), Kalshi is a **snapshot** at 5pm. Touch is a superset of settle-below,
so a dip-and-recover pays both legs. Does not fix the rally case.

## MeetAlgo ZoneRecoveryPro — measured behaviour

Settings as found (screenshot 2026-09-28 17:09 server):
Grid GAP 150 | Fix Hedge GAP **500** | Multiple Lots (Hedge) **2.0** | Max Hedge Trade **5**
| TakeProfit For Hedge 50 pts (Average) | Non-Hedge Mode Disable | Leverage 1:200

Confirmed live: sell 0.02 @ 4142.15 -> buy stop 0.04 @ 4147.15 (= +500 pts, = 2.0x lot).

Ladder at 2.0x, 500-pt gap, 0.02 initial. Locked loss evaluated at each fill:

| Fill | Lots | Net lots | Locked P&L |
|---|---|---|---|
| sell (initial) | 0.02 | -0.02 | 0 |
| buy hedge 1 | 0.04 | +0.02 | -$10 |
| sell hedge 2 | 0.08 | -0.06 | -$20 |
| buy hedge 3 | 0.16 | +0.10 | -$50 |
| sell hedge 4 | 0.32 | -0.22 | **-$100** |

EA panel reports `Max Margin | DD (Per Cycle) 433.96 | -105.00` — both check out
(-100 plus spread/commission; 0.22 lots x 100 oz x 4142 / 200 = $455 margin).

**The real risk is not -105.** At `Max Hedge Trade` the EA stops hedging and leaves you
holding net **-0.22 lots naked**, 11x the starting size, no protection. $22 per $1 of
adverse move; a 100-pt rally = -$2,200 on a $3,477 balance. The martingale relocates
the tail and enlarges it.

## x1 lock: what it buys and what it costs

Multiplier 1.0 -> hedge is 0.02 vs 0.02 -> **net flat, loss frozen** at
gap x lot x 100 = 5.00 x 2 = **-$10.00** + ~$0.48 costs. Genuinely capped. This is the
bounded-loss property the naked pairing lacks.

Cost: **a lock is a dead hedge.** Locked flat through a subsequent crash = Kalshi loses
and MT4 pays nothing. That is the worst path in the table below.

## Defined-risk structure

Input changes: `Multiple Lots (For Hedge)` 2.0 -> **1.0**, `Max Hedge Trade` 5 -> **1**,
`Fix Hedge GAP` keep **500**.

Gap wants to be **wide**, not tight — opposite to normal grid intuition. An upside lock is
harmless (Kalshi wins that state anyway); a lock *followed by* a crash is the loss. Wide gap
keeps the short alive for the only scenario it exists to cover.

| Gold @ 5pm | Path | Kalshi | MT4 0.02 | Net |
|---|---|---|---|---|
| <= 4101 | fell direct | -$49.82 | +$82.40 | +$32.58 |
| 4110 | fell | +$2.97 | +$64.40 | +$67.37 |
| 4142 | quiet | +$2.97 | +$0.12 | +$3.09 |
| >= 4147 | rallied, lock fired | +$2.97 | -$10.48 | -$7.51 |
| <= 4101 | rallied $5 THEN crashed | -$49.82 | -$10.48 | **-$60.30** |

Max loss **-$60.30** (1.7% of balance), max gain **~+$67**, every state bounded.
Worst path needs a ~141-pt round trip inside 7 hours.

## Open questions / not yet done

- Trailing stop + breakeven inputs not yet read (scroll below TakeProfit in Inputs tab).
- Partial-TP bot not yet inspected — likely the cleanest way to unlock one leg of a
  frozen pair without re-arming a martingale.
- Cheaper synthetic: Kalshi NO @ 7c pays $1. $7 -> 100 contracts -> $100 if gold <= 4101.
  Digital payoff, defined risk, zero management. A grid is a poor way to synthesise a digital.
- Account is **Coinexx-Demo** (5220992). Kalshi leg cannot be paper-traded alongside it.

## Useful commands

    # spot (broker-equivalent) vs futures
    curl -s -H "User-Agent: Mozilla/5.0" \
      "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d"

    # today's gold event + strikes
    curl -s "https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXGOLDD&status=open"
    curl -s "https://api.elections.kalshi.com/trade-api/v2/markets/KXGOLDD-26SEP2817-T4101/orderbook?depth=5"

Kalshi market data is keyless. Portfolio/orders need an API key + RSA request signing.

---

# Part 2 — Simulation results (2026-09-28)

Code: `tools/zone-recovery-sim/{sim.py,experiment.py}`. Run `python tools/zone-recovery-sim/sim.py`
to re-validate, then `python tools/zone-recovery-sim/experiment.py`.

## Validating the simulator first

Two bugs were found and fixed before any result was trusted:

1. **Monte Carlo drift read as edge.** Sample drift of 0.005% in the price path
   is worth +$0.22/cycle to a short. Fixed with antithetic sampling (half the
   paths are exact mirrors), which forces sample drift to identically zero.
2. **Discretisation leak.** Barriers are credited as filling AT the barrier —
   correct for a stop in liquid gold, but only if the simulated price is
   near-continuous. At 1-minute steps gold moves ~$1.38 per step and teleports
   past a $1.50–$5.00 barrier, gifting the strategy ~$0.77/cycle.

Convergence, gap 500, driftless (truth = -costs = -$0.240):

| steps/min | sec/step | sigma/step | SHORT mean | LONG mean | leak |
|---|---|---|---|---|---|
| 1 | 60.00 | 1.376 | +0.529 | +0.526 | +0.767 |
| 4 | 15.00 | 0.688 | +0.155 | +0.157 | +0.396 |
| 16 | 3.75 | 0.344 | -0.126 | -0.126 | +0.114 |
| **64** | **0.94** | **0.172** | **-0.242** | **-0.238** | **0.000** |
| 256 | 0.23 | 0.086 | -0.239 | -0.241 | 0.000 |

At ~1-second bars the leak is zero and both directions return exactly -costs.
**Control:** on a driftless walk, optional stopping says ANY stopping rule returns
E[pnl] = -costs. If a config beats that, the sim is broken, not the strategy.
All results below use `steps_per_min=64`.

## Finding 1 — gap size does not change expectancy, only shape

Short 0.01, 7-hour session, vol 20%, zero drift:

| gap | mean | median | P(win) | worst |
|---|---|---|---|---|
| 150 pt | -0.28 | -1.98 | 29.8% | -1.98 |
| 250 pt | -0.26 | -0.20 | 37.9% | -2.98 |
| 350 pt | -0.24 | -0.14 | 43.3% | -3.98 |
| 500 pt | -0.21 | -0.05 | 48.5% | -5.48 |
| 750 pt | -0.19 | +0.82 | 53.8% | -7.98 |
| 1000 pt | -0.15 | +0.87 | 57.0% | -10.48 |

Every mean is -$0.24, the round-turn cost. A wide gap buys a **higher win rate**
(57% vs 30%) at the price of a proportionally **bigger loss when it locks**. The
product is constant. Tuning the gap moves you along one curve; it does not lift it.

## Finding 2 — multiple accounts do not diversify

Six accounts, one per gap, all short, same price path, vs the same total size in
one account:

| | mean | P(win) | worst | std |
|---|---|---|---|---|
| 6 accounts, mixed gaps | -1.33 | 43.6% | -32.88 | 20.37 |
| 6x size, one gap 500 | -1.28 | 48.5% | -32.88 | 24.12 |

- mean pairwise correlation between accounts: **+0.72**
- **P(ALL 6 accounts lose on the same path): 43.0%**
- ensemble std **20.37** vs **9.44** if the six were genuinely independent

The ensemble carries 2.2x the risk real diversification would give, and its mean
is *worse* than concentrating (-1.33 vs -1.28) because six accounts pay six sets
of spread. The hoped-for "one locks while another profits" happens in chop; in a
trend all six lock together, which is 43% of paths.

## Finding 3 — "eventually it makes money" runs the wrong way

Repeated cycles, gap 500, driftless:

| cycles | accounts | E[total] | P(ahead) | 5th pct |
|---|---|---|---|---|
| 1 | 1 | -0.11 | 48.1% | -5.48 |
| 10 | 1 | -1.67 | 44.0% | -22.43 |
| 10 | 6 | -11.97 | 34.9% | -62.21 |
| 200 | 1 | -37.85 | 25.5% | -130.43 |
| 200 | 6 | -222.47 | 5.3% | -451.97 |
| 1000 | 1 | -187.06 | 7.1% | -394.94 |
| **1000** | **6** | **-1132.27** | **0.0%** | **-1646.17** |

Repetition is what *guarantees* the loss. The law of large numbers converges a
negative-expectancy process onto its mean. Six accounts converge six times faster.

## Finding 4 — the hedging destroys 97% of a directional edge (the big one)

If you are genuinely RIGHT about gold's direction, does the machinery let you collect it?

| drift/yr | naked short | gap 500 x1 | gap 1000 x1 | edge kept |
|---|---|---|---|---|
| 0% | -0.240 | -0.231 | -0.278 | — |
| -20% | **+0.719** | -0.208 | -0.247 | **3%** |
| -40% | **+1.678** | -0.189 | -0.207 | **3%** |
| -80% | **+3.594** | -0.149 | -0.145 | **2%** |
| -160% | **+7.425** | -0.078 | +0.007 | **2%** |

Even in a violent downtrend the hedged config keeps ~2-3% of what simply holding
the short would have earned. Cause: the trailing stop (200/100) exits on the first
$2.00 retrace, while the lock freezes the loser permanently. The system cuts
winners and holds losers — precisely inverted.

**This is the actionable result.** The EA is drawdown-control machinery, and it is
good at that (`Max Margin 0.08` on an x1 lock is real). It is not an edge, and it
is actively expensive to run on top of one.

## Caveat — what this does NOT prove

The model is GBM: no mean reversion, no fat tails, no session structure. A grid's
strongest honest defence is that intraday gold mean-reverts, which GBM cannot
express, and lock-and-bounce would score better under mean reversion than shown here.

Finding 4 is robust to that (trailing-stop truncation is mechanical), but Findings 1–3
deserve a re-run on real tick data before being treated as final. Next step: pull
Coinexx M1 history for XAUUSD and replay `cycle()` over actual bars instead of GBM.

## Practical notes

- Scaling lot size scales a negative number. There is no size that fixes expectancy;
  0.01 vs 0.02 changes only how fast. Scale edge, not size.
- Multiple accounts at one broker running correlated hedged books can breach T&Cs
  (arbitrage / cross-account hedging clauses). Check Coinexx terms before building it.

---

# Part 3 — Live measurement 2026-09-29 (NY session)

Code: `tools/feed-latency/` (tick capture + lead-lag), `tools/gold-hedge/` (pricer + edge test).

## API drift — two of Part 1's "verified facts" are now stale

| Was | Now |
|---|---|
| Kalshi prices in cent fields (`yes_ask`) | **`yes_ask_dollars`** (decimal). Cent fields return `None`; code written to Part 1 silently produces an empty board. |
| Pyth Hermes keyless | **401 Unauthorized.** Hermes now needs an API key. |

Kalshi *market data* is still keyless; only the field names moved.

## Coinexx XAUUSD measured, 20 min NY session (6,689 ticks)

| Metric | Value |
|---|---|
| Tick rate | 5.6/s |
| Spread | min 6 / median **20** / p95 21 / max 65 pts |
| Quote gaps | median 125 ms, p95 375 ms, max 1.2 s, **zero freezes >2 s** |
| Realised vol | 0.65 bp/s → **30.5% annualised** |

Broker `time_msc` runs **+3h** (server is UTC+3). Not latency. Any tool comparing
it to local time must correct for this or it reads a 3-hour "lag".

No freezes >2s is itself a finding: a broker that lags exploitably usually shows
quote freezes. This feed looks well-behaved.

## Edge test: Kalshi implied prob vs realised vol

`tools/gold-hedge/edge.py`. Lognormal, zero drift, vol band 15% / 22% / 30.5%.
The band is the point — a verdict that flips across it is an artefact of not
knowing vol, not an edge.

**Result: no tradeable mispricing found.**

- Strikes 4110–4150: fair across the whole band.
- Strikes 4170–4200 read "YES cheap" at 22%+, but **flip to fair or rich at 15%**.
  Pure vol-estimate artefact. The 30.5% figure is measured from NY-session ticks,
  the most volatile window of the day, so it is an *upper bound* — which means
  these apparent edges are the least trustworthy ones on the board.
- Only **T4160 (ATM)** is consistently cheap across all three vols, by 4–6%.
  But ATM probability is ~50% almost regardless of vol, which is *why* it is
  stable — that is not independent confirmation. And the gap is inside the
  3-cent bid/ask plus a 1.75-cent fee. Buying at 0.49 against a 52.1% model is
  ~+1.3 cents net on 49 risked, with ~50/50 variance.

**Conclusion:** the same result Part 2's simulator gave for zone recovery, by a
different route. Absent a real mispricing, the structure returns -costs. The ATM
"edge" requires believing a driftless-lognormal model beats the Kalshi market's
own view at the one strike where the market is most attentive. Do not size into it.

## Latency arbitrage — NOT ANSWERED

The Hugosway MT4 TickLogger was never started, so only one feed was recorded.
Lead-lag is a relative measurement; one feed cannot answer it. Re-run with both
terminals logging and at least 10 min of overlap.

Cost bar to clear: **24 pts** ($0.24/oz) = 20 spread + 4 commission. Two broker
feeds must diverge by more than that *within the lag window* for an arb to exist.

---

# Part 4 — Latency arbitrage, ANSWERED (2026-09-29, NY session)

Hugosway is unreachable from the US. Substituted **Duramarkets MT5** (demo 215402),
which is better: two MT5 terminals means the same Python recorder runs twice
(`record_mt5.py ... <terminal path> <tag>`), one process pinned per terminal, both
stamping with Windows `GetTickCount`. The MQL4 TickLogger is no longer needed.

Captured 20.0 min overlap, ~6,390 ticks each, 5.3/s both sides.

| | Coinexx | Duramarkets |
|---|---|---|
| Spread | 20 pts | **15 pts** |
| Round-turn cost | 24 pts | **19 pts** |

Broker mids sit ~14-42 pts apart and the offset VARIES. Only changes are
tradeable, so the analyser differences before correlating.

## The lead-lag is real

    A vs B (real)              peak lag  -16 ms   r=+0.3635
    A vs A (must peak at 0)    peak lag   +0 ms   r=+1.0000   <- clock OK
    A vs B time-reversed       peak lag -704 ms   r=+0.0175   <- 20x separation

**Duramarkets leads Coinexx by 16 ms.** Controls pass.

## The apparent edge, and why it is not one

A (lag x threshold) sweep found positive cells trading Duramarkets on Coinexx
moves at L=16ms — and they survived every statistical test:

| config | n | mean pts | t | bootstrap 95% | reversed control |
|---|---|---|---|---|---|
| thr 30, L=16 | 1328 | +4.3 | +5.89 | [+39.84, +76.40] | -19.3 |
| thr 50, L=16 | 288 | +23.1 | +9.80 | [+53.34, +79.85] | -19.2 |
| thr 100, L=16 | 32 | +49.8 | +3.68 | [+7.10, +23.60] | -19.0 |

Every L=50 cell was negative. That concentration at 16ms was the tell.

**The trade requires entering AND exiting inside 16 milliseconds.** Adding a
realistic fill delay destroys it completely:

| exec delay | thr30/hold100 | thr50/hold100 |
|---|---|---|
| 0 ms (unreachable) | **+4.4** (t +6.0) | **+23.1** (t +9.8) |
| 30 ms | -17.8 (t -39.9) | -14.4 (t -8.5) |
| 100 ms | -17.2 (t -33.0) | -14.9 (t -8.1) |
| 300 ms | -21.5 (t -74.9) | -23.8 (t -42.6) |

Retail MT5 round-trip is 30-300ms. **Every reachable cell is strongly negative.**

## Conclusion

The "edge" was measuring SIMULTANEITY, not predictability. Selecting moments
when both brokers tick within 16ms of each other is not a strategy; it is a
restatement of the fact that they watch the same market.

**No tradeable latency arbitrage exists between Coinexx and Duramarkets.**
Westernpips would have been sold for exactly this and would have failed the
same way — the software was never the missing piece. The 16ms lead is genuine
and completely unreachable.

This is the third independent route to the same destination: zone recovery
(Part 2, simulation), the Kalshi board (Part 3, vol band), and now latency arb.
All three return -costs once the artefact is removed.

## Reusable

`tools/feed-latency/`: `record_mt5.py` (any MT5 broker, `<path> <tag>`),
`analyze.py` (lead-lag + controls), `sweep.py` (lag x threshold, explicit
ask/bid execution), `validate.py` (t-stat, bootstrap, reversed control),
`executable.py` (**the one that matters — fill-delay sensitivity**),
`single_feed.py` (vol/spread/freezes).

Run `executable.py` FIRST on any future latency idea. It is the cheapest way
to kill a strategy that only works at zero latency.
