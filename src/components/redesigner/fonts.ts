// Six faces, because a skin that cannot change its voice is a colour swap.
// Picking a design skill re-points --display / --body / --mono at three of
// these (see src/lib/redesigner/skins.ts). Only Website Redesigner imports this
// module, so the rest of the hub loads none of them.
//
// The faces themselves are declared in `src/lib/fonts` and read off disk, so no
// build fetches Google:
//
//   --font-rdx-display  Archivo Black     headline, brutal and loud
//   --font-rdx-body     Space Grotesk     the workhorse
//   --font-rdx-mono     JetBrains Mono    code, labels, data
//   --font-rdx-serif    Instrument Serif  editorial + cinema skins
//   --font-rdx-sans     Inter             the neutral dashboards are built in
//   --font-rdx-syne     Syne              agency / expressive skins
import { rdxDisplay, rdxBody, rdxMono, rdxSerif, rdxSans, rdxSyne } from "@/lib/fonts";

/** Put on the element that wraps the Redesigner so its skins can reach every face. */
export const REDESIGNER_FONTS = [rdxDisplay, rdxBody, rdxMono, rdxSerif, rdxSans, rdxSyne]
  .map((f) => f.variable)
  .join(" ");
