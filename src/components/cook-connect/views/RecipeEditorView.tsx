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
//
// One source can hold several dishes ("3 dinners under $10"), and several
// sources can arrive at once (a pasted list of links, a handful of videos).
// Either way every recipe found lands in "Recipes found", where each one is
// kept, skipped, or opened and edited — by hand or in words — before it is
// kept. Nothing reaches the cookbook until the cook says so.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import { ConnectSitePanel } from "../ConnectSitePanel";
import { recordActivity } from "@/lib/cook-connect/social";
import { MEALS, toggleIn } from "@/lib/cook-connect/categories";
import { recipeImageUrl } from "@/components/cook-connect/imageGen";
import {
  type Attachment,
  type Composition,
  type ReadJob,
  type Reading,
  MAX_IMAGES,
  MAX_VIDEOS,
  hasEvidence,
  images as imagesOf,
  isBulk,
  jobsFor,
  needsReading,
  parseLinks,
  rejectFile,
  summarise,
  video as videoOf,
  videos as videosOf,
} from "@/lib/cook-connect/compose";
import {
  type FoundItem,
  type JobStatus,
  READ_CONCURRENCY,
  jobLine,
  trayCounts,
  trayOrder,
  traySummary,
} from "@/lib/cook-connect/found";
import { imageToDataUrl } from "@/lib/recall/media";
import type { Ingredient, Step } from "@/lib/cook-connect/types";
import {
  Button, Field, Panel, SectionHead, Spinner, Tag, Textarea, cx,
} from "../ui";
import {
  BackIcon, CheckIcon, CloseIcon, LinkIcon, PhotoIcon, PlateIcon, SparkIcon, TextPageIcon, VideoIcon,
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
let runSeq = 0;

/** One read in a bulk run, as its row shows it. */
interface JobRow extends ReadJob {
  status: JobStatus;
  error?: string;
  /** The site the read said needs a sign-in — its row offers "Connect" right there. */
  site?: string;
  found: number;
}

/** One recipe waiting in "Recipes found". */
interface Found extends FoundItem {
  draft: Draft;
  image: string;
  jobLabel: string;
  confidence: string | null;
  assumptions: string[];
}

/** What the reading route sends back, as one entry per dish. */
interface ReadEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recipe: any;
  confidence?: string | null;
  assumptions?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function entriesOf(data: any): ReadEntry[] {
  if (Array.isArray(data?.recipes) && data.recipes.length) return data.recipes;
  return data?.recipe ? [{ recipe: data.recipe, confidence: data.confidence, assumptions: data.assumptions }] : [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDraft(r: any): Draft {
  return {
    title: String(r?.title ?? "Untitled recipe"),
    description: String(r?.description ?? ""),
    ingredients: Array.isArray(r?.ingredients) ? r.ingredients : [],
    instructions: Array.isArray(r?.instructions) ? r.instructions : [],
    tags: (r?.dietary_tags ?? r?.tags ?? []).map((t: string) => String(t).toLowerCase()),
    prep_time: r?.prep_time || 15,
    cook_time: r?.cook_time || 20,
    servings: r?.servings || 4,
  };
}

/** Run `work` over `items`, at most `limit` at a time. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

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

  // "Recipes found": every read in a bulk run, and every recipe they turned up.
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [found, setFound] = useState<Found[]>([]);
  /** The found recipe open in the editor, or null for the list. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** The found recipe being saved right now. */
  const [keeping, setKeeping] = useState<string | null>(null);
  /** What each read was sent, kept until it succeeds so "Try again" needs nothing re-attached. */
  const bodies = useRef(new Map<string, Record<string, unknown>>());

  const composition: Composition = { note: brief, link, attachments };
  const photos = imagesOf(composition);
  const clip = videoOf(composition);
  const clips = videosOf(composition);
  const ready = hasEvidence(composition);
  const reads = needsReading(composition);
  const bulk = isBulk(composition);
  const linkCount = parseLinks(link).length;

  const trayActive = found.length > 0 || jobs.length > 0;
  const stillReading = jobs.filter((j) => j.status === "queued" || j.status === "reading").length;
  const counts = useMemo(() => trayCounts(found), [found]);
  const open = found.find((f) => f.id === openId) ?? null;

  // Opening a found recipe (or going back to the list) brings it into view —
  // on a phone the editor otherwise opens below the fold.
  const trayTop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!trayActive) return;
    trayTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  // Leaving mid-read, or with recipes nobody has decided on, loses them.
  useEffect(() => {
    if (!stillReading && !counts.pending) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [stillReading, counts.pending]);

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
  const go = () => (bulk ? void readBulk() : reads ? void read() : void write());

  /* ── Recipes found ────────────────────────────────────────────── */

  /** Turn one read's answer into rows in "Recipes found". */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toFound = (jobId: string, jobLabel: string, data: any): Found[] => {
    const entries = entriesOf(data);
    return entries.map((e, i) => {
      const d = toDraft(e.recipe);
      return {
        id: `${jobId}-${i + 1}`,
        jobId,
        jobLabel,
        status: "pending",
        draft: d,
        // A video's cover is a picture of the whole video, so it only belongs
        // to a recipe when that recipe is all the video was.
        image: entries.length === 1 && data.coverDataUrl ? data.coverDataUrl : recipeImageUrl(d.title, d.description),
        confidence: e.confidence ?? null,
        assumptions: Array.isArray(e.assumptions) ? e.assumptions : [],
      };
    });
  };

  /** A draft already on screen joins the list rather than being thrown away. */
  const parkDraft = () => {
    if (!draft) return;
    const parked: Found = {
      id: `d${++runSeq}`, jobId: "draft", jobLabel: "your earlier draft", status: "pending",
      draft, image: image ?? recipeImageUrl(draft.title, draft.description), confidence: null, assumptions: [],
    };
    setFound((list) => [...list, parked]);
    setDraft(null);
  };

  const patchJob = (id: string, patch: Partial<JobRow>) =>
    setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  /** One read of a bulk run. Its result joins the list; its failure stays on its own row. */
  const runJob = async (job: ReadJob) => {
    const body = bodies.current.get(job.id);
    if (!body) return;
    patchJob(job.id, { status: "reading", error: undefined, site: undefined });
    try {
      const res = await fetch("/api/cookbook/import-from-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ error: `The read failed (${res.status}).` }));
      if (!res.ok || data.error) {
        patchJob(job.id, {
          status: "failed",
          error: String(data.error || `The read failed (${res.status}).`),
          site: data.needsLogin && typeof data.site === "string" ? data.site : undefined,
        });
        return;
      }
      const items = toFound(job.id, job.label, data);
      setFound((list) => [...list.filter((f) => f.jobId !== job.id), ...items]);
      patchJob(job.id, { status: "done", found: items.length });
      bodies.current.delete(job.id);
    } catch (e) {
      patchJob(job.id, { status: "failed", error: e instanceof Error ? e.message : "The read failed." });
    }
  };

  /**
   * Several links or videos: each one read on its own, two at a time, every
   * recipe landing in the list as it arrives. The tray empties straight away
   * so the next batch can be pasted while this one reads.
   */
  const readBulk = async () => {
    const run = ++runSeq;
    const note = brief.trim() || undefined;
    const specs = jobsFor(composition).map((j) => ({ ...j, id: `r${run}-${j.id}` }));
    for (const spec of specs) {
      const pics = attachments.filter((a) => spec.photoIds.includes(a.id));
      bodies.current.set(spec.id, {
        link: spec.link,
        note,
        images: pics.map((a) => a.dataUrl),
        readings: pics.map((a) => a.reading),
        videoDataUrl: spec.videoId ? attachments.find((a) => a.id === spec.videoId)?.dataUrl : undefined,
      });
    }
    parkDraft();
    setOpenId(null);
    setJobs((list) => [...list, ...specs.map((s) => ({ ...s, status: "queued" as const, found: 0 }))]);
    setLink("");
    setAttachments([]);
    setError(null);
    setShowCaption(false);
    await pool(specs, READ_CONCURRENCY, runJob);
  };

  const retryJob = (id: string) => {
    const job = jobs.find((j) => j.id === id);
    if (job) void runJob(job);
  };

  const patchFound = (id: string, patch: Partial<Found>) =>
    setFound((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  /** Keep it: tagged and saved to the cookbook, with Undo on its row. */
  const keep = async (id: string) => {
    const item = found.find((f) => f.id === id);
    if (!item || !item.draft.title.trim()) return;
    setKeeping(id);
    const tagged = { ...item.draft, tags: await autoTag(item.draft) };
    const savedId = await insertRecipe(tagged, item.image);
    setKeeping(null);
    if (!savedId) return;
    patchFound(id, { status: "accepted", savedId, draft: tagged });
    if (openId === id) setOpenId(null);
  };

  /** Every recipe still waiting, one after another so their order in the book holds. */
  const keepAll = async () => {
    for (const f of found.filter((x) => x.status === "pending")) {
      if (!f.draft.title.trim()) continue;
      setKeeping(f.id);
      const tagged = { ...f.draft, tags: await autoTag(f.draft) };
      const savedId = await insertRecipe(tagged, f.image, { quiet: true });
      if (savedId) patchFound(f.id, { status: "accepted", savedId, draft: tagged });
    }
    setKeeping(null);
    notify("All of them are in the book.");
  };

  /** Take a kept recipe back out of the cookbook. */
  const undoKeep = async (id: string) => {
    const item = found.find((f) => f.id === id);
    if (!item?.savedId) return;
    const { error: err } = await sb.from("recipes").delete().eq("id", item.savedId);
    if (err) { notify(`Could not take it out: ${err.message}`); return; }
    patchFound(id, { status: "pending", savedId: undefined });
    notify(`${item.draft.title} is out of the book.`);
  };

  const clearTray = () => {
    setJobs((list) => list.filter((j) => j.status === "queued" || j.status === "reading"));
    setFound((list) => list.filter((f) => f.status === "pending"));
  };

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
      const entries = entriesOf(data);
      // Several dishes in one source — or a list already open — go to
      // "Recipes found", where each is kept or skipped on its own.
      if (entries.length > 1 || trayActive) {
        const jobId = `r${++runSeq}-j1`;
        const label = jobsFor(composition)[0]?.label ?? "that";
        const items = toFound(jobId, label, data);
        setFound((list) => [...list, ...items]);
        setJobs((list) => [...list, { id: jobId, label, photoIds: [], status: "done", found: items.length }]);
        setDraft(null);
        setOpenId(null);
        return;
      }
      await settle(toDraft(entries[0]?.recipe), false);
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

  /** Change a recipe in words. Null when the rewrite failed (already said why). */
  const rewrite = async (current: Draft): Promise<Draft | null> => {
    if (!note.trim()) return null;
    setRevising(true);
    try {
      const res = await fetch("/api/cook-connect/recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revise", recipe: current, note }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status}).`);
      const data = await res.json();
      setOffline(!!data.offline);
      setNote("");
      return {
        title: data.title,
        description: data.description,
        ingredients: data.ingredients,
        instructions: data.instructions,
        tags: data.tags,
        prep_time: data.prep_time,
        cook_time: data.cook_time,
        servings: data.servings,
      };
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't rewrite that.");
      return null;
    } finally {
      setRevising(false);
    }
  };

  const revise = async () => {
    if (!draft) return;
    const next = await rewrite(draft);
    if (next) setDraft(next);
  };

  const reviseFound = async (id: string) => {
    const item = found.find((f) => f.id === id);
    if (!item) return;
    const next = await rewrite(item.draft);
    if (next) patchFound(id, { draft: next });
  };

  /** Put one recipe in the cookbook. Returns its id, or null when it couldn't (already said why). */
  const insertRecipe = async (d: Draft, img: string | null, opts: { quiet?: boolean } = {}): Promise<string | null> => {
    if (!userId || !d.title.trim()) return null;
    const { data: existing } = await sb.from("recipes").select("*").eq("cookbook_id", cookbookId);
    const position = ((existing ?? []) as unknown[]).length;

    const { data: row, error: err } = await sb.from("recipes").insert({
      cookbook_id: cookbookId,
      author_id: userId,
      title: d.title.trim(),
      description: d.description.trim() || null,
      ingredients: d.ingredients.filter((i) => i.name.trim()),
      instructions: d.instructions
        .filter((s) => s.text.trim())
        .map((s, i) => ({ step: i + 1, text: s.text.trim() })),
      tags: d.tags,
      image_url: img ?? recipeImageUrl(d.title, d.description),
      prep_time: d.prep_time,
      cook_time: d.cook_time,
      servings: d.servings,
      position,
    }).select("*").single();
    if (err) { notify(`Could not save: ${err.message}`); return null; }

    const { data: book } = await sb.from("cookbooks").select("*").eq("id", cookbookId).maybeSingle();
    await recordActivity(sb, {
      kind: "recipe_added",
      actor_id: userId,
      subject_id: cookbookId,
      summary: `added ${d.title.trim()} to ${book?.title ?? "a cookbook"}`,
    });
    await sb.from("cookbooks").update({ updated_at: new Date().toISOString() }).eq("id", cookbookId);
    if (!opts.quiet) notify(`${d.title.trim()} is in the book.`);
    return String(row?.id ?? "") || "saved";
  };

  const save = async () => {
    if (!draft?.title.trim()) return;
    setSaving(true);
    const id = await insertRecipe(draft, image);
    setSaving(false);
    if (id) navigate({ page: "cookbook", id: cookbookId });
  };

  return (
    <Columns>
      <PageHead
        title="Add a recipe"
        subtitle="Hand over anything you've got — a link, photos of the dish or of a written recipe, a video, your own words — in any mix. Paste a whole list of links or drop in several videos and each is read on its own. A video with more than one dish comes back as one recipe per dish, each yours to keep or skip."
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

          <Field
            label={linkCount > 1 ? `Links (${linkCount})` : "Link"}
            hint="Tap Share → Copy link in TikTok, Instagram, Facebook or YouTube, or paste any recipe page. Got a pile of them? Paste them all — one per line — and each is read on its own."
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--cc-ink-faint)]">
                <LinkIcon size={14} />
              </span>
              <Textarea
                className="resize-none pl-8"
                rows={Math.min(6, Math.max(1, link.split("\n").length))}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  // One link: Enter reads it. A list: Enter is a new line, Ctrl/⌘+Enter reads them all.
                  const many = link.includes("\n") || linkCount > 1;
                  if (e.key === "Enter" && ready && (!many || e.ctrlKey || e.metaKey) && !e.shiftKey) {
                    e.preventDefault();
                    go();
                  }
                }}
                placeholder="https://www.tiktok.com/@someone/video/…"
                aria-label="Link, or a list of links"
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
              <span className="text-[13px] font-semibold">Add photos or videos</span>
              <span className="text-[11px] text-[var(--cc-ink-faint)]">
                Drop them here, paste a screenshot, or click. The dish itself, a recipe written down, or a stack of cooking videos.
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
                <Button onClick={() => fileInput.current?.click()} disabled={photos.length >= MAX_IMAGES && clips.length >= MAX_VIDEOS}>
                  <PhotoIcon size={14} />
                  Add another
                </Button>
                <span className="text-[11px] text-[var(--cc-ink-faint)]">
                  Up to {MAX_IMAGES} photos and {MAX_VIDEOS} videos, 20 MB each. Two or more videos are read one by one.
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
              : bulk
                ? `Read all ${linkCount + clips.length}`
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

      <div ref={trayTop} className="scroll-mt-16" />
      {trayActive && !open && (
        <FoundTray
          jobs={jobs}
          found={found}
          counts={counts}
          stillReading={stillReading}
          keeping={keeping}
          onOpen={setOpenId}
          onKeep={(id) => void keep(id)}
          onKeepAll={() => void keepAll()}
          onSkip={(id) => patchFound(id, { status: "rejected" })}
          onBringBack={(id) => patchFound(id, { status: "pending" })}
          onUndo={(id) => void undoKeep(id)}
          onRetry={retryJob}
          onClear={clearTray}
          onDone={() => navigate({ page: "cookbook", id: cookbookId })}
        />
      )}

      {open && (
        <>
          <div className="mb-2 flex items-center gap-2">
            <Button variant="ghost" onClick={() => setOpenId(null)}>
              <BackIcon size={14} />
              Back to the list
            </Button>
            <span className="text-[12px] text-[var(--cc-ink-faint)]">From {open.jobLabel}</span>
          </div>
          <RecipeDraft
            draft={open.draft}
            image={open.image}
            note={note}
            revising={revising}
            saving={keeping === open.id}
            onNote={setNote}
            onRevise={() => void reviseFound(open.id)}
            onChange={(d) => patchFound(open.id, { draft: d })}
            onNewImage={() => patchFound(open.id, {
              image: recipeImageUrl(open.draft.title, open.draft.description, "", "", Date.now() % 100000),
            })}
            onSave={() => (open.status === "accepted" ? setOpenId(null) : void keep(open.id))}
            onCancel={() => setOpenId(null)}
            onSkip={open.status === "pending" ? () => { patchFound(open.id, { status: "rejected" }); setOpenId(null); } : undefined}
            saveLabel={open.status === "accepted" ? "Done" : "Keep it"}
            cancelLabel="Back to the list"
          />
        </>
      )}

      {draft && !trayActive && (
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
  onNote, onRevise, onChange, onNewImage, onSave, onCancel, onSkip,
  saveLabel = "Save to the cookbook", cancelLabel = "Cancel",
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
  /** Shown only for a found recipe still waiting on a decision. */
  onSkip?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
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

          {/* What kind of dish — the filters on Explore and My recipes read these. */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">Kind</span>
            {MEALS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="cc-chip !h-7 !px-2.5 !text-[11.5px]"
                aria-pressed={draft.tags.includes(m.tag)}
                onClick={() => onChange({ ...draft, tags: toggleIn(draft.tags, m.tag) })}
              >
                {m.label}
              </button>
            ))}
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
          {saveLabel}
        </Button>
        {onSkip && <Button variant="danger" onClick={onSkip}>Skip this one</Button>}
        <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
      </div>
    </>
  );
}

/* ── Recipes found: keep, skip, or open and edit each one ──────── */

function FoundTray({
  jobs, found, counts, stillReading, keeping,
  onOpen, onKeep, onKeepAll, onSkip, onBringBack, onUndo, onRetry, onClear, onDone,
}: {
  jobs: JobRow[];
  found: Found[];
  counts: ReturnType<typeof trayCounts>;
  stillReading: number;
  keeping: string | null;
  onOpen: (id: string) => void;
  onKeep: (id: string) => void;
  onKeepAll: () => void;
  onSkip: (id: string) => void;
  onBringBack: (id: string) => void;
  onUndo: (id: string) => void;
  onRetry: (id: string) => void;
  onClear: () => void;
  onDone: () => void;
}) {
  // The reads only earn a list of their own when there was more than one, or
  // when one of them needs something from the cook (a retry, a sign-in).
  const showJobs = jobs.length > 1 || jobs.some((j) => j.status === "failed");
  const settled = !stillReading && counts.total > 0 && counts.pending === 0;
  const finishedJobs = jobs.some((j) => j.status === "done" || j.status === "failed");

  return (
    <Panel className="cc-rise mb-4 overflow-hidden">
      <SectionHead
        title="Recipes found"
        count={counts.total || undefined}
        action={
          <div className="flex items-center gap-1.5">
            {(counts.accepted > 0 || counts.rejected > 0 || (showJobs && finishedJobs)) && (
              <Button variant="ghost" className="px-2 py-1 text-[12px]" onClick={onClear}>
                Clear finished
              </Button>
            )}
            {counts.pending > 1 && (
              <Button variant="primary" className="px-2.5 py-1 text-[12px]" disabled={!!keeping} onClick={onKeepAll}>
                <CheckIcon size={12} />
                Keep all {counts.pending}
              </Button>
            )}
          </div>
        }
      />

      <p aria-live="polite" className="border-b border-[var(--cc-line)] px-3 py-2 text-[12px] text-[var(--cc-ink-muted)]">
        {traySummary(counts, stillReading)}
        {counts.pending > 0 && " Tap one to read it in full and change it — by hand or in words — before you keep it."}
      </p>

      {showJobs && (
        <ul className="divide-y divide-[var(--cc-line-soft)] border-b border-[var(--cc-line)] bg-[var(--cc-panel-2)]">
          {jobs.map((j) => (
            <li key={j.id} className="px-3 py-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                <span className="flex w-4 shrink-0 justify-center">
                  {j.status === "reading" ? <Spinner size={12} />
                    : j.status === "done" ? <CheckIcon size={12} className="text-[var(--cc-live)]" />
                    : j.status === "failed" ? <CloseIcon size={12} className="text-[var(--cc-loss)]" />
                    : <span className="h-1.5 w-1.5 rounded-full bg-[var(--cc-ink-faint)]" />}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--cc-ink)]">{j.label}</span>
                <span className={cx(
                  j.status === "failed"
                    // An error is a sentence: on a phone it gets its own line instead of eating the name.
                    ? "order-last basis-full pl-6 text-[var(--cc-loss)] sm:order-none sm:basis-auto sm:max-w-[60%] sm:truncate sm:pl-0 sm:text-right"
                    : "min-w-0 max-w-[60%] truncate text-right text-[var(--cc-ink-faint)]",
                )} title={j.error}>
                  {jobLine(j.status, j.found, j.error)}
                </span>
                {j.status === "failed" && (
                  <Button variant="ghost" className="px-2 py-0.5 text-[12px]" onClick={() => onRetry(j.id)}>
                    Try again
                  </Button>
                )}
              </div>
              {j.status === "failed" && j.site && (
                <ConnectSitePanel site={j.site} onConnected={() => onRetry(j.id)} />
              )}
            </li>
          ))}
        </ul>
      )}

      {counts.total > 0 && (
        <ul className="divide-y divide-[var(--cc-line-soft)]">
          {trayOrder(found).map((f) => (
            <FoundRow
              key={f.id}
              item={f}
              busy={keeping === f.id}
              locked={!!keeping}
              onOpen={() => onOpen(f.id)}
              onKeep={() => onKeep(f.id)}
              onSkip={() => onSkip(f.id)}
              onBringBack={() => onBringBack(f.id)}
              onUndo={() => onUndo(f.id)}
            />
          ))}
        </ul>
      )}

      {settled && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--cc-line)] p-3">
          <Button variant="primary" onClick={onDone}>Go to the cookbook</Button>
          <span className="text-[12px] text-[var(--cc-ink-faint)]">Or paste more links above — they join this list.</span>
        </div>
      )}
    </Panel>
  );
}

function FoundRow({
  item, busy, locked, onOpen, onKeep, onSkip, onBringBack, onUndo,
}: {
  item: Found;
  busy: boolean;
  locked: boolean;
  onOpen: () => void;
  onKeep: () => void;
  onSkip: () => void;
  onBringBack: () => void;
  onUndo: () => void;
}) {
  const d = item.draft;
  const skipped = item.status === "rejected";
  const kept = item.status === "accepted";
  const minutes = d.prep_time + d.cook_time;
  return (
    <li className={cx(
      "cc-rise flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 transition-opacity duration-150",
      skipped && "opacity-50",
    )}>
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-w-0 flex-1 basis-[14rem] items-center gap-3 text-left"
        aria-label={`Open ${d.title}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.image}
          alt=""
          className="h-12 w-12 shrink-0 rounded border border-[var(--cc-line)] bg-[var(--cc-panel-2)] object-cover"
        />
        <span className="min-w-0">
          <span className={cx(
            "block truncate text-[14px] font-semibold text-[var(--cc-ink)] group-hover:text-[var(--cc-ember)]",
            skipped && "line-through",
          )}>
            {d.title || "Untitled recipe"}
          </span>
          <span className="cc-num block truncate text-[11px] text-[var(--cc-ink-faint)]">
            {d.ingredients.length} ingredients · {d.instructions.length} steps
            {minutes > 0 ? ` · ${minutes} min` : ""} · from {item.jobLabel}
          </span>
        </span>
      </button>

      <span className="flex shrink-0 items-center gap-1.5">
        {item.confidence === "low" && !kept && !skipped && (
          <span title={item.assumptions.join("\n") || "Parts of this were guessed"}>
            <Tag tone="ember">check it</Tag>
          </span>
        )}
        {kept && (
          <>
            <Tag tone="live"><CheckIcon size={10} />&nbsp;In the book</Tag>
            <Button variant="ghost" className="px-2 py-1 text-[12px]" disabled={locked} onClick={onUndo}>Undo</Button>
          </>
        )}
        {skipped && (
          <Button variant="ghost" className="px-2 py-1 text-[12px]" onClick={onBringBack}>Bring back</Button>
        )}
        {item.status === "pending" && (
          <>
            <Button variant="ghost" className="px-2 py-1 text-[12px]" onClick={onOpen}>Edit</Button>
            <Button variant="danger" className="px-2 py-1 text-[12px]" disabled={busy} onClick={onSkip}>Skip</Button>
            <Button variant="primary" className="px-2.5 py-1 text-[12px]" disabled={locked} onClick={onKeep}>
              {busy ? <Spinner size={12} /> : <CheckIcon size={12} />}
              Keep
            </Button>
          </>
        )}
      </span>
    </li>
  );
}
