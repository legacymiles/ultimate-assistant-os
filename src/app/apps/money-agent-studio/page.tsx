import type { Metadata } from "next";
import { MoneyAgentStudioMount } from "@/components/money-agents/Mount";

// Money Agent Studio — agents that make videos that make money (clipping,
// faceless channels, paid clipping campaigns). Owner-only like the rest of the
// hub (middleware). Its money shows up in Financial Bible › Money Plays.

export const metadata: Metadata = {
  title: "Money Agent Studio · Ultimate Assistant OS",
  description:
    "Money agents for video: clip the best moments out of long videos, run faceless channels and work paid clipping campaigns — you approve every post, Personas Studio posts it, Earnings counts it.",
  robots: { index: false, follow: false },
};

const TABS = ["approve", "pipeline", "agents", "campaigns", "earnings"] as const;
type Tab = (typeof TABS)[number];

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initial = (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : null;
  return <MoneyAgentStudioMount initialTab={initial} />;
}
