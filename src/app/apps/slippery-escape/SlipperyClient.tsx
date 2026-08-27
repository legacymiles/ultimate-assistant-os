"use client";
// Loads the whole WebGL game client-side only (ssr:false) so the canvas, pointer
// lock, and capability checks never run on the server.

import dynamic from "next/dynamic";

const SlipperyGame = dynamic(
  () => import("@/components/slippery/SlipperyGame").then((m) => ({ default: m.SlipperyGame })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#06080c",
          color: "#5f7183",
          display: "grid",
          placeItems: "center",
          fontFamily: "ui-monospace, monospace",
          fontSize: 11,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
        }}
      >
        Oiling the floor…
      </div>
    ),
  },
);

export default function SlipperyClient() {
  return <SlipperyGame />;
}
