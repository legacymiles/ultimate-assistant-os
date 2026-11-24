"use client";

// The studio reads this device's saved settings, the microphone-free audio
// graph and WebRTC on its first render, so it mounts in the browser only.

import dynamic from "next/dynamic";

const Studio = dynamic(() => import("./AiLiveStudio").then((m) => m.AiLiveStudio), {
  ssr: false,
  loading: () => <div style={{ minHeight: "100dvh", background: "#0b0b0d" }} aria-busy="true" aria-label="Loading AI Live Studio" />,
});

export function AiLiveStudioMount() {
  return <Studio />;
}
