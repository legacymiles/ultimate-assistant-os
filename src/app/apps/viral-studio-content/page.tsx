import { GeistSans } from "geist/font/sans";

import { ViralStudio } from "@/components/viral-studio/ViralStudio";

export const metadata = {
  title: "Viral Studio Content · Ultimate Assistant OS",
  description:
    "Four boards — viral audio, fights, dances and motion. Paste a link and it lands in the tab you're on; hover a clip to watch it; one tap deletes it.",
};

export default function Page() {
  return <ViralStudio fontClass={GeistSans.variable} />;
}
