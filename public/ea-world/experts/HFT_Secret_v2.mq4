//+------------------------------------------------------------------+
//|                                              HFT_Secret_v2.mq4   |
//|  Second rebuild of "HFT Secret 1.0" - reverse-engineered from    |
//|  the OUTSIDE, because the inside cannot be read.                 |
//|                                                                  |
//|  What was tried on the .ex4 itself: the file is 181 KB of        |
//|  MetaQuotes-encrypted code (entropy 7.96 bits/byte end to end).  |
//|  The only plain text in it is the cracker's banner. Its build    |
//|  was cracked for one MT4 build ("1420+", "1431+" on the resale   |
//|  pages), which is why it died when MT4 updated. Breaking the     |
//|  encryption is not on the table, so no line here comes from it.  |
//|                                                                  |
//|  What IS known, from every public listing of the EA:             |
//|    - it trades US30 (Dow) on M1, sold as a prop-firm passer       |
//|    - its one published rule is a 34-period SMA channel built on   |
//|      the HIGHS and the LOWS: longs above it, shorts below it     |
//|    - it is an HFT scalper: many short trades, fast exits          |
//|                                                                  |
//|  So v2 = that 34-SMA high/low "wave" as the direction filter,    |
//|  driving v1's HFT engine: one stop order on the side the wave    |
//|  allows, dragged after price, OCO, breakeven, tight trailing     |
//|  stop, spread + New York session + daily limits.                 |
//|                                                                  |
//|  To make v2 trade even more like the original, load an old MT4   |
//|  statement of the original's trades into EA World > Replay >     |
//|  "Fingerprint the original". It measures stop, target, trail     |
//|  step, lot size, side and hours from the real trades and sets    |
//|  these inputs for you.                                           |
//|                                                                  |
//|  ALL DISTANCES ARE IN PRICE, not points: 8.0 on US30 means 8     |
//|  index points whatever digits your broker uses (US30 is 1 digit  |
//|  at some brokers and 2 at others - points would differ 10x).     |
//|  Replay twin: src/lib/ea-replay/strategies/hftSecretV2.ts        |
//+------------------------------------------------------------------+
#property copyright "EA World"
#property version   "2.10"
#property strict
#property description "HFT Secret v2: 34-SMA high/low wave bias + pending-stop HFT scalper (US30 M1 defaults). Distances in price."

enum ENUM_LOT_MODE   { LOT_FIXED = 0, LOT_RISK_PERCENT = 1 };
enum ENUM_BIAS_MODE  { BIAS_WAVE = 0,      // Wave: close above SMA(high) = buy side, below SMA(low) = sell side
                       BIAS_CROSS = 1,     // Cross: close crosses up through SMA(low) = buy, down through SMA(high) = sell
                       BIAS_OFF = 2 };     // Off: both sides, like v1
enum ENUM_DIRECTION  { DIR_BOTH = 0, DIR_BUY_ONLY = 1, DIR_SELL_ONLY = 2 };

input string         _g1_               = "=== Money ===";       // .
input ENUM_LOT_MODE  LotMode            = LOT_FIXED;             // Lot mode
input double         FixedLots          = 0.10;                  // Fixed lots
input double         RiskPercent        = 0.5;                   // Risk % of equity per trade (uses StopLoss)
input double         MaxLots            = 5.0;                   // Lot ceiling

input string         _g2_               = "=== Wave filter ==="; // .
input ENUM_BIAS_MODE BiasMode           = BIAS_WAVE;             // How the 34-SMA channel picks the side
input ENUM_TIMEFRAMES BiasTimeframe     = PERIOD_M1;             // Channel timeframe
input int            MaPeriod           = 34;                    // Channel period
input ENUM_MA_METHOD MaMethod           = MODE_SMA;              // Channel average
input ENUM_DIRECTION Direction          = DIR_BOTH;              // Allowed side(s) on top of the wave

input string         _g3_               = "=== Entry (price units) ===";  // .
input double         EntryDistance      = 8.0;                   // Stop order distance from price
input double         ReplaceStep        = 1.0;                   // Drag the order once it is this far off
input double         MaxSpread          = 4.0;                   // Max spread to keep orders working
input bool           DeleteOppositeOnFill = true;                // OCO

