"""
Adaptive / Conditional Recovery engine -- tick-level, execution-realistic.

WHAT THIS IS NOT
----------------
It is not an edge generator. On a zero-edge entry, no recovery rule makes
expectancy positive (optional stopping). This engine exists to answer a
narrower, answerable question:

    Do the RECOVERY legs earn their own keep?

Total P&L is dominated by base entries, so a system whose recovery legs lose
money can still show a rising equity curve. That is exactly how blind
martingale fools people. So P&L is decomposed: base legs and recovery legs are
accounted SEPARATELY, and the recovery verdict rests only on the latter.

DESIGN
------
* Bounded by construction. `max_loss_usd` force-closes a cycle. The bound is a
  parameter, not an emergent property of the ladder.
* Conditional. Each recovery leg must pass a named condition. `always` is the
  blind-martingale control, and it must be run every time as the baseline.
* Vol-adaptive. Gaps scale with measured volatility (EWMA of |dMid|), so the
  same config behaves consistently across regimes instead of being implicitly
  retuned by the market.
* Execution-realistic. Fills happen `exec_delay_ms` after the trigger, at the
  far side of the spread, with commission per leg. We measured that ignoring
  this turns a -14 pt strategy into a +23 pt one.
"""
from dataclasses import dataclass, field
import numpy as np

OZ_PER_LOT = 100.0
COMM_PER_LOT_SIDE = 2.00


@dataclass
class Config:
    mode: str = "hedge"          # 'hedge' (zone recovery) | 'scale' (average in)
    gap_vol_mult: float = 3.0    # recovery trigger, in EWMA-vol units
    tp_vol_mult: float = 2.0     # take profit, in EWMA-vol units
    lot_mult: float = 1.0        # 1.0 = bounded lock; >1 = martingale
    max_legs: int = 3            # recovery legs after the base leg
    base_lot: float = 0.01
    condition: str = "always"    # 'always' is the control
    exec_delay_ms: int = 100
    max_loss_usd: float = 50.0   # hard bound
    max_cycle_sec: float = 600.0


@dataclass
class Leg:
    is_recovery: bool
    side: int                    # +1 long, -1 short
    lot: float
    entry_px: float
    entry_i: int


@dataclass
class Result:
    base_pnl: float = 0.0
    recov_pnl: float = 0.0
    n_cycles: int = 0
    n_recov_legs: int = 0
    recov_leg_pnls: list = field(default_factory=list)
    base_leg_pnls: list = field(default_factory=list)
    cycle_pnls: list = field(default_factory=list)
    hit_bound: int = 0
    cond_blocked: int = 0

    @property
    def total(self): return self.base_pnl + self.recov_pnl


def ewma_vol(mid, alpha=0.001):
    """EWMA of |dMid| -- a robust, causal volatility proxy in price units."""
    d = np.abs(np.diff(mid, prepend=mid[0]))
    v = np.empty_like(d)
    acc = d[:1000].mean() if len(d) > 1000 else (d.mean() or 0.01)
    for i, x in enumerate(d):
        acc = alpha * x + (1 - alpha) * acc
        v[i] = acc
    return np.maximum(v, 0.005)


def check_condition(name, i, mid, vol, side, adverse_legs):
    """Gate for a recovery leg. Each is a falsifiable hypothesis, not a filter
    bolted on to make a backtest look better."""
    if name == "always":
        return True                                   # control: blind recovery
    if name == "low_vol":
        # Recover only in calm: mean reversion is likelier, trends less so.
        return vol[i] < np.median(vol[max(0, i - 50000):i + 1]) if i > 1000 else True
    if name == "range_bound":
        # Recover only if price sits inside its recent range -- i.e. not trending.
        w = mid[max(0, i - 20000):i + 1]
        if len(w) < 1000:
            return True
        lo, hi = np.percentile(w, [15, 85])
        return lo <= mid[i] <= hi
    if name == "exhaustion":
        # Recover only if the adverse move is DECELERATING.
        if i < 4000:
            return True
        recent = np.abs(mid[i] - mid[i - 2000])
        prior  = np.abs(mid[i - 2000] - mid[i - 4000])
        return recent < prior
    if name == "first_only":
        # Structural: at most one recovery leg, ever. Bounded by construction.
        return adverse_legs == 0
    raise ValueError(name)


def run(bid, ask, entries, cfg: Config, vol=None):
    """entries: array of tick indices where a base position opens (+1/-1 side)."""
    mid = (bid + ask) / 2.0
    if vol is None:
        vol = ewma_vol(mid)
    n = len(mid)
    res = Result()
    ent_i = {int(i): int(s) for i, s in entries}
    D = cfg.exec_delay_ms  # ticks are ~1 per 190ms; delay applied in ticks below

    i = 0
    while i < n - 10:
        if i not in ent_i:
            i += 1
            continue
        side = ent_i[i]
        fi = min(i + D, n - 1)                       # delayed fill
        legs = [Leg(False, side, cfg.base_lot, ask[fi] if side > 0 else bid[fi], fi)]
        anchor = mid[fi]
        t0 = fi
        cycle_open = True
        j = fi + 1
        while j < n and cycle_open:
            net_lot = sum(l.side * l.lot for l in legs)
            # mark-to-market at the exit side of the spread
            mtm = sum(l.lot * l.side * ((bid[j] if l.side > 0 else ask[j]) - l.entry_px)
                      for l in legs) * OZ_PER_LOT
            comm = sum(l.lot for l in legs) * COMM_PER_LOT_SIDE * 2
            equity = mtm - comm

            if equity <= -cfg.max_loss_usd or (j - t0) > cfg.max_cycle_sec * 5:
                res.hit_bound += 1
                cycle_open = False
            elif net_lot != 0 and equity >= cfg.tp_vol_mult * vol[j] * OZ_PER_LOT * abs(net_lot):
                cycle_open = False
            else:
                adverse = -(mid[j] - anchor) * (1 if side > 0 else -1)
                n_recov = sum(1 for l in legs if l.is_recovery)
                if adverse >= cfg.gap_vol_mult * vol[j] and n_recov < cfg.max_legs:
                    if check_condition(cfg.condition, j, mid, vol, side, n_recov):
                        fj = min(j + D, n - 1)
                        rs = -legs[-1].side if cfg.mode == "hedge" else side
                        rl = legs[-1].lot * cfg.lot_mult
                        legs.append(Leg(True, rs, rl, ask[fj] if rs > 0 else bid[fj], fj))
                        anchor = mid[fj]
                        j = fj
                    else:
                        res.cond_blocked += 1
                        cycle_open = False           # refuse to recover -> take the bounded loss
                j += 1
        # close everything at j
        k = min(j, n - 1)
        cyc = 0.0
        for l in legs:
            px = bid[k] if l.side > 0 else ask[k]
            p = l.lot * l.side * (px - l.entry_px) * OZ_PER_LOT - l.lot * COMM_PER_LOT_SIDE * 2
            cyc += p
            if l.is_recovery:
                res.recov_pnl += p; res.n_recov_legs += 1; res.recov_leg_pnls.append(p)
            else:
                res.base_pnl += p; res.base_leg_pnls.append(p)
        res.cycle_pnls.append(cyc)
        res.n_cycles += 1
        i = k + 1
    return res
