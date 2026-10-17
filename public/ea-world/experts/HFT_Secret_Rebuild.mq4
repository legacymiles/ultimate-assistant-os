//+------------------------------------------------------------------+
//|                                        HFT_Secret_Rebuild.mq4    |
//|  A clean, readable rebuild of the "HFT Secret 1.0" style of EA.  |
//|                                                                  |
//|  The original .ex4 is encrypted machine code from before the     |
//|  build-600 compiler change, which is why it stopped loading      |
//|  after the MT4 update. Nothing inside it can be read, so this is |
//|  NOT a decompile. It is a new EA written from scratch that       |
//|  trades the same way that family of EAs does:                    |
//|                                                                  |
//|   1. Park a Buy Stop above price and a Sell Stop below it.       |
//|   2. When price drifts AWAY from an order, drag the order along  |
//|      so it always sits EntryDistance away. When price moves      |
//|      TOWARD it, leave it alone so a fast move fills it.          |
//|   3. On a fill, delete the other order (OCO) and trail the stop  |
//|      tightly behind price. The trailing stop is the exit.        |
//|   4. Only trade when the spread is tight, inside the session     |
//|      window (New York peak by default), and under the daily      |
//|      loss / trade-count limits.                                  |
//|                                                                  |
//|  Its twin in TypeScript (src/lib/ea-replay/strategies/           |
//|  hftSecret.ts) runs the same rules in EA World > Replay, so a    |
//|  replay of a past NY session shows what this EA would have done. |
//|                                                                  |
//|  Written for MT4 build 600+ (#property strict). Default inputs   |
//|  are in POINTS for 5-digit brokers (10 points = 1 pip).          |
//+------------------------------------------------------------------+
#property copyright "EA World"
#property version   "2.00"
#property strict
#property description "HFT pending-stop scalper: trailing entry orders, OCO, tight trailing stop, spread + NY session filters."

//--- enums --------------------------------------------------------
enum ENUM_LOT_MODE   { LOT_FIXED = 0, LOT_RISK_PERCENT = 1 };
enum ENUM_DIRECTION  { DIR_BOTH = 0, DIR_BUY_ONLY = 1, DIR_SELL_ONLY = 2 };

//--- inputs -------------------------------------------------------
input string         _g1_               = "=== Money ===";       // .
input ENUM_LOT_MODE  LotMode            = LOT_FIXED;             // Lot mode
input double         FixedLots          = 0.10;                  // Fixed lots
input double         RiskPercent        = 1.0;                   // Risk % of equity per trade (uses StopLoss)
input double         MaxLots            = 5.0;                   // Lot ceiling

input string         _g2_               = "=== Entry ===";       // .
input ENUM_DIRECTION Direction          = DIR_BOTH;              // Which side(s) to trade
input int            EntryDistance      = 60;                    // Pending distance from price (points)
input int            ReplaceStep        = 10;                    // Drag a pending only when it is this far off (points)
input bool           DeleteOppositeOnFill = true;                // OCO: delete the other pending on a fill
input int            MaxSpread          = 20;                    // Max spread to keep orders working (points)

input string         _g3_               = "=== Exit ===";        // .
input int            StopLoss           = 100;                   // Initial stop loss (points)
input int            TakeProfit         = 0;                     // Take profit (points, 0 = trail only)
input int            TrailStart         = 30;                    // Start trailing after this profit (points)
input int            TrailDistance      = 25;                    // Trail this far behind price (points)
input int            TrailStep          = 5;                     // Move the stop in steps of (points)

input string         _g4_               = "=== Session (New York time) ===";  // .
input bool           UseSession         = true;                  // Only trade inside the window below
input int            SessionStartHHMM   = 800;                   // Start, New York time (800 = 08:00)
input int            SessionEndHHMM     = 1100;                  // End, New York time (1100 = 11:00)
input bool           AutoServerOffset   = true;                  // Live: work out broker GMT offset automatically
input int            ServerGMTOffset    = 3;                     // Broker GMT offset (used in tester / if auto is off)
input bool           CloseAtSessionEnd  = false;                 // Close open trades when the window ends

input string         _g5_               = "=== Protection ===";  // .
input int            MaxTradesPerDay    = 60;                    // Stop for the day after this many fills
input double         MaxDailyLossPct    = 3.0;                   // Stop for the day after this equity drop (%)
input int            CooldownSeconds    = 5;                     // Wait after a trade closes
input int            Slippage           = 3;                     // Max slippage (points)

input string         _g6_               = "=== Misc ===";        // .
input int            MagicNumber        = 20261016;              // Magic number
input string         OrderTag           = "HFT-Rebuild";         // Order comment
input bool           ShowPanel          = true;                  // Show the status panel

//--- state ---------------------------------------------------------
datetime g_dayStart        = 0;
double   g_dayStartEquity  = 0.0;
int      g_fillsToday      = 0;
int      g_lastPosTicket   = -1;
datetime g_lastCloseTime   = 0;
bool     g_dayLocked       = false;
string   g_status          = "";

