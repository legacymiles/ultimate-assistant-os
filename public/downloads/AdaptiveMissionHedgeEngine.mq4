//+------------------------------------------------------------------+
//|                            AdaptiveMissionHedgeEngine.mq4        |
//|                            AMHE v1.0 — Combined EA               |
//|                            Copyright 2026, AlphaForge            |
//+------------------------------------------------------------------+
//| WHAT THIS IS:                                                    |
//|   An Adaptive Mission Hedge Engine that protects a separate      |
//|   Kalshi prediction-market position by intelligently building    |
//|   and managing an MT4 hedge in the direction that would cause    |
//|   the Kalshi position to lose.                                   |
//|                                                                  |
//| WHAT THIS IS NOT:                                                |
//|   - Not a grid EA, not a martingale, not an averaging EA         |
//|   - Not a signal trader — the prediction is on Kalshi            |
//|   - The MT4 side is purely a risk manager + hedge builder        |
//|                                                                  |
//| BATTLE-TESTED ENGINES (from proven source robots):               |
//|   - Basket P/L math, weighted breakeven, multi-order spread      |
//|   - Partial close (intelligent, profit-ordered)                  |
//|   - Basket trailing stop                                         |
//|   - Breakeven lock (1+ trades)                                   |
//|   - Milestone monitor (BMM) with screenshots + notifications     |
//|                                                                  |
//| NEW ENGINES (need demo forward-testing):                         |
//|   - Mission Engine (mission parameters + progress tracking)      |
//|   - Market Context Engine (FVG/structure heuristics)             |
//|   - Adaptive Exposure Engine (pending order recalculation)       |
//|   - Harvest Engine (opportunistic working positions)             |
//|   - Recovery Engine (cooldown + structure re-validation)         |
//|   - Statistical Learning (CSV logging + efficiency tracking)     |
//|                                                                  |
//| RISK DISCLAIMER:                                                 |
//|   Trading involves substantial risk of loss. This EA is a tool   |
//|   — not financial advice. Test on a demo account first.          |
//|   Past performance is not indicative of future results.          |
//+------------------------------------------------------------------+
#property copyright "Copyright 2026, AlphaForge"
#property link      "https://www.alphaforge.com"
#property version   "1.00"
#property strict

//+------------------------------------------------------------------+
//| ENUMERATIONS                                                     |
//+------------------------------------------------------------------+
enum ENUM_MISSION_DIRECTION
{
   MISSION_BUY  = 0, // BUY (hedge horizon is ABOVE current price)
   MISSION_SELL = 1  // SELL (hedge horizon is BELOW current price)
};

enum ENUM_LOT_METHOD
{
   LOT_FRONT_HEAVY = 0, // Front Heavy (largest first)
   LOT_BACK_HEAVY  = 1, // Back Heavy (smallest first)
   LOT_EVEN        = 2, // Even (equal distribution)
   LOT_SLOW_GRIND  = 3  // Slow Grind (sqrt scaling)
};

enum ENUM_HARVEST_SETUP
{
   SETUP_NONE              = 0,
   SETUP_FVG_FILL          = 1,
   SETUP_FVG_BREAKOUT      = 2,
   SETUP_FVG_RETEST        = 3,
   SETUP_LIQUIDITY_SWEEP   = 4,
   SETUP_PULLBACK_CONT     = 5,
   SETUP_BREAKOUT_RETEST   = 6,
   SETUP_SUPPORT_BOUNCE    = 7,
   SETUP_RESISTANCE_REJECT = 8,
   SETUP_MOMENTUM_CONT     = 9
};

//+------------------------------------------------------------------+
//| INPUT PARAMETERS — MISSION ENGINE                                |
//+------------------------------------------------------------------+
input string Inp_M01 = "═══════════ MISSION ENGINE ═══════════";
input bool   InpMissionEnabled   = false;          // Enable mission (set TRUE to start)
input ENUM_MISSION_DIRECTION InpMissionDir = MISSION_SELL; // Mission direction (Kalshi hedge)
input double InpHedgeHorizon     = 0.0;            // Hedge Horizon price (Kalshi danger level)
input double InpDesiredOffsetUSD = 250.0;          // Desired hedge offset in USD at horizon
input datetime InpMissionExpiry  = 0;              // Mission expiry time (0 = no expiry)

input string Inp_M02 = "═══════════ ADAPTIVE EXPOSURE ═══════════";
input ENUM_LOT_METHOD InpLotMethod    = LOT_SLOW_GRIND; // Lot distribution method
input int    InpMaxPendingOrders      = 10;        // Max pending ladder orders
input double InpMinLotPerOrder        = 0.01;      // Minimum lot per order
input double InpMaxLotPerOrder        = 1.0;       // Maximum lot per order
input double InpMaxTotalExposure      = 5.0;       // Maximum total lots (safety cap)
input bool   InpRecalcBeforeActivate  = true;      // Recalculate pending orders before activation
input double InpLadderStartFraction   = 0.1;       // Ladder starts this fraction toward horizon
input double InpLadderEndFraction     = 0.9;       // Ladder ends this fraction toward horizon

input string Inp_M03 = "═══════════ HARVEST ENGINE ═══════════";
input bool   InpHarvestEnabled      = true;        // Enable harvest trades
input double InpHarvestLotSize      = 0.01;        // Harvest trade lot size
input int    InpHarvestMaxOpen      = 3;           // Max simultaneous harvest trades
input double InpHarvestTPPoints     = 50.0;        // Harvest TP in points
input double InpHarvestSLPoints     = 100.0;       // Harvest SL in points
input double InpMinSetupQuality     = 60.0;        // Minimum setup quality score (0-100)
input int    InpHarvestCooldownBars = 3;           // Bars between harvest entries

input string Inp_M04 = "═══════════ STRUCTURE DETECTION ═══════════";
input int    InpSwingLookback    = 5;              // Swing high/low lookback bars
input int    InpFVGMinSizePoints = 20;             // Minimum FVG size in points
input double InpATRPeriod        = 14;             // ATR period for volatility
input double InpSweepWickRatio   = 0.6;            // Wick-to-range ratio for sweep detection

input string Inp_M05 = "═══════════ POSITION GOVERNANCE ═══════════";
input int    InpLegacyAgeMinutes    = 60;          // Age (min) to become Legacy position
input bool   InpPreserveLegacy      = true;        // Preserve legacy during partial close
input double InpDrawdownActivation  = 50.0;        // Drawdown ($) to activate averaging
input double InpAveragingPoints     = 100.0;       // Basket averaging target points

input string Inp_M06 = "═══════════ TRAILING STOP ═══════════";
input bool   InpEnableTrailing      = true;        // Enable basket trailing stop
input double InpTrailingStartPts    = 50.0;        // Start trailing at this profit (points)
input double InpTrailingStepPts     = 25.0;        // Trailing step size (points)

input string Inp_M07 = "═══════════ PARTIAL CLOSE ═══════════";
input bool   InpEnablePartialClose  = true;        // Enable automatic partial close
input double InpPartialTriggerPts   = 75.0;        // Trigger at this NET profit (points)
input int    InpPartialPercent      = 50;          // Percentage to close (1-99)
input double InpBELockPointsProfit  = 25.0;        // Breakeven lock points in profit
input bool   InpCloseProfitFirst    = true;        // Close most profitable first

input string Inp_M08 = "═══════════ MILESTONE MONITOR ═══════════";
input bool   InpBMMEnable           = true;        // Enable milestone monitor
input double InpBMMGoalUSD          = 250.0;       // Basket profit goal ($)
input int    InpBMMUpdateMs         = 500;         // Update interval ms
input bool   InpBMMMile50           = true;        // 50% milestone
input bool   InpBMMMile75           = false;       // 75% milestone
input bool   InpBMMMile90           = true;        // 90% milestone
input bool   InpBMMMile99           = true;        // 99% milestone
input bool   InpBMMAlert            = true;        // Terminal popup alerts
input bool   InpBMMPush             = false;       // Push notifications
input bool   InpBMMEmail            = false;       // Email notifications
input bool   InpBMMSound            = true;        // Sound alerts
input string InpBMMSoundFile        = "alert.wav"; // Sound file
input bool   InpBMMScreenshot       = true;        // Auto-screenshot on milestone
input string InpBMMScreenFolder     = "AMHE_Screenshots"; // Screenshot folder

input string Inp_M09 = "═══════════ VISUALS ═══════════";
input bool   InpShowHorizonLine     = true;        // Show hedge horizon line
input bool   InpShowMissionPanel    = true;        // Show mission info panel
input bool   InpShowBreakevenLine   = true;        // Show breakeven line
input bool   InpShowTargetLine      = true;        // Show target line
input bool   InpShowLadderLines     = true;        // Show pending order ladder
input color  InpHorizonColor        = clrMagenta;  // Horizon line color
input color  InpBreakevenColor      = clrLime;     // Breakeven line color
input color  InpTargetColor         = clrHotPink;  // Target line color
input color  InpLadderColor         = clrDodgerBlue; // Ladder order color
input color  InpTrailingColor       = clrYellow;   // Trailing stop color
input color  InpPartialTrigColor    = clrOrange;   // Partial close trigger color
input color  InpBELockColor         = clrLimeGreen; // Breakeven lock color
input color  InpHarvestColor        = clrCyan;     // Harvest trade color
input int    InpLineWidth           = 2;           // Line width

input string Inp_M10 = "═══════════ EXECUTION ═══════════";
input int    InpMagic        = 20260712;           // Magic number
input string InpComment      = "AMHE";             // Order comment prefix
input int    InpSlippage     = 10;                 // Slippage in points
input double InpMaxSpread    = 50.0;               // Max spread for execution (points)
input int    InpRetryAttempts = 3;                 // Close retry attempts

input string Inp_M11 = "═══════════ STATISTICAL LEARNING ═══════════";
input bool   InpStatLogEnabled  = true;            // Enable CSV trade logging
input string InpStatLogFolder   = "AMHE_Stats";    // Log folder name

//+------------------------------------------------------------------+
//| CONSTANTS                                                        |
//+------------------------------------------------------------------+
#define PREFIX           "AMHE_"
#define BMM_PREFIX       "AMHE_BMM_"
#define MAX_MILESTONES   8
#define MAX_SWINGS       50
#define MAX_FVGS         20
#define MAX_HARVEST_LOG  500

//+------------------------------------------------------------------+
//| GLOBAL STATE — MISSION ENGINE                                    |
//+------------------------------------------------------------------+
string g_symbol;
int    g_digits;
double g_point;
double g_tickValue;
double g_tickSize;
double g_pointValueUSD;

