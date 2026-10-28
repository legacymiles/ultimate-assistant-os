"use client";

// Find a recipe in two taps. One search bar (name OR main ingredient), meal
// chips (breakfast … fun food), main-ingredient chips (chicken, tuna, beef…),
// and "my rank above 4 / 6 / 8" — the owner's filters, Oct 2026.
//
// Used in two places: Explore › Recipes (everyone's) and Cookbooks › My
// recipes (my own, the cookbooks I saved, and anything I ranked).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCook } from "../CookConnect";
import { loadVisibleRecipes, mySaves, type RecipeWithContext } from "@/lib/cook-connect/social";
import {
  activeFilterCount, EMPTY_FILTER, filterRecipes, MAIN_INGREDIENTS, MEALS, MIN_RANKS, sortRecipes, toggleIn,
  type RecipeFilter, type RecipeSort,
} from "@/lib/cook-connect/categories";
import { usePersonal } from "@/lib/cook-connect/personal";
import { Button, EmptyState, Panel, SearchField, Select, TabStrip, cx } from "../ui";
import { PlateIcon, SearchIcon } from "../icons";
import { RecipeCard } from "./RecipeCard";
import { Reveal } from "./Reveal";

export type BrowseScope = "everyone" | "mine";

export function RecipeBrowser({ initialScope = "everyone", lockScope }: { initialScope?: BrowseScope; lockScope?: boolean }) {
  const { sb, userId, navigate } = useCook();
  const { ranks, settings, setRank } = usePersonal(userId);
  const [scope, setScope] = useState<BrowseScope>(initialScope);
  const [filter, setFilter] = useState<RecipeFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<RecipeSort>(initialScope === "mine" ? "rank" : "newest");
  const [all, setAll] = useState<RecipeWithContext[]>([]);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [moreIngredients, setMoreIngredients] = useState(false);

  const load = useCallback(async () => {
    const [recipes, mine] = await Promise.all([
      loadVisibleRecipes(sb, userId),
      userId ? mySaves(sb, userId) : Promise.resolve(new Set<string>()),
    ]);
    setAll(recipes);
    setSaved(mine);
    setLoading(false);
  }, [sb, userId]);

  useEffect(() => { void load(); }, [load]);

  /** My cookbook = recipes I wrote, recipes in cookbooks I saved, and anything I ranked. */
  const pool = useMemo(() => (
    scope === "everyone"
      ? all
      : all.filter((r) => r.author_id === userId || saved.has(r.cookbook_id) || ranks[r.id])
  ), [scope, all, userId, saved, ranks]);

  const shown = useMemo(
    () => sortRecipes(filterRecipes(pool, filter, ranks), sort, ranks),
    [pool, filter, ranks, sort],
  );

  const set = (patch: Partial<RecipeFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const active = activeFilterCount(filter);
  const ingredientChips = moreIngredients ? MAIN_INGREDIENTS : MAIN_INGREDIENTS.slice(0, 10);
  const rankedCount = Object.keys(ranks).filter((id) => pool.some((r) => r.id === id)).length;

  return (
    <div>
      <div className="z-10 mb-4 md:sticky md:top-12 rounded-[var(--cc-radius)] border border-[var(--cc-line)]
                      bg-[color-mix(in_srgb,var(--cc-panel)_92%,transparent)] shadow-[var(--cc-shadow)] backdrop-blur-md">
        <div className="space-y-2.5 p-2.5 md:p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <SearchField
                value={filter.term}
                onChange={(term) => set({ term })}
                placeholder="Search a dish or ingredient — chicken, rice…"
                icon={<SearchIcon size={14} />}
              />
            </div>
            {!lockScope && (
              <TabStrip
                tabs={[
                  { id: "everyone" as const, label: "Everyone" },
                  { id: "mine" as const, label: "My cookbook" },
                ]}
                active={scope}
                onChange={(s) => { setScope(s); if (s === "mine") setSort("rank"); }}
              />
            )}
          </div>

          <div className="cc-chip-rail" aria-label="Meal">
            {MEALS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="cc-chip"
                aria-pressed={filter.meals.includes(m.id)}
                onClick={() => set({ meals: toggleIn(filter.meals, m.id) })}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="cc-chip-rail" aria-label="Main ingredient">
            {ingredientChips.map((ing) => (
              <button
                key={ing.id}
                type="button"
                className="cc-chip"
                aria-pressed={filter.ingredients.includes(ing.id)}
                onClick={() => set({ ingredients: toggleIn(filter.ingredients, ing.id) })}
              >
                {ing.label}
              </button>
            ))}
            <button type="button" className="cc-chip" onClick={() => setMoreIngredients((v) => !v)}>
              {moreIngredients ? "Fewer" : `+${MAIN_INGREDIENTS.length - 10} more`}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">My rank</span>
            <div className="flex gap-1" role="radiogroup" aria-label="Only recipes I ranked at least">
              {MIN_RANKS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={filter.minRank === n}
                  aria-pressed={filter.minRank === n}
                  className="cc-chip !h-7 !px-2.5"
                  onClick={() => set({ minRank: n })}
                >
                  {n === 0 ? "Any" : `${n}+`}
                </button>
              ))}
            </div>
            <span className="ml-auto flex items-center gap-2">
              <Select value={sort} onChange={(e) => setSort(e.target.value as RecipeSort)} aria-label="Sort" className="!w-auto !py-1 text-[12px]">
                <option value="rank">My rank first</option>
                <option value="newest">Newest first</option>
                <option value="az">A–Z</option>
              </Select>
              {active > 0 && (
                <Button variant="ghost" onClick={() => setFilter(EMPTY_FILTER)}>Clear ({active})</Button>
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="mb-2 flex items-baseline justify-between px-1 text-[12px] text-[var(--cc-ink-faint)]">
        <span>
          <span className="cc-num font-semibold text-[var(--cc-ink-muted)]">{shown.length}</span>
          {" "}recipe{shown.length === 1 ? "" : "s"}
          {scope === "mine" && <> · <span className="cc-num">{rankedCount}</span> ranked</>}
        </span>
        {filter.minRank > 0 && <span>Only recipes you ranked {filter.minRank} or higher</span>}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="cc-skeleton aspect-[4/5]" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<PlateIcon size={28} />}
            title={
              active > 0 ? "Nothing matches those filters"
                : scope === "mine" ? "Your cookbook is empty" : "No recipes yet"
            }
            body={
              filter.minRank > 0
                ? `Only recipes you've ranked ${filter.minRank}+ show here. Open a recipe and tap a number from 1 to 10 to rank it.`
                : active > 0
                  ? "Take a chip off, or try a different ingredient."
                  : scope === "mine"
                    ? "Recipes you write, recipes in cookbooks you save, and anything you rank all land here."
                    : "Be the first — start a cookbook and add a recipe from a link, a photo or your own words."
            }
            action={
              active > 0
                ? <Button onClick={() => setFilter(EMPTY_FILTER)}>Clear filters</Button>
                : <Button variant="primary" onClick={() => navigate({ page: "new-cookbook" })}>Start a cookbook</Button>
            }
          />
        </Panel>
      ) : (
        <ul className={cx("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4")}>
          {shown.map((r, i) => (
            <Reveal key={r.id} as="li" index={i}>
              <RecipeCard
                recipe={r}
                rank={ranks[r.id] ?? null}
                showRank={settings.showRanksOnCards}
                onRank={(n) => setRank(r.id, n)}
                onOpen={() => navigate({ page: "recipe", id: r.id, cookbookId: r.cookbook_id })}
                onAuthor={() => navigate({ page: "profile", userId: r.author_id })}
              />
            </Reveal>
          ))}
        </ul>
      )}
    </div>
  );
}