input string         _g4_               = "=== Exit (price units) ===";   // .
input double         StopLoss           = 25.0;                  // Initial stop loss
input double         TakeProfit         = 0.0;                   // Take profit (0 = trail only)
input double         BreakEvenAt        = 5.0;                   // Move stop to entry + lock after this profit (0 = off)
input double         BreakEvenLock      = 0.5;                   // Profit locked at breakeven
input double         TrailStart         = 7.0;                   // Start trailing after this profit
input double         TrailDistance      = 5.0;                   // Trail this far behind price
input double         TrailStep          = 0.5;                   // Move the stop in steps of

input string         _g5_               = "=== Session (New York time) ===";  // .
input bool           UseSession         = true;                  // Only trade inside the window
input int            SessionStartHHMM   = 930;                   // Start NY (930 = cash open)
input int            SessionEndHHMM     = 1130;                  // End NY
input bool           AutoServerOffset   = true;                  // Live: detect broker GMT offset
input int            ServerGMTOffset    = 3;                     // Broker GMT offset (tester / auto off)
input bool           CloseAtSessionEnd  = true;                  // Flatten when the window ends

input string         _g6_               = "=== Protection ===";  // .
input int            MaxTradesPerDay    = 40;                    // Stop after this many fills
input double         MaxDailyLossPct    = 2.0;                   // Stop after this equity drop (%) - prop-firm friendly
input double         DailyTargetPct     = 0.0;                   // Stop after this gain (%), 0 = off
input int            CooldownSeconds    = 10;                    // Wait after a trade closes
input int            Slippage           = 30;                    // Max slippage (points)

input string         _g7_               = "=== Misc ===";        // .
input int            MagicNumber        = 20261017;              // Magic number
input string         OrderTag           = "HFT-v2";              // Order comment
input bool           ShowPanel          = true;                  // Status panel

datetime g_dayStart        = 0;
double   g_dayStartEquity  = 0.0;
int      g_fillsToday      = 0;
int      g_lastPosTicket   = -1;
datetime g_lastCloseTime   = 0;
bool     g_dayLocked       = false;
string   g_status          = "";
int      g_bias            = 0;      // +1 buy side, -1 sell side, 0 none
int      g_crossBias       = 0;      // sticky side for BIAS_CROSS

//+------------------------------------------------------------------+
int OnInit()
{
   if(EntryDistance <= 0 || StopLoss <= 0 || TrailDistance <= 0 || MaPeriod < 2)
   {
      Print("HFT v2: EntryDistance, StopLoss, TrailDistance must be > 0 and MaPeriod >= 2");
      return(INIT_PARAMETERS_INCORRECT);
   }
   ResetDay();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) { Comment(""); }

//+------------------------------------------------------------------+
void OnTick()
{
   if(!IsTradeAllowed() && !IsTesting()) { g_status = "Trading not allowed"; DrawPanel(); return; }
   RefreshRates();

   datetime today = iTime(Symbol(), PERIOD_D1, 0);
   if(today != g_dayStart) ResetDay();

   int posTicket = FindPosition();
   if(posTicket > 0 && posTicket != g_lastPosTicket) g_fillsToday++;
   if(posTicket < 0 && g_lastPosTicket > 0) g_lastCloseTime = TimeCurrent();
   g_lastPosTicket = posTicket;

   double eq = AccountEquity();
   if(!g_dayLocked && g_dayStartEquity > 0)
   {
      if(MaxDailyLossPct > 0 && eq <= g_dayStartEquity * (1.0 - MaxDailyLossPct / 100.0))
      { g_dayLocked = true; Print("HFT v2: daily loss limit hit"); }
      else if(DailyTargetPct > 0 && eq >= g_dayStartEquity * (1.0 + DailyTargetPct / 100.0) && posTicket < 0)
      { g_dayLocked = true; Print("HFT v2: daily target reached"); }
   }

   bool inSession = InSession();
   g_bias = ComputeBias();

   if(posTicket > 0)
   {
      if(DeleteOppositeOnFill) DeleteAllPendings();
      if(CloseAtSessionEnd && !inSession) ClosePosition(posTicket);
      else                                ManageExit(posTicket);
      g_status = "In trade #" + IntegerToString(posTicket);
      DrawPanel();
      return;
   }

   string block = "";
   double spread = Ask - Bid;
   if(g_dayLocked)                                                    block = "Day locked (loss limit / target)";
   else if(MaxTradesPerDay > 0 && g_fillsToday >= MaxTradesPerDay)   block = "Max trades for today";
   else if(!inSession)                                                block = "Outside session";
   else if(spread > MaxSpread)                                        block = "Spread " + DoubleToString(spread, Digits);
   else if(CooldownSeconds > 0 && TimeCurrent() - g_lastCloseTime < CooldownSeconds) block = "Cooldown";
   else if(g_bias == 0)                                               block = "Inside the wave - no side";

   if(block != "")
   {
      DeleteAllPendings();
      g_status = block;
      DrawPanel();
      return;
   }

   // g_bias: +1 buy side, -1 sell side, 2 = both (wave filter off)
   bool buyOk  = (g_bias > 0) && Direction != DIR_SELL_ONLY;
   bool sellOk = (g_bias < 0 || g_bias == 2) && Direction != DIR_BUY_ONLY;
   if(buyOk)  WorkPending(OP_BUYSTOP);  else DeletePending(OP_BUYSTOP);
   if(sellOk) WorkPending(OP_SELLSTOP); else DeletePending(OP_SELLSTOP);
   g_status = (g_bias == 2) ? "Hunting both sides" : ((g_bias > 0) ? "Hunting longs" : "Hunting shorts");
   DrawPanel();
}

