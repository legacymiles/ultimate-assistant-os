import type { Metadata, Viewport } from "next";
import { dtfMono, dtfSans, dtfSerif } from "@/lib/fonts";
import "@/components/dtf/dtf.css";

export const metadata: Metadata = {
  title: "DTF Production",
  description: "Orders, artwork approval, print files, the print-station queue and gang sheets for the Lancelot M1630 Pro.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#08090b" };

/** Owner-only: the hub's middleware keeps this route behind the owner gate, and every API it calls checks again. */
export default function ProductionLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${dtfSans.variable} ${dtfMono.variable} ${dtfSerif.variable}`}>{children}</div>;
}
