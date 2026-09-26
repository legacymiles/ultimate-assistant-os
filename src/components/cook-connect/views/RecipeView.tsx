"use client";

// The one screen in Cook Connect that is read rather than scanned, so it is
// the one screen set in a serif at a comfortable measure. Everything else here
// is a table; a recipe is a page you cook from with your hands full.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns } from "../Columns";
import type { Profile, Recipe } from "@/lib/cook-connect/types";
import {
  Avatar, Button, EmptyState, Loading, Panel, SectionHead, Spinner, Tag, Textarea, cx,
} from "../ui";
import { ClockIcon, PeopleIcon, SparkIcon } from "../icons";
import { recipeImageUrl } from "@/components/cook-connect/imageGen";

/** Multiply an amount for a different number of servings, tidily. */
function scaleAmount(amount: string, factor: number): string {
  const n = parseFloat(amount);
  if (Number.isNaN(n)) return amount;
  const scaled = n * factor;
  const rounded = Math.round(scaled * 100) / 100;
  return String(rounded);
}

export function RecipeView({ recipeId, cookbookId }: { recipeId: string; cookbookId: string }) {
  const { sb, userId, navigate, notify } = useCook();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [author, setAuthor] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [serves, setServes] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [revising, setRevising] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await sb.from("recipes").select("*").eq("id", recipeId).maybeSingle();
    const found = (data as Recipe) ?? null;
    setRecipe(found);
    setServes(found?.servings ?? null);
    if (found) {
      const { data: who } = await sb.from("profiles").select("*").eq("id", found.author_id).maybeSingle();
      setAuthor((who as Profile) ?? null);
    }
    setLoading(false);
  }, [sb, recipeId]);

  useEffect(() => { void load(); }, [load]);

  const factor = useMemo(
    () => (recipe && serves ? serves / recipe.servings : 1),
    [recipe, serves],
  );

  if (loading) return <Columns><Loading label="Opening recipe" /></Columns>;
  if (!recipe) {
    return (
      <Columns>
        <Panel>
          <EmptyState
            title="That recipe is not here"
            body="It may have been deleted, or it lives in a cookbook that is now private."
            action={<Button onClick={() => navigate({ page: "cookbook", id: cookbookId })}>Back to the cookbook</Button>}
          />
        </Panel>
      </Columns>
    );
  }

  const isMine = recipe.author_id === userId;
  const total = (recipe.prep_time ?? 0) + (recipe.cook_time ?? 0);

  /** Rewrite the saved recipe from a sentence, then store the result. */
  const reviseWithAi = async () => {
    if (!recipe || !note.trim()) return;
    setRevising(true);
    try {
      const res = await fetch("/api/cook-connect/recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "revise",
          note,
          recipe: {
            title: recipe.title,
            description: recipe.description ?? "",
            ingredients: recipe.ingredients,
            instructions: recipe.instructions,
            tags: recipe.tags,
            prep_time: recipe.prep_time ?? 0,
            cook_time: recipe.cook_time ?? 0,
            servings: recipe.servings,
          },
        }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status}).`);
      const next = await res.json();

      // A changed dish deserves a changed photo, but a changed cooking time
      // does not, so the image is only remade when the title moved.
      const titleChanged = next.title.trim() !== recipe.title.trim();
      const patch = {
        title: next.title,
        description: next.description || null,
        ingredients: next.ingredients,
        instructions: next.instructions,
        tags: next.tags,
        prep_time: next.prep_time,
        cook_time: next.cook_time,
        servings: next.servings,
        ...(titleChanged ? { image_url: recipeImageUrl(next.title, next.description) } : {}),
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from("recipes").update(patch).eq("id", recipe.id);
      if (error) { notify(`Could not save the rewrite: ${error.message}`); return; }
      setNote("");
      notify(next.offline ? "Rewritten offline — no AI key is set." : "Recipe rewritten.");
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't rewrite that.");
    } finally {
      setRevising(false);
    }
  };

  const newPhoto = async () => {
    if (!recipe) return;
    setRegenerating(true);
    const url = recipeImageUrl(recipe.title, recipe.description ?? "", "", "", Date.now() % 100000);
    const { error } = await sb.from("recipes").update({ image_url: url }).eq("id", recipe.id);
    setRegenerating(false);
    if (error) { notify(`Could not save the photo: ${error.message}`); return; }
    await load();
  };

  const remove = async () => {
    await sb.from("recipes").delete().eq("id", recipe.id);
    notify(`${recipe.title} removed.`);
    navigate({ page: "cookbook", id: cookbookId });
  };

  return (
    <Columns
      rail={
        <>
          <Panel>
            <SectionHead title="Ingredients" count={recipe.ingredients.length} />
            <div className="p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[12px] text-[var(--cc-ink-muted)]">Scale to</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    className="h-7 w-7 px-0"
                    aria-label="Fewer servings"
                    onClick={() => setServes((s) => Math.max(1, (s ?? recipe.servings) - 1))}
                  >
                    −
                  </Button>
                  <span className="cc-num w-[46px] text-center text-[13px] font-semibold">
                    {serves ?? recipe.servings}
                  </span>
                  <Button
                    variant="secondary"
                    className="h-7 w-7 px-0"
                    aria-label="More servings"
                    onClick={() => setServes((s) => Math.min(24, (s ?? recipe.servings) + 1))}
                  >
                    +
                  </Button>
                </div>
              </div>

              <ul className="space-y-1.5">
                {recipe.ingredients.map((ing, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-[13px]">
                    <span className="cc-num shrink-0 font-semibold text-[var(--cc-ember)]">
                      {scaleAmount(ing.amount, factor)}{ing.unit && ` ${ing.unit}`}
                    </span>
                    <span className="text-[var(--cc-ink-muted)]">{ing.name}</span>
                  </li>
                ))}
              </ul>

              {factor !== 1 && (
                <p className="mt-3 border-t border-[var(--cc-line-soft)] pt-2 text-[11px] leading-relaxed text-[var(--cc-ink-faint)]">
                  Scaled from {recipe.servings}. Times below are for the original batch — a bigger pan
                  usually wants a little longer.
                </p>
              )}
            </div>
          </Panel>

          {isMine && (
            <>
              <Panel>
                <SectionHead title="Change it in words" />
                <div className="space-y-2 p-3">
                  <Textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Make it vegan. Double it. Swap the cream for coconut milk."
                    aria-label="What to change about this recipe"
                  />
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={!note.trim() || revising}
                    onClick={() => void reviseWithAi()}
                  >
                    {revising ? <Spinner size={14} /> : <SparkIcon size={14} />}
                    {revising ? "Rewriting" : "Rewrite this recipe"}
                  </Button>
                  <p className="text-[11px] leading-relaxed text-[var(--cc-ink-faint)]">
                    The recipe is replaced in place. If the dish would look different afterwards, the
                    photo is remade too.
                  </p>
                </div>
              </Panel>

              <Panel>
                <SectionHead title="Yours" />
                <div className="space-y-2 p-3">
                  <Button
                    className="w-full"
                    disabled={regenerating}
                    onClick={() => void newPhoto()}
                  >
                    {regenerating ? <Spinner size={14} /> : null}
                    New photo
                  </Button>
                  <Button variant="danger" className="w-full" onClick={() => void remove()}>
                    Delete this recipe
                  </Button>
                </div>
              </Panel>
            </>
          )}
        </>
      }
    >
      <article>
        {recipe.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={recipe.image_url}
            alt=""
            className="mb-4 aspect-[16/9] w-full rounded-[var(--cc-radius)] border border-[var(--cc-line)] object-cover"
          />
        )}

        <h1 className="text-[26px] font-bold leading-tight tracking-tight">{recipe.title}</h1>

        {recipe.description && (
          <p className="cc-prose mt-2 text-[var(--cc-ink-muted)]">{recipe.description}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-[var(--cc-line)] py-2.5 text-[12px]">
          <button
            type="button"
            onClick={() => navigate({ page: "profile", userId: recipe.author_id })}
            className="flex items-center gap-2"
          >
            <Avatar id={recipe.author_id} name={author?.display_name ?? "Member"} url={author?.avatar_url} size={22} />
            <span className="font-semibold transition-colors hover:text-[var(--cc-ember)]">
              {isMine ? "You" : author?.display_name ?? "Member"}
            </span>
          </button>

          {total > 0 && (
            <span className="flex items-center gap-1.5 text-[var(--cc-ink-muted)]">
              <ClockIcon size={14} />
              <span className="cc-num">{total}</span> min
              {recipe.prep_time !== null && recipe.cook_time !== null && (
                <span className="cc-num text-[var(--cc-ink-faint)]">
                  ({recipe.prep_time} prep · {recipe.cook_time} cook)
                </span>
              )}
            </span>
          )}

          <span className="flex items-center gap-1.5 text-[var(--cc-ink-muted)]">
            <PeopleIcon size={14} />
            serves <span className="cc-num">{recipe.servings}</span>
          </span>

          {recipe.tags.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {recipe.tags.map((t) => <Tag key={t} tone="ember">{t}</Tag>)}
            </span>
          )}
        </div>

        <h2 className="mt-6 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--cc-ink-muted)]">
          Method
        </h2>
        <ol className="mt-3 space-y-3">
          {recipe.instructions.map((step) => {
            const checked = done.has(step.step);
            return (
              <li key={step.step}>
                <button
                  type="button"
                  onClick={() => setDone((prev) => {
                    const next = new Set(prev);
                    if (checked) next.delete(step.step);
                    else next.add(step.step);
                    return next;
                  })}
                  className="flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left
                             transition-colors duration-150 hover:bg-[var(--cc-panel)]"
                  aria-pressed={checked}
                >
                  <span
                    className={cx(
                      "cc-num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold",
                      checked
                        ? "border-[var(--cc-ember)] bg-[var(--cc-ember)] text-[#1b0f05]"
                        : "border-[var(--cc-line)] text-[var(--cc-ink-faint)]",
                    )}
                  >
                    {step.step}
                  </span>
                  <span
                    className={cx(
                      "cc-prose flex-1",
                      checked ? "text-[var(--cc-ink-faint)] line-through decoration-[var(--cc-ink-faint)]" : "text-[var(--cc-ink)]",
                    )}
                  >
                    {step.text}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <p className="mt-5 text-[11px] text-[var(--cc-ink-faint)]">
          Tap a step to cross it off while you cook. Nothing is saved — it clears when you leave.
        </p>
      </article>
    </Columns>
  );
}
