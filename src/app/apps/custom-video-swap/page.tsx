import type { Metadata } from "next";
import { VideoSwapPage } from "@/components/jarvis/video-swap/Pages";

// Custom Video Swap — also a card in Jarvis › Studio. Owner-only like the
// rest of the hub (middleware).

export const metadata: Metadata = {
  title: "Custom Video Swap · Ultimate Assistant OS",
  description: "Recast any clip: new characters, a new world, the original motion — made free on your own PC.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <VideoSwapPage />;
}
