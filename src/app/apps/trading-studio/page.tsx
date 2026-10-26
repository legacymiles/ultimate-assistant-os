import { TradingStudio } from "@/components/trading-studio/TradingStudio";
import { pickSection } from "@/lib/studio-home/sections";
import { TRADING_SECTIONS } from "@/lib/studio-home/trading";

export const metadata = {
  title: "Trading Studio · Ultimate Assistant OS",
  description:
    "Every trading-bot tool behind one switcher: EA World, EA Lab, tick-by-tick Replay, the outside Terminals, " +
    "the Expert Advisor Feature List and the MT4 gold multi-order basket calculator.",
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }) {
  // `?section=` is how the old routes hand over. Null — none, or one this home
  // does not have — resumes whichever section was last open on this device.
  const { section } = await searchParams;
  return <TradingStudio initialSection={pickSection(TRADING_SECTIONS, section)} />;
}