//+------------------------------------------------------------------+
int OnInit()
{
   if(EntryDistance <= 0 || StopLoss <= 0 || TrailDistance <= 0)
   {
      Print("HFT Rebuild: EntryDistance, StopLoss and TrailDistance must be > 0");
      return(INIT_PARAMETERS_INCORRECT);
   }
   if(SessionStartHHMM < 0 || SessionStartHHMM > 2359 || SessionEndHHMM < 0 || SessionEndHHMM > 2359)
   {
      Print("HFT Rebuild: session times must be HHMM between 0000 and 2359");
      return(INIT_PARAMETERS_INCORRECT);
   }
   ResetDay();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   Comment("");
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(!IsTradeAllowed() && !IsTesting()) { g_status = "Trading not allowed"; DrawPanel(); return; }
   RefreshRates();

   //--- day roll-over (server day)
   datetime today = iTime(Symbol(), PERIOD_D1, 0);
   if(today != g_dayStart) ResetDay();

   //--- bookkeeping: detect fills and closes
   int posTicket = FindPosition();
   if(posTicket > 0 && posTicket != g_lastPosTicket) g_fillsToday++;
   if(posTicket < 0 && g_lastPosTicket > 0) g_lastCloseTime = TimeCurrent();
   g_lastPosTicket = posTicket;

   //--- daily loss lock
   if(!g_dayLocked && MaxDailyLossPct > 0 && g_dayStartEquity > 0 &&
      AccountEquity() <= g_dayStartEquity * (1.0 - MaxDailyLossPct / 100.0))
   {
      g_dayLocked = true;
      Print("HFT Rebuild: daily loss limit hit, done for today");
   }

   bool inSession = InSession();

   //--- manage an open position first
   if(posTicket > 0)
   {
      if(DeleteOppositeOnFill) DeleteAllPendings();
      if(CloseAtSessionEnd && !inSession) ClosePosition(posTicket);
      else                                Trail(posTicket);
      g_status = "In trade #" + IntegerToString(posTicket);
      DrawPanel();
      return;
   }

   //--- reasons not to keep orders working
   string block = "";
   double spreadPts = (Ask - Bid) / Point;
   if(g_dayLocked)                                         block = "Daily loss limit hit";
   else if(MaxTradesPerDay > 0 && g_fillsToday >= MaxTradesPerDay) block = "Max trades for today";
   else if(!inSession)                                     block = "Outside session";
   else if(spreadPts > MaxSpread)                          block = "Spread " + DoubleToString(spreadPts, 0) + " > " + IntegerToString(MaxSpread);
   else if(CooldownSeconds > 0 && TimeCurrent() - g_lastCloseTime < CooldownSeconds) block = "Cooldown";

   if(block != "")
   {
      DeleteAllPendings();
      g_status = block;
      DrawPanel();
      return;
   }

   //--- keep the two pendings parked at EntryDistance
   if(Direction != DIR_SELL_ONLY) WorkPending(OP_BUYSTOP);
   if(Direction != DIR_BUY_ONLY)  WorkPending(OP_SELLSTOP);
   g_status = "Hunting";
   DrawPanel();
}

//+------------------------------------------------------------------+
//| Pending order: place it, or drag it after price                  |
//+------------------------------------------------------------------+
void WorkPending(int type)
{
   double stopLevel = MathMax(MarketInfo(Symbol(), MODE_STOPLEVEL), 0) * Point;
   double dist      = MathMax(EntryDistance * Point, stopLevel + Point);
   double desired   = (type == OP_BUYSTOP) ? Ask + dist : Bid - dist;
   desired          = NormalizeDouble(desired, Digits);

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
   // gap > 0 means price moved AWAY from the order: follow it.
   if(gap >= ReplaceStep * Point)
   {
      // freeze level: an order this close to price cannot be touched
      double freeze = MarketInfo(Symbol(), MODE_FREEZELEVEL) * Point;
      double toMkt  = (type == OP_BUYSTOP) ? current - Ask : Bid - current;
      if(freeze > 0 && toMkt <= freeze) return;

      double sl, tp;
      ExitsFor(type, desired, sl, tp);
      if(!OrderModify(ticket, desired, sl, tp, 0, clrNONE))
         ReportError("drag pending", GetLastError());
   }
}

void ExitsFor(int type, double entry, double &sl, double &tp)
{
   double stopLevel = MathMax(MarketInfo(Symbol(), MODE_STOPLEVEL), 0) * Point;
   double slDist    = MathMax(StopLoss * Point, stopLevel + Point);
   double tpDist    = (TakeProfit > 0) ? MathMax(TakeProfit * Point, stopLevel + Point) : 0;
   bool   isBuy     = (type == OP_BUYSTOP || type == OP_BUY);
   sl = NormalizeDouble(isBuy ? entry - slDist : entry + slDist, Digits);
   tp = (tpDist > 0) ? NormalizeDouble(isBuy ? entry + tpDist : entry - tpDist, Digits) : 0;
}

