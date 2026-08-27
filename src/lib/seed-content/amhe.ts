import type { Feature, KnowledgeEntry, Version } from "../types";
import { uid, nowIso } from "../utils";

// ---------------------------------------------------------------------------
// Rich seed content for the Adaptive Mission Hedge Engine project.
// Provides a fully populated project with detailed writeup, features,
// versions (with downloadable .mq4 files), and knowledge inbox entries.
// ---------------------------------------------------------------------------

const PROJECT_ID_PLACEHOLDER = "__AMHE_PROJECT_ID__";

export function amheDetailed(): string {
  return `The Adaptive Mission Hedge Engine (AMHE) is a combined Kalshi + MT4 risk management system. It is NOT a traditional trading bot — it is a hedge manager that protects a separate Kalshi prediction-market position.

## The Combined Strategy

The strategy begins with a Kalshi contract — for example, "Gold will stay ABOVE 3977 at expiration." The position risks $250 for a small profit, relying on probability (Gold is already well above 3977). The risk is the rare event: if Gold unexpectedly falls below 3977, the Kalshi position loses the full $250.

The MT4 account exists solely to hedge against that rare event. It trades in the direction that would cause the Kalshi position to lose (SELL in this example), gradually building a hedge that attempts to offset the Kalshi loss if the unlikely scenario unfolds.

## The Five Engines

### 1. Mission Engine
Defines the destination — never trades. Maintains mission direction, hedge horizon (the Kalshi danger price), desired offset in USD, expiry time, and continuously tracks remaining distance, remaining time, and mission progress percentage.

### 2. Market Context Engine
The intelligence layer. Continuously evaluates market structure using heuristic detection: swing highs/lows via fractal logic, 3-bar Fair Value Gaps (fill, retest, breakout states), liquidity sweeps (wick-beyond-swing patterns), pullback continuations, breakout retests, and momentum quality. Each structure gets a quality score (0-100) weighted by session quality (London-NY overlap gets the highest bonus) and statistical learning bias. The engine rates opportunity — it never predicts direction.

### 3. Adaptive Exposure Engine
The core innovation. Maintains a pending-order ladder spread from the current price toward the hedge horizon. Before any pending order activates, the engine recalculates required exposure based on realized profit, floating P/L, existing positions, remaining distance, and projected profit at horizon. Orders are resized, delayed, or cancelled so exposure stays minimal but still satisfies the desired offset if the horizon is eventually reached. Supports four lot distribution methods: Front Heavy, Back Heavy, Even, and Slow Grind (sqrt scaling).

### 4. Harvest Engine
Opens small Working positions when the Market Context Engine rates a structure as high-quality in the mission direction. These opportunistic trades have their own TP/SL, a cooldown between entries, and a cap on simultaneous open harvests. Their purpose is to generate realized profit that finances the hedge — letting favorable market movement pay for as much of the hedge as possible.

### 5. Recovery Engine
After every completed harvest cycle, the engine waits for a fresh valid market structure before re-entering. It never blindly re-enters. Cooldown is measured in bars, ensuring the market has time to develop a new setup.

## Position Governance

### Legacy vs Working Positions
Older positions with better entry prices become Legacy Positions — they provide greater hedge value if the market continues toward the horizon. The EA preserves Legacy positions during partial closes and harvests Working positions first.

### Basket Management
- **Drawdown-activated averaging** with configurable target in points
- **Basket trailing stop** with start threshold and step size
- **Automatic partial close** triggered at a NET basket profit threshold, with intelligent ordering (most profitable first, or Working-before-Legacy)
- **Breakeven lock line** that activates after partial close with 1+ remaining trades, protecting locked-in profit
- **Manual partial close panel** on-chart for discretionary intervention

## Milestone Monitor (BMM)
Tracks basket profit progress toward a configurable USD goal. Fires one-shot milestone alerts at 50%, 75%, 90%, 99% (configurable). Supports terminal popups, push notifications, email, sound alerts, and auto-screenshots saved to date-organized folders.

## Statistical Learning
Every harvest trade is logged to CSV with setup type, session, quality score, ATR, FVG count. On exit, the engine records realized profit, max favorable/adverse excursion, drawdown, and calculates Mission Efficiency — a composite score measuring execution quality rather than raw profit. Over time, the efficiency bias (exponential moving average) influences which setup types the engine prefers, keeping the system fully explainable and transparent.

## What This Is NOT
- Not a grid EA, not a martingale, not an averaging EA, not a basket trading EA
- Not an independent signal trader — the market opinion lives on Kalshi
- Not a guarantee of profit — the heuristic structure detection and adaptive exposure engines need demo forward-testing before live use

## Risk Disclaimer
Trading involves substantial risk of loss. This EA is a tool — not financial advice. Always test on a demo account first. Past performance is not indicative of future results.`;
}

