"""
Are the sweep's positive cells real, or small-sample noise?

Three tests, all of which a real edge must pass:
  1. t-stat on mean net per signal (n and variance, not just the mean).
  2. TIME-REVERSED control: reverse the follower. A real lead-lag cannot
     survive reversing the arrow of time; a mechanical artefact can.
  3. Bootstrap 95% CI on total P&L. If it straddles zero, there is nothing.
"""
import csv, sys
import numpy as np

COMM = 2.00 / 100.0 * 2
rng = np.random.default_rng(0)

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
A_b, A_a = gridify(ga, ba, t0, t1), gridify(ga, aa, t0, t1)
B_b, B_a = gridify(gb, bb, t0, t1), gridify(gb, ab, t0, t1)

def trades(lead, f_bid, f_ask, L, thr, hold):
    mv = lead[L:] - lead[:-L]
    n = min(len(mv), len(f_bid) - L - hold); mv = mv[:n]
    up, dn = mv > thr, mv < -thr
    pnl = np.where(up, f_bid[L+hold:L+hold+n] - f_ask[L:L+n],
          np.where(dn, f_bid[L:L+n] - f_ask[L+hold:L+hold+n], 0.0))
    sig = up | dn
    return (pnl[sig] - COMM) * 100      # points

A_mid = (A_b + A_a) / 2
print(f"{'config':>18} {'n':>6} {'mean':>8} {'t':>7} {'tot$':>9} {'boot95%':>18}  {'REVERSED':>10}")
for thr in (20, 30, 50, 100):
    for L in (16, 50):
        t = trades(A_mid, B_b, B_a, L, thr/100, L)
        if len(t) < 10: continue
        mean, sd, n = t.mean(), t.std(ddof=1), len(t)
        tstat = mean / (sd / np.sqrt(n)) if sd > 0 else 0.0
        tot = t.sum() * 0.01              # USD at 0.01 lot
        boot = np.array([rng.choice(t, n, replace=True).sum() * 0.01 for _ in range(2000)])
        lo, hi = np.percentile(boot, [2.5, 97.5])
        # control: reverse the follower in time
        tr = trades(A_mid, B_b[::-1], B_a[::-1], L, thr/100, L)
        rev = tr.mean() if len(tr) else float("nan")
        print(f"thr{thr:>3} L={L:<3}{'':>4} {n:>6} {mean:>+8.1f} {tstat:>+7.2f} {tot:>+9.2f} "
              f"[{lo:>+7.2f},{hi:>+7.2f}]  {rev:>+9.1f}")
print("\nt > 3 AND a bootstrap CI clear of zero AND a REVERSED mean near zero")
print("are all required. Any one failing means there is no edge in that cell.")
