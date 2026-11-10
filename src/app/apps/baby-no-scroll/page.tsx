import type { Metadata, Viewport } from "next";
import { BabyNoScroll } from "@/components/baby-no-scroll/BabyNoScroll";

export const metadata: Metadata = {
  title: "Baby No Scroll · Ultimate Assistant OS",
  description:
    "Hand over the screen, not the device. One video or one game fills it, everything else is taken "
    + "away, and the only thing left that answers to a touch is a padlock that opens by being dragged "
    + "the width of the screen.",
  // Its own manifest, so it installs as a fullscreen app: the one way to get rid
  // of the browser's "swipe down to exit" (see manifest.webmanifest/route.ts).
  manifest: "/apps/baby-no-scroll/manifest.webmanifest",
  icons: { apple: "/baby-no-scroll/icon-192.png" },
  appleWebApp: { capable: true, title: "No Scroll", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Draw under the notch and the home indicator, so an installed app on an
  // iPhone is edge to edge rather than framed by two bars.
  viewportFit: "cover",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  // `?mode=` lets a link — from Jarvis, or a home-screen shortcut — open the
  // console already on the right tab. Anything else just resumes last time.
  const { mode } = await searchParams;
  return <BabyNoScroll initialMode={mode === "games" || mode === "youtube" ? mode : undefined} />;
}
