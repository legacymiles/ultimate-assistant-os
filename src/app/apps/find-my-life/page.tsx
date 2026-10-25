import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Oxanium } from "next/font/google";
import { FindMyLifeApp } from "@/components/find-my-life/FindMyLifeApp";

// Find My Life — a Jarvis App plugin and a Dashboard widget. Every device and
// thing you own on one radar. Owner/session-gated by middleware like the rest
// of the hub; never indexed (it's people's locations).

const display = Oxanium({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-nj-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-nj-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Find My Life · Jarvis",
  description: "Your phone, laptop, glasses, car, keys and wallet — every device and thing you own on one radar.",
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
      <FindMyLifeApp />
    </main>
  );
}
