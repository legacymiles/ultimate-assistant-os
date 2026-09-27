import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { NewJarvis } from "@/components/new-jarvis/NewJarvis";

// The surface's design names JetBrains Mono as the voice of every command,
// path, ref, count and elapsed time. The hub's --font-mono token asks for it
// first, but asking is not loading: nothing on this machine or on the deployed
// site has that face, so every one of those strings was falling through to
// Consolas. Loading it here is what makes the token true.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-nj-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "New Jarvis",
  description:
    "The assistant console: every request becomes a block with its steps and its results, voice waiting on its name, and a local agent that can drive a real browser and this PC.",
};

export default function Page() {
  return (
    <div className={mono.variable}>
      <NewJarvis />
    </div>
  );
}
