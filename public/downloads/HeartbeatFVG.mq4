//+------------------------------------------------------------------+
//|                                              HeartbeatFVG.mq4    |
//|                              Heartbeat FVG Engine v1.0           |
//|                              Copyright 2026                      |
//+------------------------------------------------------------------+
//| WHAT THIS IS                                                     |
//|   The 24/7 dual-direction charter, made testable. Three          |
//|   timeframes decide context, a Fair Value Gap on the small       |
//|   timeframe is the trigger, and a tick-rate "heartbeat" decides  |
//|   whether that gap is taken IMMEDIATELY or waited for on the     |
//|   retrace. Fixed lot size throughout. Adds cluster in a small    |
//|   band so ONE basket trail covers the whole stack.               |
//|                                                                  |
//| THE THREE TIMEFRAMES                                             |
//|   BiasTF   - which way the EA is allowed to lean (EMA + slope)   |
//|   SetupTF  - structure: is there room left to the swing, or is   |
//|              price already extended into it                      |
//|   EntryTF  - where FVGs are detected and entries are triggered   |
//|                                                                  |
//| ASAP vs WAIT (the decision the EA makes for itself)              |
//|   ASAP  - the displacement candle is large against ATR, the      |
//|           heartbeat is expanding the same way, the gap is not    |
//|           oversized and price has not run away from it. A move   |
//|           like that often never comes back, so waiting is what   |
//|           costs money.                                           |
//|   WAIT  - anything else that is still valid: the gap is armed    |
//|           and the EA waits for price to trade into it and then   |
//|           reclaim. This is the bounce/retrace entry.             |
//|   SKIP  - wrong side of bias, gap too small to be real, gap too  |
//|           large to be an imbalance, or no room left on SetupTF.  |
//|                                                                  |
//| SECURING PROFIT (the "open for a few seconds" part)              |
//|   Every ticket moves to a locked stop the moment it is           |
//|   SecureAtPoints in front. From then on it can only be closed    |
//|   for a gain. A stall exit and an optional max hold time mean    |
//|   a ticket that has done its job does not sit there giving it    |
//|   back.                                                          |
//|                                                                  |
//| WHAT IT IS NOT                                                   |
//|   Not a martingale - lot size never changes.                     |
//|   Not a wide grid - adds are capped to a narrow cluster.         |
//|   Not latency arbitrage - the heartbeat is a decision-rate       |
//|   sensor, not a race to the broker.                              |
//|                                                                  |
//| REQUIRES A HEDGING (NON-FIFO) ACCOUNT. It holds buys and sells   |
//|   at the same time. On a broker that rejects the opposing order  |
//|   the EA stands down instead of half-working - see OpenHedge().  |
//|                                                                  |
//| RISK: this is a tool, not advice. Demo and tester first. All     |
//|   point defaults are sized for XAUUSD on a 2-digit gold feed;    |
//|   re-tune every *Points input before running another symbol.     |
//+------------------------------------------------------------------+
#property copyright "Copyright 2026"
#property version   "1.00"
#property strict

//+------------------------------------------------------------------+
//| INPUTS                                                           |
//+------------------------------------------------------------------+
input string  x00 = "=== Core ===";                // .
input double  LotSize              = 0.01;         // Fixed lot for every position
input int     MagicNumber          = 20260930;     // Magic number
input int     Slippage             = 10;           // Slippage (points)
input string  TradeComment         = "HBFVG";      // Order comment

input string  x01 = "=== Timeframes ===";          // .
input ENUM_TIMEFRAMES BiasTF       = PERIOD_H1;    // Bias timeframe
input ENUM_TIMEFRAMES SetupTF      = PERIOD_M15;   // Setup / structure timeframe
input ENUM_TIMEFRAMES EntryTF      = PERIOD_M1;    // Entry timeframe (FVGs live here)
input int     BiasMaPeriod         = 50;           // Bias EMA period
input int     BiasSlopeBars        = 3;            // Bars used for EMA slope
input bool    RequireBiasAlignment = true;         // Only trade with the bias
input int     StructureBars        = 40;           // SetupTF swing lookback
input int     MinRoomPoints        = 150;          // Room to the swing needed to enter

input string  x02 = "=== Fair Value Gap ===";      // .
input int     FvgLookbackBars      = 60;           // How far back new FVGs are read
input int     FvgMinPoints         = 25;           // Ignore gaps smaller than this
input double  FvgMaxATR            = 2.0;          // Ignore gaps wider than ATR x this
input int     FvgExpiryBars        = 30;           // Armed gap expires after N EntryTF bars
input double  FvgRetracePct        = 50.0;         // Fill depth wanted, % into the gap
input int     FvgReclaimPoints     = 10;           // Reclaim off the low/high inside the gap
input double  AsapDisplacementATR  = 1.2;          // Middle-candle body vs ATR to justify ASAP
input int     AsapMaxChasePoints   = 60;           // Do not take ASAP further than this from the gap

input string  x03 = "=== Heartbeat ===";           // .
input int     PulseWindowSec       = 20;           // Slow pulse window (seconds)
input int     PulseFastSec         = 4;            // Fast pulse window (seconds)
input double  ExpandMultiple       = 1.8;          // Fast/slow ratio that counts as expansion
input double  ExhaustMultiple      = 0.5;          // Fast/slow ratio that counts as exhaustion
input int     MaxSpreadPoints      = 35;           // Above this the EA manages but never opens
input int     StaleTickSeconds     = 20;           // No ticks for this long = market Dead

input string  x04 = "=== Securing profit ===";     // .
input int     InitialStopPoints    = 600;          // Catastrophic stop attached at open (0 = none)
input int     SecureAtPoints       = 60;           // Profit at which the stop is locked in
input int     LockProfitPoints     = 20;           // Points locked when securing
input int     TrailStartPoints     = 90;           // Per-ticket trail begins here
input int     TrailStepPoints      = 25;           // Per-ticket trail distance
input int     StallExitPoints      = 35;           // Close a secured ticket if the pulse stalls
input int     MaxHoldSeconds       = 0;            // 0 = off. Else close secured tickets older than this

