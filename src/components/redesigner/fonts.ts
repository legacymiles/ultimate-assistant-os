import { Archivo_Black, Instrument_Serif, Inter, JetBrains_Mono, Space_Grotesk, Syne } from "next/font/google";

// Six faces, because a skin that cannot change its voice is a colour swap.
// Picking a design skill re-points --display / --body / --mono at three of
// these (see src/lib/redesigner/skins.ts). Only Website Redesigner imports this
// module, so the rest of the hub loads none of them.
const display = Archivo_Black({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-rdx-display" });
const body = Space_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-rdx-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-rdx-mono" });
// Editorial + cinema skins: the headline voice that is not a grotesque.
const serif = Instrument_Serif({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-rdx-serif" });
// Product skins: the neutral that dashboards are actually built in.
const sans = Inter({ subsets: ["latin"], display: "swap", variable: "--font-rdx-sans" });
// Agency / expressive skins: wide, confident, unmistakably designed.
const syne = Syne({ subsets: ["latin"], display: "swap", variable: "--font-rdx-syne" });

/** Put on the element that wraps the Redesigner so its skins can reach every face. */
export const REDESIGNER_FONTS = [display, body, mono, serif, sans, syne].map((f) => f.variable).join(" ");
