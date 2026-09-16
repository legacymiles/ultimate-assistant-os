"use client";
// The globe touches window, WebGL and a CDN script, so it only ever renders client-side.

import dynamic from "next/dynamic";

const GodsEyeView = dynamic(() => import("@/components/gods-eye/GodsEyeView").then((m) => ({ default: m.GodsEyeView })), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#050811",
        color: "#7aa3b3",
        display: "grid",
        placeItems: "center",
        fontFamily: "ui-monospace, monospace",
        fontSize: 11,
        letterSpacing: "0.3em",
      }}
    >
      ESTABLISHING UPLINK…
    </div>
  ),
});

export default function GodsEyeClient() {
  return <GodsEyeView />;
}