//+------------------------------------------------------------------+
//| The 34-SMA high/low channel                                      |
//+------------------------------------------------------------------+
int ComputeBias()
{
   if(BiasMode == BIAS_OFF) return(Direction == DIR_SELL_ONLY ? -1 : (Direction == DIR_BUY_ONLY ? 1 : 2));
   if(iBars(Symbol(), BiasTimeframe) < MaPeriod + 3) return(0);
   double hi1 = iMA(Symbol(), BiasTimeframe, MaPeriod, 0, MaMethod, PRICE_HIGH, 1);
   double lo1 = iMA(Symbol(), BiasTimeframe, MaPeriod, 0, MaMethod, PRICE_LOW, 1);
   double c1  = iClose(Symbol(), BiasTimeframe, 1);
   if(BiasMode == BIAS_WAVE)
   {
      if(c1 > hi1) return(1);
      if(c1 < lo1) return(-1);
      return(0);
   }
   // BIAS_CROSS: sticky until the opposite cross
   double hi2 = iMA(Symbol(), BiasTimeframe, MaPeriod, 0, MaMethod, PRICE_HIGH, 2);
   double lo2 = iMA(Symbol(), BiasTimeframe, MaPeriod, 0, MaMethod, PRICE_LOW, 2);
   double c2  = iClose(Symbol(), BiasTimeframe, 2);
   if(c1 > lo1 && c2 <= lo2) g_crossBias = 1;
   if(c1 < hi1 && c2 >= hi2) g_crossBias = -1;
   return(g_crossBias);
}

//+------------------------------------------------------------------+
void WorkPending(int type)
{
   double stopLevel = MarketInfo(Symbol(), MODE_STOPLEVEL) * Point;
   double dist      = MathMax(EntryDistance, stopLevel + Point);
   double desired   = NormalizeDouble((type == OP_BUYSTOP) ? Ask + dist : Bid - dist, Digits);

   int ticket = FindPending(type);
   if(ticket < 0)
   {
      double lots = CalcLots();
      if(lots <= 0) return;
      double sl, tp;
      ExitsFor(type, desired, sl, tp);
      SendOrder(type, lots, desired, sl, tp);
      return;
   }
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return;
   double current = OrderOpenPrice();
   double gap     = (type == OP_BUYSTOP) ? current - desired : desired - current;
   if(gap >= ReplaceStep)
   {
      double freeze = MarketInfo(Symbol(), MODE_FREEZELEVEL) * Point;
      double toMkt  = (type == OP_BUYSTOP) ? current - Ask : Bid - current;
      if(freeze > 0 && toMkt <= freeze) return;
      double sl, tp;
      ExitsFor(type, desired, sl, tp);
      if(!OrderModify(ticket, desired, sl, tp, 0, clrNONE)) ReportError("drag pending", GetLastError());
   }
}

void ExitsFor(int type, double entry, double &sl, double &tp)
{
   double stopLevel = MarketInfo(Symbol(), MODE_STOPLEVEL) * Point;
   double slDist    = MathMax(StopLoss, stopLevel + Point);
   double tpDist    = (TakeProfit > 0) ? MathMax(TakeProfit, stopLevel + Point) : 0;
   bool   isBuy     = (type == OP_BUYSTOP || type == OP_BUY);
   sl = NormalizeDouble(isBuy ? entry - slDist : entry + slDist, Digits);
   tp = (tpDist > 0) ? NormalizeDouble(isBuy ? entry + tpDist : entry - tpDist, Digits) : 0;
}

