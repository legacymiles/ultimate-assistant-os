import { GameCreator } from "@/components/game-creator/GameCreator";

export const metadata = {
  title: "Game Creator · Ultimate Assistant OS",
  description:
    "Describe a game and Unreal Engine on your PC builds it: design, Blueprint gameplay, playtest, screenshots and a packaged game, all collected in one gallery.",
};

export default function Page() {
  return <GameCreator />;
}
