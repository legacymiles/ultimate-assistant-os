import { Archivo_Black, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Redesigner } from "@/components/redesigner/Redesigner";

// Oversized display + a mono-tinged grotesque body + a true mono for every
// label and datum. Scoped to this route, so the rest of the hub is untouched.
const display = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-rdx-display",
});
const body = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-rdx-body",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-rdx-mono",
});

export const metadata = {
  title: "Website Redesigner · Ultimate Assistant OS",
  description:
    "Paste a URL and get three redesign directions plus a functionality-preserving build prompt for Claude Code.",
};

export default function Page() {
  return (
    <div className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <Redesigner />
    </div>
  );
}