input string  x05 = "=== Stack (small area) ===";  // .
input bool    UseStacking          = true;         // Allow more than one position per side
input int     MaxStackPerSide      = 6;            // Hard cap per direction
input int     AddSpacingPoints     = 25;           // Minimum gap between entries on one side
input int     MaxClusterPoints     = 140;          // The whole stack must fit inside this band
input bool    AddOnlyWhenSecured   = true;         // A winning add needs the trail to already cover it
input int     RecoveryAddPoints    = 40;           // Adverse move before a recovery add
input int     MaxRecoveryAdds      = 3;            // Recovery adds allowed per side
input int     BasketTrailStart     = 55;           // Basket trail begins at this basket profit
input int     BasketTrailStep      = 30;           // Basket trail distance

input string  x06 = "=== Drawdown lock ===";       // .
input bool    UseDrawdownLock      = true;         // Freeze a losing basket with an opposing position
input int     LockAtLossPoints     = 300;          // Basket adverse points that triggers the lock
input int     LockReleasePoints    = 80;           // Profit on the free leg before a release
input int     LockMaxAgeMinutes    = 240;          // Escalate to the governor past this age

input string  x07 = "=== Governor ===";            // .
input double  MaxGrossLots         = 0.20;         // Longs + shorts ceiling
input double  MaxFloatingLossPct   = 8.0;          // Floating loss vs equity -> Lockdown
input double  DailyLossPct         = 5.0;          // Loss from the day's opening equity -> Lockdown
input double  EquityPeakDDPct      = 15.0;         // Drawdown from peak equity -> Lockdown
input bool    FridayFlatten        = true;         // Close everything before the weekend
input int     FridayFlattenHour    = 20;           // Server hour on Friday to flatten
input bool    VerboseLog           = false;        // Print every decision (noisy in the tester)

//+------------------------------------------------------------------+
//| TYPES                                                            |
//+------------------------------------------------------------------+
#define HB_DEAD       0
#define HB_DRIFTING   1
#define HB_EXPANDING  2
#define HB_EXHAUSTING 3
#define HB_REVERSING  4

#define GOV_NORMAL    0
#define GOV_DEFENSIVE 1
#define GOV_LOCKDOWN  2

#define ENTRY_SKIP    0
#define ENTRY_ASAP    1
#define ENTRY_WAIT    2

#define MAX_FVG 64

struct Fvg
{
   bool     used;        // slot in use
   int      dir;         // +1 bullish gap, -1 bearish gap
   double   top;         // upper edge
   double   bottom;      // lower edge
   datetime born;        // EntryTF bar time the gap completed on
   bool     armed;       // waiting for the retrace
   bool     touched;     // price has entered the zone
   double   extreme;     // deepest price reached inside the zone
};

struct Side
{
   int      count;
   double   lots;
   double   avg;         // volume weighted average entry
   double   profit;      // money, including swap and commission
   double   pts;         // basket profit in points off the average
   datetime oldest;
   double   lastEntry;   // entry price closest to current price
   double   clusterHi;
   double   clusterLo;
};

//+------------------------------------------------------------------+
//| GLOBALS                                                          |
//+------------------------------------------------------------------+
Fvg      g_fvg[MAX_FVG];
Side     g_long, g_short;

double   g_tickPx[512];
datetime g_tickT[512];
int      g_tickN = 0;

int      g_pulse      = HB_DRIFTING;
int      g_pulseDir   = 0;          // sign of the slow pulse
bool     g_guarded    = true;       // spread / stale-tick guard
double   g_velFast    = 0;
double   g_velSlow    = 0;

int      g_gov        = GOV_NORMAL;
string   g_govWhy     = "";
double   g_equityPeak = 0;
double   g_dayOpenEq  = 0;
int      g_dayStamp   = -1;

double   g_basketTrailL = 0;        // price level, 0 = not armed
double   g_basketTrailS = 0;
int      g_recoveryL    = 0;
int      g_recoveryS    = 0;

bool     g_lockActive   = false;
int      g_lockLoser    = 0;        // which side was frozen: +1 long, -1 short
datetime g_lockTime     = 0;

bool     g_hedgeRefused = false;    // broker rejected an opposing order (FIFO)
datetime g_lastEntryBar = 0;

//+------------------------------------------------------------------+
//| SMALL HELPERS                                                    |
//+------------------------------------------------------------------+
void Say(string s)
{
   if(VerboseLog) Print(s);
}

double Pts(double priceDiff)
{
   return(priceDiff / Point);
}

double Px(double points)
{
   return(points * Point);
}

double Norm(double p)
{
   return(NormalizeDouble(p, Digits));
}

int StopLevelPoints()
{
   int sl = (int)MarketInfo(Symbol(), MODE_STOPLEVEL);
   int fr = (int)MarketInfo(Symbol(), MODE_FREEZELEVEL);
   return(MathMax(sl, fr));
}

int SpreadPoints()
{
   return((int)MathRound((Ask - Bid) / Point));
}

//| Pull a stop back to something the server will accept. Returns 0   |
//| when no legal level exists yet, and the caller simply waits.      |
double ClampStop(int type, double sl)
{
   double dist = Px(StopLevelPoints());
   if(type == OP_BUY)
   {
      double maxSl = Bid - dist;
      if(sl > maxSl) return(0);
   }
   else
   {
      double minSl = Ask + dist;
      if(sl < minSl) return(0);
   }
   return(Norm(sl));
}

bool Mine()
{
   return(OrderMagicNumber() == MagicNumber && OrderSymbol() == Symbol());
}

