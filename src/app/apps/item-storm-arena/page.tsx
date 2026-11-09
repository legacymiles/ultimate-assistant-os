import type { Metadata, Viewport } from "next";
import { isaDisplay as display, isaBody as body } from "@/lib/fonts";
import { ItemStormArena } from "@/components/item-storm-arena/ItemStormArena";

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
