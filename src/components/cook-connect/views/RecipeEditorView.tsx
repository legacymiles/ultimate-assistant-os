"use client";

// Adding a recipe. Describe the dish in a sentence and the draft arrives
// filled in — then every field is yours to change before it is saved. The
// draft is a starting point, never the final word, so nothing is read-only.

import { useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import { recordActivity } from "@/lib/cook-connect/social";
import { recipeImageUrl } from "@/components/cookbook/imageGen";
import type { Ingredient, Step } from "@/lib/cook-connect/types";
import {
  Button, Field, Input, Panel, SectionHead, Spinner, Tag, Textarea, cx,
} from "../ui";
import { CloseIcon, PlusIcon, SparkIcon } from "../icons";

interface Draft {
  title: string;
  description: string;
  ingredients: Ingredient[];
  instructions: Step[];
  tags: string[];
  prep_time: number;
  cook_time: number;
  servings: number;
}

const BLANK: Draft = {
  title: "",
  description: "",
  ingredients: [{ name: "", amount: "", unit: "" }],
  instructions: [{ step: 1, text: "" }],
  tags: [],
  prep_time: 15,
  cook_time: 20,
  servings: 4,
};

export function RecipeEditorView({ cookbookId }: { cookbookId: string }) {
  const { sb, userId, navigate, notify } = useCook();
  const [idea, setIdea] = useState("");
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [image, setImage] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(false);
  const [note, setNote] = useState("");
  const [revising, setRevising] = useState(false);

  const patch = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }));

  const ask = async (action: "draft" | "revise") => {
    const setBusy = action === "draft" ? setDrafting : setRevising;
    setBusy(true);
    try {
      const res = await fetch("/api/cook-connect/recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "draft" ? { action, prompt: idea } : { action, recipe: draft, note },
        ),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setOffline(!!data.offline);
      setDraft({
        title: data.title,
        description: data.description,
        ingredients: data.ingredients,
        instructions: data.instructions,
        tags: data.tags,
        prep_time: data.prep_time,
        cook_time: data.cook_time,
        servings: data.servings,
      });
      setImage(recipeImageUrl(data.title, data.description));
      if (action === "revise") setNote("");
    } catch (e) {
      notify(e instanceof Error ? e.message : "The kitchen assistant is not answering. Write it yourself below.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!userId || !draft.title.trim()) return;
    setSaving(true);
    const { data: existing } = await sb.from("recipes").select("*").eq("cookbook_id", cookbookId);
    const position = ((existing ?? []) as unknown[]).length;

    const { error } = await sb.from("recipes").insert({
      cookbook_id: cookbookId,
      author_id: userId,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      ingredients: draft.ingredients.filter((i) => i.name.trim()),
      instructions: draft.instructions
        .filter((s) => s.text.trim())
        .map((s, i) => ({ step: i + 1, text: s.text.trim() })),
      tags: draft.tags,
      image_url: image ?? recipeImageUrl(draft.title, draft.description),
      prep_time: draft.prep_time,
      cook_time: draft.cook_time,
      servings: draft.servings,
      position,
    });
    setSaving(false);
    if (error) { notify(`Could not save: ${error.message}`); return; }

    const { data: book } = await sb.from("cookbooks").select("*").eq("id", cookbookId).maybeSingle();
    await recordActivity(sb, {
      kind: "recipe_added",
      actor_id: userId,
      subject_id: cookbookId,
      summary: `added ${draft.title.trim()} to ${book?.title ?? "a cookbook"}`,
    });
    await sb.from("cookbooks").update({ updated_at: new Date().toISOString() }).eq("id", cookbookId);
    notify(`${draft.title.trim()} is in the book.`);
    navigate({ page: "cookbook", id: cookbookId });
  };

  const started = !!draft.title || draft.ingredients.some((i) => i.name);

  return (
    <Columns>
      <PageHead
        title="Add a recipe"
        subtitle="Describe the dish and the draft comes back filled in. Everything below stays editable — the assistant writes the first pass, you write the recipe."
      />

      <Panel className="mb-4">
        <SectionHead title="Start from an idea" />
        <div className="flex flex-wrap items-end gap-2 p-3">
          <div className="min-w-[240px] flex-1">
            <Field label="What are you making?">
              <Input
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && idea.trim()) void ask("draft"); }}
                placeholder="A one-pan lemon chicken with orzo, enough for four"
              />
            </Field>
          </div>
          <Button variant="primary" disabled={!idea.trim() || drafting} onClick={() => void ask("draft")}>
            {drafting ? <Spinner size={14} /> : <SparkIcon size={14} />}
            {drafting ? "Writing" : "Draft it"}
          </Button>
        </div>
        {offline && (
          <p className="border-t border-[var(--cc-line)] px-3 py-2 text-[11px] leading-relaxed text-[var(--cc-gold)]">
            No AI key is set, so that draft is a template rather than a real recipe. Everything below is
            still yours to write.
          </p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-4">
          <Panel>
            <SectionHead title="The dish" />
            <div className="space-y-3 p-3">
              <Field label="Title">
                <Input
                  value={draft.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  placeholder="Lemon chicken with orzo"
                />
              </Field>
              <Field label="One line about it">
                <Textarea
                  rows={2}
                  value={draft.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder="Bright, lemony, and all in one pan."
                />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Prep (min)">
                  <Input
                    type="number"
                    min={0}
                    value={draft.prep_time}
                    onChange={(e) => patch({ prep_time: Number(e.target.value) })}
                    className="cc-num"
                  />
                </Field>
                <Field label="Cook (min)">
                  <Input
                    type="number"
                    min={0}
                    value={draft.cook_time}
                    onChange={(e) => patch({ cook_time: Number(e.target.value) })}
                    className="cc-num"
                  />
                </Field>
                <Field label="Serves">
                  <Input
                    type="number"
                    min={1}
                    value={draft.servings}
                    onChange={(e) => patch({ servings: Math.max(1, Number(e.target.value)) })}
                    className="cc-num"
                  />
                </Field>
              </div>
              <TagEditor tags={draft.tags} onChange={(tags) => patch({ tags })} />
            </div>
          </Panel>

          <Panel>
            <SectionHead
              title="Ingredients"
              count={draft.ingredients.filter((i) => i.name).length}
              action={
                <Button
                  variant="ghost"
                  onClick={() => patch({ ingredients: [...draft.ingredients, { name: "", amount: "", unit: "" }] })}
                >
                  <PlusIcon size={13} />
                  Add
                </Button>
              }
            />
            <ul className="p-2">
              {draft.ingredients.map((ing, i) => (
                <li key={i} className="flex items-center gap-1.5 py-1">
                  <Input
                    value={ing.amount}
                    onChange={(e) => {
                      const next = [...draft.ingredients];
                      next[i] = { ...ing, amount: e.target.value };
                      patch({ ingredients: next });
                    }}
                    placeholder="2"
                    aria-label={`Amount for ingredient ${i + 1}`}
                    className="cc-num w-[64px] shrink-0 text-center"
                  />
                  <Input
                    value={ing.unit}
                    onChange={(e) => {
                      const next = [...draft.ingredients];
                      next[i] = { ...ing, unit: e.target.value };
                      patch({ ingredients: next });
                    }}
                    placeholder="tbsp"
                    aria-label={`Unit for ingredient ${i + 1}`}
                    className="w-[76px] shrink-0"
                  />
                  <Input
                    value={ing.name}
                    onChange={(e) => {
                      const next = [...draft.ingredients];
                      next[i] = { ...ing, name: e.target.value };
                      patch({ ingredients: next });
                    }}
                    placeholder="olive oil"
                    aria-label={`Ingredient ${i + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => patch({ ingredients: draft.ingredients.filter((_, n) => n !== i) })}
                    aria-label={`Remove ingredient ${i + 1}`}
                    className="shrink-0 rounded-md p-1.5 text-[var(--cc-ink-faint)] transition-colors
                               hover:bg-[var(--cc-panel-2)] hover:text-[var(--cc-loss)]"
                  >
                    <CloseIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <SectionHead
              title="Method"
              count={draft.instructions.filter((s) => s.text).length}
              action={
                <Button
                  variant="ghost"
                  onClick={() => patch({
                    instructions: [...draft.instructions, { step: draft.instructions.length + 1, text: "" }],
                  })}
                >
                  <PlusIcon size={13} />
                  Add
                </Button>
              }
            />
            <ol className="p-2">
              {draft.instructions.map((step, i) => (
                <li key={i} className="flex items-start gap-2 py-1">
                  <span className="cc-num mt-2 w-5 shrink-0 text-right text-[12px] font-semibold text-[var(--cc-ink-faint)]">
                    {i + 1}
                  </span>
                  <Textarea
                    rows={2}
                    value={step.text}
                    onChange={(e) => {
                      const next = [...draft.instructions];
                      next[i] = { ...step, text: e.target.value };
                      patch({ instructions: next });
                    }}
                    placeholder="What happens at this step?"
                    aria-label={`Step ${i + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => patch({ instructions: draft.instructions.filter((_, n) => n !== i) })}
                    aria-label={`Remove step ${i + 1}`}
                    className="mt-1.5 shrink-0 rounded-md p-1.5 text-[var(--cc-ink-faint)] transition-colors
                               hover:bg-[var(--cc-panel-2)] hover:text-[var(--cc-loss)]"
                  >
                    <CloseIcon size={14} />
                  </button>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel>
            <SectionHead title="Photo" />
            <div className="p-3">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt=""
                  className="aspect-[4/3] w-full rounded-md border border-[var(--cc-line)] object-cover"
                />
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border
                                border-dashed border-[var(--cc-line)] bg-[var(--cc-panel-2)] text-[var(--cc-ink-faint)]">
                  <SparkIcon size={22} />
                </div>
              )}
              <Button
                className="mt-2 w-full"
                disabled={!draft.title.trim()}
                onClick={() => setImage(recipeImageUrl(draft.title, draft.description, "", "", Date.now() % 100000))}
              >
                {image ? "Another photo" : "Make a photo"}
              </Button>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--cc-ink-faint)]">
                Generated from the title and description. Free, and no key needed.
              </p>
            </div>
          </Panel>

          {started && (
            <Panel>
              <SectionHead title="Change something" />
              <div className="space-y-2 p-3">
                <Textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Make it vegan. Double it. Cut the cooking time."
                  aria-label="What to change"
                />
                <Button
                  className="w-full"
                  disabled={!note.trim() || revising}
                  onClick={() => void ask("revise")}
                >
                  {revising ? <Spinner size={14} /> : <SparkIcon size={14} />}
                  {revising ? "Rewriting" : "Rewrite it"}
                </Button>
              </div>
            </Panel>
          )}

          <div className={cx("sticky bottom-4 space-y-2")}>
            <Button
              variant="primary"
              className="w-full py-2"
              disabled={!draft.title.trim() || saving}
              onClick={() => void save()}
            >
              {saving && <Spinner size={14} />}
              Save to the cookbook
            </Button>
            <Button className="w-full" onClick={() => navigate({ page: "cookbook", id: cookbookId })}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </Columns>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [entry, setEntry] = useState("");

  const add = () => {
    const value = entry.trim().toLowerCase();
    if (!value || tags.includes(value) || tags.length >= 8) { setEntry(""); return; }
    onChange([...tags, value]);
    setEntry("");
  };

  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">
        Tags
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="inline-flex items-center gap-1 rounded-md border border-[#4a2e17] bg-[var(--cc-ember-wash)]
                       px-1.5 py-0.5 text-[11px] font-medium text-[var(--cc-ember)] transition-colors
                       hover:border-[var(--cc-loss)] hover:text-[var(--cc-loss)]"
            aria-label={`Remove tag ${t}`}
          >
            {t}
            <CloseIcon size={11} />
          </button>
        ))}
        <Input
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          }}
          onBlur={add}
          placeholder={tags.length ? "Another" : "dinner, chicken, italian"}
          aria-label="Add a tag"
          className="w-[150px]"
        />
      </div>
      {tags.length === 0 && (
        <p className="mt-1 text-[11px] text-[var(--cc-ink-faint)]">
          Course, protein, cuisine, diet. These are what people search on.
        </p>
      )}
      {tags.length > 0 && <Tag>{tags.length} of 8</Tag>}
    </div>
  );
}
