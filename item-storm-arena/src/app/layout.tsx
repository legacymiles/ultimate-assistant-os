import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "700"],
});

const body = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://item-storm-arena.vercel.app"),
  title: "ITEM STORM ARENA — an interactive gravity playground",
  description:
    "A storm of living objects circles a floating arena. Your cursor is a gravity well: collect the storm, launch it at the kart, and discover the sequences the arena never explains.",
  openGraph: {
    title: "ITEM STORM ARENA",
    description:
      "Collect the storm. Launch the chaos. Some sequences are special — the arena won't tell you which.",
    type: "website",
    siteName: "Item Storm Arena",
  },
  twitter: {
    card: "summary_large_image",
    title: "ITEM STORM ARENA",
    description: "An interactive gravity playground. Collect the storm. Launch the chaos.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0c1e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
