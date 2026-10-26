import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Oxanium } from "next/font/google";
import { IphoneNotesApp } from "@/components/iphone-notes/IphoneNotesApp";

// iPhone Notes — a Jarvis App plugin and a Dashboard widget. Notes from the
// iPhone, read into proposals with a self-improving confidence score; every
// one waits for the owner's Approve. Session-gated by middleware like the rest
// of the hub; never indexed (it's people's notes).

const display = Oxanium({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-nj-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-nj-mono", display: "swap" });

export const metadata: Metadata = {
  title: "iPhone Notes · Jarvis",
  description: "Your iPhone notes, read by Jarvis into to-dos, events, birthdays and ideas — each with a confidence score, and nothing happens until you approve.",
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
      <IphoneNotesApp />
    </main>
  );
}
