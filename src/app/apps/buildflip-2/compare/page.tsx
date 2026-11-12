import type { Metadata } from "next";
import AppShell from "@/components/buildflip-2/AppShell";
import Compare from "@/components/buildflip-2/Compare";

export const metadata: Metadata = {
  title: "Compare builds",
  description: "Rank your build ideas by profit per hour and put two head to head.",
  robots: { index: false, follow: false },
};

export default function ComparePage() {
  return (
    <AppShell>
      <Compare />
    </AppShell>
  );
}
