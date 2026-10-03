import { Bible } from "@/components/bible/Bible";
import { isRoom } from "@/lib/bible/rooms";

export const metadata = {
  title: "Financial Bible · Ultimate Assistant OS",
  description:
    "Every business idea you have had, each one holding the costed, sourced, ordered plan for actually "
    + "building it — and an agent that will argue with you about it.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ studio?: string }>;
}) {
  // `?studio=` is how Jarvis, and any link, points at one room. Null — no room,
  // or one that is not a room — means the shell resumes whichever was last open.
  const { studio } = await searchParams;
  return <Bible initialRoom={isRoom(studio) ? studio : null} />;
}