export function amheFeatures(projectId: string): Feature[] {
  const ts = nowIso();
  const core: { title: string; description: string }[] = [
    {
      title: "Mission Engine",
      description:
        "Defines the hedge destination: direction, hedge horizon (Kalshi danger price), desired offset USD, expiry. Tracks remaining distance, time, and progress percentage. Never trades — only defines the mission.",
    },
    {
      title: "Market Context Engine",
      description:
        "Heuristic structure detection: swing highs/lows (fractals), 3-bar FVGs with fill/retest/breakout states, liquidity sweeps, pullback continuations, breakout retests, momentum quality. Rates setup quality 0-100 with session and statistical bias.",
    },
    {
      title: "Adaptive Exposure Engine",
      description:
        "Pending-order ladder from current price toward hedge horizon. Recalculates required exposure before any order activates — resizes, delays, or cancels based on realized + floating P/L, existing positions, remaining distance. Four lot methods: Front Heavy, Back Heavy, Even, Slow Grind.",
    },
    {
      title: "Harvest Engine",
      description:
        "Opens small Working positions on high-quality structures in mission direction. Own TP/SL, cooldown between entries, cap on simultaneous harvests. Generates realized profit to finance the hedge.",
    },
    {
      title: "Recovery Engine",
      description:
        "Waits for a fresh valid market structure after every completed harvest cycle. Never blindly re-enters. Cooldown measured in bars.",
    },
    {
      title: "Position Governance — Legacy vs Working",
      description:
        "Classifies positions by age and entry quality. Legacy positions (older, better entry) are preserved during partial closes. Working/Harvest positions are expendable — harvested first to generate realized profit.",
    },
    {
      title: "Adaptive Pending Order Intelligence",
      description:
        "Every pending order is a living part of the mission. Before activation, the EA asks: does this order still improve the mission? Is this exposure still required? Has realized profit already reduced needs? Orders are resized or cancelled dynamically.",
    },
  ];

  const supporting: { title: string; description: string }[] = [
    {
      title: "Basket Trailing Stop",
      description:
        "Trails the net basket profit with configurable start threshold and step size. Closes all trades when the trailing level is hit.",
    },
    {
      title: "Automatic & Manual Partial Close",
      description:
        "Auto-triggers at a NET basket profit threshold. Intelligent ordering: closes Working/Harvest positions before Legacy. Manual partial close panel on-chart for discretionary use.",
    },
    {
      title: "Breakeven Lock Line",
      description:
        "Activates after partial close with 1+ remaining trades. Locks in a configurable number of points in profit. If price reverses to the lock level, all remaining trades close to secure the profit.",
    },
    {
      title: "Milestone Monitor (BMM)",
      description:
        "Tracks basket profit progress toward a USD goal. One-shot alerts at configurable milestones (50/75/90/99%). Supports terminal popups, push, email, sound, and auto-screenshots to date-organized folders.",
    },
    {
      title: "Statistical Learning",
      description:
        "CSV logging per harvest trade: setup type, session, quality, ATR, realized P/L, MFE/MAE, drawdown, Mission Efficiency. Exponential moving average bias influences future setup preference. Fully transparent — no black box.",
    },
    {
      title: "On-Chart Visual Engine",
      description:
        "Live-updating lines: hedge horizon, breakeven, target, partial close trigger, trailing stop, breakeven lock, ladder orders. Mission info panel with progress, floating P/L, projected profit at horizon, harvest stats, and setup quality.",
    },
    {
      title: "Multi-Order Spread Math",
      description:
        "Inherited from VisualBasketProfitEngine: spread-corrected lot calculation that inflates total lots when pending orders are spread toward TP, so projected profit at target matches the user's desired amount.",
    },
  ];

  return [
    ...core.map((f) => ({
      id: uid("f"),
      project_id: projectId,
      title: f.title,
      description: f.description,
      group: "core" as const,
      created_at: ts,
    })),
    ...supporting.map((f) => ({
      id: uid("f"),
      project_id: projectId,
      title: f.title,
      description: f.description,
      group: "supporting" as const,
      created_at: ts,
    })),
  ];
}

