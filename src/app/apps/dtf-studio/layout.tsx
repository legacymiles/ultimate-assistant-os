import type { Metadata, Viewport } from "next";
import { dtfMono, dtfSans, dtfSerif } from "@/lib/fonts";
import "@/components/dtf/dtf.css";

export const metadata: Metadata = {
  title: { default: "DTF Studio — design it on the real garment, we print it", template: "%s · DTF Studio" },
  description:
    "Design custom tees, hoodies, sweatshirts and totes on real garment photos, preview them worn, folded and hanging, work with an AI designer, and get it printed on a real DTF press — every file checked by a person before it prints.",
  openGraph: {
    title: "DTF Studio",
    description: "A futuristic apparel design studio connected to a real DTF print shop.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#08090b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function DtfLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${dtfSans.variable} ${dtfMono.variable} ${dtfSerif.variable}`}>{children}</div>;
}
