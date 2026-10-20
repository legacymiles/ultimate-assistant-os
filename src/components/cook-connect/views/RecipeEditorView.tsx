"use client";

// Adding a recipe. ONE surface, not a choice of lanes.
//
// It used to be two tabs — "from a video link" OR "describe it" — which meant a
// photo of a dish with "make it for six, no dairy" had nowhere to go: whichever
// tab you picked, it couldn't see the other one's box. So there is now a single
// tray you hand ANYTHING to, in any combination: a link, photos, a video, and
// your own words. Every part is optional and every part is read.
//
// The one thing a photo needs that a link doesn't is to be told what it IS. A
// picture of a recipe card must be TRANSCRIBED (its amounts are the truth); a
// picture of a finished dish must be INVENTED FROM (there are no amounts to
// read). Getting that backwards wastes the call, so each photo wears its
// reading on its chip and you can flip it before anything is spent.
//
// Below the tray, the draft arrives as a recipe you can read and edit in place,
// with one box for changing it in words. You are never handed an empty form.

import { useCallback, useEffect, useRef, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import { ConnectSitePanel } from "../ConnectSitePanel";
import { recordActivity } from "@/lib/cook-connect/social";
import { recipeImageUrl } from "@/components/cook-connect/imageGen";
import {
  type Attachment,
  type Composition,
  type Reading,
  MAX_IMAGES,
  hasEvidence,
  images as imagesOf,
  needsReading,
  rejectFile,
  summarise,
  video as videoOf,
} from "@/lib/cook-connect/compose";
import { imageToDataUrl } from "@/lib/recall/media";
import type { Ingredient, Step } from "@/lib/cook-connect/types";
import {
  Button, Field, Input, Panel, SectionHead, Spinner, Textarea, cx,
} from "../ui";
import {
  CloseIcon, LinkIcon, PhotoIcon, PlateIcon, SparkIcon, TextPageIcon, VideoIcon,
} from "../icons";

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

/**
 * Photos are downscaled further than Recall's default, because half of them are
 * pictures of WRITING and 1280px loses the strokes of a handwritten "1½".
 */
const PHOTO_MAX_DIM = 1600;

let seq = 0;
const nextId = () => `a${++seq}`;

export function RecipeEditorView({ cookbookId }: { cookbookId: string }) {
  const { sb, userId, navigate, notify } = useCook();

  // What the cook has handed over. One object, so the routing and the summary
  // line are decided by the evidence rather than by a tab.
  const [brief, setBrief] = useState("");
  const [link, setLink] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);

  // Only ever shown as the way out of a login-walled post, which is the only
  // time anyone should have to paste a caption by hand.
  const [showCaption, setShowCaption] = useState(false);
  const [caption, setCaption] = useState("");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [canWriteAnyway, setCanWriteAnyway] = useState(false);
  /** The site an import said needs a sign-in — shows "Connect Facebook" under the error. */
  const [connectSite, setConnectSite] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [note, setNote] = useState("");
  const [revising, setRevising] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const composition: Composition = { note: brief, link, attachments };
  const photos = imagesOf(composition);
  const clip = videoOf(composition);
  const ready = hasEvidence(composition);
  const reads = needsReading(composition);

  // What the reading is doing, named after what was actually handed over — a
  // caption that says "watching the video" when no video was attached is worse
  // than no caption at all.
  const stages = (() => {
    const out: string[] = [];
    if (link.trim()) out.push("Opening the link…");
    if (clip) out.push("Watching the video…");
    if (photos.length) out.push(photos.length === 1 ? "Looking at the photo…" : "Looking at the photos…");
    out.push("Picking out the ingredients…", "Writing the steps…");
    return out;
  })();

  useEffect(() => {
    if (!busy || !reads) return;
    const t = setInterval(() => setStage((s) => (s + 1) % stages.length), 2600);
    return () => clearInterval(t);
  }, [busy, reads, stages.length]);

  /* ── The tray ─────────────────────────────────────────────────── */

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    let held = [...attachments];
    let refusal: string | null = null;
    for (const file of Array.from(files)) {
      const why = rejectFile(file, { note: brief, link, attachments: held });
      if (why) { refusal ??= why; continue; }
      try {
        const dataUrl = file.type.startsWith("image/")
          ? await imageToDataUrl(file, PHOTO_MAX_DIM)
          : await readAsDataUrl(file);
        held = [...held, {
          id: nextId(),
          kind: file.type.startsWith("image/") ? "image" : "video",
          name: file.name || (file.type.startsWith("image/") ? "photo" : "video"),
          dataUrl,
          reading: "auto",
        }];
      } catch {
        refusal ??= `Couldn't read ${file.name || "that file"}.`;
      }
    }
    setAttachments(held);
    setError(refusal);
  };

  const setReading = (id: string, reading: Reading) =>
    setAttachments((list) => list.map((a) => (a.id === id ? { ...a, reading } : a)));

  const remove = (id: string) => setAttachments((list) => list.filter((a) => a.id !== id));

  /** Screenshots arrive on the clipboard far more often than they arrive as files. */
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files);
  };

  /* ── Tagging and settling a draft ─────────────────────────────── */

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

  /* ── The one button ───────────────────────────────────────────── */

  /**
   * Words alone go to the draft route; anything with a link, a photo or a video
   * goes to the reading route. The cook never picks — what they handed over
   * already decided it.
   */
  const go = () => (reads ? void read() : void write());

  /** A link, photos, a video — opened, looked at, watched, and written up. */
  const read = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCanWriteAnyway(false);
    setConnectSite(null);
    setStage(0);
    try {
      const res = await fetch("/api/cookbook/import-from-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          link: link.trim() || undefined,
          note: brief.trim() || undefined,
          caption: caption.trim() || undefined,
          images: photos.map((a) => a.dataUrl),
          readings: photos.map((a) => a.reading),
          videoDataUrl: clip?.dataUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(String(data.error || `The read failed (${res.status}).`));
        if (data.needsLogin && typeof data.site === "string") setConnectSite(data.site);
        // Pasting the caption only helps a post that wouldn't open.
        if (data.needsHelp && link.trim() && !data.needsKey) setShowCaption(true);
        // A note is a complete request on its own, so when the evidence can't
        // be read there is still a way forward — offered, not taken silently,
        // because a recipe written WITHOUT the photo is a different recipe.
        setCanWriteAnyway(Boolean(brief.trim()));
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
      setError(e instanceof Error ? e.message : "The read failed.");
      setCanWriteAnyway(Boolean(brief.trim()));
    } finally {
      setBusy(false);
    }
  };

  /** Once the site is connected, run the same read again — no second press. */
  const readRef = useRef(read);
  readRef.current = read;
  const retryAfterConnect = useCallback(() => {
    setTimeout(() => void readRef.current(), 600);
  }, []);

  /** Words alone: the route with a template behind it, so a keyless hub answers. */
  const write = async () => {
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError(null);
    setCanWriteAnyway(false);
    try {
      const res = await fetch("/api/cook-connect/recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft", prompt: brief }),
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
        subtitle="Hand over anything you've got — a link, photos of the dish or of a written recipe, a video, your own words — in any mix. It all gets read as one dish."
      />

      <Panel
        className={cx("mb-4 transition-colors duration-150", dragging && "border-[var(--cc-ember)]")}
        onPaste={onPaste}
        onDragOver={(e: React.DragEvent) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: React.DragEvent) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        <SectionHead title="What have you got?" />

        <div className="space-y-3 p-3">
          {/* Words first: it is the one input everybody has, and the only one
              that can carry an instruction rather than evidence. */}
          <Field
            label="In your words"
            hint="A dish, a change to make, anything the photos and the link can't say. Works on its own, and it outranks the rest."
          >
            <Textarea
              rows={3}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="A one-pan lemon chicken with orzo, enough for four — or: this is my nan's, keep her amounts but make it dairy-free"
              autoFocus
            />
          </Field>

          <Field label="Link" hint="Tap Share → Copy link in TikTok, Instagram, Facebook or YouTube, or paste any recipe page.">
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--cc-ink-faint)]">
                <LinkIcon size={14} />
              </span>
              <Input
                className="pl-8"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && ready) go(); }}
                placeholder="https://www.tiktok.com/@someone/video/…"
              />
            </div>
          </Field>

          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
          />

          {attachments.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className={cx(
                "flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-5",
                "transition-colors duration-150",
                dragging
                  ? "border-[var(--cc-ember)] bg-[var(--cc-ember-wash)] text-[var(--cc-ember)]"
                  : "border-[var(--cc-line)] bg-[var(--cc-panel-2)] text-[var(--cc-ink-muted)] hover:border-[var(--cc-ember-dim)] hover:text-[var(--cc-ink)]",
              )}
            >
              <PhotoIcon size={20} />
              <span className="text-[13px] font-semibold">Add photos or a video</span>
              <span className="text-[11px] text-[var(--cc-ink-faint)]">
                Drop them here, paste a screenshot, or click. The dish itself, or a recipe written down.
              </span>
            </button>
          ) : (
            <div className="space-y-2">
              <ul className="divide-y divide-[var(--cc-line-soft)] overflow-hidden rounded-lg border border-[var(--cc-line)]">
                {attachments.map((a) => (
                  <AttachmentRow
                    key={a.id}
                    attachment={a}
                    onReading={(r) => setReading(a.id, r)}
                    onRemove={() => remove(a.id)}
                  />
                ))}
              </ul>
              <div className="flex items-center gap-2">
                <Button onClick={() => fileInput.current?.click()} disabled={photos.length >= MAX_IMAGES && !!clip}>
                  <PhotoIcon size={14} />
                  Add another
                </Button>
                <span className="text-[11px] text-[var(--cc-ink-faint)]">
                  Up to {MAX_IMAGES} photos and one video, 20 MB.
                </span>
              </div>
            </div>
          )}

          {showCaption && (
            <div className="cc-rise">
              <Field label="The caption" hint="Only needed because that post wouldn't open. Paste the text from under it.">
                <Textarea
                  rows={2}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Paste the caption…"
                />
              </Field>
            </div>
          )}
        </div>

        {/* The line that makes the button honest. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--cc-line)] p-3">
          <Button variant="primary" disabled={!ready || busy} onClick={go}>
            {busy ? <Spinner size={14} /> : <SparkIcon size={14} />}
            {busy
              ? (reads ? stages[stage % stages.length] : "Writing")
              : (reads ? "Read the recipe" : "Write the recipe")}
          </Button>
          <p aria-live="polite" className="text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
            {ready
              ? summarise(composition)
              : "Nothing yet — a photo, a link or a sentence is enough."}
          </p>
        </div>

        {error && (
          <div role="alert" className="border-t border-[var(--cc-line)] px-3 py-2">
            <p className="text-[12px] leading-relaxed text-[var(--cc-loss)]">{error}</p>
            {connectSite && <ConnectSitePanel site={connectSite} onConnected={retryAfterConnect} />}
            {canWriteAnyway && (
              <Button className="mt-2" onClick={() => void write()}>
                <SparkIcon size={14} />
                Write it from my words instead
              </Button>
            )}
          </div>
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

/* ── One attached file, wearing how it will be read ────────────── */

const READINGS: { id: Reading; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Let it work out what this picture is" },
  { id: "dish", label: "The dish", hint: "A photo of the finished food — write a recipe that would produce it" },
  { id: "written", label: "The writing", hint: "A recipe card, page or screenshot — transcribe its amounts exactly" },
];

function AttachmentRow({
  attachment, onReading, onRemove,
}: {
  attachment: Attachment;
  onReading: (r: Reading) => void;
  onRemove: () => void;
}) {
  const isImage = attachment.kind === "image";
  return (
    // Wraps rather than squeezes: on a phone the three-way reading control is
    // wider than what's left beside the name, and sharing one line turned the
    // filename into a column of single words.
    <li className="cc-rise flex flex-wrap items-center gap-x-2.5 gap-y-2 bg-[var(--cc-panel-2)] p-2">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.dataUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded border border-[var(--cc-line)] object-cover"
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[var(--cc-line)] bg-[var(--cc-elevated)] text-[var(--cc-ember)]">
          <VideoIcon size={16} />
        </span>
      )}

      <span className="min-w-0 flex-1 basis-[7rem]">
        <span className="block truncate text-[13px] font-medium text-[var(--cc-ink)]">{attachment.name}</span>
        <span className="block text-[11px] leading-snug text-[var(--cc-ink-faint)]">
          {isImage
            ? READINGS.find((r) => r.id === attachment.reading)?.hint
            : "Watched in full — visuals, speech and on-screen text"}
        </span>
      </span>

      {isImage && (
        <span className="ml-auto flex shrink-0 rounded-md border border-[var(--cc-line)] bg-[var(--cc-panel)] p-0.5">
          {READINGS.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={attachment.reading === r.id}
              title={r.hint}
              onClick={() => onReading(r.id)}
              className={cx(
                "inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold",
                "transition-colors duration-150",
                attachment.reading === r.id
                  ? "bg-[var(--cc-ember)] text-[#1b0f05]"
                  : "text-[var(--cc-ink-faint)] hover:text-[var(--cc-ink)]",
              )}
            >
              {r.id === "dish" && <PlateIcon size={11} />}
              {r.id === "written" && <TextPageIcon size={11} />}
              {r.label}
            </button>
          ))}
        </span>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
        className="shrink-0 text-[var(--cc-ink-faint)] transition-colors hover:text-[var(--cc-loss)]"
      >
        <CloseIcon size={14} />
      </button>
    </li>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
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
