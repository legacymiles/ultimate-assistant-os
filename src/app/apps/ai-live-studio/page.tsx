import type { Metadata, Viewport } from "next";
import { AiLiveStudioMount } from "@/components/ai-live-studio/Mount";

// AI Live Studio — a real-time AI host for TikTok LIVE: a photoreal face
// (LiveTalking lip sync, or the host's portrait as a preview), a moderated
// live chat the owner can steer, and a personality that changes how he talks.
// Owner-only like the rest of the hub (middleware → routeAccess "owner").

export const metadata: Metadata = {
  title: "AI Live Studio · Ultimate Assistant OS",
  description:
    "Run a photoreal AI host on TikTok LIVE: he reads the chat, answers people by name in his own voice, and never reads abuse aloud — while you watch, steer and step in.",
  robots: { index: false, follow: false },
};

/** The browser chrome matches the dark studio, and the phone's notch is respected. */
export const viewport: Viewport = {
  themeColor: "#0b0b0d",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function Page() {
  return <AiLiveStudioMount />;
}