//+------------------------------------------------------------------+
//| HEARTBEAT                                                        |
//|                                                                  |
//| One pulse reader. Everything else asks it what the market is     |
//| doing instead of reading indicators of its own. It runs on ticks  |
//| because a bar close is already one bar late.                     |
//+------------------------------------------------------------------+
void UpdatePulse()
{
   double mid = (Ask + Bid) / 2.0;

   if(g_tickN < 512) g_tickN++;
   for(int i = g_tickN - 1; i > 0; i--)
   {
      g_tickPx[i] = g_tickPx[i-1];
      g_tickT[i]  = g_tickT[i-1];
   }
   g_tickPx[0] = mid;
   g_tickT[0]  = TimeCurrent();

   g_velFast = 0;
   g_velSlow = 0;

   // Velocity in points per second over two windows. A move that is still
   // moving but decelerating is the reading the entry logic cares about most.
   int iFast = -1, iSlow = -1;
   for(int k = 1; k < g_tickN; k++)
   {
      int age = (int)(g_tickT[0] - g_tickT[k]);
      if(iFast < 0 && age >= PulseFastSec)   iFast = k;
      if(age >= PulseWindowSec)            { iSlow = k; break; }
   }

   if(iFast > 0)
   {
      int secF = (int)(g_tickT[0] - g_tickT[iFast]);
      if(secF > 0) g_velFast = Pts(g_tickPx[0] - g_tickPx[iFast]) / secF;
   }
   if(iSlow > 0)
   {
      int secS = (int)(g_tickT[0] - g_tickT[iSlow]);
      if(secS > 0) g_velSlow = Pts(g_tickPx[0] - g_tickPx[iSlow]) / secS;
   }

   g_pulseDir = 0;
   if(g_velSlow > 0) g_pulseDir = 1;
   if(g_velSlow < 0) g_pulseDir = -1;

   double af = MathAbs(g_velFast);
   double as = MathAbs(g_velSlow);

   bool stale = (g_tickN > 1 && (TimeCurrent() - g_tickT[1]) > StaleTickSeconds);

   if(stale || (af < 0.01 && as < 0.01))                       g_pulse = HB_DEAD;
   else if(as > 0 && g_velFast * g_velSlow < 0 && af > as * 0.8) g_pulse = HB_REVERSING;
   else if(as > 0 && af > as * ExpandMultiple)                   g_pulse = HB_EXPANDING;
   else if(as > 0 && af < as * ExhaustMultiple)                  g_pulse = HB_EXHAUSTING;
   else                                                          g_pulse = HB_DRIFTING;

   // The execution guard. While guarded the EA may manage and close, never open.
   g_guarded = (SpreadPoints() > MaxSpreadPoints) || (g_pulse == HB_DEAD) || stale;
}

//| Is the pulse pushing in `dir` right now?                          |
bool PulseWith(int dir)
{
   if(dir > 0) return(g_velFast > 0);
   return(g_velFast < 0);
}

//+------------------------------------------------------------------+
//| THE BOOK                                                         |
//|                                                                  |
//| Longs and shorts are two separate baskets. They are never merged  |
//| for management. Net exposure is what the account gains or loses;  |
//| gross exposure is what it is actually carrying, and the governor  |
//| measures its ceilings against gross.                             |
//+------------------------------------------------------------------+
void ResetSide(Side &s)
{
   s.count = 0; s.lots = 0; s.avg = 0; s.profit = 0; s.pts = 0;
   s.oldest = 0; s.lastEntry = 0; s.clusterHi = 0; s.clusterLo = 0;
}

void ScanBook()
{
   ResetSide(g_long);
   ResetSide(g_short);

   double sumL = 0, sumS = 0;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(!Mine()) continue;

      int    t  = OrderType();
      double op = OrderOpenPrice();
      double pl = OrderProfit() + OrderSwap() + OrderCommission();

      if(t == OP_BUY)
      {
         g_long.count++;
         g_long.lots  += OrderLots();
         g_long.profit += pl;
         sumL         += op * OrderLots();
         if(g_long.oldest == 0 || OrderOpenTime() < g_long.oldest) g_long.oldest = OrderOpenTime();
         if(g_long.clusterHi == 0 || op > g_long.clusterHi) g_long.clusterHi = op;
         if(g_long.clusterLo == 0 || op < g_long.clusterLo) g_long.clusterLo = op;
         if(g_long.lastEntry == 0 || MathAbs(op - Bid) < MathAbs(g_long.lastEntry - Bid)) g_long.lastEntry = op;
      }
      else if(t == OP_SELL)
      {
         g_short.count++;
         g_short.lots  += OrderLots();
         g_short.profit += pl;
         sumS          += op * OrderLots();
         if(g_short.oldest == 0 || OrderOpenTime() < g_short.oldest) g_short.oldest = OrderOpenTime();
         if(g_short.clusterHi == 0 || op > g_short.clusterHi) g_short.clusterHi = op;
         if(g_short.clusterLo == 0 || op < g_short.clusterLo) g_short.clusterLo = op;
         if(g_short.lastEntry == 0 || MathAbs(op - Ask) < MathAbs(g_short.lastEntry - Ask)) g_short.lastEntry = op;
      }
   }

   if(g_long.lots  > 0) { g_long.avg  = sumL / g_long.lots;  g_long.pts  = Pts(Bid - g_long.avg); }
   if(g_short.lots > 0) { g_short.avg = sumS / g_short.lots; g_short.pts = Pts(g_short.avg - Ask); }

   if(g_long.count  == 0) { g_basketTrailL = 0; g_recoveryL = 0; }
   if(g_short.count == 0) { g_basketTrailS = 0; g_recoveryS = 0; }
   if(g_long.count == 0 && g_short.count == 0 && g_lockActive)
   {
      g_lockActive = false;
      g_lockLoser  = 0;
   }
}

double GrossLots() { return(g_long.lots + g_short.lots); }
double NetLots()   { return(g_long.lots - g_short.lots); }
double FloatingPL(){ return(g_long.profit + g_short.profit); }

