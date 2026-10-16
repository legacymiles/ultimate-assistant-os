import { ReplayStudio } from "@/components/ea-replay/ReplayStudio";

export const metadata = {
  title: "Replay · EA World · Ultimate Assistant OS",
  description:
    "Watch a trading bot trade a real past New York session tick by tick — real Dukascopy bid/ask, a simulated MT4 broker with latency, slippage and commission.",
};

export default function Page() {
  return <ReplayStudio />;
}