//+------------------------------------------------------------------+
//| Trailing stop on the open position                               |
//+------------------------------------------------------------------+
void Trail(int ticket)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return;
   double stopLevel = MathMax(MarketInfo(Symbol(), MODE_STOPLEVEL), 0) * Point;
   double trail     = MathMax(TrailDistance * Point, stopLevel + Point);
   double open      = OrderOpenPrice();
   double sl        = OrderStopLoss();

   if(OrderType() == OP_BUY)
   {
      if((Bid - open) < TrailStart * Point) return;
      double newSL = NormalizeDouble(Bid - trail, Digits);
      if(sl == 0 || newSL >= sl + TrailStep * Point)
         if(!OrderModify(ticket, open, newSL, OrderTakeProfit(), 0, clrNONE))
            ReportError("trail buy", GetLastError());
   }
   else if(OrderType() == OP_SELL)
   {
      if((open - Ask) < TrailStart * Point) return;
      double newSL = NormalizeDouble(Ask + trail, Digits);
      if(sl == 0 || newSL <= sl - TrailStep * Point)
         if(!OrderModify(ticket, open, newSL, OrderTakeProfit(), 0, clrNONE))
            ReportError("trail sell", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| Order helpers                                                    |
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

void DeleteAllPendings()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != Symbol() || OrderMagicNumber() != MagicNumber) continue;
      if(OrderType() > OP_SELL)
         if(!OrderDelete(OrderTicket(), clrNONE))
            ReportError("delete pending", GetLastError());
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
      // Some ECN servers refuse stops on the send; place the order bare, then attach them.
      if(err == ERR_INVALID_STOPS && (sl != 0 || tp != 0))
      {
         ticket = OrderSend(Symbol(), type, lots, price, Slippage, 0, 0, OrderTag, MagicNumber, 0, clrNONE);
         if(ticket > 0)
         {
            if(OrderSelect(ticket, SELECT_BY_TICKET))
               if(!OrderModify(ticket, OrderOpenPrice(), sl, tp, 0, clrNONE))
                  ReportError("attach stops", GetLastError());
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
   Print("HFT Rebuild: ", what, " failed, error ", err);
}

//+------------------------------------------------------------------+
//| Position size                                                    |
//+------------------------------------------------------------------+
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
      double lossPerLot = (StopLoss * Point / tickSize) * tickValue;
      if(lossPerLot <= 0) return(0);
      lots = AccountEquity() * RiskPercent / 100.0 / lossPerLot;
   }
   if(step <= 0) step = 0.01;
   lots = MathFloor(lots / step) * step;
   lots = MathMax(minL, MathMin(maxL, lots));
   return(NormalizeDouble(lots, 2));
}

//+------------------------------------------------------------------+
//| Session: the window is in New York time, DST handled            |
//+------------------------------------------------------------------+
int ServerOffsetHours()
{
   if(AutoServerOffset && !IsTesting())
   {
      long diff = (long)(TimeCurrent() - TimeGMT());
      return((int)MathRound(diff / 3600.0));
   }
   return(ServerGMTOffset);
}

// Second Sunday of March 07:00 UTC -> first Sunday of November 06:00 UTC
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
   d.year = year; d.mon = month; d.day = 1;
   d.hour = 0; d.min = 0; d.sec = 0;
   datetime first = StructToTime(d);
   MqlDateTime f;
   TimeToStruct(first, f);
   int firstSunday = 1 + (7 - f.day_of_week) % 7;
   d.day = firstSunday + 7 * (nth - 1);
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
   if(SessionStartHHMM <= SessionEndHHMM)
      return(hhmm >= SessionStartHHMM && hhmm < SessionEndHHMM);
   return(hhmm >= SessionStartHHMM || hhmm < SessionEndHHMM);   // window across midnight
}

//+------------------------------------------------------------------+
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
   double spreadPts = (Ask - Bid) / Point;
   string s = "HFT Secret Rebuild  v2.00\n";
   s += "Status: " + g_status + "\n";
   s += "Spread: " + DoubleToString(spreadPts, 0) + " / " + IntegerToString(MaxSpread) + " pts\n";
   s += "Session (NY " + IntegerToString(SessionStartHHMM) + "-" + IntegerToString(SessionEndHHMM) + "): " + (InSession() ? "OPEN" : "closed") + "\n";
   s += "Fills today: " + IntegerToString(g_fillsToday) + " / " + IntegerToString(MaxTradesPerDay) + "\n";
   s += "Day P/L: " + DoubleToString(AccountEquity() - g_dayStartEquity, 2) + "\n";
   Comment(s);
}
//+------------------------------------------------------------------+
