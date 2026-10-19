import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Syne } from "next/font/google";
import { AppBuilder } from "@/components/app-builder/AppBuilder";

// App Builder — a Jarvis App plugin. Type an idea or drop a recording of an
// app or workflow; the super agent takes it apart, asks what it's for, designs
// the features, and hands the build to Claude Code with the owner's skills.
// Owner-only (middleware), so it is never indexed or previewed.

const syne = Syne({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-syne", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jbm", display: "swap" });

export const metadata: Metadata = {
  title: "App Builder · Jarvis",
  description: "Describe an app or show a recording of one — the super agent designs it and hands the build to your pro team.",
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
    <div className={`${syne.variable} ${mono.variable}`}>
      <AppBuilder />
    </div>
  );
}
