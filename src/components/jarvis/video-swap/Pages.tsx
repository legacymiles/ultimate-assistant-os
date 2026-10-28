"use client";

// The App plugins pages for the two Studio screens: the same component, full
// height, with a way back to Jarvis instead of back to the Studio wall.

import { useRouter } from "next/navigation";
import { VideoSwap } from "./VideoSwap";
import { WorkflowMaker } from "../workflow-maker/WorkflowMaker";

export function VideoSwapPage() {
  const router = useRouter();
  return (
    <div className="h-dvh">
      <VideoSwap onClose={() => router.push("/apps/jarvis#studio")} />
    </div>
  );
}

export function WorkflowMakerPage() {
  const router = useRouter();
  return (
    <div className="h-dvh">
      <WorkflowMaker onClose={() => router.push("/apps/jarvis#studio")} />
    </div>
  );
}