double g_missionProgress    = 0.0;  // 0-100%
double g_remainingDistance   = 0.0;  // points to horizon
int    g_remainingTimeSec    = 0;    // seconds to expiry
double g_realizedProfitUSD   = 0.0;  // total realized from closed trades
double g_floatingProfitUSD   = 0.0;  // current floating P/L
double g_projectedAtHorizon  = 0.0;  // projected profit if all positions reach horizon

//+------------------------------------------------------------------+
//| GLOBAL STATE — MARKET CONTEXT ENGINE                             |
//+------------------------------------------------------------------+
struct SwingPoint
{
   double price;
   datetime time;
   bool   isHigh;
   int    barIndex;
};

struct FairValueGap
{
   double topPrice;
   double bottomPrice;
   double midPrice;
   datetime time;
   int    barIndex;
   bool   isBullish;  // true = bullish FVG (gap up), false = bearish
   bool   filled;
   bool   broken;
   bool   retested;
};

SwingPoint  g_swings[MAX_SWINGS];
int         g_swingCount = 0;
FairValueGap g_fvgs[MAX_FVGS];
int         g_fvgCount = 0;
double      g_currentATR = 0.0;
double      g_setupQuality = 0.0;
ENUM_HARVEST_SETUP g_lastSetupType = SETUP_NONE;

//+------------------------------------------------------------------+
//| GLOBAL STATE — ADAPTIVE EXPOSURE ENGINE                          |
//+------------------------------------------------------------------+
double g_ladderPrices[];
double g_ladderLots[];
int    g_ladderCount = 0;
double g_totalLadderLots = 0.0;
int    g_ladderTickets[];  // tickets for placed pending orders
bool   g_ladderPlaced = false;

//+------------------------------------------------------------------+
//| GLOBAL STATE — HARVEST ENGINE                                    |
//+------------------------------------------------------------------+
int    g_harvestOpenCount = 0;
int    g_lastHarvestBar   = 0;
double g_harvestRealizedUSD = 0.0;

//+------------------------------------------------------------------+
//| GLOBAL STATE — POSITION GOVERNANCE                               |
//+------------------------------------------------------------------+
double g_breakevenPrice      = 0.0;
double g_targetPrice         = 0.0;
double g_trailingStopPrice   = 0.0;
double g_partialTriggerPrice = 0.0;
double g_beLockPrice         = 0.0;
double g_highestProfitPts    = 0.0;
bool   g_averagingActivated  = false;
bool   g_partialCloseExecuted = false;
bool   g_beLockActive        = false;
bool   g_closingInProgress   = false;

//+------------------------------------------------------------------+
//| GLOBAL STATE — MILESTONE MONITOR                                 |
//+------------------------------------------------------------------+
double g_bmm_milePercent[MAX_MILESTONES];
bool   g_bmm_mileEnabled[MAX_MILESTONES];
bool   g_bmm_mileTriggered[MAX_MILESTONES];
string g_bmm_mileLabel[MAX_MILESTONES];
int    g_bmm_mileCount       = 0;
double g_bmm_basketProfit    = 0.0;
double g_bmm_totalLots       = 0.0;
double g_bmm_avgEntry        = 0.0;
int    g_bmm_openOrders      = 0;
int    g_bmm_basketDir       = 0;
double g_bmm_targetPrice     = 0.0;
double g_bmm_pctComplete     = 0.0;
double g_bmm_remainingUSD    = 0.0;
double g_bmm_currentPrice    = 0.0;
uint   g_bmm_lastUpdate      = 0;
bool   g_bmm_hadOpenOrders   = false;

//+------------------------------------------------------------------+
//| GLOBAL STATE — STATISTICAL LEARNING                              |
//+------------------------------------------------------------------+
struct HarvestRecord
{
   ENUM_HARVEST_SETUP setupType;
   string  session;      // "London", "NewYork", "Asian", "Off"
   double  fvgQuality;
   double  drawdown;
   double  realizedProfit;
   double  mfe;          // max favorable excursion (points)
   double  mae;          // max adverse excursion (points)
   double  missionEfficiency;
   datetime entryTime;
   datetime exitTime;
};

double g_setupBias[10];  // per-setup-type efficiency bias (0-100)
int    g_setupCount[10]; // number of completed trades per type

//+------------------------------------------------------------------+
//| BASKET DATA STRUCTURE                                            |
//+------------------------------------------------------------------+
struct BasketData
{
   double totalBuyLots;
   double totalSellLots;
   double avgBuyPrice;
   double avgSellPrice;
   double netLots;
   int    totalBuyCount;
   int    totalSellCount;
   double totalProfit;
   double netBreakeven;
   double netPointsProfit;
   double currentPrice;
   double pv; // point value
};

//+------------------------------------------------------------------+
//| TRADE ORDER STRUCTURE                                            |
//+------------------------------------------------------------------+
struct TradeOrder
{
   int      ticket;
   double   lots;
   double   profit;
   double   openPrice;
   int      type;
   datetime openTime;
   string   comment;
   bool     isLegacy;
   bool     isHarvest;
};

//+------------------------------------------------------------------+
//| INITIALIZATION                                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   g_symbol    = Symbol();
   g_digits    = (int)MarketInfo(g_symbol, MODE_DIGITS);
   g_point     = MarketInfo(g_symbol, MODE_POINT);
   g_tickValue = MarketInfo(g_symbol, MODE_TICKVALUE);
   g_tickSize  = MarketInfo(g_symbol, MODE_TICKSIZE);

   if(g_tickSize > 0 && g_tickValue > 0)
      g_pointValueUSD = g_tickValue / g_tickSize * g_point;
   else
      g_pointValueUSD = 10.0;

   // Initialize setup bias (neutral start)
   ArrayInitialize(g_setupBias, 50.0);
   ArrayInitialize(g_setupCount, 0);

   // Initialize milestone monitor
   BMM_Init();

   // Chart event hooks
   ChartSetInteger(0, CHART_EVENT_MOUSE_MOVE, 1);
   ChartSetInteger(0, CHART_EVENT_OBJECT_DELETE, 1);

   // Create visual elements
   if(InpMissionEnabled && InpHedgeHorizon > 0)
   {
      CreateMissionVisuals();
   }

   CreateManualPartialClosePanel();

   Print("═══════════════════════════════════════════════");
   Print("  ADAPTIVE MISSION HEDGE ENGINE v1.0");
   Print("  Mission: ", InpMissionEnabled ? "ENABLED" : "DISABLED");
   if(InpMissionEnabled)
   {
      Print("  Direction: ", InpMissionDir == MISSION_SELL ? "SELL" : "BUY");
      Print("  Hedge Horizon: ", DoubleToString(InpHedgeHorizon, g_digits));
      Print("  Desired Offset: $", DoubleToString(InpDesiredOffsetUSD, 2));
   }
   Print("═══════════════════════════════════════════════");

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| DEINITIALIZATION                                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   BMM_Deinit();
   DeleteAllObjects();
}

//+------------------------------------------------------------------+
//| MAIN TICK FUNCTION                                               |
//+------------------------------------------------------------------+
void OnTick()
{
   if(g_closingInProgress) return;

   RefreshRates();

   // ── 1. MISSION ENGINE: update progress ──
   if(InpMissionEnabled && InpHedgeHorizon > 0)
      UpdateMissionState();

   // ── 2. MARKET CONTEXT ENGINE: scan structures ──
   UpdateMarketContext();

   // ── 3. BASKET STATE: calculate current basket ──
   BasketData basket;
   bool hasBasket = CalculateBasketData(basket);

   // ── 4. ADAPTIVE EXPOSURE ENGINE: manage ladder ──
   if(InpMissionEnabled && InpHedgeHorizon > 0)
   {
      if(InpRecalcBeforeActivate && g_ladderPlaced)
         RecalculateLadder(basket);

      if(!g_ladderPlaced && hasBasket == false)
         BuildInitialLadder();
      else if(!g_ladderPlaced && hasBasket)
         BuildAdaptiveLadder(basket);
   }

   // ── 5. HARVEST ENGINE: look for opportunities ──
   if(InpHarvestEnabled && InpMissionEnabled)
      RunHarvestEngine(basket);

   // ── 6. POSITION GOVERNANCE ──
   if(hasBasket)
   {
      int totalPos = basket.totalBuyCount + basket.totalSellCount;

      // Drawdown activation
      if(!g_averagingActivated && basket.totalProfit <= -InpDrawdownActivation)
      {
         g_averagingActivated = true;
         Print("[AMHE] Drawdown activation triggered. P/L: $", DoubleToString(basket.totalProfit, 2));
      }

      // Averaging target check
      if(g_averagingActivated && totalPos >= 2 && MathAbs(basket.netLots) > 0.00001)
      {
         g_breakevenPrice = basket.netBreakeven;
         double ptsFromBE = (basket.netLots > 0) ?
            (basket.currentPrice - g_breakevenPrice) / basket.pv :
            (g_breakevenPrice - basket.currentPrice) / basket.pv;

         if(ptsFromBE >= InpAveragingPoints)
         {
            Print("[AMHE] Averaging profit target reached!");
            if(CheckSpread()) CloseAllTradesFast();
         }
      }

      // Trailing stop
      if(InpEnableTrailing && totalPos >= 2 && MathAbs(basket.netLots) > 0.00001)
         CheckTrailingStop(basket);

      // Automatic partial close
      if(InpEnablePartialClose && !g_partialCloseExecuted && totalPos >= 2 && MathAbs(basket.netLots) > 0.00001)
         CheckAutomaticPartialClose(basket);

      // Breakeven lock
      if(g_partialCloseExecuted)
         UpdateBreakevenLockPrice(basket);

      if(g_partialCloseExecuted && g_beLockActive)
         CheckBreakevenLockHit(basket);

      // Render visuals
      RenderAllLines(basket);
      UpdateMissionPanel(basket);
   }

   // ── 7. MILESTONE MONITOR ──
   BMM_OnTick();
}

