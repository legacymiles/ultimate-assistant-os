import type { Metadata } from "next";
import AppShell from "@/components/buildflip-2/AppShell";
import Pricing from "@/components/buildflip-2/Pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "One full build plan free, no card. Then $9 a month for unlimited plans, live re-pricing and real-cost tracking. Cancel in one click.",
  openGraph: {
    title: "BuildFlip pricing — one plan free, then $9 a month",
    description:
      "Unlimited priced build plans, re-pricing against today's listings, and real-cost tracking that sharpens every estimate.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "BuildFlip pricing" }],
  },
};

export default function PricingPage() {
  return (
    <AppShell>
      <Pricing />
    </AppShell>
  );
}
