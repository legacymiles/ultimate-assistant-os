"""
What ONE feed can and cannot tell you.

CAN: tick rate, spread behaviour, quote-freeze gaps, realised volatility.
CANNOT: lead-lag, latency arbitrage. That needs a second feed, always.

Realised vol here feeds the Kalshi structure: it is the input that decides
whether Kalshi's implied probability is rich or cheap.
"""
import csv, sys, math, statistics as st
import numpy as np

path = sys.argv[1] if len(sys.argv) > 1 else "tools/feed-latency/ticks_mt5_XAUUSD.csv"
rows = list(csv.DictReader(open(path)))
g   = np.array([int(r["gtc_ms"]) for r in rows])
bid = np.array([float(r["bid"]) for r in rows])
ask = np.array([float(r["ask"]) for r in rows])
mid = (bid + ask) / 2.0
dur_s = (g[-1] - g[0]) / 1000.0

print(f"{len(rows)} ticks over {dur_s/60:.1f} min ({len(rows)/dur_s:.1f}/s)")
print(f"mid {mid.min():.2f} - {mid.max():.2f}   range {(mid.max()-mid.min())*100:.0f} pts")

gaps = np.diff(g)
print(f"\nQUOTE GAPS (a lagging broker shows long freezes)")
print(f"  median {np.median(gaps):.0f}ms  p95 {np.percentile(gaps,95):.0f}ms  max {gaps.max():.0f}ms")
frozen = gaps[gaps > 2000]
print(f"  freezes >2s: {len(frozen)}" + (f"  longest {frozen.max()/1000:.1f}s" if len(frozen) else ""))

sp = (ask - bid) * 100
print(f"\nSPREAD  min {sp.min():.0f} med {np.median(sp):.0f} p95 {np.percentile(sp,95):.0f} max {sp.max():.0f} pts")

# Realised vol on a fixed 1s grid (tick-time sampling biases vol upward via
# bid-ask bounce; a time grid with forward-fill does not).
axis = np.arange(g[0], g[-1], 1000)
idx  = np.clip(np.searchsorted(g, axis, side="right") - 1, 0, len(mid) - 1)
s1   = mid[idx]
lr   = np.diff(np.log(s1))
lr   = lr[np.isfinite(lr)]
sig_s   = lr.std()
ann     = sig_s * math.sqrt(252 * 24 * 3600)
print(f"\nREALISED VOL  {sig_s*1e4:.2f} bp/s  ->  {ann*100:.1f}% annualised")

# Extrapolate to settlement. A 20-minute sample is a NOISY estimate of a 7.5h
# move; chi-square gives the honest interval on the vol estimate itself.
n = len(lr)
lo = sig_s * math.sqrt(n / 1.96**2 * (1 - 2/(9*n) + 1.96*math.sqrt(2/(9*n)))**3 / (n/1.96**2))
for H in (7.5,):
    secs = H * 3600
    move_1sd = mid[-1] * sig_s * math.sqrt(secs)
    print(f"\nOVER {H}h: 1sd move = ${move_1sd:.1f}   2sd = ${2*move_1sd:.1f}")
    print(f"  P(|move| > $25) = {2*(1-0.5*(1+math.erf(25/(move_1sd*math.sqrt(2))))) :.1%}")
    print(f"  P(move < -$25)  = {0.5*(1+math.erf(-25/(move_1sd*math.sqrt(2)))):.1%}")
print(f"\n  CAVEAT: {dur_s/60:.0f} min of NY-session ticks. NY is the most volatile")
print( "  window of the day, so this OVERSTATES vol for a 7.5h horizon that")
print( "  includes the close. Treat it as an upper bound, not a point estimate.")
