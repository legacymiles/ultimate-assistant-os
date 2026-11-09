// Geist for the Studio's premium flows (Custom Video Swap, Workflow Maker):
// a confident grotesk display + UI face and its mono for times and engines.
//
// The faces themselves are declared in `src/lib/fonts` and read off disk, so
// no build fetches Google. This file stays as the flows' import point.
import { vsSans, vsMono } from "@/lib/fonts";

export { vsSans, vsMono };

export const vsFonts = `${vsSans.variable} ${vsMono.variable}`;