//+------------------------------------------------------------------+
//| CHART EVENT HANDLER                                              |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam,
                  const double &dparam, const string &sparam)
{
   if(id == CHARTEVENT_OBJECT_CLICK)
   {
      if(sparam == PREFIX + "ManualPCBtn")
      {
         ObjectSetInteger(0, PREFIX + "ManualPCBtn", OBJPROP_STATE, false);
         string pctStr = ObjectGetString(0, PREFIX + "ManualPCEdit", OBJPROP_TEXT);
         int pct = (int)StringToInteger(pctStr);
         if(pct >= 1 && pct <= 99)
         {
            Print("[AMHE] Manual partial close: ", pct, "%");
            ExecutePartialClose(pct);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| ═══════════════════════════════════════════════════════════════   |
//|                    1. MISSION ENGINE                              |
//| ═══════════════════════════════════════════════════════════════   |
//+------------------------------------------------------------------+
void UpdateMissionState()
{
   double currentPrice = (InpMissionDir == MISSION_SELL) ? Bid : Ask;
   double totalDistance;

   if(InpMissionDir == MISSION_SELL)
      totalDistance = (currentPrice - InpHedgeHorizon) / g_point;
   else
      totalDistance = (InpHedgeHorizon - currentPrice) / g_point;

   // Remaining distance from ENTRY to horizon (use first trade if exists, else current)
   double entryRef = currentPrice;
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != g_symbol || OrderMagicNumber() != InpMagic) continue;
      if(OrderType() == OP_BUY || OrderType() == OP_SELL)
      {
         entryRef = OrderOpenPrice();
         break;
      }
   }

   double fullDistance;
   if(InpMissionDir == MISSION_SELL)
      fullDistance = (entryRef - InpHedgeHorizon) / g_point;
   else
      fullDistance = (InpHedgeHorizon - entryRef) / g_point;

   g_remainingDistance = (totalDistance > 0) ? totalDistance : 0;
   if(fullDistance > 0)
      g_missionProgress = ((fullDistance - g_remainingDistance) / fullDistance) * 100.0;
   else
      g_missionProgress = 0;

   if(g_missionProgress < 0) g_missionProgress = 0;
   if(g_missionProgress > 100) g_missionProgress = 100;

   // Remaining time
   if(InpMissionExpiry > 0)
      g_remainingTimeSec = (int)(InpMissionExpiry - TimeCurrent());
   else
      g_remainingTimeSec = -1; // no expiry

   // Projected profit at horizon
   g_projectedAtHorizon = 0;
   g_floatingProfitUSD = 0;
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != g_symbol || OrderMagicNumber() != InpMagic) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;

      double lot = OrderLots();
      double op  = OrderOpenPrice();
      double pl  = OrderProfit() + OrderSwap() + OrderCommission();
      g_floatingProfitUSD += pl;

      double projDist;
      if(type == OP_BUY)
         projDist = (InpHedgeHorizon - op) / g_point;
      else
         projDist = (op - InpHedgeHorizon) / g_point;

      g_projectedAtHorizon += lot * projDist * g_pointValueUSD;
   }
}

//+------------------------------------------------------------------+
//| ═══════════════════════════════════════════════════════════════   |
//|                 2. MARKET CONTEXT ENGINE                         |
//| ═══════════════════════════════════════════════════════════════   |
//+------------------------------------------------------------------+
void UpdateMarketContext()
{
   DetectSwingPoints();
   DetectFairValueGaps();
   UpdateFVGStatus();

   g_currentATR = iATR(g_symbol, 0, (int)InpATRPeriod, 0);
}

//--- Swing point detection via fractal logic ---
void DetectSwingPoints()
{
   g_swingCount = 0;
   int lb = InpSwingLookback;

   for(int bar = lb; bar < Bars - lb && g_swingCount < MAX_SWINGS; bar++)
   {
      // Swing High
      bool isHigh = true;
      double highVal = High[bar];
      for(int j = 1; j <= lb; j++)
      {
         if(High[bar - j] > highVal || High[bar + j] > highVal)
         { isHigh = false; break; }
      }
      if(isHigh)
      {
         g_swings[g_swingCount].price    = highVal;
         g_swings[g_swingCount].time     = Time[bar];
         g_swings[g_swingCount].isHigh   = true;
         g_swings[g_swingCount].barIndex = bar;
         g_swingCount++;
         if(g_swingCount >= MAX_SWINGS) break;
      }

      // Swing Low
      bool isLow = true;
      double lowVal = Low[bar];
      for(int j = 1; j <= lb; j++)
      {
         if(Low[bar - j] < lowVal || Low[bar + j] < lowVal)
         { isLow = false; break; }
      }
      if(isLow)
      {
         g_swings[g_swingCount].price    = lowVal;
         g_swings[g_swingCount].time     = Time[bar];
         g_swings[g_swingCount].isHigh   = false;
         g_swings[g_swingCount].barIndex = bar;
         g_swingCount++;
      }
   }
}

//--- Fair Value Gap detection (3-candle imbalance) ---
void DetectFairValueGaps()
{
   g_fvgCount = 0;
   double minSize = InpFVGMinSizePoints * g_point;

   for(int bar = 2; bar < 100 && g_fvgCount < MAX_FVGS; bar++)
   {
      // Bullish FVG: candle[bar] high < candle[bar-2] low (gap up)
      if(Low[bar - 2] > High[bar])
      {
         double gapSize = Low[bar - 2] - High[bar];
         if(gapSize >= minSize)
         {
            g_fvgs[g_fvgCount].topPrice    = Low[bar - 2];
            g_fvgs[g_fvgCount].bottomPrice = High[bar];
            g_fvgs[g_fvgCount].midPrice    = (Low[bar - 2] + High[bar]) / 2.0;
            g_fvgs[g_fvgCount].time        = Time[bar - 1];
            g_fvgs[g_fvgCount].barIndex    = bar - 1;
            g_fvgs[g_fvgCount].isBullish   = true;
            g_fvgs[g_fvgCount].filled      = false;
            g_fvgs[g_fvgCount].broken      = false;
            g_fvgs[g_fvgCount].retested    = false;
            g_fvgCount++;
         }
      }

      // Bearish FVG: candle[bar] low > candle[bar-2] high (gap down)
      if(High[bar - 2] < Low[bar])
      {
         double gapSize = Low[bar] - High[bar - 2];
         if(gapSize >= minSize)
         {
            g_fvgs[g_fvgCount].topPrice    = Low[bar];
            g_fvgs[g_fvgCount].bottomPrice = High[bar - 2];
            g_fvgs[g_fvgCount].midPrice    = (Low[bar] + High[bar - 2]) / 2.0;
            g_fvgs[g_fvgCount].time        = Time[bar - 1];
            g_fvgs[g_fvgCount].barIndex    = bar - 1;
            g_fvgs[g_fvgCount].isBullish   = false;
            g_fvgs[g_fvgCount].filled      = false;
            g_fvgs[g_fvgCount].broken      = false;
            g_fvgs[g_fvgCount].retested    = false;
            g_fvgCount++;
         }
      }
   }
}

//--- Update FVG status: filled, broken, retested ---
void UpdateFVGStatus()
{
   double bid = Bid;
   for(int i = 0; i < g_fvgCount; i++)
   {
      if(g_fvgs[i].isBullish)
      {
         if(bid <= g_fvgs[i].midPrice) g_fvgs[i].filled = true;
         if(bid < g_fvgs[i].bottomPrice) g_fvgs[i].broken = true;
         if(g_fvgs[i].filled && bid >= g_fvgs[i].bottomPrice && bid <= g_fvgs[i].topPrice)
            g_fvgs[i].retested = true;
      }
      else
      {
         if(bid >= g_fvgs[i].midPrice) g_fvgs[i].filled = true;
         if(bid > g_fvgs[i].topPrice) g_fvgs[i].broken = true;
         if(g_fvgs[i].filled && bid >= g_fvgs[i].bottomPrice && bid <= g_fvgs[i].topPrice)
            g_fvgs[i].retested = true;
      }
   }
}

//--- Evaluate setup quality (0-100) ---
double EvaluateSetupQuality(ENUM_HARVEST_SETUP &outSetup)
{
   double score = 0;
   outSetup = SETUP_NONE;
   double bid = Bid;
   bool isSellMission = (InpMissionDir == MISSION_SELL);

   // Check FVG interactions in mission direction
   for(int i = 0; i < g_fvgCount; i++)
   {
      // For SELL mission, we want bearish FVGs or filled bullish FVGs
      if(isSellMission)
      {
         // Bearish FVG retest (price came back up into it)
         if(!g_fvgs[i].isBullish && g_fvgs[i].retested && !g_fvgs[i].broken)
         {
            double s = 70.0;
            // Bonus for FVG size relative to ATR
            if(g_currentATR > 0)
            {
               double relSize = (g_fvgs[i].topPrice - g_fvgs[i].bottomPrice) / g_currentATR;
               s += MathMin(relSize * 15.0, 20.0);
            }
            if(s > score) { score = s; outSetup = SETUP_FVG_RETEST; }
         }

         // Bearish FVG breakout (price broke below a bullish FVG)
         if(g_fvgs[i].isBullish && g_fvgs[i].broken)
         {
            double s = 65.0;
            if(s > score) { score = s; outSetup = SETUP_FVG_BREAKOUT; }
         }

         // Bullish FVG fill (price came down into bullish FVG — continuation setup for sells)
         if(g_fvgs[i].isBullish && g_fvgs[i].filled && !g_fvgs[i].broken &&
            bid >= g_fvgs[i].bottomPrice && bid <= g_fvgs[i].topPrice)
         {
            double s = 55.0;
            if(s > score) { score = s; outSetup = SETUP_FVG_FILL; }
         }
      }
      else // BUY mission
      {
         if(g_fvgs[i].isBullish && g_fvgs[i].retested && !g_fvgs[i].broken)
         {
            double s = 70.0;
            if(g_currentATR > 0)
            {
               double relSize = (g_fvgs[i].topPrice - g_fvgs[i].bottomPrice) / g_currentATR;
               s += MathMin(relSize * 15.0, 20.0);
            }
            if(s > score) { score = s; outSetup = SETUP_FVG_RETEST; }
         }

         if(!g_fvgs[i].isBullish && g_fvgs[i].broken)
         {
            double s = 65.0;
            if(s > score) { score = s; outSetup = SETUP_FVG_BREAKOUT; }
         }

         if(!g_fvgs[i].isBullish && g_fvgs[i].filled && !g_fvgs[i].broken &&
            bid >= g_fvgs[i].bottomPrice && bid <= g_fvgs[i].topPrice)
         {
            double s = 55.0;
            if(s > score) { score = s; outSetup = SETUP_FVG_FILL; }
         }
      }
   }

   // Check liquidity sweep (wick beyond recent swing, close back)
   if(g_swingCount >= 2)
   {
      double lastClose = Close[1];
      double lastHigh  = High[1];
      double lastLow   = Low[1];
      double lastRange  = lastHigh - lastLow;

      if(lastRange > 0)
      {
         for(int i = 0; i < g_swingCount && i < 5; i++)
         {
            if(isSellMission && g_swings[i].isHigh)
            {
               // Sweep above swing high then close back below
               if(lastHigh > g_swings[i].price && lastClose < g_swings[i].price)
               {
                  double wickRatio = (lastHigh - lastClose) / lastRange;
                  if(wickRatio >= InpSweepWickRatio)
                  {
                     double s = 75.0;
                     if(s > score) { score = s; outSetup = SETUP_LIQUIDITY_SWEEP; }
                  }
               }
            }
            else if(!isSellMission && !g_swings[i].isHigh)
            {
               if(lastLow < g_swings[i].price && lastClose > g_swings[i].price)
               {
                  double wickRatio = (lastClose - lastLow) / lastRange;
                  if(wickRatio >= InpSweepWickRatio)
                  {
                     double s = 75.0;
                     if(s > score) { score = s; outSetup = SETUP_LIQUIDITY_SWEEP; }
                  }
               }
            }
         }
      }
   }

   // Pullback continuation: price pulled back against mission dir, now resuming
   if(g_swingCount >= 3)
   {
      if(isSellMission)
      {
         // Recent swing low, then higher low (pullback), price now below both
         if(!g_swings[0].isHigh && g_swings[0].barIndex < 10 && Close[0] < g_swings[0].price)
         {
            double s = 60.0;
            if(s > score) { score = s; outSetup = SETUP_PULLBACK_CONT; }
         }
      }
      else
      {
         if(g_swings[0].isHigh == false && g_swings[0].barIndex < 10 && Close[0] > g_swings[0].price)
         {
            double s = 60.0;
            if(s > score) { score = s; outSetup = SETUP_PULLBACK_CONT; }
         }
      }
   }

   // Momentum continuation: strong candle in mission direction
   double bodySize = MathAbs(Close[1] - Open[1]);
   if(g_currentATR > 0 && bodySize > g_currentATR * 0.8)
   {
      bool missionAligned = (isSellMission && Close[1] < Open[1]) ||
                            (!isSellMission && Close[1] > Open[1]);
      if(missionAligned)
      {
         double s = 50.0;
         if(s > score) { score = s; outSetup = SETUP_MOMENTUM_CONT; }
      }
   }

   // Apply session quality bonus
   double sessionBonus = GetSessionQuality();
   score += sessionBonus;

   // Apply statistical learning bias
   if(outSetup != SETUP_NONE && g_setupCount[(int)outSetup] > 5)
   {
      double bias = g_setupBias[(int)outSetup];
      // Scale score by historical efficiency (50 = neutral, 100 = double, 0 = zero)
      score = score * (bias / 50.0);
   }

   // Remaining distance bonus: closer to horizon = slightly higher quality
   if(g_remainingDistance > 0 && g_missionProgress > 30)
      score += (g_missionProgress / 100.0) * 10.0;

   if(score > 100) score = 100;
   g_setupQuality = score;
   return score;
}

