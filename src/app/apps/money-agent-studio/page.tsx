import type { Metadata } from "next";
import { MoneyAgentStudioMount } from "@/components/money-agents/Mount";
import { isRoom } from "@/lib/bible/rooms";

// Money Agent Studio — agents that make videos that make money (clipping,
// faceless channels, paid clipping campaigns). Owner-only like the rest of the
// hub (middleware). Financial Bible is the Bible tab here (MERGED_INTO in
// src/lib/studio/plugins.ts): what the agents make and the plan it is spent
// against are one app, and Money Plays already read the same board.

export const metadata: Metadata = {
  title: "Money Agent Studio · Ultimate Assistant OS",
  description:
    "Money agents: an opportunity radar (IPOs, CPI/Fed releases, gold, crypto, smart companies, a move-alert bot) plus video agents that clip, run faceless channels and work paid clipping campaigns — you approve every post.",
  robots: { index: false, follow: false },
};

const TABS = ["radar", "approve", "pipeline", "agents", "campaigns", "earnings", "bible"] as const;
type Tab = (typeof TABS)[number];

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; studio?: string }> }) {
  const { tab, studio } = await searchParams;
  const initial = (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : null;
  // `?studio=` is the Bible's own room, carried over from /apps/financial-bible.
  return <MoneyAgentStudioMount initialTab={initial} initialRoom={isRoom(studio) ? studio : null} />;
}
