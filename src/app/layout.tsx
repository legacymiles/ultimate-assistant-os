import type { Metadata, Viewport } from "next";
import "./globals.css";
import { IdentityBoundary } from "@/components/IdentityBoundary";
import { ErrorReporter } from "@/components/ErrorReporter";

// The hub's own identity. Every app page sets its own full title
// ("Jarvis · Ultimate Assistant OS"), so this is the default for `/` and for
// anything that does not — it must name the hub, not whichever app happened to
// be built first. It said "Projects Timeline" until 2026-11-07, which is what
// the browser tab, a link preview and anyone cloning the repo all read.
export const metadata: Metadata = {
  title: "Ultimate Assistant OS",
  description:
    "One hub for every app: AI assistants and agents, video and music studios, image tools, automations, websites and trading — all in one place.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <IdentityBoundary />
        <ErrorReporter />
        {children}
      </body>
    </html>
  );
}
