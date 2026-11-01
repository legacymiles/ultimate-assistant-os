"""
Does the 16ms effect survive REAL execution latency?

The sweep's profitable cells enter and exit within 16ms. That is not a
strategy, it is a measurement of simultaneity: you cannot send an order and
have it fill in 16ms from a retail terminal.

Here the signal is observed at t, but the fill happens at t+delay, and the
exit fill at t+delay+hold. Retail MT5 round-trip is 30-300ms.
"""
import csv, sys
import numpy as np

COMM = 2.00 / 100.0 * 2

def load(p):
    r = list(csv.DictReader(open(p)))
    return (np.array([int(x["gtc_ms"]) for x in r]),
            np.array([float(x["bid"]) for x in r]),
            np.array([float(x["ask"]) for x in r]))

def gridify(g, v, t0, t1):
    axis = np.arange(t0, t1 + 1, dtype=np.int64)
    return v[np.clip(np.searchsorted(g, axis, side="right") - 1, 0, len(v) - 1)]

ga, ba, aa = load(sys.argv[1]); gb, bb, ab = load(sys.argv[2])
t0, t1 = max(ga[0], gb[0]), min(ga[-1], gb[-1])
A_mid = (gridify(ga, ba, t0, t1) + gridify(ga, aa, t0, t1)) / 2
B_b, B_a = gridify(gb, bb, t0, t1), gridify(gb, ab, t0, t1)

def run(L, thr, delay, hold):
    mv = A_mid[L:] - A_mid[:-L]
    n = min(len(mv), len(B_b) - L - delay - hold); mv = mv[:n]
    up, dn = mv > thr, mv < -thr
    e = L + delay                      # fill index
    x = L + delay + hold               # exit index
    pnl = np.where(up, B_b[x:x+n] - B_a[e:e+n],
          np.where(dn, B_b[e:e+n] - B_a[x:x+n], 0.0))
    s = up | dn
    if s.sum() < 10: return None
    t = (pnl[s] - COMM) * 100
    return len(t), t.mean(), t.mean()/(t.std(ddof=1)/np.sqrt(len(t)))

print("Signal from a 16ms Coinexx move > threshold; trade Duramarkets.")
print("mean net points per trade (t-stat). Positive = edge.\n")
for thr in (30, 50):
    print(f"--- threshold {thr} pts ---")
    print(f"{'exec delay':>11} |" + "".join(f"{'hold '+str(h)+'ms':>16}" for h in (16, 100, 500, 2000)))
    for delay in (0, 30, 100, 200, 300):
        cells = []
        for hold in (16, 100, 500, 2000):
            r = run(16, thr/100, delay, hold)
            cells.append(f"{r[1]:>+8.1f}(t{r[2]:>+5.1f})" if r else f"{'--':>16}")
        tag = "  <- unreachable" if delay == 0 else ""
        print(f"{delay:>9}ms |" + "".join(cells) + tag)
    print()
