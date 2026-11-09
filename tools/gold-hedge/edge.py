"""
Is Kalshi's gold board mispriced vs realised volatility?

Compares each strike's implied P(settle above) to a lognormal estimate from
measured vol. Shows a SENSITIVITY BAND, because the conclusion flips on the
vol input and a single point estimate would hide that.

Kalshi settles on spot at 21:00 UTC. Drift is set to zero: over 7.5h the
risk-neutral drift on gold is ~0.01%, far below the noise in any vol estimate,
and assuming a direction is how you talk yourself into a position.
"""
import json, urllib.request, datetime as dt, math, sys

API = "https://api.elections.kalshi.com/trade-api/v2"

def get(u):
    r = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    return json.load(urllib.request.urlopen(r, timeout=15))

def spot():
    import MetaTrader5 as mt5
    if not mt5.initialize():
        sys.exit("MT5 not logged in")
    t = mt5.symbol_info_tick("XAUUSD"); mt5.shutdown()
    return (t.bid + t.ask) / 2.0

def p_above(S, K, vol_ann, hours):
    """P(S_T > K), lognormal, zero drift."""
    if hours <= 0: return 1.0 if S > K else 0.0
    sig = vol_ann * math.sqrt(hours / (252 * 24))
    if sig <= 0: return 1.0 if S > K else 0.0
    z = (math.log(S / K) - 0.5 * sig * sig) / sig
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))

S = spot()
evs = get(f"{API}/events?series_ticker=KXGOLDD&status=open")["events"]
today = dt.datetime.now(dt.timezone.utc).date().isoformat()
ev = next((e for e in evs if e.get("strike_date","")[:10] == today), evs[0])
close = dt.datetime.fromisoformat(ev["strike_date"].replace("Z", "+00:00"))
H = (close - dt.datetime.now(dt.timezone.utc)).total_seconds() / 3600

print(f"{ev['event_ticker']}  spot {S:.2f}  {H:.1f}h to settle\n")
VOLS = [15.0, 22.0, 30.5]      # low / mid / measured-NY-upper-bound
print(f"{'strike':>7} {'mkt bid/ask':>12} {'mkt P':>7} |" +
      "".join(f"{'P@'+str(v)+'%':>9}" for v in VOLS) + f"{'  verdict (vs mid vol)':>22}")

mk = get(f"{API}/markets?event_ticker={ev['event_ticker']}")["markets"]
rows = sorted((float(m["floor_strike"]), m) for m in mk
              if m.get("floor_strike") is not None and m.get("status") in ("active","open")
              and m.get("yes_bid_dollars") is not None and m.get("yes_ask_dollars") is not None)

for K, m in rows:
    yb, ya = float(m["yes_bid_dollars"]), float(m["yes_ask_dollars"])
    if ya <= 0 or yb >= 1: continue
    if abs(K - S) > 60: continue          # only strikes with real two-way pricing
    mktp = (yb + ya) / 2
    ps = [p_above(S, K, v/100, H) for v in VOLS]
    mid_model = ps[1]
    edge = mktp - mid_model
    tag = "YES rich (fade)" if edge > 0.04 else ("YES cheap (buy)" if edge < -0.04 else "fair")
    print(f"{K:>7.0f} {f'{yb:.2f}/{ya:.2f}':>12} {mktp:>7.1%} |" +
          "".join(f"{p:>9.1%}" for p in ps) + f"   {edge:>+6.1%}  {tag}")

print("\nThe verdict column uses the MIDDLE vol (22%). Read the whole band:")
print("a strike whose call flips between the 15% and 30.5% columns is not an")
print("edge, it is an artefact of not knowing vol. Only strikes that are rich")
print("(or cheap) across ALL THREE columns are worth trading.")