//+------------------------------------------------------------------+
//| THE GOVERNOR                                                     |
//|                                                                  |
//| A single authority every risk-adding path must ask. It can        |
//| refuse. It can never require a trade. Lockdown does not reset     |
//| itself on a new day or a restart - only a chart reload does.      |
//+------------------------------------------------------------------+
void UpdateGovernor()
{
   double eq = AccountEquity();

   if(g_dayStamp != DayOfYear())
   {
      g_dayStamp  = DayOfYear();
      g_dayOpenEq = eq;
   }
   if(eq > g_equityPeak) g_equityPeak = eq;

   if(g_gov == GOV_LOCKDOWN) return;   // sticky on purpose

   if(g_hedgeRefused)
   {
      g_gov    = GOV_LOCKDOWN;
      g_govWhy = "broker refused an opposing order - this EA needs a hedging (non-FIFO) account";
      Print("LOCKDOWN: ", g_govWhy);
      return;
   }

   double floatLossPct = 0;
   if(eq > 0 && FloatingPL() < 0) floatLossPct = (-FloatingPL()) / eq * 100.0;

   double dayLossPct = 0;
   if(g_dayOpenEq > 0 && eq < g_dayOpenEq) dayLossPct = (g_dayOpenEq - eq) / g_dayOpenEq * 100.0;

   double peakDDPct = 0;
   if(g_equityPeak > 0 && eq < g_equityPeak) peakDDPct = (g_equityPeak - eq) / g_equityPeak * 100.0;

   if(floatLossPct >= MaxFloatingLossPct)
   { g_gov = GOV_LOCKDOWN; g_govWhy = "floating loss ceiling"; Print("LOCKDOWN: ", g_govWhy); return; }
   if(dayLossPct >= DailyLossPct)
   { g_gov = GOV_LOCKDOWN; g_govWhy = "daily loss ceiling";    Print("LOCKDOWN: ", g_govWhy); return; }
   if(peakDDPct >= EquityPeakDDPct)
   { g_gov = GOV_LOCKDOWN; g_govWhy = "equity peak drawdown";  Print("LOCKDOWN: ", g_govWhy); return; }

   bool defensive = false;
   string why = "";

   if(g_guarded)                                  { defensive = true; why = "execution guard"; }
   if(g_lockActive)                               { defensive = true; why = "carrying a drawdown lock"; }
   if(GrossLots() + LotSize > MaxGrossLots + 1e-8){ defensive = true; why = "gross lot ceiling"; }
   if(floatLossPct >= MaxFloatingLossPct * 0.7)   { defensive = true; why = "approaching floating loss ceiling"; }
   if(dayLossPct  >= DailyLossPct * 0.7)          { defensive = true; why = "approaching daily loss ceiling"; }
   if(FridayFlatten && DayOfWeek() == 5 && Hour() >= FridayFlattenHour)
                                                  { defensive = true; why = "Friday flatten window"; }

   g_gov    = defensive ? GOV_DEFENSIVE : GOV_NORMAL;
   g_govWhy = why;
}

bool MayOpenRisk()
{
   return(g_gov == GOV_NORMAL && !g_guarded && IsTradeAllowed());
}

//+------------------------------------------------------------------+
//| CONTEXT: BIAS AND STRUCTURE                                      |
//+------------------------------------------------------------------+
//| +1 bullish, -1 bearish, 0 undecided.                              |
int Bias()
{
   double maNow = iMA(NULL, (int)BiasTF, BiasMaPeriod, 0, MODE_EMA, PRICE_CLOSE, 1);
   double maOld = iMA(NULL, (int)BiasTF, BiasMaPeriod, 0, MODE_EMA, PRICE_CLOSE, 1 + BiasSlopeBars);
   double cl    = iClose(NULL, (int)BiasTF, 1);

   if(maNow <= 0 || maOld <= 0) return(0);
   if(cl > maNow && maNow > maOld) return(1);
   if(cl < maNow && maNow < maOld) return(-1);
   return(0);
}

//| Room left to the SetupTF swing in the direction we want to trade. |
//| Entering with no room is entering into someone else's target.     |
double RoomPoints(int dir)
{
   int hi = iHighest(NULL, (int)SetupTF, MODE_HIGH, StructureBars, 1);
   int lo = iLowest (NULL, (int)SetupTF, MODE_LOW,  StructureBars, 1);
   if(hi < 0 || lo < 0) return(0);

   double swingHi = iHigh(NULL, (int)SetupTF, hi);
   double swingLo = iLow (NULL, (int)SetupTF, lo);

   if(dir > 0) return(Pts(swingHi - Ask));
   return(Pts(Bid - swingLo));
}

double EntryAtr()
{
   double a = iATR(NULL, (int)EntryTF, 14, 1);
   if(a <= 0) a = Px(FvgMinPoints * 2);
   return(a);
}

//+------------------------------------------------------------------+
//| FVG ENGINE                                                       |
//|                                                                  |
//| A Fair Value Gap is a three-bar imbalance: the middle bar moved   |
//| so fast that bar 1 and bar 3 never traded through the same        |
//| prices. Bullish gap = low of the newest bar is above the high of  |
//| the oldest. The gap is the zone nobody transacted in, and it is   |
//| the level price most often comes back to.                        |
//+------------------------------------------------------------------+
int FvgSlot()
{
   for(int i = 0; i < MAX_FVG; i++) if(!g_fvg[i].used) return(i);

   // Full: recycle the oldest.
   int oldest = 0;
   for(int j = 1; j < MAX_FVG; j++) if(g_fvg[j].born < g_fvg[oldest].born) oldest = j;
   return(oldest);
}

bool FvgKnown(datetime born, int dir)
{
   for(int i = 0; i < MAX_FVG; i++)
      if(g_fvg[i].used && g_fvg[i].born == born && g_fvg[i].dir == dir) return(true);
   return(false);
}

