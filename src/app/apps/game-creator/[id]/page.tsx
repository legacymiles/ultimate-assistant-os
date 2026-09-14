import { GamePage } from "@/components/game-creator/GamePage";

export const metadata = {
  title: "Game · Game Creator · Ultimate Assistant OS",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GamePage id={id} />;
}
