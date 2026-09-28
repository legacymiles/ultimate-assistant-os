"use client";

// Adding a recipe, on the shape Cookbook Genie settled on: two ways in across
// the top, then the draft rendered as a recipe you can read, with one box for
// changing it in words. You are never handed an empty form to fill in.

import { useEffect, useRef, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import { recordActivity } from "@/lib/cook-connect/social";
import { recipeImageUrl } from "@/components/cook-connect/imageGen";
import type { Ingredient, Step } from "@/lib/cook-connect/types";
import {
  Button, Field, Input, Panel, SectionHead, Spinner, Tag, Textarea, cx,
} from "../ui";
import { BookIcon, CloseIcon, SparkIcon } from "../icons";

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

type Mode = "link" | "describe";

const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

/** What the importer is doing, so a long wait reads as progress. */
const IMPORT_STAGES = [
  "Opening the post…",
  "Watching the video…",
  "Picking out the ingredients…",
  "Writing the steps…",
];

export function RecipeEditorView({ cookbookId }: { cookbookId: string }) {
  const { sb, userId, navigate, notify } = useCook();
  const [mode, setMode] = useState<Mode>("link");

  const [link, setLink] = useState("");
  const [caption, setCaption] = useState("");
  const [videoDataUrl, setVideoDataUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [note, setNote] = useState("");
  const [revising, setRevising] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Cycle the stage captions while an import runs.
  useEffect(() => {
    if (!busy || mode !== "link") return;
    const t = setInterval(() => setStage((s) => (s + 1) % IMPORT_STAGES.length), 2600);
    return () => clearInterval(t);
  }, [busy, mode]);

  const canImport = !!link.trim() || !!caption.trim() || !!videoDataUrl;

  /** Ask the classifier for protein / meal / cuisine so tags aren't hand-typed. */
  const autoTag = async (recipe: Draft): Promise<string[]> => {
    try {
      const res = await fetch("/api/cookbook/auto-tag-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: recipe.title,
          description: recipe.description,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
        }),
      });
      if (!res.ok) return recipe.tags;
      const t = await res.json();
      const merged = [
        ...recipe.tags,
        ...(t.protein_tags ?? []),
        ...(t.meal_type_tags ?? []),
        ...(t.cuisine_tags ?? []),
      ].map((x: string) => String(x).toLowerCase().trim()).filter(Boolean);
      return [...new Set(merged)].slice(0, 8);
    } catch {
      return recipe.tags; // tagging is a nicety, not a gate
    }
  };

  const settle = async (next: Draft, isOffline: boolean) => {
    setOffline(isOffline);
    const tagged = { ...next, tags: await autoTag(next) };
    setDraft(tagged);
    setImage(recipeImageUrl(tagged.title, tagged.description));
  };

  /** Paste a cooking video or post and let it read the recipe out. */
  const importFromLink = async () => {
    if (!canImport || busy) return;
    setBusy(true);
    setError(null);
    setStage(0);
    try {
      const res = await fetch("/api/cookbook/import-from-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          link: link.trim() || undefined,
          caption: caption.trim() || undefined,
          videoDataUrl: videoDataUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        // Some failures already name the way out ("…upload the video"); don't
        // say it twice.
        const said = /upload|paste/i.test(String(data.error ?? ""));
        setError(
          data.needsHelp && !said
            ? `${data.error} Paste the caption underneath, or upload the video itself.`
            : data.error || `The import failed (${res.status}).`,
        );
        return;
      }
      const r = data.recipe;
      await settle({
        title: r.title,
        description: r.description,
        ingredients: r.ingredients,
        instructions: r.instructions,
        tags: (r.dietary_tags ?? []).map((t: string) => t.toLowerCase()),
        prep_time: r.prep_time || 15,
        cook_time: r.cook_time || 20,
        servings: r.servings || 4,
      }, false);
      if (data.coverDataUrl) setImage(data.coverDataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  };

  const describeIt = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cook-connect/recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft", prompt }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status}).`);
      const data = await res.json();
      await settle({
        title: data.title,
        description: data.description,
        ingredients: data.ingredients,
        instructions: data.instructions,
        tags: data.tags,
        prep_time: data.prep_time,
        cook_time: data.cook_time,
        servings: data.servings,
      }, !!data.offline);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write that one.");
    } finally {
      setBusy(false);
    }
  };

  const revise = async () => {
    if (!note.trim() || !draft) return;
    setRevising(true);
    try {
      const res = await fetch("/api/cook-connect/recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revise", recipe: draft, note }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status}).`);
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
      setNote("");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't rewrite that.");
    } finally {
      setRevising(false);
    }
  };

  const onVideo = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) { setError("That file isn't a video."); return; }
    if (file.size > MAX_VIDEO_BYTES) {
      setError("That video is over 20 MB. Trim it, or paste the caption instead.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setVideoDataUrl(reader.result as string);
      setVideoName(file.name);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!userId || !draft?.title.trim()) return;
    setSaving(true);
    const { data: existing } = await sb.from("recipes").select("*").eq("cookbook_id", cookbookId);
    const position = ((existing ?? []) as unknown[]).length;

    const { error: err } = await sb.from("recipes").insert({
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
    if (err) { notify(`Could not save: ${err.message}`); return; }

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

  return (
    <Columns>
      <PageHead
        title="Add a recipe"
        subtitle={
          mode === "link"
            ? "Paste a cooking video and it gets watched — visuals, speech and on-screen text — then written up as a recipe."
            : "Describe what you want to cook and the recipe gets written for you to edit."
        }
      />

      {/* Two ways in */}
      <div className="mb-4 flex gap-1 rounded-lg border border-[var(--cc-line)] bg-[var(--cc-panel)] p-1">
        {([
          { id: "link" as const, label: "From a video link" },
          { id: "describe" as const, label: "Describe it" },
        ]).map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => { setMode(m.id); setError(null); }}
            className={cx(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold",
              "transition-colors duration-150",
              mode === m.id
                ? "bg-[var(--cc-ember)] text-[#1b0f05]"
                : "text-[var(--cc-ink-muted)] hover:bg-[var(--cc-panel-2)] hover:text-[var(--cc-ink)]",
            )}
          >
            {m.id === "link" ? <BookIcon size={14} /> : <SparkIcon size={14} />}
            {m.label}
          </button>
        ))}
      </div>

      <Panel className="mb-4">
        {mode === "link" ? (
          <>
            <SectionHead title="The post" />
            <div className="space-y-3 p-3">
              <Field
                label="Link"
                hint="In TikTok, Instagram, Facebook or YouTube tap Share → Copy link, then paste it here."
              >
                <Input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && canImport) void importFromLink(); }}
                  placeholder="https://www.tiktok.com/@someone/video/…"
                  autoFocus
                />
              </Field>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => onVideo(e.target.files?.[0])}
                />
                <Button onClick={() => fileInput.current?.click()}>
                  {videoName ? "Choose another video" : "Or upload the video"}
                </Button>
                {videoName && (
                  <span className="flex items-center gap-1.5 text-[12px] text-[var(--cc-ink-muted)]">
                    <Tag tone="ember">{videoName}</Tag>
                    <button
                      type="button"
                      onClick={() => { setVideoDataUrl(null); setVideoName(null); }}
                      aria-label="Remove the video"
                      className="text-[var(--cc-ink-faint)] transition-colors hover:text-[var(--cc-loss)]"
                    >
                      <CloseIcon size={13} />
                    </button>
                  </span>
                )}
                <span className="text-[11px] text-[var(--cc-ink-faint)]">Up to 20 MB.</span>
              </div>

              <Field
                label="Caption"
                hint="Only needed when a private or login-walled post can't be opened."
              >
                <Textarea
                  rows={2}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Paste the caption if the link alone isn't enough…"
                />
              </Field>
            </div>
            <div className="flex items-center gap-2 border-t border-[var(--cc-line)] p-3">
              <Button variant="primary" disabled={!canImport || busy} onClick={() => void importFromLink()}>
                {busy ? <Spinner size={14} /> : <SparkIcon size={14} />}
                {busy ? IMPORT_STAGES[stage] : "Read the recipe"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <SectionHead title="The dish" />
            <div className="p-3">
              <Field label="What do you want to cook?">
                <Textarea
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="A one-pan lemon chicken with orzo, enough for four"
                  autoFocus
                />
              </Field>
            </div>
            <div className="flex items-center gap-2 border-t border-[var(--cc-line)] p-3">
              <Button variant="primary" disabled={!prompt.trim() || busy} onClick={() => void describeIt()}>
                {busy ? <Spinner size={14} /> : <SparkIcon size={14} />}
                {busy ? "Writing" : "Write the recipe"}
              </Button>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="border-t border-[var(--cc-line)] px-3 py-2 text-[12px] leading-relaxed text-[var(--cc-loss)]">
            {error}
          </p>
        )}
        {offline && draft && (
          <p className="border-t border-[var(--cc-line)] px-3 py-2 text-[11px] leading-relaxed text-[var(--cc-gold)]">
            No AI key is set, so that draft is a template rather than a real recipe. Everything below
            is still yours to write.
          </p>
        )}
      </Panel>

      {draft && (
        <RecipeDraft
          draft={draft}
          image={image}
          note={note}
          revising={revising}
          saving={saving}
          onNote={setNote}
          onRevise={() => void revise()}
          onChange={setDraft}
          onNewImage={() => setImage(recipeImageUrl(draft.title, draft.description, "", "", Date.now() % 100000))}
          onSave={() => void save()}
          onCancel={() => navigate({ page: "cookbook", id: cookbookId })}
        />
      )}
    </Columns>
  );
}

/* ── The draft, as a recipe rather than a form ─────────────────── */

function RecipeDraft({
  draft, image, note, revising, saving,
  onNote, onRevise, onChange, onNewImage, onSave, onCancel,
}: {
  draft: Draft;
  image: string | null;
  note: string;
  revising: boolean;
  saving: boolean;
  onNote: (v: string) => void;
  onRevise: () => void;
  onChange: (d: Draft) => void;
  onNewImage: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const total = draft.prep_time + draft.cook_time;

  return (
    <>
      <Panel className="overflow-hidden">
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="aspect-[16/9] w-full border-b border-[var(--cc-line)] object-cover" />
        )}

        <div className="p-4">
          {/* Editable in place: click the title and type. No separate form. */}
          <input
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            aria-label="Recipe title"
            className="w-full bg-transparent text-[24px] font-bold leading-tight tracking-tight
                       outline-none focus:text-[var(--cc-ember)]"
            style={{ fontFamily: "Georgia, serif" }}
          />
          <textarea
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
            aria-label="One line about it"
            rows={2}
            className="cc-prose mt-1.5 w-full resize-none bg-transparent text-[var(--cc-ink-muted)] outline-none"
          />

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-[var(--cc-line)] py-2 text-[12px]">
            <label className="flex items-center gap-1.5">
              <span className="text-[var(--cc-ink-faint)]">Prep</span>
              <input
                type="number"
                min={0}
                value={draft.prep_time}
                onChange={(e) => onChange({ ...draft, prep_time: Number(e.target.value) })}
                className="cc-num w-[46px] rounded border border-[var(--cc-line)] bg-[var(--cc-panel-2)] px-1 py-0.5 text-center"
              />
              <span className="text-[var(--cc-ink-faint)]">min</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[var(--cc-ink-faint)]">Cook</span>
              <input
                type="number"
                min={0}
                value={draft.cook_time}
                onChange={(e) => onChange({ ...draft, cook_time: Number(e.target.value) })}
                className="cc-num w-[46px] rounded border border-[var(--cc-line)] bg-[var(--cc-panel-2)] px-1 py-0.5 text-center"
              />
              <span className="text-[var(--cc-ink-faint)]">min</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[var(--cc-ink-faint)]">Serves</span>
              <input
                type="number"
                min={1}
                value={draft.servings}
                onChange={(e) => onChange({ ...draft, servings: Math.max(1, Number(e.target.value)) })}
                className="cc-num w-[46px] rounded border border-[var(--cc-line)] bg-[var(--cc-panel-2)] px-1 py-0.5 text-center"
              />
            </label>
            {total > 0 && (
              <span className="cc-num text-[var(--cc-ink-faint)]">{total} min in all</span>
            )}
            <div className="flex flex-wrap items-center gap-1">
              {draft.tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onChange({ ...draft, tags: draft.tags.filter((x) => x !== t) })}
                  aria-label={`Remove tag ${t}`}
                  className="inline-flex items-center gap-1 rounded-md border border-[#4a2e17] bg-[var(--cc-ember-wash)]
                             px-1.5 py-0.5 text-[11px] font-medium text-[var(--cc-ember)]
                             transition-colors hover:border-[var(--cc-loss)] hover:text-[var(--cc-loss)]"
                >
                  {t}
                  <CloseIcon size={10} />
                </button>
              ))}
              {draft.tags.length === 0 && (
                <span className="text-[11px] text-[var(--cc-ink-faint)]">No tags</span>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--cc-ink-muted)]">
                Ingredients
              </h3>
              <ul className="space-y-1">
                {draft.ingredients.map((ing, i) => (
                  <li key={i} className="group flex items-baseline gap-1.5 text-[13px]">
                    <input
                      value={`${ing.amount}${ing.unit ? ` ${ing.unit}` : ""}`}
                      onChange={(e) => {
                        const [amount, ...unit] = e.target.value.split(" ");
                        const next = [...draft.ingredients];
                        next[i] = { ...ing, amount, unit: unit.join(" ") };
                        onChange({ ...draft, ingredients: next });
                      }}
                      aria-label={`Amount for ${ing.name}`}
                      className="cc-num w-[68px] shrink-0 rounded bg-transparent px-1 font-semibold text-[var(--cc-ember)]
                                 outline-none hover:bg-[var(--cc-panel-2)] focus:bg-[var(--cc-panel-2)]"
                    />
                    <input
                      value={ing.name}
                      onChange={(e) => {
                        const next = [...draft.ingredients];
                        next[i] = { ...ing, name: e.target.value };
                        onChange({ ...draft, ingredients: next });
                      }}
                      aria-label={`Ingredient ${i + 1}`}
                      className="min-w-0 flex-1 rounded bg-transparent px-1 text-[var(--cc-ink-muted)]
                                 outline-none hover:bg-[var(--cc-panel-2)] focus:bg-[var(--cc-panel-2)]"
                    />
                    <button
                      type="button"
                      onClick={() => onChange({ ...draft, ingredients: draft.ingredients.filter((_, n) => n !== i) })}
                      aria-label={`Remove ${ing.name}`}
                      className="shrink-0 text-[var(--cc-ink-faint)] opacity-0 transition-opacity
                                 hover:text-[var(--cc-loss)] group-hover:opacity-100"
                    >
                      <CloseIcon size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                variant="ghost"
                className="mt-1.5"
                onClick={() => onChange({
                  ...draft,
                  ingredients: [...draft.ingredients, { name: "", amount: "", unit: "" }],
                })}
              >
                Add an ingredient
              </Button>
            </section>

            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--cc-ink-muted)]">
                Method
              </h3>
              <ol className="space-y-2">
                {draft.instructions.map((step, i) => (
                  <li key={i} className="group flex items-start gap-2.5">
                    <span className="cc-num mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full
                                     border border-[var(--cc-line)] text-[12px] font-semibold text-[var(--cc-ink-faint)]">
                      {i + 1}
                    </span>
                    <textarea
                      value={step.text}
                      onChange={(e) => {
                        const next = [...draft.instructions];
                        next[i] = { ...step, text: e.target.value };
                        onChange({ ...draft, instructions: next });
                      }}
                      aria-label={`Step ${i + 1}`}
                      rows={2}
                      className="cc-prose min-w-0 flex-1 resize-none rounded bg-transparent px-1 outline-none
                                 hover:bg-[var(--cc-panel-2)] focus:bg-[var(--cc-panel-2)]"
                    />
                    <button
                      type="button"
                      onClick={() => onChange({ ...draft, instructions: draft.instructions.filter((_, n) => n !== i) })}
                      aria-label={`Remove step ${i + 1}`}
                      className="mt-1.5 shrink-0 text-[var(--cc-ink-faint)] opacity-0 transition-opacity
                                 hover:text-[var(--cc-loss)] group-hover:opacity-100"
                    >
                      <CloseIcon size={12} />
                    </button>
                  </li>
                ))}
              </ol>
              <Button
                variant="ghost"
                className="mt-1.5"
                onClick={() => onChange({
                  ...draft,
                  instructions: [...draft.instructions, { step: draft.instructions.length + 1, text: "" }],
                })}
              >
                Add a step
              </Button>
            </section>
          </div>
        </div>
      </Panel>

      <Panel className="mt-4">
        <SectionHead title="Change it in words" />
        <div className="flex flex-wrap items-end gap-2 p-3">
          <div className="min-w-[240px] flex-1">
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="Make it vegan. Double it. Cut the cooking time in half."
              aria-label="What to change"
            />
          </div>
          <Button disabled={!note.trim() || revising} onClick={onRevise}>
            {revising ? <Spinner size={14} /> : <SparkIcon size={14} />}
            {revising ? "Rewriting" : "Rewrite it"}
          </Button>
          <Button onClick={onNewImage}>Another photo</Button>
        </div>
      </Panel>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" className="px-4 py-2" disabled={!draft.title.trim() || saving} onClick={onSave}>
          {saving && <Spinner size={14} />}
          Save to the cookbook
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </>
  );
}
