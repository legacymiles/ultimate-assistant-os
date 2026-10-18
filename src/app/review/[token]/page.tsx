import type { Metadata, Viewport } from "next";
import { ClientPortal } from "@/components/client-review/ClientPortal";

// A client's private review link. Public (see src/lib/hubAccess.ts); the page
// itself holds nothing — ClientPortal loads the project through the token.

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Review your website · Jarvis",
    description: "See the latest version of your website and send your edit requests to Jarvis.",
    // A private link must never be indexed or previewed with its address.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    // The manifest is what lets an iPhone add this link to the Home Screen,
    // which is the only way Safari delivers push notifications to it.
    manifest: `/review/${token}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "Jarvis Review", statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = {
  themeColor: "#07080c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClientPortal token={token} />;
}