void ClearFvg(int i)
{
   g_fvg[i].used    = false;
   g_fvg[i].armed   = false;
   g_fvg[i].touched = false;
   g_fvg[i].dir     = 0;
   g_fvg[i].top     = 0;
   g_fvg[i].bottom  = 0;
   g_fvg[i].extreme = 0;
   g_fvg[i].born    = 0;
}

//| Read new gaps off closed EntryTF bars. Shift 1 is the newest      |
//| completed bar, shift 2 is the displacement candle, shift 3 the    |
//| bar the gap is measured from.                                     |
void ScanFvgs()
{
   int bars = iBars(NULL, (int)EntryTF);
   int last = MathMin(FvgLookbackBars, bars - 4);
   double atr = EntryAtr();

   for(int s = 1; s <= last; s++)
   {
      double hi3 = iHigh(NULL, (int)EntryTF, s + 2);
      double lo3 = iLow (NULL, (int)EntryTF, s + 2);
      double hi1 = iHigh(NULL, (int)EntryTF, s);
      double lo1 = iLow (NULL, (int)EntryTF, s);
      datetime born = iTime(NULL, (int)EntryTF, s);

      int    dir = 0;
      double top = 0, bottom = 0;

      if(lo1 > hi3) { dir =  1; bottom = hi3; top = lo1; }
      else if(hi1 < lo3) { dir = -1; bottom = hi1; top = lo3; }
      else continue;

      double gapPts = Pts(top - bottom);
      if(gapPts < FvgMinPoints) continue;
      if(Px(gapPts) > atr * FvgMaxATR) continue;
      if(FvgKnown(born, dir)) continue;

      int k = FvgSlot();
      ClearFvg(k);
      g_fvg[k].used   = true;
      g_fvg[k].dir    = dir;
      g_fvg[k].top    = top;
      g_fvg[k].bottom = bottom;
      g_fvg[k].born   = born;
      g_fvg[k].armed  = false;
      Say(StringConcatenate("FVG ", (dir > 0 ? "bull " : "bear "), DoubleToString(bottom, Digits),
                            " - ", DoubleToString(top, Digits), "  ", DoubleToString(gapPts, 0), "pts"));
   }
}

//| Retire gaps that have expired or been traded through.             |
void AgeFvgs()
{
   for(int i = 0; i < MAX_FVG; i++)
   {
      if(!g_fvg[i].used) continue;

      int shift = iBarShift(NULL, (int)EntryTF, g_fvg[i].born, false);
      if(shift < 0 || shift > FvgExpiryBars) { ClearFvg(i); continue; }

      // Traded clean through the far edge: the imbalance is gone, and with it
      // the reason to expect a reaction there.
      if(g_fvg[i].dir > 0 && Bid < g_fvg[i].bottom - Px(FvgReclaimPoints)) { ClearFvg(i); continue; }
      if(g_fvg[i].dir < 0 && Ask > g_fvg[i].top    + Px(FvgReclaimPoints)) { ClearFvg(i); continue; }
   }
}

//| The level inside the gap we want to be filled at.                 |
double FvgFillLevel(int i)
{
   double span = g_fvg[i].top - g_fvg[i].bottom;
   double pct  = MathMax(0.0, MathMin(100.0, FvgRetracePct)) / 100.0;
   if(g_fvg[i].dir > 0) return(g_fvg[i].top - span * pct);   // buy into the gap from above
   return(g_fvg[i].bottom + span * pct);                     // sell into the gap from below
}

//+------------------------------------------------------------------+
//| THE ASAP-OR-WAIT DECISION                                        |
//|                                                                  |
//| A large displacement with the pulse still expanding often does    |
//| not come back, so waiting for the retrace is what costs money.    |
//| Everything else that is still valid gets armed and waited for.    |
//+------------------------------------------------------------------+
int ClassifyFvg(int i)
{
   int dir = g_fvg[i].dir;

   if(RequireBiasAlignment)
   {
      int b = Bias();
      if(b == 0 || b != dir) return(ENTRY_SKIP);
   }

   if(RoomPoints(dir) < MinRoomPoints) return(ENTRY_SKIP);

   int shift = iBarShift(NULL, (int)EntryTF, g_fvg[i].born, false);
   if(shift < 0) return(ENTRY_SKIP);

   // The displacement candle sits one bar older than the gap's newest bar.
   double body = MathAbs(iClose(NULL, (int)EntryTF, shift + 1) - iOpen(NULL, (int)EntryTF, shift + 1));
   double atr  = EntryAtr();
   bool   strong = (atr > 0 && body >= atr * AsapDisplacementATR);

   double chase = (dir > 0) ? Pts(Ask - g_fvg[i].top) : Pts(g_fvg[i].bottom - Bid);

   if(strong && g_pulse == HB_EXPANDING && PulseWith(dir) && chase <= AsapMaxChasePoints && shift <= 2)
      return(ENTRY_ASAP);

   return(ENTRY_WAIT);
}

//+------------------------------------------------------------------+
//| ORDER PLUMBING                                                   |
//+------------------------------------------------------------------+
int SendMarket(int type, string tag)
{
   if(!IsTradeAllowed()) return(-1);
   RefreshRates();

   double price = (type == OP_BUY) ? Ask : Bid;
   int ticket = OrderSend(Symbol(), type, LotSize, Norm(price), Slippage,
                          0, 0, TradeComment + "-" + tag, MagicNumber, 0,
                          (type == OP_BUY) ? clrDodgerBlue : clrOrangeRed);
   if(ticket < 0)
      Print("OrderSend failed type=", type, " err=", GetLastError(), " spread=", SpreadPoints());
   else
      Say(StringConcatenate("OPEN ", (type == OP_BUY ? "BUY " : "SELL "), tag, " @", DoubleToString(price, Digits)));
   return(ticket);
}

//| The opposing leg. A broker that will not accept this is the       |
//| FIFO case the charter refuses to run on, so the failure is        |
//| recorded rather than retried forever.                            |
int OpenHedge(int type)
{
   int ticket = SendMarket(type, "LOCK");
   if(ticket < 0)
   {
      int err = GetLastError();
      if(err == 4109 || err == 149 || err == 138 || err == 133)
      {
         g_hedgeRefused = true;
         Print("Opposing order refused (err ", err, "). Hedging account required.");
      }
   }
   return(ticket);
}

