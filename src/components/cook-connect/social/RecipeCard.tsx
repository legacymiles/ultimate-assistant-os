"use client";

// One recipe as a card: the photo big, the title on a scrim, who made it, what
// kind of dish it is, and — if you have ranked it — your rank. The rank button
// on the card lets you rank without opening the recipe.

import { useEffect, useRef, useState } from "react";
import type { RecipeWithContext } from "@/lib/cook-connect/social";
import { MEAL_BY_ID, mealsOf } from "@/lib/cook-connect/categories";
import { Avatar, cx } from "../ui";
import { ClockIcon, PlateIcon } from "../icons";
import { RankBadge, RankPicker } from "./RankPicker";

export function RecipeCard({
  recipe, rank, onRank, onOpen, onAuthor, showRank = true, size = "grid",
}: {
  recipe: RecipeWithContext;
  rank: number | null;
  onRank: (rank: number | null) => void;
  onOpen: () => void;
  onAuthor?: () => void;
  showRank?: boolean;
  size?: "grid" | "feed";
}) {
  const [ranking, setRanking] = useState(false);
  const pop = useRef<HTMLDivElement | null>(null);
  const meals = mealsOf(recipe).slice(0, 2);
  const total = (recipe.prep_time ?? 0) + (recipe.cook_time ?? 0);

  // Close the rank popover on an outside tap or Escape.
  useEffect(() => {
    if (!ranking) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof PointerEvent && pop.current?.contains(e.target as Node)) return;
      setRanking(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [ranking]);

  return (
    <article className="cc-card group">
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`Open ${recipe.title}`}>
        <div className={cx("cc-card-media", size === "feed" ? "aspect-[4/3] md:aspect-[16/10]" : "aspect-[4/3]")}>
          {recipe.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={recipe.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <Placeholder title={recipe.title} id={recipe.id} />
          )}
          <span className="cc-card-scrim" />
          <div className="absolute inset-x-0 bottom-0 p-3">
            <h3 className={cx(
              "line-clamp-2 font-bold leading-tight tracking-tight text-white drop-shadow",
              size === "feed" ? "text-[19px] md:text-[22px]" : "text-[15px]",
            )}>
              {recipe.title}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {meals.map((m) => (
                <span key={m} className="rounded-full bg-white/14 px-2 py-0.5 text-[10.5px] font-semibold text-white/90 backdrop-blur-sm">
                  {MEAL_BY_ID[m].label}
                </span>
              ))}
              {total > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-black/35 px-2 py-0.5 text-[10.5px] font-semibold text-white/85 backdrop-blur-sm">
                  <ClockIcon size={11} />
                  <span className="cc-num">{total}</span>m
                </span>
              )}
            </div>
          </div>
          {showRank && rank && (
            <span className="absolute left-2.5 top-2.5"><RankBadge rank={rank} size={size === "feed" ? "md" : "sm"} /></span>
          )}
        </div>
      </button>

      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onAuthor}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-label={`Open ${recipe.author?.display_name ?? "the cook"}'s profile`}
        >
          <Avatar
            id={recipe.author_id}
            name={recipe.author?.display_name ?? "Member"}
            url={recipe.author?.avatar_url}
            size={size === "feed" ? 28 : 22}
          />
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-semibold transition-colors hover:text-[var(--cc-ember)]">
              {recipe.author?.display_name ?? "Member"}
            </span>
            {recipe.cookbook && (
              <span className={cx("truncate text-[11px] text-[var(--cc-ink-faint)]", size === "feed" ? "block" : "hidden sm:block")}>
                {recipe.cookbook.title}
              </span>
            )}
          </span>
        </button>

        <div className="relative" ref={pop}>
          <button
            type="button"
            onClick={() => setRanking((v) => !v)}
            aria-expanded={ranking}
            className={cx(
              "rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
              rank
                ? "border-[#4a2e17] bg-[var(--cc-ember-wash)] text-[var(--cc-ember)]"
                : "border-[var(--cc-line)] text-[var(--cc-ink-muted)] hover:text-[var(--cc-ink)]",
            )}
          >
            {rank
              ? <><span className={size === "feed" ? "" : "hidden sm:inline"}>My rank </span><span className="cc-num">{rank}</span>/10</>
              : <>Rank<span className={size === "feed" ? "" : "hidden sm:inline"}> it</span></>}
          </button>
          {ranking && (
            <div className="cc-sheet absolute bottom-[calc(100%+8px)] right-0 z-30 w-[min(280px,calc(100vw-32px))] rounded-xl border
                            border-[var(--cc-line)] bg-[var(--cc-elevated)] p-3 shadow-[var(--cc-shadow)]">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">
                Your rank — only you see it
              </p>
              <RankPicker compact value={rank} onChange={(n) => { onRank(n); if (n) setTimeout(() => setRanking(false), 260); }} />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/** No photo yet: the dish's colour and a plate, not a broken image. */
function Placeholder({ title, id }: { title: string; id: string }) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{
        background: `radial-gradient(120% 120% at 20% 10%, hsl(${hue} 55% 32%), hsl(${(hue + 40) % 360} 45% 14%))`,
      }}
      aria-hidden="true"
    >
      <span className="flex flex-col items-center gap-1 text-white/45">
        <PlateIcon size={34} />
        <span className="text-[26px] font-bold">{title.trim()[0]?.toUpperCase() ?? ""}</span>
      </span>
    </div>
  );
}
