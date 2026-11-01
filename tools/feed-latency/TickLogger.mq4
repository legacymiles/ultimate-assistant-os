//+------------------------------------------------------------------+
//| TickLogger.mq4 - log every tick with the SHARED GetTickCount clock|
//|                                                                  |
//| Pairs with record_mt5.py. Both stamp ticks with Windows           |
//| GetTickCount (ms since boot), so two terminals on one machine     |
//| align to ~1ms without any clock synchronisation.                  |
//|                                                                   |
//| Writes to <terminal>/MQL4/Files/ticks_mt4_<symbol>.csv            |
//+------------------------------------------------------------------+
#property strict
#import "kernel32.dll"
   int GetTickCount();
#import

int    handle = INVALID_HANDLE;
double lastBid = 0, lastAsk = 0;
int    n = 0;

int OnInit()
{
   string fn = "ticks_mt4_" + Symbol() + ".csv";
   handle = FileOpen(fn, FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(handle == INVALID_HANDLE)
   {
      Print("FileOpen failed: ", GetLastError());
      return INIT_FAILED;
   }
   FileWrite(handle, "gtc_ms", "broker_time", "bid", "ask");
   Print("TickLogger started on ", Symbol(), " -> ", fn,
         "  (Allow DLL imports must be ON)");
   return INIT_SUCCEEDED;
}

void OnTick()
{
   if(handle == INVALID_HANDLE) return;
   if(Bid == lastBid && Ask == lastAsk) return;   // quote-change ticks only
   lastBid = Bid; lastAsk = Ask;
   FileWrite(handle, GetTickCount(), TimeCurrent(),
             DoubleToString(Bid, Digits), DoubleToString(Ask, Digits));
   n++;
   if(n % 200 == 0) { FileFlush(handle); Comment("TickLogger: ", n, " ticks"); }
}

void OnDeinit(const int reason)
{
   if(handle != INVALID_HANDLE) { FileFlush(handle); FileClose(handle); }
   Comment("");
   Print("TickLogger stopped after ", n, " ticks");
}