bool CloseTicket(int ticket)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return(false);
   if(OrderCloseTime() != 0) return(true);
   RefreshRates();
   double price = (OrderType() == OP_BUY) ? Bid : Ask;
   bool ok = OrderClose(OrderTicket(), OrderLots(), Norm(price), Slippage, clrGray);
   if(!ok) Print("OrderClose failed ticket=", ticket, " err=", GetLastError());
   return(ok);
}

void CloseSide(int type, string why)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(!Mine()) continue;
      if(OrderType() != type) continue;
      Say("CLOSE side " + (string)type + " : " + why);
      CloseTicket(OrderTicket());
   }
}

void CloseEverything(string why)
{
   CloseSide(OP_BUY,  why);
   CloseSide(OP_SELL, why);
}

//+------------------------------------------------------------------+
//| SECURING PROFIT                                                  |
//|                                                                  |
//| The moment a ticket is SecureAtPoints in front, its stop moves    |
//| to locked profit. From then on it can only close for a gain.      |
//| A stop is only ever moved in the direction that reduces risk.     |
//+------------------------------------------------------------------+
void SecureAndTrail()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(!Mine()) continue;

      int    type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;

      double open = OrderOpenPrice();
      double cur  = OrderStopLoss();
      double gain = (type == OP_BUY) ? Pts(Bid - open) : Pts(open - Ask);

      double want = 0;

      if(gain >= TrailStartPoints)
         want = (type == OP_BUY) ? Bid - Px(TrailStepPoints) : Ask + Px(TrailStepPoints);
      else if(gain >= SecureAtPoints)
         want = (type == OP_BUY) ? open + Px(LockProfitPoints) : open - Px(LockProfitPoints);
      else if(cur == 0 && InitialStopPoints > 0)
      {
         // The catastrophic backstop. The drawdown lock gets first crack at a
         // losing basket, but a position that never receives a stop has no
         // knowable worst case, and one trade like that pays for a month.
         want = (type == OP_BUY) ? open - Px(InitialStopPoints) : open + Px(InitialStopPoints);
      }

      if(want == 0) continue;

      // Never loosen. This is enforced here so no other path can undo it.
      if(cur != 0)
      {
         if(type == OP_BUY  && want <= cur) continue;
         if(type == OP_SELL && want >= cur) continue;
      }

      double sl = ClampStop(type, want);
      if(sl == 0) continue;
      if(cur != 0 && MathAbs(sl - cur) < Point) continue;

      if(!OrderModify(OrderTicket(), open, sl, OrderTakeProfit(), 0, clrLime))
         Say("OrderModify failed err=" + (string)GetLastError());
   }
}

//| Tickets that have done their job and stopped working. A secured   |
//| ticket sitting in a dead or reversing pulse is giving profit back.|
void StallAndAgeExits()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(!Mine()) continue;

      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;

      double open = OrderOpenPrice();
      double gain = (type == OP_BUY) ? Pts(Bid - open) : Pts(open - Ask);
      int    dir  = (type == OP_BUY) ? 1 : -1;
      int    held = (int)(TimeCurrent() - OrderOpenTime());

      if(gain < StallExitPoints) continue;   // only ever exits in profit

      bool stalled = (g_pulse == HB_REVERSING && !PulseWith(dir)) || g_pulse == HB_DEAD;
      bool aged    = (MaxHoldSeconds > 0 && held >= MaxHoldSeconds && gain >= LockProfitPoints);

      if(stalled || aged)
      {
         Say(StringConcatenate("SECURE-EXIT ticket=", OrderTicket(), " gain=", DoubleToString(gain, 0),
                               stalled ? " (pulse stalled)" : " (max hold)"));
         CloseTicket(OrderTicket());
      }
   }
}

//| One trail for the whole directional stack, computed off the       |
//| basket average, because the stack is managed as one thing.        |
void BasketTrail()
{
   if(g_long.count > 1 && g_long.pts >= BasketTrailStart)
   {
      double lvl = Bid - Px(BasketTrailStep);
      if(lvl > g_basketTrailL) g_basketTrailL = lvl;
   }
   if(g_basketTrailL > 0 && g_long.count > 0 && Bid <= g_basketTrailL)
   {
      Say("BASKET TRAIL hit long @" + DoubleToString(Bid, Digits));
      CloseSide(OP_BUY, "basket trail");
      g_basketTrailL = 0;
   }

   if(g_short.count > 1 && g_short.pts >= BasketTrailStart)
   {
      double lvs = Ask + Px(BasketTrailStep);
      if(g_basketTrailS == 0 || lvs < g_basketTrailS) g_basketTrailS = lvs;
   }
   if(g_basketTrailS > 0 && g_short.count > 0 && Ask >= g_basketTrailS)
   {
      Say("BASKET TRAIL hit short @" + DoubleToString(Ask, Digits));
      CloseSide(OP_SELL, "basket trail");
      g_basketTrailS = 0;
   }
}

//+------------------------------------------------------------------+
//| STACKING - MORE POSITIONS IN A SMALL AREA                        |
//|                                                                  |
//| Adds cluster inside MaxClusterPoints so that one basket trail     |
//| covers all of them. A winning add must already be paid for by     |
//| the trail; a recovery add is capped, clustered, and never taken   |
//| into a pulse that is expanding against the basket.               |
//+------------------------------------------------------------------+
bool ClusterAllows(Side &s, double price)
{
   if(s.count == 0) return(true);
   double hi = MathMax(s.clusterHi, price);
   double lo = MathMin(s.clusterLo, price);
   return(Pts(hi - lo) <= MaxClusterPoints);
}

