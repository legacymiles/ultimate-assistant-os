"""
Is the negative verdict robust, or an artefact of one (lag, threshold) choice?

Sweeps both. Models execution EXPLICITLY -- you cross the follower's spread to
enter (buy at ask / sell at bid) and cross it again to exit -- rather than
netting mid-to-mid and subtracting a cost constant. Mid-to-mid can flatter a
strategy when the spread moves with the signal.

If NO cell is profitable, the verdict stands. If one is, it must be checked
against the time-reversed control before anyone believes it.
"""
import csv, sys
import numpy as np

COMM = 2.00 / 100.0 * 2      # USD/oz, round turn

def load(p):
    r = list(csv.DictReader(open(p)))
    return (np.array([int(x["gtc_ms"]) for x in r]),
            np.array([float(x["bid"]) for x in r]),
            np.array([float(x["ask"]) for x in r]))

def gridify(g, v, t0, t1):
    axis = np.arange(t0, t1 + 1, dtype=np.int64)
    idx = np.clip(np.searchsorted(g, axis, side="right") - 1, 0, len(v) - 1)
    return v[idx]

ga, ba, aa = load(sys.argv[1])      # A = coinexx
gb, bb, ab = load(sys.argv[2])      # B = dura
t0, t1 = max(ga[0], gb[0]), min(ga[-1], gb[-1])
A_b, A_a = gridify(ga, ba, t0, t1), gridify(ga, aa, t0, t1)
B_b, B_a = gridify(gb, bb, t0, t1), gridify(gb, ab, t0, t1)
hours = (t1 - t0) / 3.6e6

def econ(lead_mid, f_bid, f_ask, L, thr, hold):
    """Leader moves > thr over L ms -> take follower, exit after `hold` ms."""
    mv = lead_mid[L:] - lead_mid[:-L]
    n = min(len(mv), len(f_bid) - L - hold)
    mv = mv[:n]
    up, dn = mv > thr, mv < -thr
    # long: buy ask now, sell bid later | short: sell bid now, buy ask later
    entry_a = f_ask[L:L + n]; entry_b = f_bid[L:L + n]
    exit_b  = f_bid[L + hold:L + hold + n]; exit_a = f_ask[L + hold:L + hold + n]
    pnl = np.where(up, exit_b - entry_a, np.where(dn, entry_b - exit_a, 0.0))
    sig = up | dn
    if sig.sum() == 0:
        return 0, 0.0, 0.0
    net = pnl[sig] - COMM
    return int(sig.sum()), float(net.mean()) * 100, float(net.sum()) * 100

for name, lead, fb, fa in [("DURA leads -> trade COINEXX", (B_b + B_a) / 2, A_b, A_a),
                           ("COINEXX leads -> trade DURA", (A_b + A_a) / 2, B_b, B_a)]:
    print(f"\n{name}   (mean net pts per signal; >0 = edge)")
    print(f"{'thr pts':>8} |" + "".join(f"{'L='+str(l):>12}" for l in (16, 50, 100, 250, 500)))
    for thr_pts in (5, 10, 20, 30, 50, 100):
        cells = []
        for L in (16, 50, 100, 250, 500):
            n, mean, tot = econ(lead, fb, fa, L, thr_pts / 100.0, hold=L)
            cells.append(f"{mean:>+8.1f}({n//100:>2}h)" if n else f"{'--':>12}")
        print(f"{thr_pts:>8} |" + "".join(cells))
print("\n(NNh = hundreds of signals.) Every cell already pays spread twice + commission.")