//--- Session quality: London/NY get bonus, Asian/Off get penalty ---
double GetSessionQuality()
{
   int hour = TimeHour(TimeCurrent());
   // London: 8-16 UTC, New York: 13-21 UTC (overlap 13-16)
   if(hour >= 13 && hour <= 16) return 10.0;  // London-NY overlap
   if(hour >= 8 && hour <= 16)  return 5.0;   // London
   if(hour >= 13 && hour <= 21) return 5.0;   // New York
   return -5.0;  // Asian / off-hours
}

string GetSessionName()
{
   int hour = TimeHour(TimeCurrent());
   if(hour >= 13 && hour <= 16) return "LDN-NY";
   if(hour >= 8 && hour <= 16)  return "London";
   if(hour >= 13 && hour <= 21) return "NewYork";
   if(hour >= 0 && hour <= 8)   return "Asian";
   return "Off";
}

//+------------------------------------------------------------------+
//| ═══════════════════════════════════════════════════════════════   |
//|              3. ADAPTIVE EXPOSURE ENGINE                         |
//| ═══════════════════════════════════════════════════════════════   |
//+------------------------------------------------------------------+

//--- Calculate total lot needed to achieve desired offset at horizon ---
double CalculateRequiredTotalLot()
{
   double currentPrice = (InpMissionDir == MISSION_SELL) ? Bid : Ask;
   double distToHorizon;

   if(InpMissionDir == MISSION_SELL)
      distToHorizon = (currentPrice - InpHedgeHorizon) / g_point;
   else
      distToHorizon = (InpHedgeHorizon - currentPrice) / g_point;

   if(distToHorizon <= 0 || g_pointValueUSD <= 0)
      return 0;

   // Account for existing realized + floating profit
   double existingValue = g_realizedProfitUSD + g_floatingProfitUSD;
   double needed = InpDesiredOffsetUSD - existingValue;
   if(needed <= 0) return 0; // already hedged enough

   double requiredLot = needed / (distToHorizon * g_pointValueUSD);

   // Subtract existing open position lots in mission direction
   double existingLots = 0;
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != g_symbol || OrderMagicNumber() != InpMagic) continue;
      int type = OrderType();
      if(InpMissionDir == MISSION_SELL && type == OP_SELL) existingLots += OrderLots();
      else if(InpMissionDir == MISSION_BUY && type == OP_BUY) existingLots += OrderLots();
   }

   requiredLot -= existingLots;
   if(requiredLot < 0) requiredLot = 0;

   // Safety cap
   if(requiredLot > InpMaxTotalExposure) requiredLot = InpMaxTotalExposure;

   return requiredLot;
}

//--- Build initial pending order ladder ---
void BuildInitialLadder()
{
   if(!InpMissionEnabled || InpHedgeHorizon <= 0) return;

   double totalLot = CalculateRequiredTotalLot();
   if(totalLot < InpMinLotPerOrder) return;

   double currentPrice = (InpMissionDir == MISSION_SELL) ? Bid : Ask;
   double totalDist = MathAbs(currentPrice - InpHedgeHorizon);

   int orderCount = InpMaxPendingOrders;
   if(totalLot < InpMinLotPerOrder * 3) orderCount = 1;

   if(orderCount > InpMaxPendingOrders) orderCount = InpMaxPendingOrders;
   g_ladderCount = orderCount;

   ArrayResize(g_ladderPrices, orderCount);
   ArrayResize(g_ladderLots, orderCount);
   ArrayResize(g_ladderTickets, orderCount);
   ArrayInitialize(g_ladderTickets, -1);

   DistributeLadder(totalLot, currentPrice, orderCount);
   PlaceLadderOrders();
}

//--- Build adaptive ladder accounting for existing positions ---
void BuildAdaptiveLadder(BasketData &basket)
{
   if(!InpMissionEnabled || InpHedgeHorizon <= 0) return;
   if(g_ladderPlaced) return;

   double totalLot = CalculateRequiredTotalLot();
   if(totalLot < InpMinLotPerOrder) return;

   double currentPrice = (InpMissionDir == MISSION_SELL) ? Bid : Ask;

   int orderCount = MathMin(InpMaxPendingOrders,
                            MathMax(1, (int)MathCeil(totalLot / InpMinLotPerOrder)));
   if(orderCount > InpMaxPendingOrders) orderCount = InpMaxPendingOrders;

   g_ladderCount = orderCount;
   ArrayResize(g_ladderPrices, orderCount);
   ArrayResize(g_ladderLots, orderCount);
   ArrayResize(g_ladderTickets, orderCount);
   ArrayInitialize(g_ladderTickets, -1);

   DistributeLadder(totalLot, currentPrice, orderCount);
   PlaceLadderOrders();
}

//--- Distribute lots across ladder using selected method ---
void DistributeLadder(double totalLot, double currentPrice, int orderCount)
{
   if(orderCount <= 0) return;

   // Calculate prices spread between fraction of distance
   double totalDist = MathAbs(currentPrice - InpHedgeHorizon);
   double startOffset = totalDist * InpLadderStartFraction;
   double endOffset   = totalDist * InpLadderEndFraction;

   for(int i = 0; i < orderCount; i++)
   {
      double fraction = (orderCount == 1) ? 0.5 :
                        (double)i / (double)(orderCount - 1);
      double offset = startOffset + fraction * (endOffset - startOffset);

      if(InpMissionDir == MISSION_SELL)
         g_ladderPrices[i] = currentPrice - offset;
      else
         g_ladderPrices[i] = currentPrice + offset;

      g_ladderPrices[i] = NormalizeDouble(g_ladderPrices[i], g_digits);
   }

   // Distribute lots using weight method
   double weights[];
   ArrayResize(weights, orderCount);
   double totalWeight = 0;

   for(int i = 0; i < orderCount; i++)
   {
      switch(InpLotMethod)
      {
         case LOT_FRONT_HEAVY: weights[i] = (double)(orderCount - i); break;
         case LOT_BACK_HEAVY:  weights[i] = (double)(i + 1); break;
         case LOT_EVEN:        weights[i] = 1.0; break;
         case LOT_SLOW_GRIND:  weights[i] = MathSqrt((double)(i + 1)); break;
      }
      totalWeight += weights[i];
   }

   g_totalLadderLots = 0;
   for(int i = 0; i < orderCount; i++)
   {
      double lot = (totalWeight > 0) ? totalLot * weights[i] / totalWeight : 0;
      lot = NormalizeLot(lot);
      if(lot > InpMaxLotPerOrder) lot = InpMaxLotPerOrder;
      if(lot < InpMinLotPerOrder) lot = InpMinLotPerOrder;
      g_ladderLots[i] = lot;
      g_totalLadderLots += lot;
   }
}

//--- Place pending orders for the ladder ---
void PlaceLadderOrders()
{
   int stopLevel = (int)MarketInfo(g_symbol, MODE_STOPLEVEL);
   double stopLevelPrice = stopLevel * g_point;
   int placed = 0;

   for(int i = 0; i < g_ladderCount; i++)
   {
      if(g_ladderLots[i] < InpMinLotPerOrder) continue;

      int orderType;
      double price = g_ladderPrices[i];
      string comment = InpComment + "_L" + IntegerToString(i + 1);

      if(InpMissionDir == MISSION_SELL)
      {
         orderType = OP_SELLSTOP;
         if(Bid - price < stopLevelPrice)
         {
            Print("[AMHE] Ladder #", i+1, " too close to market, skipping.");
            continue;
         }
      }
      else
      {
         orderType = OP_BUYSTOP;
         if(price - Ask < stopLevelPrice)
         {
            Print("[AMHE] Ladder #", i+1, " too close to market, skipping.");
            continue;
         }
      }

      int ticket = OrderSend(g_symbol, orderType, g_ladderLots[i], price,
                             InpSlippage, 0, 0, comment, InpMagic, 0, InpLadderColor);

      if(ticket > 0)
      {
         g_ladderTickets[i] = ticket;
         placed++;
         Print("[AMHE] Ladder order #", i+1, " placed. Ticket: ", ticket,
               " Lot: ", g_ladderLots[i], " @ ", DoubleToString(price, g_digits));
      }
      else
      {
         Print("[AMHE] Ladder order #", i+1, " FAILED. Error: ", GetLastError());
      }
   }

   if(placed > 0) g_ladderPlaced = true;
   Print("[AMHE] Ladder: ", placed, "/", g_ladderCount, " orders placed. Total lots: ",
         DoubleToString(g_totalLadderLots, 2));
}

