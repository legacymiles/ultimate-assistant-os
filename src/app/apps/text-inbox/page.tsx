import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Oxanium } from "next/font/google";
import { TextInboxApp } from "@/components/text-inbox/TextInboxApp";

// Text Inbox — a Jarvis App plugin and a Dashboard widget. Texts from the
// iPhone with a reply drafted in the user's voice; every reply waits for the
// user's Approve, and only the iPhone sends it. Session-gated by middleware
// like the rest of the hub; never indexed (it's people's messages). Its own
// manifest so it can be added to the Home Screen, where iOS delivers push.

const display = Oxanium({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-nj-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-nj-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Text Inbox · Jarvis",
  description: "Your iPhone texts with a reply drafted in your voice — approve, edit or decline each one, and your phone sends it.",
  robots: { index: false, follow: false },
  manifest: "/apps/text-inbox/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Texts", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#05060a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function Page() {
  return (
    <main className={`${display.variable} ${mono.variable}`}>
      <TextInboxApp />
    </main>
  );
}
