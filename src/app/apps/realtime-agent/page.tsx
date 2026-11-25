import type { Metadata, Viewport } from "next";
import RealtimeAgent from "@/components/realtime-agent/RealtimeAgent";

// Realtime Agent — all three agents in one place: the Three.js face, the
// photoreal LiveTalking face on this PC, and the same thing on a rented RunPod
// GPU. Only the last one costs money, so it is the only one behind a confirm
// gate, with a live meter and an idle auto-stop.
//
// Owner-only like the rest of the hub: `routeAccess` in lib/hubAccess.ts
// defaults an unlisted path to "owner" and the middleware enforces it, which
// matters more here than usual — this page can start a billed GPU.

export const metadata: Metadata = {
  title: "Realtime Agent · Ultimate Assistant OS",
  description:
    "Switch between your 3D agent, the photoreal agent on this PC and the rented-GPU one, and talk to whichever is up. The paid one asks first, shows what it is costing, and stops itself when you go quiet.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0f",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function Page() {
  return <RealtimeAgent />;
}
