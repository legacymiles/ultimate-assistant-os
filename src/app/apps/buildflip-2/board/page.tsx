import type { Metadata } from "next";
import AppShell from "@/components/buildflip-2/AppShell";
import Board from "@/components/buildflip-2/Board";

export const metadata: Metadata = {
  title: "Your board",
  description:
    "Every build plan you've made, newest first, moving from idea to sold.",
  robots: { index: false, follow: false },
};

export default function BoardPage() {
  return (
    <AppShell>
      <Board />
    </AppShell>
  );
}
