import type { Metadata, Viewport } from "next";
import { njDisplay as display, njMono as mono } from "@/lib/fonts";
import { ContradictingApp } from "@/components/contradicting/ContradictingApp";

// Contradicting — a Jarvis App plugin. A clip-on recorder (Omi) streams what
// was said; when someone denies saying something, the app shows the exact
// line, when, and the back-and-forth that led up to it. Consent-first: only
// people who agreed are recorded. Owner/session-gated by middleware; never indexed.

export const metadata: Metadata = {
  title: "Contradicting · Jarvis",
  description: "The record doesn't lie — for both of you. Receipts for “I never said that.”",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#07080b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function Page() {
  return (
    <main className={`${display.variable} ${mono.variable}`}>
      <ContradictingApp />
    </main>
  );
}
