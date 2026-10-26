import { GameStudio } from "@/components/game-studio/GameStudio";
import { pickSection } from "@/lib/studio-home/sections";
import { GAME_SECTIONS } from "@/lib/studio-home/games";

export const metadata = {
  title: "Game Studio · Ultimate Assistant OS",
  description:
    "Describe a game and Unreal on your PC builds it — and every game that plays but isn't finished yet, playable in place with a Finish it button.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }) {
  const { section } = await searchParams;
  return <GameStudio initialSection={pickSection(GAME_SECTIONS, section)} />;
}
