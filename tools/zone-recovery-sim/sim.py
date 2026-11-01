"""
Zone-recovery x1 lock simulator - MeetAlgo ZoneRecoveryPro mechanics.

Models ONE cycle: entry -> (trailing-stop exit | hedge lock) -> session end.
Multiplier 1.0, Max Hedge Trade 1, so a lock is terminal and bounded.

Calibrated to Coinexx XAUUSD, 2026-09-28:
  100 oz/lot | spread 20 pts ($0.20) | commission $0.04 per 0.02 lot per side
  trailing 200/100 | observed: sell 0.02 @4142.15, trailed to 4141.04, +$1.94

TWO THINGS THIS FILE EXISTS TO GET RIGHT
----------------------------------------
1. ANTITHETIC sampling. Without it a 0.005% Monte Carlo drift in the price
   sample reads as real profit to a directional book (+$0.22/cycle of pure
   fiction). Half the paths are exact mirrors, so sample drift is identically 0.

2. TIME RESOLUTION. Barriers are credited as filling AT the barrier, which is
   how a stop behaves in liquid gold. That is only valid if the simulated price
   is near-continuous. At 1-minute steps gold moves ~1.4 USD per step and
   teleports straight past a 1.50-5.00 USD barrier, handing the strategy a free
   ~0.7 USD per cycle and making a break-even mechanic look profitable. Use
   steps_per_min high enough that `leak` in convergence() is small.

CONTROL: on a driftless walk, optional stopping says ANY stopping rule returns
E[pnl] = -costs, for long and short alike. If run() disagrees, the sim is wrong,
not the strategy.
"""
import numpy as np

OZ_PER_LOT   = 100.0
SPREAD       = 0.20
COMM_PER_LOT = 2.00
SPOT         = 4143.0


def run(n_paths, minutes, vol_annual, drift_annual, gaps, lot=0.01,
        trail_pts=200, step_pts=100, direction=-1, steps_per_min=60, seed=0):
    """
    Incremental GBM + barrier evaluation. Price is never stored as a matrix, so
    resolution can go fine without exhausting memory.

    Returns {gap_pts: pnl_array}. All gaps see the SAME price paths, which is
    what makes the cross-account correlation measurement meaningful.
    """
    rng   = np.random.default_rng(seed)
    n     = (n_paths // 2) * 2
    nstep = int(minutes * steps_per_min)
    dt    = 1.0 / (252 * 1440 * steps_per_min)
    mu, sig = drift_annual, vol_annual
    sgn   = 1.0 if direction == -1 else -1.0     # +1 => profit when price falls

    units  = lot * OZ_PER_LOT
    cost_1 = SPREAD * units + COMM_PER_LOT * lot * 2
    cost_2 = 2 * cost_1

    entry = np.full(n, SPOT)
    price = entry.copy()
    state = {}
    for g in gaps:
        state[g] = dict(pnl=np.full(n, np.nan), sl=np.full(n, np.nan),
                        best=entry.copy(), gap=g / 100.0)
    trail, step = trail_pts / 100.0, step_pts / 100.0

    for _ in range(nstep):
        z = rng.normal(0.0, 1.0, n // 2)
        z = np.concatenate([z, -z])                       # antithetic
        price = price * np.exp((mu - 0.5 * sig**2) * dt + sig * np.sqrt(dt) * z)
        prof  = sgn * (entry - price)                     # USD in our favour

        for g, st in state.items():
            pnl, sl, best, gap = st['pnl'], st['sl'], st['best'], st['gap']
            live = np.isnan(pnl)
            if not live.any():
                continue

            lock = live & (prof <= -gap)                  # hedge fires, frozen
            pnl[lock] = -gap * units - cost_2

            live = np.isnan(pnl)
            arm  = live & (prof >= trail) & np.isnan(sl)
            sl[arm]   = price[arm] + sgn * trail
            best[arm] = price[arm]

            adv = live & ~np.isnan(sl) & (sgn * (best - price) >= step)
            best[adv] = price[adv]
            sl[adv]   = price[adv] + sgn * trail

            hit = live & ~np.isnan(sl) & (sgn * (sl - price) <= 0)
            pnl[hit] = sgn * (entry[hit] - sl[hit]) * units - cost_1

    for g, st in state.items():                           # still open at 5pm
        pnl  = st['pnl']
        open_ = np.isnan(pnl)
        pnl[open_] = sgn * (entry[open_] - price[open_]) * units - cost_1
    return {g: st['pnl'] for g, st in state.items()}


def convergence(n_paths=6000, minutes=420, vol=0.20, gap=500, seed=3):
    """Show the discretisation leak shrinking as resolution rises."""
    units  = 0.01 * OZ_PER_LOT
    truth  = -(SPREAD * units + COMM_PER_LOT * 0.01 * 2)
    print(f"{'steps/min':>10} {'sec/step':>9} {'sigma/step':>11} "
          f"{'SHORT mean':>11} {'LONG mean':>10} {'leak vs -cost':>14}")
    print("-" * 70)
    for spm in [1, 4, 16, 64, 256]:
        s_ = run(n_paths, minutes, vol, 0.0, [gap], direction=-1,
                 steps_per_min=spm, seed=seed)[gap]
        l_ = run(n_paths, minutes, vol, 0.0, [gap], direction=+1,
                 steps_per_min=spm, seed=seed)[gap]
        sig_step = SPOT * vol * np.sqrt(1.0 / (252 * 1440 * spm))
        avg = (s_.mean() + l_.mean()) / 2
        print(f"{spm:>10} {60/spm:>9.2f} {sig_step:>11.3f} "
              f"{s_.mean():>11.3f} {l_.mean():>10.3f} {avg - truth:>+14.3f}")
    print(f"\ntruth (optional stopping, driftless): E[pnl] = -costs = {truth:+.3f}")


def describe(pnl, label):
    return dict(cfg=label, mean=pnl.mean(), median=np.median(pnl),
                p_win=(pnl > 0).mean(), p5=np.percentile(pnl, 5),
                p95=np.percentile(pnl, 95), worst=pnl.min(), std=pnl.std())


def table(rows, title):
    print(f"\n{title}")
    print(f"{'config':>24} {'mean':>8} {'median':>8} {'P(win)':>7} "
          f"{'5th %':>8} {'95th %':>8} {'worst':>9} {'std':>7}")
    print("-" * 86)
    for r in rows:
        print(f"{r['cfg']:>24} {r['mean']:>8.2f} {r['median']:>8.2f} "
              f"{r['p_win']:>6.1%} {r['p5']:>8.2f} {r['p95']:>8.2f} "
              f"{r['worst']:>9.2f} {r['std']:>7.2f}")


if __name__ == "__main__":
    print("=" * 86)
    print("STEP 1 - VALIDATE. A break-even mechanic must return -costs, both ways.")
    print("=" * 86)
    convergence()