bool SpacingAllows(Side &s, double price)
{
   if(s.count == 0) return(true);
   return(MathAbs(Pts(price - s.lastEntry)) >= AddSpacingPoints);
}

//| Would the trail that already exists still protect the basket if   |
//| one more fixed lot were added at the current price? This is the   |
//| "secured profit pays for the next position" rule.                 |
bool TrailCoversAdd(int dir, Side &s, double price)
{
   double newLots = s.lots + LotSize;
   if(newLots <= 0) return(false);
   double newAvg  = (s.avg * s.lots + price * LotSize) / newLots;

   if(dir > 0)
   {
      if(g_basketTrailL <= 0) return(false);
      return(g_basketTrailL > newAvg);
   }
   if(g_basketTrailS <= 0) return(false);
   return(g_basketTrailS < newAvg);
}

void TryStackAdds()
{
   if(!UseStacking) return;
   if(!MayOpenRisk()) return;
   if(g_lockActive) return;

   // ---- long side ----
   if(g_long.count > 0 && g_long.count < MaxStackPerSide &&
      GrossLots() + LotSize <= MaxGrossLots + 1e-8 &&
      SpacingAllows(g_long, Ask) && ClusterAllows(g_long, Ask))
   {
      bool winning = (g_long.pts > 0);
      if(winning)
      {
         if(!AddOnlyWhenSecured || TrailCoversAdd(1, g_long, Ask))
            if(PulseWith(1) && g_pulse != HB_REVERSING)
               SendMarket(OP_BUY, "ADD");
      }
      else if(g_recoveryL < MaxRecoveryAdds &&
              Pts(g_long.lastEntry - Ask) >= RecoveryAddPoints &&
              !(g_pulse == HB_EXPANDING && g_velFast < 0))
      {
         if(SendMarket(OP_BUY, "REC") > 0) g_recoveryL++;
      }
   }

   // ---- short side ----
   if(g_short.count > 0 && g_short.count < MaxStackPerSide &&
      GrossLots() + LotSize <= MaxGrossLots + 1e-8 &&
      SpacingAllows(g_short, Bid) && ClusterAllows(g_short, Bid))
   {
      bool winningS = (g_short.pts > 0);
      if(winningS)
      {
         if(!AddOnlyWhenSecured || TrailCoversAdd(-1, g_short, Bid))
            if(PulseWith(-1) && g_pulse != HB_REVERSING)
               SendMarket(OP_SELL, "ADD");
      }
      else if(g_recoveryS < MaxRecoveryAdds &&
              Pts(Bid - g_short.lastEntry) >= RecoveryAddPoints &&
              !(g_pulse == HB_EXPANDING && g_velFast > 0))
      {
         if(SendMarket(OP_SELL, "REC") > 0) g_recoveryS++;
      }
   }
}

//+------------------------------------------------------------------+
//| DRAWDOWN LOCK                                                    |
//|                                                                  |
//| Freeze a losing basket at a known number instead of closing it    |
//| at the worst moment. Once locked the loss cannot grow with price. |
//| Release one leg at a time; closing both at once realises the      |
//| whole debt with nothing earned against it.                        |
//+------------------------------------------------------------------+
void ManageLock()
{
   if(!UseDrawdownLock) return;

   if(!g_lockActive)
   {
      // Long basket in trouble with the pulse expanding against it.
      if(g_long.count > 0 && g_long.pts <= -LockAtLossPoints &&
         g_pulse == HB_EXPANDING && g_velFast < 0 && !g_guarded)
      {
         int need = (int)MathRound((g_long.lots - g_short.lots) / LotSize);
         for(int a = 0; a < need; a++)
            if(OpenHedge(OP_SELL) < 0) break;
         if(need > 0 && !g_hedgeRefused)
         {
            g_lockActive = true; g_lockLoser = 1; g_lockTime = TimeCurrent();
            Print("DRAWDOWN LOCK on long basket, debt=", DoubleToString(g_long.profit, 2));
         }
         return;
      }

      if(g_short.count > 0 && g_short.pts <= -LockAtLossPoints &&
         g_pulse == HB_EXPANDING && g_velFast > 0 && !g_guarded)
      {
         int needS = (int)MathRound((g_short.lots - g_long.lots) / LotSize);
         for(int b = 0; b < needS; b++)
            if(OpenHedge(OP_BUY) < 0) break;
         if(needS > 0 && !g_hedgeRefused)
         {
            g_lockActive = true; g_lockLoser = -1; g_lockTime = TimeCurrent();
            Print("DRAWDOWN LOCK on short basket, debt=", DoubleToString(g_short.profit, 2));
         }
      }
      return;
   }

   // ---- carrying a lock ----
   int ageMin = (int)((TimeCurrent() - g_lockTime) / 60);
   if(LockMaxAgeMinutes > 0 && ageMin >= LockMaxAgeMinutes)
   {
      Print("Lock exceeded max age - flattening and standing down.");
      CloseEverything("lock aged out");
      g_gov    = GOV_LOCKDOWN;
      g_govWhy = "drawdown lock exceeded max age";
      return;
   }

   // Release the profitable leg at exhaustion, one side only.
   if(g_lockLoser == 1 && g_short.pts >= LockReleasePoints && g_pulse == HB_EXHAUSTING)
   {
      Say("LOCK RELEASE: closing the short leg");
      CloseSide(OP_SELL, "lock release");
      g_lockActive = false; g_lockLoser = 0;
   }
   else if(g_lockLoser == -1 && g_long.pts >= LockReleasePoints && g_pulse == HB_EXHAUSTING)
   {
      Say("LOCK RELEASE: closing the long leg");
      CloseSide(OP_BUY, "lock release");
      g_lockActive = false; g_lockLoser = 0;
   }
}

