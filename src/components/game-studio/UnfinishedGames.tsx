"use client";

// ---------------------------------------------------------------------------
// Game Studio › Unfinished games — games that play but aren't done.
//
// Each row is playable in place; "Finish it" files the rest of the work in the
// owner's In Queue (folder app:game-studio) for Claude Code — the same request
// API App Builder's Build it and Jarvis's queue_build use.
// ---------------------------------------------------------------------------

import { UNFINISHED_GAMES, finishRequest } from "@/lib/studio-home/games";
import { fileRequest } from "@/lib/studio-home/fileRequest";
import { PlayShelf, type ShelfItem } from "../studio-home/PlayShelf";

const ITEMS: ShelfItem[] = UNFINISHED_GAMES.map((g) => ({
  slug: g.slug,
  title: g.title,
  tag: g.tag,
  overview: g.overview,
  route: g.route,
  hue: g.hue,
  cols: [g.missing.slice(0, 2).join(" · ") + (g.missing.length > 2 ? ` +${g.missing.length - 2}` : ""), g.controls],
  chips: g.missing,
  posterNote: g.webgl ? "3D — runs best on a computer with a real graphics card" : undefined,
}));

export function UnfinishedGames() {
  return (
    <PlayShelf
      title="Unfinished games"
      lede="Games that play but aren't done. Play one here, or hand the rest of it to Claude Code."
      count={`${ITEMS.length} in progress`}
      heads={["Game", "Still missing", "Plays with"]}
      items={ITEMS}
      chipsLabel="Still missing"
      action={{
        label: "Finish it",
        doneLabel: "Queued ✓",
        run: async (it) => {
          const game = UNFINISHED_GAMES.find((g) => g.slug === it.slug);
          if (!game) return;
          const r = finishRequest(game);
          const state = await fileRequest(r.folder, r.text);
          return state === "filed"
            ? "Filed in In Queue › Game Studio. Claude Code picks it up and clears it when it's done."
            : "That request was already waiting in In Queue › Game Studio.";
        },
      }}
    />
  );
}
