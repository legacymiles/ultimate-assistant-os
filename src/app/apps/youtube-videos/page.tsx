import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Oxanium } from "next/font/google";
import { YouTubeVideosApp } from "@/components/youtube-videos/YouTubeVideosApp";

// YouTube videos — a Jarvis App plugin and a Dashboard widget. Paste YouTube
// and social video links to watch later; For you suggests what to watch next.
// Owner/session-gated by middleware like the rest of the hub; never indexed.

// Jarvis's own HUD faces, under Jarvis's variable names, so the app reads the
// same on its own page as inside the Dashboard sheet.
const display = Oxanium({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-nj-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-nj-mono", display: "swap" });

export const metadata: Metadata = {
  title: "YouTube videos · Jarvis",
  description: "Paste any YouTube or social video link and watch it later, on every device.",
  robots: { index: false, follow: false },
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
      <YouTubeVideosApp />
    </main>
  );
}
