import {
  Archivo_Black,
  Instrument_Serif,
  Inter,
  JetBrains_Mono,
  Space_Grotesk,
  Syne,
} from "next/font/google";
import { Redesigner } from "@/components/redesigner/Redesigner";

// Six faces, because a skin that cannot change its voice is a colour swap.
// Picking a design skill re-points --display / --body / --mono at three of
// these (see src/lib/redesigner/skins.ts); they are scoped to this route, so
// the rest of the hub loads none of them.
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
// Editorial + cinema skins: the headline voice that is not a grotesque.
const serif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-rdx-serif",
});
// Product skins: the neutral that dashboards are actually built in.
const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-rdx-sans",
});
// Agency / expressive skins: wide, confident, unmistakably designed.
const syne = Syne({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-rdx-syne",
});

export const metadata = {
  title: "Website Redesigner · Ultimate Assistant OS",
  description:
    "Paste a URL and get three redesign directions plus a functionality-preserving build prompt for Claude Code.",
};

export default function Page() {
  return (
    <div
      className={`${display.variable} ${body.variable} ${mono.variable} ${serif.variable} ${sans.variable} ${syne.variable}`}
    >
      <Redesigner />
    </div>
  );
}
