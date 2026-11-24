import type { ReactNode } from "react";
import { inspireDisplay, inspireMono, inspireSans } from "@/lib/fonts";
import "@/components/image-studio/inspire/inspire.css";

export default function InspireLayout({ children }: { children: ReactNode }) {
  return <div className={`${inspireDisplay.variable} ${inspireSans.variable} ${inspireMono.variable}`}>{children}</div>;
}