//+------------------------------------------------------------------+
//| ENTRIES                                                          |
//+------------------------------------------------------------------+
void TryEntries()
{
   if(!MayOpenRisk()) return;
   if(g_lockActive) return;

   // One fresh entry per EntryTF bar keeps the tester honest and stops a
   // single gap being taken over and over inside the same bar.
   datetime barNow = iTime(NULL, (int)EntryTF, 0);

   for(int i = 0; i < MAX_FVG; i++)
   {
      if(!g_fvg[i].used) continue;

      int dir  = g_fvg[i].dir;
      int type = (dir > 0) ? OP_BUY : OP_SELL;

      Side side = (dir > 0) ? g_long : g_short;
      if(side.count >= MaxStackPerSide) continue;
      if(GrossLots() + LotSize > MaxGrossLots + 1e-8) continue;

      int mode = ClassifyFvg(i);
      if(mode == ENTRY_SKIP) continue;

      if(mode == ENTRY_ASAP)
      {
         if(g_lastEntryBar == barNow) continue;
         if(side.count > 0 && !SpacingAllows(side, (dir > 0) ? Ask : Bid)) continue;
         if(SendMarket(type, "ASAP") > 0)
         {
            g_lastEntryBar = barNow;
            ClearFvg(i);
         }
         continue;
      }

      // ---- ENTRY_WAIT: arm the gap and wait for the retrace + reclaim ----
      g_fvg[i].armed = true;

      double fill = FvgFillLevel(i);

      if(dir > 0)
      {
         if(Bid <= fill)
         {
            g_fvg[i].touched = true;
            if(g_fvg[i].extreme == 0 || Bid < g_fvg[i].extreme) g_fvg[i].extreme = Bid;
         }
         if(g_fvg[i].touched && g_fvg[i].extreme > 0 &&
            Pts(Bid - g_fvg[i].extreme) >= FvgReclaimPoints && PulseWith(1))
         {
            if(g_lastEntryBar == barNow) continue;
            if(side.count > 0 && !SpacingAllows(side, Ask)) continue;
            if(SendMarket(OP_BUY, "RETR") > 0)
            {
               g_lastEntryBar = barNow;
               ClearFvg(i);
            }
         }
      }
      else
      {
         if(Ask >= fill)
         {
            g_fvg[i].touched = true;
            if(g_fvg[i].extreme == 0 || Ask > g_fvg[i].extreme) g_fvg[i].extreme = Ask;
         }
         if(g_fvg[i].touched && g_fvg[i].extreme > 0 &&
            Pts(g_fvg[i].extreme - Ask) >= FvgReclaimPoints && PulseWith(-1))
         {
            if(g_lastEntryBar == barNow) continue;
            if(side.count > 0 && !SpacingAllows(side, Bid)) continue;
            if(SendMarket(OP_SELL, "RETR") > 0)
            {
               g_lastEntryBar = barNow;
               ClearFvg(i);
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| LIFECYCLE                                                        |
//+------------------------------------------------------------------+
int OnInit()
{
   if(LotSize < MarketInfo(Symbol(), MODE_MINLOT))
   {
      Print("LotSize ", LotSize, " is below the broker minimum ", MarketInfo(Symbol(), MODE_MINLOT));
      return(INIT_PARAMETERS_INCORRECT);
   }
   if(MaxGrossLots < LotSize)
   {
      Print("MaxGrossLots must be at least one LotSize.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   for(int i = 0; i < MAX_FVG; i++) ClearFvg(i);

   g_equityPeak = AccountEquity();
   g_dayOpenEq  = AccountEquity();
   g_dayStamp   = DayOfYear();
   g_gov        = GOV_NORMAL;

   Print("Heartbeat FVG Engine v1.0 | lot=", DoubleToString(LotSize, 2),
         " bias=", EnumToString(BiasTF), " setup=", EnumToString(SetupTF),
         " entry=", EnumToString(EntryTF),
         " | requires a hedging (non-FIFO) account");
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   Comment("");
}

void OnTick()
{
   UpdatePulse();
   ScanBook();
   UpdateGovernor();

   // Management runs in every mode. Only opening new risk is gated.
   SecureAndTrail();
   StallAndAgeExits();
   BasketTrail();
   ManageLock();

   if(g_gov == GOV_LOCKDOWN)
   {
      if(g_long.count > 0 || g_short.count > 0) CloseEverything("lockdown: " + g_govWhy);
      Comment("LOCKDOWN: ", g_govWhy);
      return;
   }

   if(FridayFlatten && DayOfWeek() == 5 && Hour() >= FridayFlattenHour)
   {
      if(g_long.count > 0 || g_short.count > 0) CloseEverything("Friday flatten");
      return;
   }

   static datetime lastBar = 0;
   datetime b = iTime(NULL, (int)EntryTF, 0);
   if(b != lastBar)
   {
      lastBar = b;
      ScanFvgs();
   }
   AgeFvgs();

   TryEntries();
   TryStackAdds();

   if(!IsOptimization())
   {
      string pulseName[5] = {"DEAD", "DRIFTING", "EXPANDING", "EXHAUSTING", "REVERSING"};
      string govName[3]   = {"NORMAL", "DEFENSIVE", "LOCKDOWN"};
      Comment("Heartbeat FVG  |  pulse ", pulseName[g_pulse],
              "  gov ", govName[g_gov], (g_govWhy == "" ? "" : " (" + g_govWhy + ")"),
              "\nlong ", g_long.count, " @", DoubleToString(g_long.avg, Digits), "  ", DoubleToString(g_long.pts, 0), "pts",
              "   short ", g_short.count, " @", DoubleToString(g_short.avg, Digits), "  ", DoubleToString(g_short.pts, 0), "pts",
              "\ngross ", DoubleToString(GrossLots(), 2), "  net ", DoubleToString(NetLots(), 2),
              "  float ", DoubleToString(FloatingPL(), 2),
              (g_lockActive ? "  [LOCKED]" : ""),
              "\nspread ", SpreadPoints(), "pts  velFast ", DoubleToString(g_velFast, 2),
              "  velSlow ", DoubleToString(g_velSlow, 2));
   }
}
//+------------------------------------------------------------------+
