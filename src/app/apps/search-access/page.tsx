import type { Metadata, Viewport } from "next";
import { SearchAccess } from "@/components/search-infra/SearchAccess";

// Search access — where someone the owner gave a key goes to find it.
//
// Reachable without the owner gate (src/lib/hubAccess.ts, as an EXACT public
// path), because the people it exists for are by definition not the owner.
// Signed out it shows a sign-in prompt and nothing else; signed in it asks
// /api/search/account, which only ever returns that person's own keys and
// their own usage. Never indexed.

export const metadata: Metadata = {
  title: "Search access · Jarvis",
  description: "Your key for the search API, what it allows, and how to use it.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0f",
  width: "device-width",
  initialScale: 1,
};

export default function Page() {
  return <SearchAccess />;
}