export function amheVersions(projectId: string): Version[] {
  const ts = nowIso();
  return [
    {
      id: uid("v"),
      project_id: projectId,
      number: "1.0",
      summary:
        "Source robots — the two proven MT4 EAs that form the foundation of the combined AMHE. VisualBasketProfitEngine v3.00 (multi-order spread calculator + milestone monitor) and BasketAveragingEA v3.40 (partial close + trailing + breakeven lock engine).",
      created_at: ts,
      files: [
        {
          id: uid("file"),
          version_id: "", // filled below
          name: "VisualBasketProfitEngine.mq4",
          type: "mq4",
          size: 42000,
          url: "/downloads/VisualBasketProfitEngine.mq4",
          created_at: ts,
        },
        {
          id: uid("file"),
          version_id: "",
          name: "BasketAveragingEA.mq4",
          type: "mq4",
          size: 28000,
          url: "/downloads/BasketAveragingEA.mq4",
          created_at: ts,
        },
      ],
    },
    {
      id: uid("v"),
      project_id: projectId,
      number: "2.0",
      summary:
        "Combined Adaptive Mission Hedge Engine v1.0 — all five engines (Mission, Market Context, Adaptive Exposure, Harvest, Recovery) plus Position Governance, Milestone Monitor, Statistical Learning, and full on-chart visuals in a single .mq4 file.",
      created_at: ts,
      files: [
        {
          id: uid("file"),
          version_id: "",
          name: "AdaptiveMissionHedgeEngine.mq4",
          type: "mq4",
          size: 55000,
          url: "/downloads/AdaptiveMissionHedgeEngine.mq4",
          created_at: ts,
        },
      ],
    },
  ];
}

