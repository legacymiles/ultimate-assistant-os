import type { Metadata } from "next";
import SlipperyClient from "./SlipperyClient";

export const metadata: Metadata = {
  title: "Slippery Escape · First-Person Physics Escape",
  description:
    "Trapped in a giant oiled-up bathroom with a glistening bruiser blocking the only door. Build momentum, juke him out, and slide to the exit — without wiping out.",
};

export default function Page() {
  return <SlipperyClient />;
}
