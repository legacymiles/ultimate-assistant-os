import type { Metadata, Viewport } from "next";
import { ClientReviewApp } from "@/components/client-review/ClientReviewApp";

// Client Review — one page for clients and the owner. Clients see their
// websites and the Chat Intake; the Admin tab is locked for everyone but the
// owner (and its API is owner-only in middleware either way).

export const metadata: Metadata = {
  title: "Client Review · Jarvis",
  description: "See your website and send your edit requests to Jarvis.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  manifest: "/apps/client-review/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Client Review", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#07080c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function Page() {
  return <ClientReviewApp />;
}
