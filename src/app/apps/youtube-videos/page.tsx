import type { Metadata, Viewport } from "next";
import { Syne } from "next/font/google";
import { YouTubeVideosApp } from "@/components/youtube-videos/YouTubeVideosApp";

// YouTube videos — a Jarvis App plugin and a Dashboard widget. Paste YouTube
// and social video links to watch later; For you suggests what to watch next.
// Owner/session-gated by middleware like the rest of the hub; never indexed.

const syne = Syne({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "YouTube videos · Jarvis",
  description: "Paste any YouTube or social video link and watch it later, on every device.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#07080c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function Page() {
  return (
    <main className={syne.variable}>
      <YouTubeVideosApp />
    </main>
  );
}
