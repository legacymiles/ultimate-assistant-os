import { JarvisAudioStudio } from "@/components/jarvis-audio-studio/JarvisAudioStudio";
import { isSection } from "@/lib/jarvis-audio-studio/sections";

export const metadata = {
  title: "Jarvis Audio Studio · Ultimate Assistant OS",
  description:
    "Three studios behind one switcher: find and download a recording, file your library by how it hits, " +
    "and write, plan and render songs of your own.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  // `?section=` is how the three old routes hand over, and how Jarvis points at
  // one studio in particular. Null — no section, or one that is not a studio —
  // means the shell resumes whichever one was last open.
  const { section } = await searchParams;
  return <JarvisAudioStudio initialSection={isSection(section) ? section : null} />;
}
