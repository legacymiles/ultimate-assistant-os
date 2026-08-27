//+------------------------------------------------------------------+
//|                                       VisualBasketProfitEngine   |
//|                                        XAUUSD Position & Profit  |
//|                                  Copyright 2026, AlphaForge      |
//|                                  Multi-Order Spread Version 3.00|
//+------------------------------------------------------------------+
#property copyright "Copyright 2026, AlphaForge"
#property link      "https://www.alphaforge.com"
#property version   "3.00"
#property strict

// Full source preserved — see original VisualBasketProfitEngine.mq4
// This is the multi-order spread calculator + milestone monitor
// that forms the foundation of the AMHE's Adaptive Exposure Engine
// and Milestone Monitor (BMM).
//
// Key contributions to AMHE:
//   - Multi-order lot distribution (Front Heavy / Back Heavy / Even / Slow Grind)
//   - Spread-corrected lot math (inflated lots for pending orders closer to TP)
//   - Basket statistics (first-order loss, all-filled loss, break-even, projected P/L)
//   - Collapsible orders report panel
//   - Milestone monitor with screenshots, push, email, sound alerts
//   - On-chart visuals (draggable lines, rectangles, banners)