//+------------------------------------------------------------------+
//| Breakeven, then trailing                                         |
//+------------------------------------------------------------------+
void ManageExit(int ticket)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return;
   double stopLevel = MarketInfo(Symbol(), MODE_STOPLEVEL) * Point;
   double trail     = MathMax(TrailDistance, stopLevel + Point);
   double open      = OrderOpenPrice();
   double sl        = OrderStopLoss();
   double newSL     = sl;

   if(OrderType() == OP_BUY)
   {
      double profit = Bid - open;
      if(BreakEvenAt > 0 && profit >= BreakEvenAt)
      {
         double be = NormalizeDouble(open + BreakEvenLock, Digits);
         if((sl == 0 || be > sl) && be <= Bid - stopLevel) newSL = be;
      }
      if(profit >= TrailStart)
      {
         double t = NormalizeDouble(Bid - trail, Digits);
         if(t > newSL && (sl == 0 || t >= sl + TrailStep)) newSL = t;
      }
      if(newSL != sl && newSL > sl)
         if(!OrderModify(ticket, open, newSL, OrderTakeProfit(), 0, clrNONE)) ReportError("stop buy", GetLastError());
   }
   else if(OrderType() == OP_SELL)
   {
      double profit = open - Ask;
      if(BreakEvenAt > 0 && profit >= BreakEvenAt)
      {
         double be = NormalizeDouble(open - BreakEvenLock, Digits);
         if((sl == 0 || be < sl) && be >= Ask + stopLevel) newSL = be;
      }
      if(profit >= TrailStart)
      {
         double t = NormalizeDouble(Ask + trail, Digits);
         if((newSL == 0 || t < newSL) && (sl == 0 || t <= sl - TrailStep)) newSL = t;
      }
      if(newSL != sl && (sl == 0 || newSL < sl))
         if(!OrderModify(ticket, open, newSL, OrderTakeProfit(), 0, clrNONE)) ReportError("stop sell", GetLastError());
   }
}

//+------------------------------------------------------------------+
int FindPosition()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != Symbol() || OrderMagicNumber() != MagicNumber) continue;
      if(OrderType() == OP_BUY || OrderType() == OP_SELL) return(OrderTicket());
   }
   return(-1);
}

int FindPending(int type)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != Symbol() || OrderMagicNumber() != MagicNumber) continue;
      if(OrderType() == type) return(OrderTicket());
   }
   return(-1);
}

void DeletePending(int type)
{
   int t = FindPending(type);
   if(t > 0 && !OrderDelete(t, clrNONE)) ReportError("delete pending", GetLastError());
}

void DeleteAllPendings()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != Symbol() || OrderMagicNumber() != MagicNumber) continue;
      if(OrderType() > OP_SELL)
         if(!OrderDelete(OrderTicket(), clrNONE)) ReportError("delete pending", GetLastError());
   }
}

void ClosePosition(int ticket)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return;
   for(int attempt = 0; attempt < 3; attempt++)
   {
      RefreshRates();
      double px = (OrderType() == OP_BUY) ? Bid : Ask;
      if(OrderClose(ticket, OrderLots(), px, Slippage, clrNONE)) return;
      int err = GetLastError();
      ReportError("close", err);
      if(!Retryable(err)) return;
      Sleep(200);
   }
}

bool SendOrder(int type, double lots, double price, double sl, double tp)
{
   for(int attempt = 0; attempt < 3; attempt++)
   {
      int ticket = OrderSend(Symbol(), type, lots, price, Slippage, sl, tp, OrderTag, MagicNumber, 0, clrNONE);
      if(ticket > 0) return(true);
      int err = GetLastError();
      if(err == ERR_INVALID_STOPS && (sl != 0 || tp != 0))
      {
         ticket = OrderSend(Symbol(), type, lots, price, Slippage, 0, 0, OrderTag, MagicNumber, 0, clrNONE);
         if(ticket > 0)
         {
            if(OrderSelect(ticket, SELECT_BY_TICKET))
               if(!OrderModify(ticket, OrderOpenPrice(), sl, tp, 0, clrNONE)) ReportError("attach stops", GetLastError());
            return(true);
         }
         err = GetLastError();
      }
      ReportError("send", err);
      if(!Retryable(err)) return(false);
      Sleep(200);
      RefreshRates();
   }
   return(false);
}

