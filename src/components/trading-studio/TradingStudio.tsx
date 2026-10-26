"use client";

// ---------------------------------------------------------------------------
// Trading Studio — every trading-bot tool behind one front door.
//
// EA World, EA Lab, Replay, Terminals, the EA Feature List and the
// Multi-Order Calculator were separate apps. This is the StudioHome shell with
// each one mounted `embedded`; the old routes redirect here with their section
// already chosen.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { HomeSkeleton, StudioHome, type SectionComponent } from "../studio-home/StudioHome";
import {
  TRADING_DEFAULT,
  TRADING_REMEMBER,
  TRADING_SECTIONS,
  type TradingSection,
} from "@/lib/studio-home/trading";
import "./trading-studio.css";

// One section's JavaScript at a time: Replay alone pulls in a charting library
// and a tick decoder, and someone checking a basket should not download them.
const COMPONENTS: Partial<Record<TradingSection, SectionComponent>> = {
  // EA World and EA Lab are pending (their code is only on the PC so far).
  // Wiring each later is one edit here plus deleting its `pending` field in
  // src/lib/studio-home/trading.ts:
  //   world: dynamic(() => import("../ea-world/EaWorld").then((m) => m.EaWorld), { ssr: false, loading: () => <HomeSkeleton /> }),
  //   lab:   dynamic(() => import("../ea-lab/EaLab").then((m) => m.EaLab),       { ssr: false, loading: () => <HomeSkeleton /> }),
  replay: dynamic(() => import("../ea-replay/ReplayStudio").then((m) => m.ReplayStudio), {
    ssr: false,
    loading: () => <HomeSkeleton shape="canvas" />,
  }),
  terminals: dynamic(() => import("../ea-replay/TerminalsStudio").then((m) => m.TerminalsStudio), {
    ssr: false,
    loading: () => <HomeSkeleton />,
  }),
  features: dynamic(() => import("../ea/EaFeatureList").then((m) => m.EaFeatureList), {
    ssr: false,
    loading: () => <HomeSkeleton />,
  }),
  calculator: dynamic(() => import("../calculator/Calculator").then((m) => m.Calculator), {
    ssr: false,
    loading: () => <HomeSkeleton shape="grid" />,
  }),
};

export function TradingStudio({ initialSection }: { initialSection: TradingSection | null }) {
  return (
    <StudioHome
      brand={{ name: "Trading", em: "Studio", tagline: "Every trading-bot tool, one front door", icon: "Target" }}
      sections={TRADING_SECTIONS}
      components={COMPONENTS}
      rememberKey={TRADING_REMEMBER}
      initialSection={initialSection}
      defaultSection={TRADING_DEFAULT}
    />
  );
}
