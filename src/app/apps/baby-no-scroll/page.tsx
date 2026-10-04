import { BabyNoScroll } from "@/components/baby-no-scroll/BabyNoScroll";

export const metadata = {
  title: "Baby No Scroll · Ultimate Assistant OS",
  description:
    "Hand over the screen, not the device. One video or one game fills it, everything else is taken "
    + "away, and the only thing left that answers to a touch is a padlock that opens by being dragged "
    + "the width of the screen.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  // `?mode=` lets a link — from Jarvis, or a home-screen shortcut — open the
  // console already on the right tab. Anything else just resumes last time.
  const { mode } = await searchParams;
  return <BabyNoScroll initialMode={mode === "games" || mode === "youtube" ? mode : undefined} />;
}
