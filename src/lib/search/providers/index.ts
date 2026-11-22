// ---------------------------------------------------------------------------
// The provider registry.
//
// Adding a provider is: write the adapter, add it here. The orchestrator, the
// API routes, the dashboard and every app read it through this map and never
// name a provider themselves.
// ---------------------------------------------------------------------------

import type { SearchProviderAdapter } from "./base";
import { duckduckgoProvider } from "./duckduckgo";
import { searxngProvider } from "./searxng";
import { tavilyProvider } from "./tavily";

export const PROVIDERS: Record<string, SearchProviderAdapter> = {
  [searxngProvider.id]: searxngProvider,
  [duckduckgoProvider.id]: duckduckgoProvider,
  [tavilyProvider.id]: tavilyProvider,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export function providerById(id: string): SearchProviderAdapter | null {
  return PROVIDERS[id] ?? null;
}

export type { SearchProviderAdapter, ProviderQuery, ProviderOutcome } from "./base";
export { searxngProvider, duckduckgoProvider, tavilyProvider };