//--- Recalculate ladder before pending orders activate ---
void RecalculateLadder(BasketData &basket)
{
   double newRequired = CalculateRequiredTotalLot();

   for(int i = 0; i < g_ladderCount; i++)
   {
      if(g_ladderTickets[i] <= 0) continue;
      if(!OrderSelect(g_ladderTickets[i], SELECT_BY_TICKET)) continue;
      if(OrderCloseTime() != 0) { g_ladderTickets[i] = -1; continue; }
      if(OrderType() == OP_BUY || OrderType() == OP_SELL)
      {
         // Already filled — no longer pending
         g_ladderTickets[i] = -1;
         continue;
      }

      // Check if this order's lot is still needed
      double existingPending = 0;
      for(int j = 0; j < g_ladderCount; j++)
      {
         if(j == i) continue;
         if(g_ladderTickets[j] <= 0) continue;
         if(!OrderSelect(g_ladderTickets[j], SELECT_BY_TICKET)) continue;
         if(OrderCloseTime() == 0 && (OrderType() == OP_BUYSTOP || OrderType() == OP_SELLSTOP))
            existingPending += OrderLots();
      }

      double existingOpen = 0;
      for(int k = 0; k < OrdersTotal(); k++)
      {
         if(!OrderSelect(k, SELECT_BY_POS, MODE_TRADES)) continue;
         if(OrderSymbol() != g_symbol || OrderMagicNumber() != InpMagic) continue;
         if(OrderType() == OP_BUY || OrderType() == OP_SELL)
            existingOpen += OrderLots();
      }

      double stillNeeded = newRequired - existingOpen - existingPending;
      if(stillNeeded <= 0)
      {
         // Cancel this order — no longer needed
         if(OrderSelect(g_ladderTickets[i], SELECT_BY_TICKET))
         {
            bool deleted = OrderDelete(g_ladderTickets[i]);
            if(deleted)
            {
               Print("[AMHE] Cancelled ladder #", i+1, " — exposure no longer needed.");
               g_ladderTickets[i] = -1;
            }
         }
      }
      else if(stillNeeded < g_ladderLots[i] * 0.7) // resize if significantly less needed
      {
         double newLot = NormalizeLot(stillNeeded);
         if(newLot >= InpMinLotPerOrder && newLot < g_ladderLots[i])
         {
            if(OrderSelect(g_ladderTickets[i], SELECT_BY_TICKET))
            {
               double price = OrderOpenPrice();
               int type = OrderType();
               bool deleted = OrderDelete(g_ladderTickets[i]);
               if(deleted)
               {
                  string comment = InpComment + "_L" + IntegerToString(i + 1) + "r";
                  int newTicket = OrderSend(g_symbol, type, newLot, price,
                                            InpSlippage, 0, 0, comment, InpMagic, 0, InpLadderColor);
                  if(newTicket > 0)
                  {
                     g_ladderTickets[i] = newTicket;
                     g_ladderLots[i] = newLot;
                     Print("[AMHE] Resized ladder #", i+1, " to ", DoubleToString(newLot, 2));
                  }
               }
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| ═══════════════════════════════════════════════════════════════   |
//|                   4. HARVEST ENGINE                              |
//| ═══════════════════════════════════════════════════════════════   |
//+------------------------------------------------------------------+
void RunHarvestEngine(BasketData &basket)
{
   // Count current harvest trades
   g_harvestOpenCount = 0;
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != g_symbol || OrderMagicNumber() != InpMagic) continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
      string cmt = OrderComment();
      if(StringFind(cmt, "_H") >= 0) g_harvestOpenCount++;
   }

   if(g_harvestOpenCount >= InpHarvestMaxOpen) return;

   // Cooldown check
   if(Bars - g_lastHarvestBar < InpHarvestCooldownBars) return;

   // Spread check
   if(!CheckSpread()) return;

   // Evaluate setup quality
   ENUM_HARVEST_SETUP setupType;
   double quality = EvaluateSetupQuality(setupType);

   if(quality < InpMinSetupQuality || setupType == SETUP_NONE) return;

   // Execute harvest trade
   int orderType;
   double price, sl, tp;
   color clr;

   if(InpMissionDir == MISSION_SELL)
   {
      orderType = OP_SELL;
      price = Bid;
      sl = price + InpHarvestSLPoints * g_point;
      tp = price - InpHarvestTPPoints * g_point;
      clr = InpHarvestColor;
   }
   else
   {
      orderType = OP_BUY;
      price = Ask;
      sl = price - InpHarvestSLPoints * g_point;
      tp = price + InpHarvestTPPoints * g_point;
      clr = InpHarvestColor;
   }

   string comment = InpComment + "_H" + IntegerToString((int)setupType);
   int ticket = OrderSend(g_symbol, orderType, InpHarvestLotSize, price,
                          InpSlippage, sl, tp, comment, InpMagic, 0, clr);

   if(ticket > 0)
   {
      g_lastHarvestBar = Bars;
      g_lastSetupType = setupType;
      Print("[AMHE] HARVEST trade opened. Setup: ", EnumToString(setupType),
            " Quality: ", DoubleToString(quality, 1),
            " Lot: ", DoubleToString(InpHarvestLotSize, 2),
            " @ ", DoubleToString(price, g_digits));

      // Log to stats
      if(InpStatLogEnabled) LogHarvestEntry(ticket, setupType, quality);
   }
   else
   {
      Print("[AMHE] Harvest trade FAILED. Error: ", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| ═══════════════════════════════════════════════════════════════   |
//|                 5. POSITION GOVERNANCE                           |
//| ═══════════════════════════════════════════════════════════════   |
//+------------------------------------------------------------------+

//--- Calculate basket data ---
bool CalculateBasketData(BasketData &basket)
{
   ZeroMemory(basket);
   basket.currentPrice = Bid;
   basket.pv = g_point;
   int tradeCount = 0;
   double totalBuyValue = 0, totalSellValue = 0;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != g_symbol) continue;
      if(OrderMagicNumber() != InpMagic) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;

      tradeCount++;
      double lot = OrderLots();
      double pl  = OrderProfit() + OrderSwap() + OrderCommission();
      double op  = OrderOpenPrice();

      if(type == OP_BUY)
      {
         basket.totalBuyLots += lot;
         totalBuyValue += lot * op;
         basket.totalBuyCount++;
      }
      else
      {
         basket.totalSellLots += lot;
         totalSellValue += lot * op;
         basket.totalSellCount++;
      }
      basket.totalProfit += pl;
   }

   if(tradeCount == 0) return false;

   if(basket.totalBuyLots > 0) basket.avgBuyPrice = totalBuyValue / basket.totalBuyLots;
   if(basket.totalSellLots > 0) basket.avgSellPrice = totalSellValue / basket.totalSellLots;
   basket.netLots = basket.totalBuyLots - basket.totalSellLots;
   basket.netBreakeven = CalcNetBreakeven(basket);
   basket.netPointsProfit = CalcNetPointsProfit(basket);

   return true;
}

double CalcNetBreakeven(BasketData &b)
{
   if(b.totalBuyLots == 0 && b.totalSellLots == 0) return 0;
   if(b.totalBuyLots == 0) return b.avgSellPrice;
   if(b.totalSellLots == 0) return b.avgBuyPrice;

   double num = (b.avgBuyPrice * b.totalBuyLots) - (b.avgSellPrice * b.totalSellLots);
   double den = b.totalBuyLots - b.totalSellLots;
   if(MathAbs(den) < 0.00001)
   {
      double total = b.totalBuyLots + b.totalSellLots;
      return (total > 0) ? (b.avgBuyPrice * b.totalBuyLots + b.avgSellPrice * b.totalSellLots) / total : 0;
   }
   return num / den;
}

double CalcNetPointsProfit(BasketData &b)
{
   if(b.pv <= 0) return 0;
   if(b.netLots > 0) return (b.currentPrice - b.netBreakeven) / b.pv;
   if(b.netLots < 0) return (b.netBreakeven - b.currentPrice) / b.pv;
   return 0;
}

//--- Trailing stop ---
void CheckTrailingStop(BasketData &basket)
{
   double pts = basket.netPointsProfit;
   if(pts > g_highestProfitPts)
   {
      g_highestProfitPts = pts;
      if(g_highestProfitPts >= InpTrailingStartPts)
      {
         double newStop = g_highestProfitPts - InpTrailingStepPts;
         if(newStop > 0)
         {
            if(basket.netLots > 0)
               g_trailingStopPrice = basket.netBreakeven + (newStop * basket.pv);
            else
               g_trailingStopPrice = basket.netBreakeven - (newStop * basket.pv);
         }
      }
   }

   if(g_trailingStopPrice > 0 && g_highestProfitPts >= InpTrailingStartPts)
   {
      bool hit = (basket.netLots > 0 && basket.currentPrice <= g_trailingStopPrice) ||
                 (basket.netLots < 0 && basket.currentPrice >= g_trailingStopPrice);
      if(hit)
      {
         Print("[AMHE] TRAILING STOP HIT!");
         if(CheckSpread()) CloseAllTradesFast();
      }
   }
}

//--- Automatic partial close ---
void CheckAutomaticPartialClose(BasketData &basket)
{
   if(g_partialCloseExecuted) return;
   if(basket.netPointsProfit >= InpPartialTriggerPts)
   {
      Print("[AMHE] AUTOMATIC PARTIAL CLOSE TRIGGERED at +",
            DoubleToString(basket.netPointsProfit, 1), " pts");
      ExecutePartialClose(InpPartialPercent);
   }
}

//--- Execute partial close (intelligent ordering) ---
void ExecutePartialClose(int percent)
{
   if(g_closingInProgress) return;
   g_closingInProgress = true;

   TradeOrder buyOrders[], sellOrders[];
   int buyCount = 0, sellCount = 0;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != g_symbol || OrderMagicNumber() != InpMagic) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;

      TradeOrder ord;
      ord.ticket   = OrderTicket();
      ord.lots     = OrderLots();
      ord.profit   = OrderProfit() + OrderSwap() + OrderCommission();
      ord.openPrice = OrderOpenPrice();
      ord.type     = type;
      ord.openTime = OrderOpenTime();
      ord.comment  = OrderComment();

      // Classify: legacy if old enough AND not a harvest trade, or if user wants preservation
      bool isHarv = (StringFind(ord.comment, "_H") >= 0);
      bool isLeg  = (!isHarv && (TimeCurrent() - ord.openTime) > InpLegacyAgeMinutes * 60);
      ord.isLegacy  = isLeg;
      ord.isHarvest = isHarv;

      if(type == OP_BUY)
      {
         ArrayResize(buyOrders, buyCount + 1);
         buyOrders[buyCount] = ord;
         buyCount++;
      }
      else
      {
         ArrayResize(sellOrders, sellCount + 1);
         sellOrders[sellCount] = ord;
         sellCount++;
      }
   }

   // Sort: if preserving legacy, put Working/Harvest trades first (they get closed first)
   if(InpPreserveLegacy)
   {
      SortWorkingFirst(buyOrders, buyCount);
      SortWorkingFirst(sellOrders, sellCount);
   }
   else if(InpCloseProfitFirst)
   {
      SortByProfitDesc(buyOrders, buyCount);
      SortByProfitDesc(sellOrders, sellCount);
   }

   double totalBuy = 0, totalSell = 0;
   for(int i = 0; i < buyCount; i++) totalBuy += buyOrders[i].lots;
   for(int i = 0; i < sellCount; i++) totalSell += sellOrders[i].lots;

   double buyReduce  = NormalizeDouble(totalBuy * percent / 100.0, 2);
   double sellReduce = NormalizeDouble(totalSell * percent / 100.0, 2);

   if(buyCount > 0 && buyReduce > 0.00001)
      DoPartialClose(buyOrders, buyCount, buyReduce);
   if(sellCount > 0 && sellReduce > 0.00001)
      DoPartialClose(sellOrders, sellCount, sellReduce);

   // Count remaining
   int remaining = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != g_symbol || OrderMagicNumber() != InpMagic) continue;
      if(OrderType() == OP_BUY || OrderType() == OP_SELL) remaining++;
   }

   if(remaining >= 1)
   {
      g_partialCloseExecuted = true;
      g_beLockActive = true;
      BasketData bk;
      if(CalculateBasketData(bk)) UpdateBreakevenLockPrice(bk);
      Print("[AMHE] Partial close complete. ", remaining, " trade(s) remaining. BE Lock active.");
   }
   else
   {
      g_partialCloseExecuted = false;
      g_beLockActive = false;
      g_beLockPrice = 0;
   }

   g_closingInProgress = false;
}

