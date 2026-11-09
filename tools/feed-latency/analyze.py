"""
Does a latency edge exist between two broker feeds? Answers in one number.

Method
------
1. Resample both feeds onto a common 1ms grid via the shared GetTickCount clock.
2. Cross-correlate mid-price CHANGES at lags -1000..+1000ms. The argmax lag is
   the lead-lag: positive => feed A leads feed B by that many ms.
3. Count ACTIONABLE divergences: moments where the leader moved further than the
   follower's full round-turn cost (spread + commission), AND the follower then
   actually followed within the lag window. Anything less is not tradeable.

CONTROLS (the sim lesson: an artifact will read as edge if you let it)
----------------------------------------------------------------------
* Time-reversal control. Reverse feed B in time and re-run. A real lead-lag
  vanishes; a methodology bug survives. If the control shows a comparable peak,
  the answer is "no edge", not "edge in both directions".
* Self control. Correlate feed A against itself shifted. Must peak at lag 0.
  If it does not, the clock alignment is broken and nothing else is meaningful.

Usage: python analyze.py ticks_mt5_XAUUSD.csv ticks_mt4_XAUUSD.csv
"""
import sys, csv, pathlib
import numpy as np

# Coinexx XAUUSD, measured 2026-09-28 (see docs/superpowers/specs/gold-kalshi-mt4-hedge.md)
OZ_PER_LOT   = 100.0
COMM_PER_LOT = 2.00          # per side, USD per lot
MAX_LAG_MS   = 1000


def load(path):
    g, bid, ask = [], [], []
    with open(path) as f:
        for r in csv.DictReader(f):
            try:
                g.append(int(r["gtc_ms"])); bid.append(float(r["bid"])); ask.append(float(r["ask"]))
            except (ValueError, KeyError):
                continue
    if not g:
        sys.exit(f"{path}: no usable rows")
    g = np.array(g, dtype=np.int64)
    bid = np.array(bid); ask = np.array(ask)
    return g, bid, ask, (bid + ask) / 2.0


def grid(g, mid, t0, t1):
    """Forward-fill onto a 1ms grid. Quotes are step functions, not samples."""
    axis = np.arange(t0, t1 + 1, dtype=np.int64)
    idx = np.searchsorted(g, axis, side="right") - 1
    out = np.where(idx >= 0, mid[np.clip(idx, 0, len(mid) - 1)], np.nan)
    return axis, out


def leadlag(a, b, label):
    """Cross-correlate first differences. +lag => a leads b."""
    da = np.diff(a); db = np.diff(b)
    ok = ~(np.isnan(da) | np.isnan(db))
    da = np.where(ok, da, 0.0); db = np.where(ok, db, 0.0)
    if da.std() == 0 or db.std() == 0:
        return 0, 0.0, np.zeros(2 * MAX_LAG_MS + 1)
    da = (da - da.mean()) / da.std(); db = (db - db.mean()) / db.std()
    lags = np.arange(-MAX_LAG_MS, MAX_LAG_MS + 1)
    cc = np.array([np.dot(da[max(0, L):len(da) + min(0, L)],
                          db[max(0, -L):len(db) + min(0, -L)]) / len(da) for L in lags])
    k = int(np.argmax(np.abs(cc)))
    print(f"  {label:26s} peak lag {lags[k]:+5d} ms   r={cc[k]:+.4f}")
    return int(lags[k]), float(cc[k]), cc


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    pa, pb = sys.argv[1], sys.argv[2]
    ga, ba_, aa_, ma = load(pa)
    gb, bb_, ab_, mb = load(pb)

    t0, t1 = max(ga[0], gb[0]), min(ga[-1], gb[-1])
    if t1 - t0 < 60_000:
        sys.exit(f"only {(t1-t0)/1000:.0f}s of overlap - record longer (need 10min+)")
    print(f"overlap {(t1-t0)/1000/60:.1f} min | A={pathlib.Path(pa).name} {len(ga)} ticks"
          f" | B={pathlib.Path(pb).name} {len(gb)} ticks")
    print(f"tick rate  A {len(ga)/((t1-t0)/1000):.1f}/s   B {len(gb)/((t1-t0)/1000):.1f}/s")

    _, A = grid(ga, ma, t0, t1)
    _, B = grid(gb, mb, t0, t1)
    _, A_bid = grid(ga, ba_, t0, t1); _, A_ask = grid(ga, aa_, t0, t1)
    _, B_bid = grid(gb, bb_, t0, t1); _, B_ask = grid(gb, ab_, t0, t1)

    print("\nLEAD-LAG")
    lag, r, _ = leadlag(A, B, "A vs B (real)")

    print("\nCONTROLS")
    leadlag(A, A, "A vs A (must peak at 0)")
    _, r_rev, _ = leadlag(A, B[::-1], "A vs B time-reversed")
    verdict_ctrl = abs(r) > 2 * abs(r_rev)
    print(f"  -> real peak {'is' if verdict_ctrl else 'is NOT'} >2x the reversed control"
          f"  ({abs(r):.4f} vs {abs(r_rev):.4f})")

    if lag == 0 or not verdict_ctrl:
        print("\nVERDICT: no exploitable lead-lag. The feeds move together within"
              "\n         measurement resolution. No arbitrage here, with or without"
              "\n         Westernpips. Do not spend money on this.")
        return

    leader, follower = ("A", "B") if lag > 0 else ("B", "A")
    L = abs(lag)
    Lm, Fb, Fa = (A, B_bid, B_ask) if lag > 0 else (B, A_bid, A_ask)
    print(f"\n  {leader} leads {follower} by {L} ms")

    # Actionable: leader's move over the lag window exceeds the follower's
    # round-turn cost, and the follower then closes the gap.
    spread = np.nanmean(Fa - Fb)
    cost = spread + 2 * COMM_PER_LOT / OZ_PER_LOT     # USD per oz, round turn
    print(f"  follower spread {spread*100:.1f} pts | round-turn cost {cost*100:.1f} pts"
          f" (${cost*OZ_PER_LOT*0.01:.2f} per 0.01 lot)")

    move = Lm[L:] - Lm[:-L]
    fmid = (Fb + Fa) / 2.0
    follow = fmid[L:] - fmid[:-L]
    sig = ~np.isnan(move) & ~np.isnan(follow) & (np.abs(move) > cost)
    n_sig = int(sig.sum())
    hours = (t1 - t0) / 3.6e6

    if n_sig == 0:
        print(f"\nVERDICT: lead-lag of {L}ms is real but NEVER exceeds cost "
              f"({cost*100:.1f} pts).\n         Not tradeable.")
        return

    captured = np.where(sig, np.sign(move) * follow, 0.0)[sig]
    net = captured - cost
    print(f"\n  signals {n_sig}  ({n_sig/hours:.1f}/hour)")
    print(f"  follow-through captured  mean {np.mean(captured)*100:+.1f} pts")
    print(f"  net of cost              mean {np.mean(net)*100:+.1f} pts"
          f"   hit rate {(net>0).mean()*100:.0f}%")
    edge_hr = np.sum(net) * OZ_PER_LOT * 0.01 / hours
    print(f"  => ${edge_hr:+.2f} per hour at 0.01 lot, before slippage/rejects")
    print("\nVERDICT:", "EDGE EXISTS - worth building the executor." if np.mean(net) > 0
          else "NO EDGE - the lag is real but cost eats it. Do not trade this.")


if __name__ == "__main__":
    main()
