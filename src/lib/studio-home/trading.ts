// ---------------------------------------------------------------------------
// Trading Studio — every trading-bot tool behind one front door.
//
// Pure and server-safe: the page validates `?section=` against this list. The
// components each section mounts are wired in
// src/components/trading-studio/TradingStudio.tsx.
//
// EA World and EA Lab are PENDING: their code lives only on the owner's PC so
// far. Wiring one in later is one edit each — delete its `pending` field here
// and add its component to the map in TradingStudio.tsx (the comment there
// says exactly what to write).
// ---------------------------------------------------------------------------

import type { HomeSection } from "./sections";

export type TradingSection = "world" | "lab" | "replay" | "terminals" | "features" | "calculator";

export const TRADING_FOLDER = "app:trading-studio";

export const TRADING_SECTIONS: readonly HomeSection<TradingSection>[] = [
  {
    id: "world",
    label: "EA World",
    hint: "what you've learned",
    icon: "Layers",
    hue: 45,
    pending: {
      title: "EA World is on your PC and isn't on the website yet",
      body: [
        "EA World — the vault of your trading bots, the mechanics worth stealing and the build bench — was built on your PC, and its code hasn't been brought into the website yet. This tab is where it will open.",
        "Claude Code on the PC will bring it in. Nothing to set up on your side: press the button and it waits in your In Queue until the PC picks it up.",
      ],
      request: {
        folder: TRADING_FOLDER,
        label: "Ask Claude Code to bring it in",
        text:
          "Bring EA World into Trading Studio: commit the EA World code that is only on this PC (src/components/ea-world, src/lib/ea-world, src/app/apps/ea-world/page.tsx), " +
          "then mount it as Trading Studio's World section — in src/components/trading-studio/TradingStudio.tsx add `world: dynamic(() => import(\"../ea-world/EaWorld\")…)` " +
          "with embedded, and delete the `pending` field on `world` in src/lib/studio-home/trading.ts. Remove the /apps/ea-world redirect from next.config.mjs only if the page itself becomes a redirect.",
      },
    },
  },
  {
    id: "lab",
    label: "EA Lab",
    hint: "measure a bot",
    icon: "Target",
    hue: 150,
    pending: {
      title: "EA Lab is on your PC and isn't on the website yet",
      body: [
        "EA Lab — the bench that backtests every bot dropped in its folder and rates it on results it hasn't seen — runs on your PC, and its screen hasn't been brought into the website yet. This tab is where it will open.",
        "Claude Code on the PC will bring it in. Press the button and the request waits in your In Queue until the PC picks it up.",
      ],
      request: {
        folder: TRADING_FOLDER,
        label: "Ask Claude Code to bring it in",
        text:
          "Bring EA Lab into Trading Studio: commit the EA Lab code that is only on this PC (src/components/ea-lab, src/app/apps/ea-lab), " +
          "then mount it as Trading Studio's Lab section — in src/components/trading-studio/TradingStudio.tsx add `lab: dynamic(() => import(\"../ea-lab/EaLab\")…)` " +
          "with embedded, and delete the `pending` field on `lab` in src/lib/studio-home/trading.ts.",
      },
    },
  },
  { id: "replay", label: "Replay", hint: "watch it trade", icon: "Play", hue: 205 },
  { id: "terminals", label: "Terminals", hint: "the market around it", icon: "Server", hue: 175 },
  { id: "features", label: "Feature List", hint: "the specs", icon: "ListChecks", hue: 265 },
  { id: "calculator", label: "Calculator", hint: "basket P/L", icon: "Cash", hue: 20 },
];

/** Where a bare visit lands the first time — the one that works with nothing on the PC. */
export const TRADING_DEFAULT: TradingSection = "replay";

export const TRADING_REMEMBER = "trading-studio:section";