void DoPartialClose(TradeOrder &orders[], int count, double targetReduce)
{
   double remaining = targetReduce;
   for(int i = 0; i < count && remaining > 0.00001; i++)
   {
      if(!OrderSelect(orders[i].ticket, SELECT_BY_TICKET)) continue;
      if(OrderCloseTime() != 0) continue;

      double lot = orders[i].lots;
      double closeVol = (lot <= remaining + 0.00001) ? lot : remaining;

      double minVol = MarketInfo(g_symbol, MODE_MINLOT);
      double volStep = MarketInfo(g_symbol, MODE_LOTSTEP);
      if(volStep > 0) closeVol = MathFloor(closeVol / volStep) * volStep;
      if(closeVol < minVol) continue;

      RefreshRates();
      double closePrice = (OrderType() == OP_BUY) ? Bid : Ask;
      if(OrderClose(orders[i].ticket, closeVol, closePrice, InpSlippage))
      {
         remaining -= closeVol;
         // Track realized profit for harvest trades
         if(orders[i].isHarvest)
            g_harvestRealizedUSD += orders[i].profit * (closeVol / lot);
      }
      Sleep(10);
   }
}

//--- Sort working/harvest trades first (legacy trades last = preserved) ---
void SortWorkingFirst(TradeOrder &orders[], int count)
{
   for(int i = 0; i < count - 1; i++)
      for(int j = i + 1; j < count; j++)
         if(orders[j].isLegacy == false && orders[i].isLegacy == true)
         { TradeOrder t = orders[i]; orders[i] = orders[j]; orders[j] = t; }
}

void SortByProfitDesc(TradeOrder &orders[], int count)
{
   for(int i = 0; i < count - 1; i++)
      for(int j = i + 1; j < count; j++)
         if(orders[i].profit < orders[j].profit)
         { TradeOrder t = orders[i]; orders[i] = orders[j]; orders[j] = t; }
}

//--- Breakeven lock ---
void UpdateBreakevenLockPrice(BasketData &basket)
{
   if(!g_partialCloseExecuted) return;
   int total = basket.totalBuyCount + basket.totalSellCount;
   if(total < 1) return;

   double newLock = 0;
   if(basket.netLots > 0)
      newLock = basket.netBreakeven + (InpBELockPointsProfit * basket.pv);
   else if(basket.netLots < 0)
      newLock = basket.netBreakeven - (InpBELockPointsProfit * basket.pv);

   if(MathAbs(newLock - g_beLockPrice) > basket.pv * 0.5 || g_beLockPrice == 0)
   {
      g_beLockPrice = newLock;
      g_beLockActive = true;
   }
}

void CheckBreakevenLockHit(BasketData &basket)
{
   if(!g_beLockActive || g_beLockPrice <= 0) return;

   bool hit = (basket.netLots > 0 && basket.currentPrice <= g_beLockPrice) ||
              (basket.netLots < 0 && basket.currentPrice >= g_beLockPrice);

   if(hit)
   {
      Print("[AMHE] BREAKEVEN LOCK HIT! Closing all trades.");
      if(CheckSpread()) CloseAllTradesFast();
   }
}

//--- Close all trades ---
void CloseAllTradesFast()
{
   if(g_closingInProgress) return;
   g_closingInProgress = true;
   int closed = 0, failed = 0;

   for(int attempt = 0; attempt <= InpRetryAttempts; attempt++)
   {
      if(attempt > 0) Sleep(50);
      for(int i = OrdersTotal() - 1; i >= 0; i--)
      {
         if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
         if(OrderSymbol() != g_symbol || OrderMagicNumber() != InpMagic) continue;
         int type = OrderType();

         if(type == OP_BUYSTOP || type == OP_SELLSTOP ||
            type == OP_BUYLIMIT || type == OP_SELLLIMIT)
         {
            if(OrderDelete(OrderTicket())) closed++;
            continue;
         }

         if(type != OP_BUY && type != OP_SELL) continue;
         if(OrderCloseTime() != 0) continue;

         RefreshRates();
         double cp = (type == OP_BUY) ? Bid : Ask;
         if(OrderClose(OrderTicket(), OrderLots(), cp, InpSlippage))
            closed++;
         else
            failed++;
      }
      if(failed == 0) break;
      failed = 0;
   }

   ResetState();
   g_closingInProgress = false;
   Print("[AMHE] All trades closed. Count: ", closed);
}

//--- Reset state ---
void ResetState()
{
   g_breakevenPrice = 0;
   g_targetPrice = 0;
   g_trailingStopPrice = 0;
   g_partialTriggerPrice = 0;
   g_beLockPrice = 0;
   g_highestProfitPts = 0;
   g_averagingActivated = false;
   g_partialCloseExecuted = false;
   g_beLockActive = false;
   g_ladderPlaced = false;
   g_ladderCount = 0;
   DeleteAllObjects();
   if(InpMissionEnabled) CreateMissionVisuals();
   CreateManualPartialClosePanel();
}

//--- Spread check ---
bool CheckSpread()
{
   double spread = (Ask - Bid) / g_point;
   if(InpMaxSpread > 0 && spread > InpMaxSpread) return false;
   return true;
}

//--- Normalize lot ---
double NormalizeLot(double lot)
{
   double minL = MarketInfo(g_symbol, MODE_MINLOT);
   double maxL = MarketInfo(g_symbol, MODE_MAXLOT);
   double step = MarketInfo(g_symbol, MODE_LOTSTEP);
   lot = MathMax(minL, MathMin(maxL, lot));
   if(step > 0) lot = MathRound(lot / step) * step;
   return lot;
}

//+------------------------------------------------------------------+
//| ═══════════════════════════════════════════════════════════════   |
//|                 6. VISUAL ENGINE                                 |
//| ═══════════════════════════════════════════════════════════════   |
//+------------------------------------------------------------------+

void CreateMissionVisuals()
{
   if(InpShowHorizonLine && InpHedgeHorizon > 0)
   {
      string name = PREFIX + "HorizonLine";
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, InpHedgeHorizon);
      ObjectSetInteger(0, name, OBJPROP_COLOR, InpHorizonColor);
      ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_DASHDOT);
      ObjectSetInteger(0, name, OBJPROP_WIDTH, InpLineWidth);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, true);
      ObjectSetInteger(0, name, OBJPROP_BACK, false);

      string label = PREFIX + "HorizonLabel";
      ObjectCreate(0, label, OBJ_TEXT, 0, TimeCurrent(), InpHedgeHorizon);
      ObjectSetString(0, label, OBJPROP_TEXT,
         StringFormat("══ HEDGE HORIZON %s | Kalshi Danger Level ══",
                      DoubleToString(InpHedgeHorizon, g_digits)));
      ObjectSetInteger(0, label, OBJPROP_COLOR, InpHorizonColor);
      ObjectSetInteger(0, label, OBJPROP_FONTSIZE, 11);
      ObjectSetString(0, label, OBJPROP_FONT, "Arial Bold");
   }
}

