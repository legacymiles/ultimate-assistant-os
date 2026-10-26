"use client";

// ---------------------------------------------------------------------------
// Game Studio — make a game, and finish the ones in progress.
//
// The StudioHome shell with Game Creator mounted `embedded` as Create, and the
// Unfinished games shelf beside it. /apps/game-creator redirects to Create;
// game detail pages stay at /apps/game-creator/<id>.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { HomeSkeleton, StudioHome, type SectionComponent } from "../studio-home/StudioHome";
import { GAME_DEFAULT, GAME_REMEMBER, GAME_SECTIONS, type GameSection } from "@/lib/studio-home/games";

const COMPONENTS: Record<GameSection, SectionComponent> = {
  create: dynamic(() => import("../game-creator/GameCreator").then((m) => m.GameCreator), {
    ssr: false,
    loading: () => <HomeSkeleton shape="grid" />,
  }),
  unfinished: dynamic(() => import("./UnfinishedGames").then((m) => m.UnfinishedGames), {
    ssr: false,
    loading: () => <HomeSkeleton />,
  }),
};

export function GameStudio({ initialSection }: { initialSection: GameSection | null }) {
  return (
    <StudioHome
      brand={{ name: "Game", em: "Studio", tagline: "Make a game, finish the ones in progress", icon: "Flag" }}
      sections={GAME_SECTIONS}
      components={COMPONENTS}
      rememberKey={GAME_REMEMBER}
      initialSection={initialSection}
      defaultSection={GAME_DEFAULT}
    />
  );
}
