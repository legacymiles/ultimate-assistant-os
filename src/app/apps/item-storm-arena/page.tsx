import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { ItemStormArena } from "@/components/item-storm-arena/ItemStormArena";

// The two faces the arena was designed in, scoped to this route.
const display = Space_Grotesk({ variable: "--font-isa-display", subsets: ["latin"], weight: ["500", "700"], display: "swap" });
const body = Inter({ variable: "--font-isa-body", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Item Storm Arena · Game Studio",
  description:
    "A storm of living objects circles a floating arena. Your cursor is a gravity well: collect the storm, launch it at the kart, " +
    "and discover the sequences the arena never explains.",
};

export const viewport: Viewport = {
  themeColor: "#0a0c1e",
};

export default function Page() {
  return (
    <div className={`${display.variable} ${body.variable}`}>
      <ItemStormArena />
    </div>
  );
}