void RenderAllLines(BasketData &basket)
{
   int total = basket.totalBuyCount + basket.totalSellCount;
   bool hasNet = (MathAbs(basket.netLots) > 0.00001);
   bool multi = (total >= 2);

   // Breakeven line
   if(g_averagingActivated && multi && hasNet && InpShowBreakevenLine && g_breakevenPrice > 0)
   {
      SetHLine(PREFIX + "BELine", g_breakevenPrice, InpBreakevenColor, STYLE_SOLID, InpLineWidth);
      SetTextLabel(PREFIX + "BELabel", g_breakevenPrice,
         StringFormat("══ BASKET BREAKEVEN @ %s ══", DoubleToString(g_breakevenPrice, g_digits)),
         InpBreakevenColor);
   }
   else
   {
      ObjectDelete(0, PREFIX + "BELine");
      ObjectDelete(0, PREFIX + "BELabel");
   }

   // Target line
   if(g_averagingActivated && multi && hasNet && InpShowTargetLine)
   {
      double tp = (basket.netLots > 0) ?
         g_breakevenPrice + InpAveragingPoints * basket.pv :
         g_breakevenPrice - InpAveragingPoints * basket.pv;
      if(tp > 0)
      {
         g_targetPrice = tp;
         SetHLine(PREFIX + "TPLine", tp, InpTargetColor, STYLE_SOLID, InpLineWidth);
         SetTextLabel(PREFIX + "TPLabel", tp,
            StringFormat("*** BASKET TP @ %s (+%.0f pts) ***", DoubleToString(tp, g_digits), InpAveragingPoints),
            InpTargetColor);
      }
   }
   else
   {
      ObjectDelete(0, PREFIX + "TPLine");
      ObjectDelete(0, PREFIX + "TPLabel");
   }

   // Partial close trigger
   if(InpEnablePartialClose && !g_partialCloseExecuted && multi && hasNet)
   {
      double pcPrice = (basket.netLots > 0) ?
         basket.netBreakeven + InpPartialTriggerPts * basket.pv :
         basket.netBreakeven - InpPartialTriggerPts * basket.pv;
      if(pcPrice > 0)
      {
         SetHLine(PREFIX + "PCTrigger", pcPrice, InpPartialTrigColor, STYLE_DASHDOT, 1);
         SetTextLabel(PREFIX + "PCLabel", pcPrice,
            StringFormat("@ PARTIAL CLOSE TRIGGER +%.0f pts @", InpPartialTriggerPts),
            InpPartialTrigColor);
      }
   }
   else
   {
      ObjectDelete(0, PREFIX + "PCTrigger");
      ObjectDelete(0, PREFIX + "PCLabel");
   }

   // Trailing stop
   if(InpEnableTrailing && g_trailingStopPrice > 0 && multi && hasNet)
   {
      SetHLine(PREFIX + "TrailLine", g_trailingStopPrice, InpTrailingColor, STYLE_DASH, 1);
      SetTextLabel(PREFIX + "TrailLabel", g_trailingStopPrice,
         StringFormat("--- TRAILING STOP @ %s ---", DoubleToString(g_trailingStopPrice, g_digits)),
         InpTrailingColor);
   }
   else
   {
      ObjectDelete(0, PREFIX + "TrailLine");
      ObjectDelete(0, PREFIX + "TrailLabel");
   }

   // Breakeven lock
   if(g_partialCloseExecuted && g_beLockActive && g_beLockPrice > 0 && total >= 1)
   {
      SetHLine(PREFIX + "BELock", g_beLockPrice, InpBELockColor, STYLE_SOLID, InpLineWidth);
      SetTextLabel(PREFIX + "BELockLabel", g_beLockPrice,
         StringFormat("══ BE LOCK @ %s (+%.0f pts locked) ══",
                      DoubleToString(g_beLockPrice, g_digits), InpBELockPointsProfit),
         InpBELockColor);
   }
   else
   {
      ObjectDelete(0, PREFIX + "BELock");
      ObjectDelete(0, PREFIX + "BELockLabel");
   }
}

void SetHLine(string name, double price, color clr, int style, int width)
{
   if(ObjectFind(0, name) < 0)
   {
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, name, OBJPROP_BACK, false);
   }
   ObjectSetDouble(0, name, OBJPROP_PRICE, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_STYLE, style);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, width);
}

void SetTextLabel(string name, double price, string text, color clr)
{
   datetime t = TimeCurrent() - 2 * PeriodSeconds(PERIOD_CURRENT);
   if(ObjectFind(0, name) < 0)
   {
      ObjectCreate(0, name, OBJ_TEXT, 0, t, price);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   }
   ObjectMove(0, name, 0, t, price);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 10);
   ObjectSetString(0, name, OBJPROP_FONT, "Arial Bold");
}

//--- Mission info panel ---
void UpdateMissionPanel(BasketData &basket)
{
   if(!InpShowMissionPanel) return;

   int x = 10, y = 10, rowH = 16, pad = 6, width = 340;
   string bgName = PREFIX + "MissionBg";

   string rows[20];
   color  clrs[20];
   int rowCount = 0;

   string dirStr = (InpMissionDir == MISSION_SELL) ? "SELL" : "BUY";
   double currentPrice = (InpMissionDir == MISSION_SELL) ? Bid : Ask;

   rows[rowCount] = "ADAPTIVE MISSION HEDGE ENGINE"; clrs[rowCount] = clrGold; rowCount++;
   rows[rowCount] = StringFormat("Mission: %s to %s | Progress: %.1f%%",
      dirStr, DoubleToString(InpHedgeHorizon, g_digits), g_missionProgress);
   clrs[rowCount] = clrWhite; rowCount++;
   rows[rowCount] = StringFormat("Remaining: %.0f pts | Desired: $%.2f",
      g_remainingDistance, InpDesiredOffsetUSD);
   clrs[rowCount] = clrSilver; rowCount++;

   if(g_remainingTimeSec > 0)
   {
      int hrs = g_remainingTimeSec / 3600;
      int mins = (g_remainingTimeSec % 3600) / 60;
      rows[rowCount] = StringFormat("Time left: %dh %dm", hrs, mins);
   }
   else
      rows[rowCount] = "Time left: No expiry";
   clrs[rowCount] = clrSilver; rowCount++;

   rows[rowCount] = StringFormat("Floating: $%.2f | Projected@Horizon: $%.2f",
      g_floatingProfitUSD, g_projectedAtHorizon);
   clrs[rowCount] = (g_floatingProfitUSD >= 0) ? clrLime : clrSalmon; rowCount++;

   rows[rowCount] = StringFormat("Harvest Realized: $%.2f | Open: %d",
      g_harvestRealizedUSD, g_harvestOpenCount);
   clrs[rowCount] = clrCyan; rowCount++;

   rows[rowCount] = StringFormat("Setup Quality: %.0f | Type: %s | Session: %s",
      g_setupQuality, EnumToString(g_lastSetupType), GetSessionName());
   clrs[rowCount] = (g_setupQuality >= InpMinSetupQuality) ? clrLime : clrGray; rowCount++;

   int total = basket.totalBuyCount + basket.totalSellCount;
   rows[rowCount] = StringFormat("Basket: %d trades | Net %.2f lots | P/L $%.2f",
      total, basket.netLots, basket.totalProfit);
   clrs[rowCount] = clrWhite; rowCount++;

   string lockStr = g_beLockActive ? DoubleToString(g_beLockPrice, g_digits) : "—";
   rows[rowCount] = StringFormat("Avg:%s Trailing:%s Lock:%s",
      g_averagingActivated ? "ON" : "—",
      (g_trailingStopPrice > 0) ? DoubleToString(g_trailingStopPrice, g_digits) : "—",
      lockStr);
   clrs[rowCount] = clrSilver; rowCount++;

   int totalH = pad * 2 + rowCount * rowH;

   if(ObjectFind(0, bgName) < 0)
   {
      ObjectCreate(0, bgName, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, bgName, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
      ObjectSetInteger(0, bgName, OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, bgName, OBJPROP_YDISTANCE, y);
      ObjectSetInteger(0, bgName, OBJPROP_BGCOLOR, C'10,10,20');
      ObjectSetInteger(0, bgName, OBJPROP_BORDER_COLOR, clrGold);
      ObjectSetInteger(0, bgName, OBJPROP_BACK, false);
      ObjectSetInteger(0, bgName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, bgName, OBJPROP_HIDDEN, true);
   }
   ObjectSetInteger(0, bgName, OBJPROP_XSIZE, width);
   ObjectSetInteger(0, bgName, OBJPROP_YSIZE, totalH);

   for(int i = 0; i < rowCount; i++)
   {
      string rName = PREFIX + "MRow" + IntegerToString(i);
      if(ObjectFind(0, rName) < 0)
      {
         ObjectCreate(0, rName, OBJ_LABEL, 0, 0, 0);
         ObjectSetInteger(0, rName, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
         ObjectSetInteger(0, rName, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, rName, OBJPROP_HIDDEN, true);
      }
      ObjectSetInteger(0, rName, OBJPROP_XDISTANCE, x + pad);
      ObjectSetInteger(0, rName, OBJPROP_YDISTANCE, y + pad + i * rowH);
      ObjectSetInteger(0, rName, OBJPROP_COLOR, clrs[i]);
      ObjectSetInteger(0, rName, OBJPROP_FONTSIZE, (i == 0) ? 10 : 9);
      ObjectSetString(0, rName, OBJPROP_FONT, (i == 0) ? "Arial Bold" : "Consolas");
      ObjectSetString(0, rName, OBJPROP_TEXT, rows[i]);
   }
}

//--- Manual partial close panel ---
void CreateManualPartialClosePanel()
{
   int x = 10, y = 200;
   string panelBg  = PREFIX + "ManualPCBg";
   string editName = PREFIX + "ManualPCEdit";
   string btnName  = PREFIX + "ManualPCBtn";
   string lblName  = PREFIX + "ManualPCLbl";

   ObjectCreate(0, panelBg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, panelBg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, panelBg, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, panelBg, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, panelBg, OBJPROP_XSIZE, 180);
   ObjectSetInteger(0, panelBg, OBJPROP_YSIZE, 80);
   ObjectSetInteger(0, panelBg, OBJPROP_BGCOLOR, C'10,10,15');
   ObjectSetInteger(0, panelBg, OBJPROP_BORDER_COLOR, clrGray);
   ObjectSetInteger(0, panelBg, OBJPROP_BACK, true);
   ObjectSetInteger(0, panelBg, OBJPROP_SELECTABLE, false);

   ObjectCreate(0, lblName, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, lblName, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lblName, OBJPROP_XDISTANCE, x + 10);
   ObjectSetInteger(0, lblName, OBJPROP_YDISTANCE, y + 5);
   ObjectSetString(0, lblName, OBJPROP_TEXT, "MANUAL PARTIAL CLOSE");
   ObjectSetInteger(0, lblName, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, lblName, OBJPROP_FONTSIZE, 9);
   ObjectSetString(0, lblName, OBJPROP_FONT, "Arial Bold");
   ObjectSetInteger(0, lblName, OBJPROP_SELECTABLE, false);

   ObjectCreate(0, editName, OBJ_EDIT, 0, 0, 0);
   ObjectSetInteger(0, editName, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, editName, OBJPROP_XDISTANCE, x + 10);
   ObjectSetInteger(0, editName, OBJPROP_YDISTANCE, y + 25);
   ObjectSetInteger(0, editName, OBJPROP_XSIZE, 60);
   ObjectSetInteger(0, editName, OBJPROP_YSIZE, 20);
   ObjectSetString(0, editName, OBJPROP_TEXT, "50");
   ObjectSetInteger(0, editName, OBJPROP_COLOR, clrBlack);
   ObjectSetInteger(0, editName, OBJPROP_BGCOLOR, clrWhite);
   ObjectSetInteger(0, editName, OBJPROP_FONTSIZE, 10);

   ObjectCreate(0, btnName, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, btnName, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, btnName, OBJPROP_XDISTANCE, x + 10);
   ObjectSetInteger(0, btnName, OBJPROP_YDISTANCE, y + 50);
   ObjectSetInteger(0, btnName, OBJPROP_XSIZE, 160);
   ObjectSetInteger(0, btnName, OBJPROP_YSIZE, 25);
   ObjectSetString(0, btnName, OBJPROP_TEXT, "CLOSE % OF BASKET");
   ObjectSetInteger(0, btnName, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, btnName, OBJPROP_BGCOLOR, clrDarkGreen);
   ObjectSetInteger(0, btnName, OBJPROP_FONTSIZE, 10);
   ObjectSetString(0, btnName, OBJPROP_FONT, "Arial Bold");
   ObjectSetInteger(0, btnName, OBJPROP_SELECTABLE, false);
}

//--- Delete all objects ---
void DeleteAllObjects()
{
   for(int i = ObjectsTotal() - 1; i >= 0; i--)
   {
      string name = ObjectName(i);
      if(StringFind(name, PREFIX) == 0 || StringFind(name, BMM_PREFIX) == 0)
         ObjectDelete(0, name);
   }
}

//+------------------------------------------------------------------+
//| ═══════════════════════════════════════════════════════════════   |
//|              7. MILESTONE MONITOR (BMM)                          |
//| ═══════════════════════════════════════════════════════════════   |
//+------------------------------------------------------------------+
void BMM_Init()
{
   g_bmm_mileCount = 0;
   if(InpBMMMile50) BMM_AddMilestone(50.0, "50%");
   if(InpBMMMile75) BMM_AddMilestone(75.0, "75%");
   if(InpBMMMile90) BMM_AddMilestone(90.0, "90%");
   if(InpBMMMile99) BMM_AddMilestone(99.0, "99%");

   for(int i = 0; i < g_bmm_mileCount - 1; i++)
      for(int j = i + 1; j < g_bmm_mileCount; j++)
         if(g_bmm_milePercent[j] < g_bmm_milePercent[i])
         {
            double tp = g_bmm_milePercent[i]; g_bmm_milePercent[i] = g_bmm_milePercent[j]; g_bmm_milePercent[j] = tp;
            string tl = g_bmm_mileLabel[i]; g_bmm_mileLabel[i] = g_bmm_mileLabel[j]; g_bmm_mileLabel[j] = tl;
            bool te = g_bmm_mileEnabled[i]; g_bmm_mileEnabled[i] = g_bmm_mileEnabled[j]; g_bmm_mileEnabled[j] = te;
         }

   g_bmm_lastUpdate = 0;
   g_bmm_hadOpenOrders = false;
   Print("[BMM] Milestone Monitor initialized. Goal=$", DoubleToString(InpBMMGoalUSD, 2));
}

void BMM_AddMilestone(double pct, string label)
{
   if(g_bmm_mileCount >= MAX_MILESTONES) return;
   g_bmm_milePercent[g_bmm_mileCount] = pct;
   g_bmm_mileLabel[g_bmm_mileCount] = label;
   g_bmm_mileEnabled[g_bmm_mileCount] = true;
   g_bmm_mileTriggered[g_bmm_mileCount] = false;
   g_bmm_mileCount++;
}

void BMM_Deinit()
{
   for(int i = ObjectsTotal() - 1; i >= 0; i--)
   {
      string n = ObjectName(i);
      if(StringFind(n, BMM_PREFIX) == 0) ObjectDelete(0, n);
   }
}

void BMM_OnTick()
{
   if(!InpBMMEnable) return;
   uint now = GetTickCount();
   if(g_bmm_lastUpdate != 0 && (now - g_bmm_lastUpdate) < (uint)InpBMMUpdateMs) return;
   g_bmm_lastUpdate = now;

   BMM_UpdateBasketData();

   if(g_bmm_openOrders == 0 && g_bmm_hadOpenOrders)
   {
      for(int i = 0; i < g_bmm_mileCount; i++) g_bmm_mileTriggered[i] = false;
      g_bmm_hadOpenOrders = false;
   }
   if(g_bmm_openOrders > 0) g_bmm_hadOpenOrders = true;

   if(g_bmm_openOrders == 0 || g_bmm_totalLots == 0) return;

   BMM_ComputeProgress();
   BMM_CheckMilestones();
}

void BMM_UpdateBasketData()
{
   g_bmm_basketProfit = 0; g_bmm_totalLots = 0; g_bmm_openOrders = 0;
   g_bmm_avgEntry = 0; g_bmm_basketDir = 0; g_bmm_currentPrice = 0;
   double buyL = 0, sellL = 0, buyH = 0, sellH = 0;

   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != g_symbol || OrderMagicNumber() != InpMagic) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      double lot = OrderLots();
      double pl = OrderProfit() + OrderSwap() + OrderCommission();
      double op = OrderOpenPrice();
      g_bmm_basketProfit += pl;
      g_bmm_openOrders++;
      if(type == OP_BUY) { buyL += lot; buyH += lot * op; }
      else               { sellL += lot; sellH += lot * op; }
   }

   g_bmm_totalLots = buyL - sellL;
   if(g_bmm_totalLots > 0)
   { g_bmm_basketDir = 1; g_bmm_avgEntry = (sellL > 0) ? (buyH - sellH) / g_bmm_totalLots : buyH / buyL; g_bmm_currentPrice = Bid; }
   else if(g_bmm_totalLots < 0)
   { g_bmm_basketDir = -1; g_bmm_avgEntry = (buyL > 0) ? (buyH - sellH) / g_bmm_totalLots : sellH / sellL; g_bmm_currentPrice = Ask; }
}

