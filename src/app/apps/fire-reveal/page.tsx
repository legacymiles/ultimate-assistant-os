import type { Metadata } from "next";
import FireRevealClient from "./FireRevealClient";

export const metadata: Metadata = {
  title: "EMBER · WebGL Image Reveal",
  description:
    "A WebGL mouse-trail image-reveal studio. Move to scan the top image away and reveal what's hidden underneath, click to flash, and upload your own two images with live rim-tint presets.",
};

export default function Page() {
  return <FireRevealClient />;
}