bool Retryable(int err)
{
   return(err == ERR_SERVER_BUSY || err == ERR_NO_CONNECTION || err == ERR_TRADE_TIMEOUT ||
          err == ERR_PRICE_CHANGED || err == ERR_OFF_QUOTES || err == ERR_REQUOTE ||
          err == ERR_TRADE_CONTEXT_BUSY || err == ERR_BROKER_BUSY);
}

void ReportError(string what, int err)
{
   if(err == ERR_NO_ERROR || err == ERR_NO_RESULT) return;
   Print("HFT v2: ", what, " failed, error ", err);
}

double CalcLots()
{
   double step = MarketInfo(Symbol(), MODE_LOTSTEP);
   double minL = MarketInfo(Symbol(), MODE_MINLOT);
   double maxL = MathMin(MarketInfo(Symbol(), MODE_MAXLOT), MaxLots);
   double lots = FixedLots;
   if(LotMode == LOT_RISK_PERCENT)
   {
      double tickValue = MarketInfo(Symbol(), MODE_TICKVALUE);
      double tickSize  = MarketInfo(Symbol(), MODE_TICKSIZE);
      if(tickValue <= 0 || tickSize <= 0) return(0);
      double lossPerLot = (StopLoss / tickSize) * tickValue;   // StopLoss is in price
      if(lossPerLot <= 0) return(0);
      lots = AccountEquity() * RiskPercent / 100.0 / lossPerLot;
   }
   if(step <= 0) step = 0.01;
   lots = MathFloor(lots / step) * step;
   lots = MathMax(minL, MathMin(maxL, lots));
   return(NormalizeDouble(lots, 2));
}

//+------------------------------------------------------------------+
int ServerOffsetHours()
{
   if(AutoServerOffset && !IsTesting())
      return((int)MathRound((double)(TimeCurrent() - TimeGMT()) / 3600.0));
   return(ServerGMTOffset);
}

bool UsDstAt(datetime utc)
{
   MqlDateTime t;
   TimeToStruct(utc, t);
   datetime start = NthSundayUtc(t.year, 3, 2) + 7 * 3600;
   datetime end   = NthSundayUtc(t.year, 11, 1) + 6 * 3600;
   return(utc >= start && utc < end);
}

datetime NthSundayUtc(int year, int month, int nth)
{
   MqlDateTime d;
   d.year = year; d.mon = month; d.day = 1; d.hour = 0; d.min = 0; d.sec = 0;
   datetime first = StructToTime(d);
   MqlDateTime f;
   TimeToStruct(first, f);
   d.day = 1 + (7 - f.day_of_week) % 7 + 7 * (nth - 1);
   return(StructToTime(d));
}

bool InSession()
{
   if(!UseSession) return(true);
   datetime utc = TimeCurrent() - ServerOffsetHours() * 3600;
   datetime ny  = utc + (UsDstAt(utc) ? -4 : -5) * 3600;
   MqlDateTime t;
   TimeToStruct(ny, t);
   if(t.day_of_week == 0 || t.day_of_week == 6) return(false);
   int hhmm = t.hour * 100 + t.min;
   if(SessionStartHHMM <= SessionEndHHMM) return(hhmm >= SessionStartHHMM && hhmm < SessionEndHHMM);
   return(hhmm >= SessionStartHHMM || hhmm < SessionEndHHMM);
}

void ResetDay()
{
   g_dayStart       = iTime(Symbol(), PERIOD_D1, 0);
   g_dayStartEquity = AccountEquity();
   g_fillsToday     = 0;
   g_dayLocked      = false;
}

void DrawPanel()
{
   if(!ShowPanel) return;
   string side = (g_bias == 2) ? "off (both sides)" : (g_bias > 0 ? "BUY side" : (g_bias < 0 ? "SELL side" : "inside - none"));
   string s = "HFT Secret v2  (2.10)\n";
   s += "Status: " + g_status + "\n";
   s += "Wave (" + IntegerToString(MaPeriod) + " SMA high/low): " + side + "\n";
   s += "Spread: " + DoubleToString(Ask - Bid, Digits) + " / " + DoubleToString(MaxSpread, Digits) + "\n";
   s += "Session NY " + IntegerToString(SessionStartHHMM) + "-" + IntegerToString(SessionEndHHMM) + ": " + (InSession() ? "OPEN" : "closed") + "\n";
   s += "Fills today: " + IntegerToString(g_fillsToday) + " / " + IntegerToString(MaxTradesPerDay) + "\n";
   s += "Day P/L: " + DoubleToString(AccountEquity() - g_dayStartEquity, 2) + "\n";
   Comment(s);
}
//+------------------------------------------------------------------+
