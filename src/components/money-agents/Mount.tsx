"use client";

// The studio reads this device's saved board on its first render, so it is
// mounted in the browser only — a server render would disagree with it.

import dynamic from "next/dynamic";
import type { TabId } from "./MoneyAgentStudio";

const Studio = dynamic(() => import("./MoneyAgentStudio").then((m) => m.MoneyAgentStudio), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: "100dvh", background: "#06080a" }} aria-busy="true" aria-label="Loading Money Agent Studio" />
  ),
});

export function MoneyAgentStudioMount({ initialTab }: { initialTab: TabId | null }) {
  return <Studio initialTab={initialTab} />;
}
