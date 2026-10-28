import { Geist, Geist_Mono } from "next/font/google";

// Geist for the Studio's premium flows (Custom Video Swap, Workflow Maker):
// a confident grotesk display + UI face and its mono for times and engines.
export const vsSans = Geist({ subsets: ["latin"], variable: "--font-vs", display: "swap" });
export const vsMono = Geist_Mono({ subsets: ["latin"], variable: "--font-vs-mono", display: "swap" });
export const vsFonts = `${vsSans.variable} ${vsMono.variable}`;
