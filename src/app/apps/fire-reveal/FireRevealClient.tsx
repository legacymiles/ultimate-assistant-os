"use client";
// The whole reveal experience runs client-side only (ssr:false) so WebGL
// capability detection and the canvas never touch the server.

import dynamic from "next/dynamic";

const FireRevealStudio = dynamic(
  () => import("@/components/reveal/FireRevealStudio").then((m) => ({ default: m.FireRevealStudio })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#05060a",
          color: "#8a5a3a",
          display: "grid",
          placeItems: "center",
          fontFamily: "ui-monospace, monospace",
          fontSize: 11,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
        }}
      >
        Stoking the embers…
      </div>
    ),
  },
);

export default function FireRevealClient() {
  return <FireRevealStudio />;
}
