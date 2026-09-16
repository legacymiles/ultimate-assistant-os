import { MusicCreator } from "@/components/music-creator/MusicCreator";

export const metadata = {
  title: "Music Creator · Ultimate Assistant OS",
  description:
    "A music creation studio: write, plan and render full songs with YuE2, mash up a melody with another sound, " +
    "and keep cloned voices in a library that only has to be built once.",
};

export default function Page() {
  return <MusicCreator />;
}
