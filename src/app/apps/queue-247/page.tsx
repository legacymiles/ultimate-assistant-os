import type { Metadata } from "next";
import { CommandCenter } from "@/components/queue247/CommandCenter";

// 24/7 Queue — the AI operations command center, full screen. The same
// surface is the first tab of Jarvis › 24/7 Queue. Tasks run on the VPS
// worker; this page only reads and steers them (src/lib/queue247).

export const metadata: Metadata = {
  title: "24/7 Queue · Ultimate Assistant OS",
  description:
    "The AI operations command center: what every agent is working on right now, standing 24/7 workflows by app, things that need you, live worker health, and everything the agents have discovered.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <CommandCenter />;
}
