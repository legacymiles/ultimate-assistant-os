"use client";

import Link from "next/link";
import type { Game } from "@/lib/game-creator/types";
import { ago, shotUrl } from "./api";
import { StatusPill } from "./StatusPill";

// One tile in the gallery. A finished game shows its first screenshot; a game
// still in the pipeline shows an animated stage card so the wall of games
// reads as "being built" rather than "broken images".

const STAGES = ["queued", "designing", "building", "testing", "packaging", "ready"] as const;

export function GameCard({ game }: { game: Game }) {
  const cover = game.screenshots.length ? shotUrl(game.id, 0) : null;
  const stageIndex = STAGES.indexOf(game.status as (typeof STAGES)[number]);

  return (
    <Link
      href={`/apps/game-creator/${game.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-panel transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[0_12px_40px_-12px] hover:shadow-brand/30"
    >
      <div className="relative aspect-video overflow-hidden bg-canvas">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="gc-forge absolute inset-0" data-status={game.status}>
            <div className="gc-forge__grid" />
            <div className="gc-forge__scan" />
          </div>
        )}
        <div className="absolute left-2 top-2">
          <StatusPill status={game.status} />
        </div>
        {game.screenshots.length > 1 && (
          <span className="absolute bottom-2 right-2 rounded-md bg-canvas/80 px-1.5 py-0.5 text-[10px] text-ink-muted backdrop-blur">
            {game.screenshots.length} shots
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="line-clamp-1 text-sm font-semibold text-ink">{game.title ?? "Untitled game"}</p>
        <p className="line-clamp-2 text-xs text-ink-muted">{game.summary ?? game.prompt}</p>

        {stageIndex >= 0 && game.status !== "ready" && (
          <div className="mt-1 flex gap-1" aria-hidden>
            {STAGES.slice(1).map((s, i) => (
              <span
                key={s}
                className={`h-1 flex-1 rounded-full ${i + 1 < stageIndex ? "bg-brand" : i + 1 === stageIndex ? "animate-pulse bg-brand/70" : "bg-line"}`}
              />
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center gap-2 pt-1.5 text-[11px] text-ink-faint">
          <span className="truncate">{game.note && game.status !== "ready" ? game.note : game.genre ?? game.template}</span>
          <span className="ml-auto shrink-0">{ago(game.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}