export function amheKnowledge(projectId: string): KnowledgeEntry[] {
  const ts = nowIso();
  return [
    {
      id: uid("k"),
      project_id: projectId,
      kind: "documentation",
      title: "Adaptive Mission Hedge Strategy — Concept",
      content: `# Adaptive Mission Hedge Strategy

## Overview
This strategy combines Kalshi and MT4 into one coordinated risk management system. They are two parts of a single strategy where each platform has a completely different responsibility.

- **Kalshi is the primary position** — a prediction market contract (e.g., "Gold stays above 3977")
- **MT4 is the adaptive hedge** — trades in the direction that would cause the Kalshi position to lose

## The Kalshi Position
Example: Gold at 4120, Kalshi contract "Gold stays ABOVE 3977." Risk $250, potential profit $2.67. Based on probability — Gold has a significant buffer. The rare event (Gold falling below 3977) is what the MT4 account protects against.

## The Purpose of MT4
The MT4 account is NOT trying to predict the market. The prediction is already on Kalshi. MT4 asks: "If the unlikely event starts happening, how can I intelligently build a hedge while risking as little as possible?" Its success is measured by how well it protects the combined portfolio, not by independent profit.

## Using Time as an Advantage
The large distance between current price and Kalshi danger level creates time. The strategy uses that time to build the hedge gradually — smallest positions first, evolving as the market evolves. Market pullbacks, breakouts, FVGs, and liquidity sweeps all represent opportunities to harvest profit and strengthen the hedge.

## The Core Philosophy
The Kalshi position expresses the market opinion. The MT4 account does not attempt to replace that opinion — it exists to intelligently manage the rare scenario where the Kalshi opinion is wrong. By using time, market structure, adaptive exposure, and disciplined trade management, the system attempts to let favorable market movement finance as much of the hedge as possible while continuously strengthening protection.`,
      created_at: ts,
    },
    {
      id: uid("k"),
      project_id: projectId,
      kind: "documentation",
      title: "AMHE Architecture — Five Engines",
      content: `# AMHE Architecture

## 1. Mission Engine
Maintains direction, hedge horizon, desired profit, remaining distance/time, and probability estimate. Never trades — defines the destination.

## 2. Market Context Engine
Always observing. Never sleeping. Never chasing. Evaluates market structure (support, resistance, FVGs, liquidity sweeps, momentum, session quality, volatility) to determine: "Is the market currently offering a high-quality opportunity to safely improve the hedge?"

## 3. Harvest Engine
Entry modules: support bounce, resistance rejection, pullback continuation, breakout retest, liquidity sweep, FVG fill/breakout/retest, momentum continuation. May scale in, partial close, trail, or feed realized profit into the mission.

## 4. Adaptive Exposure Engine (Core Innovation)
Every meaningful event triggers a mission recalculation. Before any pending order activates, the EA recalculates required exposure considering realized profit, floating profit, legacy/working positions, remaining distance/time, current/pending exposure, and projected profit at horizon. The objective is continuous exposure optimization.

## 5. Recovery Engine
After every completed harvest cycle, waits for another valid market structure. Never blindly re-enters.

## Position Classification
- **Legacy Positions**: Older, better average entry, greater future mission value. Preserved whenever practical.
- **Working Positions**: Exist to harvest movement. Expendable. Generate realized profit. May be partially or fully closed.

## Mission Efficiency
Measures execution quality: harvested profit, drawdown, exposure used, legacy preservation, working position performance, pending order optimization, recovery quality, hedge improvement. Continuously improves execution without changing mission direction.`,
      created_at: ts,
    },
    {
      id: uid("k"),
      project_id: projectId,
      kind: "dev_update",
      title: "Source Robots — Foundation Components",
      content: `# Source Robots

## VisualBasketProfitEngine v3.00 (Multi-Order Spread)
The order placement and milestone monitoring engine. Key capabilities:
- Multi-order lot distribution (Front Heavy / Back Heavy / Even / Slow Grind)
- Spread-corrected lot math: inflates total lots when pending orders are spread between entry and TP
- Basket statistics: first-order SL loss, all-filled SL loss, weighted break-even, projected P/L at TP
- Collapsible orders report panel with per-order breakdown
- Milestone monitor (BMM): profit goal tracking, alerts (terminal/push/email/sound), auto-screenshots
- On-chart visuals: draggable entry/SL/TP lines, colored profit/loss zones, banner labels

## BasketAveragingEA v3.40 (Position Management)
The basket management and risk governance engine. Key capabilities:
- Net basket breakeven calculation (handles BUY + SELL hedged baskets)
- Drawdown-activated averaging with configurable point target
- Basket trailing stop with start threshold and step size
- Automatic + manual partial close (profit-ordered or size-ordered, configurable percentage)
- Breakeven lock line: activates after partial close with 1+ remaining trades
- CLineManager class for clean visual management
- Spread filter + fast close engine with retry attempts
- Real-time info panel with basket state, averaging status, lock status

## What AMHE Combines
AMHE takes the multi-order spread math + milestone monitor from VisualBasketProfitEngine and the position governance (trailing, partial close, breakeven lock) from BasketAveragingEA, then adds five new engines: Mission, Market Context, Adaptive Exposure, Harvest, and Recovery — plus Statistical Learning. The result is a single EA that manages the entire Kalshi hedge lifecycle.`,
      created_at: ts,
    },
  ];
}
