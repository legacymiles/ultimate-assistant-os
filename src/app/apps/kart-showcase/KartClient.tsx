"use client";
// Loads the whole WebGL experience client-side only (ssr:false), so capability
// detection and the canvas never run on the server.

import dynamic from "next/dynamic";

const KartShowcase = dynamic(
  () => import("@/components/kart/KartShowcase").then((m) => ({ default: m.KartShowcase })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#07090c",
          color: "#5f7183",
          display: "grid",
          placeItems: "center",
          fontFamily: "ui-monospace, monospace",
          fontSize: 11,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
        }}
      >
        Loading experience…
      </div>
    ),
  },
);

export default function KartClient() {
  return <KartShowcase />;
}
