r"""
Record Coinexx MT5 ticks with LOCAL arrival timestamps.

Why local arrival time and not tick.time_msc:
  time_msc is the BROKER's stamp. For latency arbitrage the only thing that
  matters is when the quote reached THIS machine. A broker that stamps quotes
  correctly but ships them 200ms late is exactly the exploitable case, and
  time_msc hides it. We record both so the gap itself is measurable.

Usage: python record_mt5.py XAUUSD 900 "C:\Program Files\X MT5 Terminal\terminal64.exe" tag

The terminal path matters: the MT5 Python bridge binds ONE terminal per
process, so comparing two brokers means two processes, each pinned to its
own terminal64.exe. Both stamp ticks with Windows GetTickCount, so the two
recordings share a clock with no synchronisation step.
"""
import sys, time, csv, pathlib
import ctypes
import MetaTrader5 as mt5

# Shared monotonic clock with the MT4 logger: both read Windows GetTickCount.
# Same origin (ms since boot), so the two feeds align to ~1ms with no NTP sync.
_gtc = ctypes.windll.kernel32.GetTickCount64
_gtc.restype = ctypes.c_ulonglong

SYM  = sys.argv[1] if len(sys.argv) > 1 else "XAUUSD"
DUR  = float(sys.argv[2]) if len(sys.argv) > 2 else 900.0
PATH = sys.argv[3] if len(sys.argv) > 3 else None
TAG  = sys.argv[4] if len(sys.argv) > 4 else "mt5"
OUT  = pathlib.Path(__file__).parent / f"ticks_{TAG}_{SYM}.csv"

ok = mt5.initialize(path=PATH) if PATH else mt5.initialize()
if not ok:
    sys.exit(f"initialize failed: {mt5.last_error()} -- is the terminal logged in?")

info = mt5.symbol_info(SYM)
if info is None:
    cands = [s.name for s in mt5.symbols_get() if "XAU" in s.name.upper()][:20]
    sys.exit(f"symbol {SYM} not found. XAU-like symbols: {cands}")
if not info.visible:
    mt5.symbol_select(SYM, True)

# A freshly selected symbol needs a moment before ticks arrive.
for _ in range(15):
    if (t := mt5.symbol_info_tick(SYM)) and t.bid:
        break
    time.sleep(1)
else:
    sys.exit(f"{TAG}: no ticks for {SYM} after 15s - is the market open and symbol subscribed?")

print(f"[{TAG}] recording {SYM} digits={info.digits} point={info.point} for {DUR}s -> {OUT.name}")

n, last = 0, None
t_end = time.time() + DUR
with OUT.open("w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["gtc_ms", "local_ns", "broker_time_msc", "bid", "ask"])
    while time.time() < t_end:
        t = mt5.symbol_info_tick(SYM)
        if t is not None:
            key = (t.time_msc, t.bid, t.ask)
            if key != last:
                w.writerow([_gtc(), time.time_ns(), t.time_msc, t.bid, t.ask])
                last = key
                n += 1
                if n % 200 == 0:
                    f.flush()
                    print(f"  [{TAG}] {n} ticks  bid={t.bid} ask={t.ask} "
                          f"broker_lag={time.time()*1000 - t.time_msc:.0f}ms", flush=True)
        time.sleep(0.0005)

mt5.shutdown()
print(f"[{TAG}] done: {n} ticks -> {OUT}")
