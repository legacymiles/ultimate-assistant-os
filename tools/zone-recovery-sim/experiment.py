"""Main experiment: gap choice, and does running several accounts diversify?"""
import numpy as np, sys, time
sys.path.insert(0, "tools/zone-recovery-sim")
from sim import run, describe, table, OZ_PER_LOT, SPREAD, COMM_PER_LOT

GAPS  = [150, 250, 350, 500, 750, 1000]
N     = 10000
MIN   = 420          # 7-hour session
SPM   = 64           # ~1-second bars; validated leak-free
LOT   = 0.01
COST  = SPREAD * LOT * OZ_PER_LOT + COMM_PER_LOT * LOT * 2

t0 = time.time()
for vol, drift, name in [(0.20, 0.0,   "ZERO drift (no directional edge)"),
                         (0.20, -0.40, "-40%/yr drift (short is RIGHT)")]:
    res = run(N, MIN, vol, drift, GAPS, lot=LOT, steps_per_min=SPM,
              direction=-1, seed=11)
    table([describe(res[g], f"gap {g}pt ({g/100:.2f} USD)") for g in GAPS],
          f"=== SINGLE ACCOUNT, short {LOT}, vol {vol:.0%}, {name} ===")
    print(f"    cost of one round turn = ${COST:.2f}"
          f"   |  every gap's mean sits at -cost when drift is zero")

    M = np.vstack([res[g] for g in GAPS])
    ens  = M.sum(axis=0)                     # 6 accounts, one per gap
    solo = res[500] * len(GAPS)              # same total size, single gap
    table([describe(ens,  f"{len(GAPS)} accounts, mixed gaps"),
           describe(solo, f"{len(GAPS)}x size, one gap 500")],
          f"--- ENSEMBLE vs CONCENTRATED, identical total size ---")

    c  = np.corrcoef(M); iu = np.triu_indices_from(c, k=1)
    all_lock = np.all(M < 0, axis=0).mean()
    all_win  = np.all(M > 0, axis=0).mean()
    print(f"    mean pairwise correlation across accounts : {c[iu].mean():+.3f}")
    print(f"    P(ALL 6 accounts lose on the same path)   : {all_lock:.1%}")
    print(f"    P(ALL 6 accounts win on the same path)    : {all_win:.1%}")
    print(f"    ensemble std {ens.std():.2f}  vs  6 independent copies would be "
          f"{M.std(axis=1).mean()*np.sqrt(6):.2f}")

print(f"\n[{time.time()-t0:.0f}s]")

print("\n" + "=" * 86)
print('THE "EVENTUALLY IT MAKES MONEY" CLAIM, over repeated cycles')
print("=" * 86)
res = run(N, MIN, 0.20, 0.0, [500], lot=LOT, steps_per_min=SPM, seed=99)[500]
rng = np.random.default_rng(1)
print(f"{'cycles':>8} {'accounts':>9} {'E[total]':>10} {'P(ahead)':>10} {'5th %':>9}")
print("-" * 52)
for cycles in [1, 10, 50, 200, 1000]:
    for accts in [1, 6]:
        draw = rng.choice(res, size=(4000, cycles * accts), replace=True).sum(axis=1)
        print(f"{cycles:>8} {accts:>9} {draw.mean():>10.2f} "
              f"{(draw > 0).mean():>9.1%} {np.percentile(draw, 5):>9.2f}")
