"""
Live pricer for the Kalshi-gold / Coinexx-XAUUSD defined-risk structure.

Reproduces the payoff table in docs/superpowers/specs/gold-kalshi-mt4-hedge.md
against LIVE prices, and says whether today's structure is worth putting on.

Structure (from the spec, x1 lock -- NOT the 2.0x martingale as shipped):
    MT4/MT5 : short `lot` XAUUSD, zone-recovery hedge at multiplier 1.0,
              Max Hedge Trade 1, wide gap -> loss is FROZEN, not martingaled.
    Kalshi  : YES on a strike below spot, financed by the short.

Read-only. Places no orders. Kalshi market data is keyless; only order
placement needs an API key + RSA signing.
"""
import json, urllib.request, datetime as dt, sys

OZ_PER_LOT   = 100.0
COMM_PER_LOT = 2.00     # per side, USD/lot (Coinexx, measured)
SERIES       = "KXGOLDD"
API          = "https://api.elections.kalshi.com/trade-api/v2"


def get(url):
    r = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0",
                                             "Accept": "application/json"})
    return json.load(urllib.request.urlopen(r, timeout=15))


def spot():
    """Live Coinexx mid. The broker IS the execution venue, so its price is
    the only one that matters for the MT5 leg."""
    try:
        import MetaTrader5 as mt5
        if mt5.initialize():
            t = mt5.symbol_info_tick("XAUUSD")
            mt5.shutdown()
            if t:
                return (t.bid + t.ask) / 2.0, t.bid, t.ask
    except Exception:
        pass
    return None, None, None


def todays_event():
    evs = get(f"{API}/events?series_ticker={SERIES}&status=open").get("events", [])
    today = dt.datetime.now(dt.timezone.utc).date()
    for e in evs:
        sd = e.get("strike_date", "")
        if sd[:10] == today.isoformat():
            return e
    return evs[0] if evs else None


def fee(contracts, price_dollars):
    """Kalshi quadratic fee: 0.07 * C * P * (1-P), rounded UP to the cent."""
    import math
    p = price_dollars
    return math.ceil(0.07 * contracts * p * (1 - p) * 100) / 100


def main():
    mid, bid, ask = spot()
    if mid is None:
        sys.exit("MT5 not available - launch and log into the Coinexx MT5 terminal")
    ev = todays_event()
    if not ev:
        sys.exit("no open KXGOLDD event")

    close = dt.datetime.fromisoformat(ev["strike_date"].replace("Z", "+00:00"))
    hrs = (close - dt.datetime.now(dt.timezone.utc)).total_seconds() / 3600
    print(f"{ev['event_ticker']}  settles {close:%H:%M UTC}  ({hrs:+.1f}h)")
    print(f"Coinexx XAUUSD {bid}/{ask}  mid {mid:.2f}  spread {(ask-bid)*100:.0f} pts\n")

    # NOTE: Kalshi now returns prices as *_dollars (decimal), not cent fields.
    # The cent-based notes in the spec are stale as of 2026-09-29.
    mk = get(f"{API}/markets?event_ticker={ev['event_ticker']}").get("markets", [])
    rows = []
    for m in mk:
        st = m.get("floor_strike")
        if st is None or m.get("status") not in ("active", "open"):
            continue
        yb, ya = m.get("yes_bid_dollars"), m.get("yes_ask_dollars")
        if yb is None or ya is None:
            continue
        rows.append((float(st), float(yb), float(ya), m["ticker"]))
    rows.sort()

    print(f"{'strike':>9} {'dist':>8} {'YES bid/ask':>13}   {'$50 YES: net win / lose':>26}")
    for st, yb, ya, tk in rows:
        if not ya or ya >= 1.0 or ya <= 0.0:
            continue
        dist = st - mid
        p = ya
        n = int(50 / p)
        cost = n * p
        f = fee(n, p)
        win = n * 1.0 - cost - f
        print(f"{st:>9.0f} {dist:>+8.1f} {str(yb)+'/'+str(ya):>13}   "
              f"{win:>+10.2f} / {-cost-f:>+9.2f}   {tk}")

    print("\nStructure sizing: MT5 short 0.01 lot = $1.00 per $1 of gold move.")
    print("A YES strike D dollars below spot is covered by the short only if the")
    print("short survives to settlement -- that is what the x1 lock buys, and")
    print("what `Multiple Lots 2.0 / Max Hedge Trade 5` destroys.")
    print("\nSpec worst case was -$60.30 on a ~141pt round trip. Re-derive against")
    print("live vol before sizing up; do not reuse yesterday's table as truth.")


if __name__ == "__main__":
    main()
