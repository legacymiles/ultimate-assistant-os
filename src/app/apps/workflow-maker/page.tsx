import type { Metadata } from "next";
import { WorkflowMakerPage } from "@/components/jarvis/video-swap/Pages";

// Workflow Maker ("rea to workflow") — also a card in Jarvis › Studio.
// Owner-only like the rest of the hub (middleware).

export const metadata: Metadata = {
  title: "Workflow Maker · Ultimate Assistant OS",
  description: "Show it a video of any process — it maps every step and builds you the working tool.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <WorkflowMakerPage />;
}