void BMM_ComputeProgress()
{
   double goal = (InpBMMGoalUSD > 0) ? InpBMMGoalUSD : 1.0;
   g_bmm_pctComplete = (g_bmm_basketProfit / goal) * 100.0;
   g_bmm_remainingUSD = goal - g_bmm_basketProfit;
   if(g_bmm_totalLots != 0 && g_tickValue > 0 && g_point > 0)
   {
      g_bmm_targetPrice = g_bmm_avgEntry + (goal * g_point) / (g_tickValue * g_bmm_totalLots);
      g_bmm_targetPrice = NormalizeDouble(g_bmm_targetPrice, g_digits);
   }
}

void BMM_CheckMilestones()
{
   for(int i = 0; i < g_bmm_mileCount; i++)
   {
      if(!g_bmm_mileEnabled[i] || g_bmm_mileTriggered[i]) continue;
      if(g_bmm_pctComplete >= g_bmm_milePercent[i])
      {
         g_bmm_mileTriggered[i] = true;
         BMM_FireMilestone(i);
      }
   }
}

void BMM_FireMilestone(int idx)
{
   string label = g_bmm_mileLabel[idx];
   string msg = StringFormat("[AMHE BMM] %s MILESTONE | Profit: $%.2f / $%.2f | %.1f%%",
      label, g_bmm_basketProfit, InpBMMGoalUSD, g_bmm_pctComplete);
   Print(msg);

   if(InpBMMAlert) Alert(msg);
   if(InpBMMPush)  SendNotification(msg);
   if(InpBMMEmail) SendMail("[AMHE] " + label + " Milestone", msg);
   if(InpBMMSound && InpBMMSoundFile != "") PlaySound(InpBMMSoundFile);

   if(InpBMMScreenshot)
   {
      string dateStr = TimeToString(TimeCurrent(), TIME_DATE);
      StringReplace(dateStr, ".", "-");
      string safeLbl = label;
      StringReplace(safeLbl, "%", "pct");
      string folder = InpBMMScreenFolder + "\\" + dateStr;
      FolderCreate(InpBMMScreenFolder);
      FolderCreate(folder);
      string file = folder + "\\" + safeLbl + ".png";
      WindowScreenShot(file, 1280, 720, -1, -1);
   }
}

//+------------------------------------------------------------------+
//| ═══════════════════════════════════════════════════════════════   |
//|              8. STATISTICAL LEARNING                             |
//| ═══════════════════════════════════════════════════════════════   |
//+------------------------------------------------------------------+

void LogHarvestEntry(int ticket, ENUM_HARVEST_SETUP setup, double quality)
{
   if(!InpStatLogEnabled) return;

   string dateStr = TimeToString(TimeCurrent(), TIME_DATE);
   StringReplace(dateStr, ".", "-");
   FolderCreate(InpStatLogFolder);

   string fileName = InpStatLogFolder + "\\" + dateStr + "_harvest.csv";
   int handle = FileOpen(fileName, FILE_WRITE | FILE_READ | FILE_CSV | FILE_ANSI, ',');
   if(handle == INVALID_HANDLE) return;

   // If new file, write header
   if(FileSize(handle) == 0)
   {
      FileWrite(handle,
         "Time", "Ticket", "Setup", "Session", "Quality",
         "Lot", "Entry", "Direction", "ATR", "FVG_Count");
   }

   FileSeek(handle, 0, SEEK_END);
   FileWrite(handle,
      TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS),
      IntegerToString(ticket),
      EnumToString(setup),
      GetSessionName(),
      DoubleToString(quality, 1),
      DoubleToString(InpHarvestLotSize, 2),
      DoubleToString((InpMissionDir == MISSION_SELL) ? Bid : Ask, g_digits),
      (InpMissionDir == MISSION_SELL) ? "SELL" : "BUY",
      DoubleToString(g_currentATR, g_digits),
      IntegerToString(g_fvgCount));

   FileClose(handle);
}

void LogHarvestExit(int ticket, ENUM_HARVEST_SETUP setup, double realized,
                    double mfe, double mae, double drawdown)
{
   if(!InpStatLogEnabled) return;

   // Update setup bias based on mission efficiency
   double efficiency = 50.0;
   if(realized > 0 && drawdown > 0)
      efficiency = MathMin(100.0, (realized / drawdown) * 50.0);
   else if(realized > 0)
      efficiency = 80.0;
   else
      efficiency = 20.0;

   int idx = (int)setup;
   if(idx >= 0 && idx < 10)
   {
      g_setupCount[idx]++;
      // Exponential moving average of efficiency
      double alpha = 2.0 / (g_setupCount[idx] + 1.0);
      g_setupBias[idx] = g_setupBias[idx] * (1.0 - alpha) + efficiency * alpha;
   }
}
//+------------------------------------------------------------------+
