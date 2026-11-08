// ---------------------------------------------------------------------------
// Every webface this site uses, read off disk.
//
// These were `next/font/google` calls spread across eleven files. Google was
// then fetched *during every build*, which made the build fail about half the
// time with an error that never mentioned fonts:
//
//     An error occurred in `next/font`.
//     TypeError: Cannot read properties of null (reading '1')
//
// It named whichever app page happened to ask for a font first, so it read like
// a code error in a random app. Measured 2026-11-07: three failures and three
// passes on identical commits, in a pristine clone as readily as in a working
// checkout. A repo that builds half the time is a repo nobody else can build.
//
// So the files live in `public/fonts/` and `next/font/local` reads them. The build
// is offline and deterministic, and the pages look the same: same families,
// same weights, same `latin` subset, same CSS variable names.
//
// `public/fonts/` is where this repo already kept its first two self-hosted faces
// (commit "Jarvis: self-host the two build-time fonts"), so every face lives there
// now rather than in a second folder of its own.
//
// Adding a face: add it to `scripts/fetch-fonts.mjs`, run it, commit the woff2,
// then declare it here. Never fetch a font at build time again.
//
// One declaration per (face, CSS variable) pair, because several pages dress
// the same family in a different variable name. Webpack emits each woff2 once
// however many declarations point at it.
// ---------------------------------------------------------------------------

import localFont from "next/font/local";

// `next/font` reads these option objects statically at build time, so every
// value here must be a literal — a shared `const` for the fallback stack fails
// the build with "Font loader values must be explicitly written literals".
// That is why the same three stacks are spelled out over and over below.

// --- App Builder (/apps/app-builder) ---------------------------------------

export const appBuilderDisplay = localFont({
  src: "../../../public/fonts/syne-variable.woff2",
  weight: "400 800",
  display: "swap",
  variable: "--font-syne",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export const appBuilderMono = localFont({
  src: "../../../public/fonts/jetbrains-mono-variable.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-jbm",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
});

// --- The Jarvis app pages: Contradicting, Find My Life, iPhone Notes, -------
//     Text Inbox, YouTube videos. One pair, shared by all five.

export const njDisplay = localFont({
  src: "../../../public/fonts/oxanium-variable.woff2",
  weight: "200 800",
  display: "swap",
  variable: "--font-nj-display",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export const njMono = localFont({
  src: "../../../public/fonts/jetbrains-mono-variable.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-nj-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
});

// --- Item Storm Arena (/apps/item-storm-arena) -----------------------------

export const isaDisplay = localFont({
  src: "../../../public/fonts/space-grotesk-variable.woff2",
  weight: "300 700",
  display: "swap",
  variable: "--font-isa-display",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export const isaBody = localFont({
  src: "../../../public/fonts/inter-variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-isa-body",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

// --- God's Eye View --------------------------------------------------------
// Used through `.className`, not a CSS variable. Chakra Petch has no variable
// version upstream, so its three weights are three files.

export const godsEyeDisplay = localFont({
  src: [
    { path: "../../../public/fonts/chakra-petch-500.woff2", weight: "500", style: "normal" },
    { path: "../../../public/fonts/chakra-petch-600.woff2", weight: "600", style: "normal" },
    { path: "../../../public/fonts/chakra-petch-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export const godsEyeMono = localFont({
  src: "../../../public/fonts/jetbrains-mono-variable.woff2",
  weight: "100 800",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
});

// --- APEX/01 Kart Teardown -------------------------------------------------
// Used through `.style.fontFamily`, piped into CSS custom properties.

export const kartDisplay = localFont({
  src: "../../../public/fonts/space-grotesk-variable.woff2",
  weight: "300 700",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export const kartMono = localFont({
  src: "../../../public/fonts/jetbrains-mono-variable.woff2",
  weight: "100 800",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
});

// --- Studio premium flows (Custom Video Swap, Workflow Maker) --------------

export const vsSans = localFont({
  src: "../../../public/fonts/geist-variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-vs",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export const vsMono = localFont({
  src: "../../../public/fonts/geist-mono-variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-vs-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
});

// --- Website Redesigner ----------------------------------------------------
// Six faces, so a skin can change its voice and not just its colours.

export const rdxDisplay = localFont({
  src: "../../../public/fonts/archivo-black-400.woff2",
  weight: "400",
  display: "swap",
  variable: "--font-rdx-display",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export const rdxBody = localFont({
  src: "../../../public/fonts/space-grotesk-variable.woff2",
  weight: "300 700",
  display: "swap",
  variable: "--font-rdx-body",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export const rdxMono = localFont({
  src: "../../../public/fonts/jetbrains-mono-variable.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-rdx-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
});

export const rdxSerif = localFont({
  src: "../../../public/fonts/instrument-serif-400.woff2",
  weight: "400",
  display: "swap",
  variable: "--font-rdx-serif",
  fallback: ["Georgia", "Cambria", "Times New Roman", "serif"],
});

export const rdxSans = localFont({
  src: "../../../public/fonts/inter-variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-rdx-sans",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export const rdxSyne = localFont({
  src: "../../../public/fonts/syne-variable.woff2",
  weight: "400 800",
  display: "swap",
  variable: "--font-rdx-syne",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});
