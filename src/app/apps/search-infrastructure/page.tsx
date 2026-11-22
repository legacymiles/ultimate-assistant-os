import type { Metadata, Viewport } from "next";
import { SearchInfraApp } from "@/components/search-infra/SearchInfraApp";

// Search Infrastructure — the console for the hub's one search service.
// Owner/session-gated by middleware like the rest of the hub, and never
// indexed: it shows what the owner's apps have been searching for.

export const metadata: Metadata = {
  title: "Search Infrastructure · Jarvis",
  description:
    "One search endpoint for every Jarvis app and agent: self-hosted SearXNG on this machine and on the VPS, Tavily as the fallback, with caching, rate limits, usage and page extraction.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0f",
  width: "device-width",
  initialScale: 1,
};

export default function Page() {
  return <SearchInfraApp />;
}
