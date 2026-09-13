"use client";

import { useEffect, useRef, useState } from "react";
import { PLATFORM_LABEL, parseLink } from "@/lib/social-import/platform";
import { useCookbook } from "../CookbookGenie";
import { recipeImageUrl } from "../imageGen";

interface Ingredient { name: string; amount: string; unit: string }
interface Instruction { step: number; text: string }
interface RecipeData {
  title: string;
  description: string;
  ingredients: Ingredient[];
  instructions: Instruction[];
  prep_time: number;
  cook_time: number;
  servings: number;
  calories: number;
  dietary_tags: string[];
}
interface ImportInfo {
  source: { url: string; platform: string; platformLabel: string; author: string };
  evidence: { watchedVideo: boolean; readCaption: boolean; creatorPage: boolean; sawCover: boolean };
  confidence: "high" | "medium" | "low" | null;
  assumptions: string[];
  trail: string[];
}

const PLATING = [
  { v: "modern minimalist", l: "Modern Minimalist" },
  { v: "rustic farmhouse", l: "Rustic Farmhouse" },
  { v: "fine dining elegant", l: "Fine Dining" },
  { v: "casual comfort food", l: "Casual Comfort" },
];
const LIGHTING = [
  { v: "bright natural daylight", l: "Bright Daylight" },
  { v: "warm kitchen ambiance", l: "Warm Kitchen" },
  { v: "moody restaurant lighting", l: "Moody Restaurant" },
  { v: "clean overhead studio", l: "Overhead Studio" },
];

// The import is one request, so these advance on a timer rather than on real
// progress. They describe the order the server works in.
const IMPORT_STAGES = ["Opening the post…", "Watching the video…", "Picking out the ingredients…", "Writing the steps…"];

const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
// Above this an uploaded video goes through Storage: Vercel rejects function
// bodies over 4.5 MB, and base64 grows the file by a third.
const INLINE_VIDEO_BYTES = 3 * 1024 * 1024;

interface Props { cookbookId: string }

export function CreateRecipeView({ cookbookId }: Props) {
  const { sb, navigate } = useCookbook();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"link" | "describe">("link");
  const [prompt, setPrompt] = useState("");
  const [link, setLink] = useState("");
  const [pastedCaption, setPastedCaption] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stage, setStage] = useState(0);
  const [importInfo, setImportInfo] = useState<ImportInfo | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recipe, setRecipe] = useState<RecipeData | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [genImage, setGenImage] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [plating, setPlating] = useState("modern minimalist");
  const [lighting, setLighting] = useState("bright natural daylight");
  const [error, setError] = useState<string | null>(null);

  const detected = parseLink(link);
  const busy = generating || importing;
  const canImport = Boolean(link.trim() || pastedCaption.trim() || videoFile);

  useEffect(() => {
    if (!importing) return;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, IMPORT_STAGES.length - 1)), 7000);
    return () => clearInterval(t);
  }, [importing]);

  // Free image generation via Pollinations — the <img> loads the URL directly.
  const generateImage = (r: RecipeData, seed = Math.floor(Math.random() * 1_000_000)) => {
    setGenImage(true);
    setImageUrl(recipeImageUrl(r.title, r.description, plating, lighting, seed));
  };

  const resetResult = () => {
    setRecipe(null);
    setImageUrl(null);
    setImportInfo(null);
    setCover(null);
    setError(null);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    resetResult();
    try {
      const res = await fetch("/api/cookbook/generate-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), action: "generate" }),
      });
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      setRecipe(data);
      generateImage(data);
    } catch (e: any) {
      setError(e.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleImport = async () => {
    if (!canImport || busy) return;
    setImporting(true);
    resetResult();
    let uploadedPath: string | null = null;
    try {
      const body: Record<string, string> = {};
      if (link.trim()) body.link = link.trim();
      if (pastedCaption.trim()) body.caption = pastedCaption.trim();
      if (videoFile) {
        if (videoFile.size > INLINE_VIDEO_BYTES) {
          const path = `imports/${crypto.randomUUID()}.${videoFile.name.split(".").pop() || "mp4"}`;
          try {
            const { error: upErr } = await sb.storage.from("recipe-images").upload(path, videoFile, { contentType: videoFile.type || "video/mp4" });
            const publicUrl: string = upErr ? "" : sb.storage.from("recipe-images").getPublicUrl(path).data.publicUrl;
            // Local demo storage hands back a data: URL the server can't fetch.
            if (publicUrl.startsWith("https://")) {
              body.videoUrl = publicUrl;
              uploadedPath = path;
            }
          } catch { /* fall back to sending it inline */ }
        }
        if (!body.videoUrl) body.videoDataUrl = await readAsDataUrl(videoFile);
      }

      const res = await fetch("/api/cookbook/import-from-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ error: `Import failed (${res.status}).` }));
      if (!res.ok || data?.error) {
        if (data?.needsHelp) setShowHelp(true);
        throw new Error(data?.error || "Import failed");
      }

      setRecipe(data.recipe);
      setImportInfo({
        source: data.source,
        evidence: data.evidence,
        confidence: data.confidence ?? null,
        assumptions: data.assumptions ?? [],
        trail: data.trail ?? [],
      });
      if (data.coverDataUrl) {
        setCover(data.coverDataUrl);
        setGenImage(false);
        setImageUrl(data.coverDataUrl);
      } else {
        generateImage(data.recipe);
      }
    } catch (e: any) {
      setError(e.message || "Import failed");
    } finally {
      setImporting(false);
      if (uploadedPath) {
        try { await (sb.storage.from("recipe-images") as any).remove?.([uploadedPath]); } catch { /* best effort */ }
      }
    }
  };

  const handleVideoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) return setError("That file isn't a video.");
    if (file.size > MAX_VIDEO_BYTES) return setError("That video is over 20 MB. Trim it, or paste the caption instead.");
    setError(null);
    setVideoFile(file);
  };

  const handleEdit = async () => {
    if (!editPrompt.trim() || !recipe) return;
    setEditing(true);
    try {
      const res = await fetch("/api/cookbook/generate-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", editInstruction: editPrompt.trim(), recipe }),
      });
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      const { change_summary, visual_change, ...rd } = data;
      setRecipe(rd);
      setEditPrompt("");
      if (visual_change) generateImage(rd);
    } catch (e: any) {
      setError(e.message || "Edit failed");
    } finally {
      setEditing(false);
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => setImageUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!recipe) return;
    setSaving(true);
    setError(null);
    try {
      let finalImageUrl: string | null = null;
      if (imageUrl && imageUrl.startsWith("data:")) {
        const mime = imageUrl.substring(5, imageUrl.indexOf(";")) || "image/png";
        const ext = mime.split("/")[1]?.replace("+xml", "") || "png";
        const base64 = imageUrl.split(",")[1];
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const fileName = `${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await sb.storage.from("recipe-images").upload(fileName, bytes, { contentType: mime });
        if (!upErr) {
          finalImageUrl = sb.storage.from("recipe-images").getPublicUrl(fileName).data.publicUrl;
        }
      } else if (imageUrl) {
        finalImageUrl = imageUrl;
      }

      const { data, error: insErr } = await sb.from("recipes").insert({
        cookbook_id: cookbookId, title: recipe.title, description: recipe.description,
        ingredients: recipe.ingredients, instructions: recipe.instructions,
        prep_time: recipe.prep_time, cook_time: recipe.cook_time,
        servings: recipe.servings, calories: recipe.calories,
        dietary_tags: recipe.dietary_tags, image_url: finalImageUrl,
        plating_style: plating, lighting_style: lighting,
        notes: importInfo ? sourceNote(importInfo) : null,
      }).select().single();
      if (insErr) throw insErr;

      // Auto-tag in background (non-blocking)
      try {
        const tagRes = await fetch("/api/cookbook/auto-tag-recipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: recipe.title, description: recipe.description, ingredients: recipe.ingredients, instructions: recipe.instructions }),
        });
        const tags = await tagRes.json();
        if (tags && !tags.error) {
          await sb.from("recipes").update({
            protein_tags: tags.protein_tags || [],
            meal_type_tags: tags.meal_type_tags || [],
            cuisine_tags: tags.cuisine_tags || [],
          }).eq("id", data.id);
        }
      } catch { /* skip */ }

      navigate({ page: "recipe", id: data.id, cookbookId });
    } catch (e: any) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-line bg-elevated px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none";
  const primaryCls = "flex w-full items-center justify-center gap-2 rounded-lg bg-[#e67e22] px-4 py-2.5 font-medium text-white hover:bg-[#d35400] disabled:opacity-50";

  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={() => navigate({ page: "cookbook", id: cookbookId })} className="mb-6 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeftIcon /> Back to cookbook
      </button>

      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#e67e22]/10"><SparkleIcon /></div>
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Georgia, serif" }}>Create Recipe</h1>
          <p className="text-sm text-ink-muted">
            {mode === "link" ? "Paste a cooking video and AI will write the recipe from it" : "Describe what you want to cook and AI will create the recipe"}
          </p>
        </div>
      </div>

      <div className="mb-4 inline-flex rounded-lg border border-line bg-elevated p-1 text-sm" role="tablist">
        {(["link", "describe"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 ${mode === m ? "bg-[#e67e22] text-white" : "text-ink-muted hover:text-ink"}`}>
            {m === "link" ? <><LinkIcon /> From a video link</> : <><SparkleIcon small white={mode === m} /> Describe it</>}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">{error}</div>}

      {mode === "link" ? (
        <div className="mb-8 space-y-3">
          <div className="relative">
            <input
              type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleImport(); }}
              placeholder="Paste a TikTok, Instagram, Facebook or YouTube link"
              className={`${inputCls} ${detected ? "pr-28" : ""}`}
            />
            {detected && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-[#e67e22]/10 px-2 py-0.5 text-xs font-medium text-[#e67e22]">
                {PLATFORM_LABEL[detected.platform]}
              </span>
            )}
          </div>
          <p className="text-xs text-ink-faint">
            In the app tap Share → Copy link, then paste it here. It watches the video, reads the caption, and writes the title, ingredients and steps.
          </p>

          <button onClick={() => setShowHelp((v) => !v)} className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline">
            {showHelp ? "Hide extra options" : "Link won't open? Paste the caption or upload the video"}
          </button>
          {showHelp && (
            <div className="space-y-3 rounded-lg border border-line bg-panel p-3">
              <p className="text-xs text-ink-muted">
                Instagram and Facebook usually hide posts from anyone who isn't logged in. Paste the caption, or save the video to your phone and upload it here (up to 20 MB).
              </p>
              <textarea
                value={pastedCaption} onChange={(e) => setPastedCaption(e.target.value)} rows={3}
                placeholder="Paste the post's caption (optional)"
                className={`${inputCls} resize-none text-sm`}
              />
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => videoRef.current?.click()} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">
                  {videoFile ? "Change video" : "Upload video"}
                </button>
                {videoFile && (
                  <span className="min-w-0 truncate text-xs text-ink-muted">
                    {videoFile.name} · {(videoFile.size / 1048576).toFixed(1)} MB{" "}
                    <button onClick={() => setVideoFile(null)} className="underline hover:text-ink">remove</button>
                  </span>
                )}
                <input ref={videoRef} type="file" accept="video/*" onChange={handleVideoPick} className="hidden" />
              </div>
            </div>
          )}

          <button onClick={handleImport} disabled={busy || !canImport} className={primaryCls}>
            {importing ? <><Spinner /> {IMPORT_STAGES[stage]}</> : <><LinkIcon /> Import Recipe</>}
          </button>
        </div>
      ) : (
        <div className="mb-8 space-y-3">
          <textarea
            placeholder='Describe your recipe... e.g. "A quick 30-minute chicken stir-fry with vegetables, high protein, gluten-free"'
            value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
            className={`${inputCls} resize-none`}
          />
          <button onClick={handleGenerate} disabled={busy || !prompt.trim()} className={primaryCls}>
            {generating ? <><Spinner /> Generating recipe...</> : <><SparkleIcon white /> Generate Recipe</>}
          </button>
        </div>
      )}

      {busy && (
        <div className="py-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl bg-[#e67e22]/10"><ChefIcon /></div>
          <p className="text-ink-muted">{importing ? IMPORT_STAGES[stage] : "Our AI chef is creating your recipe..."}</p>
          {importing && <p className="mt-1 text-xs text-ink-faint">Videos take 20–60 seconds.</p>}
        </div>
      )}

      {recipe && !busy && (
        <div className="space-y-6 rounded-xl border border-line bg-panel p-6">
          {importInfo && <ImportSummary info={importInfo} />}

          {/* Image */}
          <div className="relative overflow-hidden rounded-lg">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={recipe.title}
                className="h-64 w-full object-cover"
                onLoad={() => setGenImage(false)}
                onError={() => setGenImage(false)}
              />
            ) : (
              <div className="flex h-48 w-full items-center justify-center bg-elevated"><ImageIcon /></div>
            )}
            {genImage && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-elevated/80 backdrop-blur-sm">
                <Spinner /><p className="text-sm text-ink-muted">Generating food photo...</p>
              </div>
            )}
          </div>

          {/* Image controls */}
          <div className="flex flex-wrap gap-3">
            <select value={plating} onChange={(e) => setPlating(e.target.value)} className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-sm focus:border-[#e67e22] focus:outline-none">
              {PLATING.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
            <select value={lighting} onChange={(e) => setLighting(e.target.value)} className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-sm focus:border-[#e67e22] focus:outline-none">
              {LIGHTING.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
            </select>
            <button onClick={() => generateImage(recipe)} disabled={genImage} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">
              {cover ? "Generate AI Photo" : "Regenerate"}
            </button>
            {cover && imageUrl !== cover && (
              <button onClick={() => { setGenImage(false); setImageUrl(cover); }} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">Use Video Cover</button>
            )}
            <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">Upload Image</button>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold" style={{ fontFamily: "Georgia, serif" }}>{recipe.title}</h2>
              <p className="mt-1 text-ink-muted">{recipe.description}</p>
            </div>
            <button onClick={handleSave} disabled={saving}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-[#e67e22] px-4 py-2 text-sm font-medium text-white hover:bg-[#d35400] disabled:opacity-50">
              {saving ? <><Spinner /> Saving...</> : "Save Recipe"}
            </button>
          </div>

          {recipe.dietary_tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {recipe.dietary_tags.map((t) => <span key={t} className="rounded-full bg-[#e67e22]/10 px-2.5 py-1 text-xs font-medium text-[#e67e22]">{t}</span>)}
            </div>
          )}

          <div className="grid grid-cols-4 gap-4 text-center">
            {[
              { label: "Prep (min)", value: recipe.prep_time },
              { label: "Cook (min)", value: recipe.cook_time },
              { label: "Servings", value: recipe.servings },
              { label: "Calories", value: recipe.calories },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-elevated p-3">
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-xs text-ink-muted">{s.label}</p>
              </div>
            ))}
          </div>

          {/* AI edit */}
          <div className="space-y-3 rounded-lg border border-[#e67e22]/30 bg-[#e67e22]/5 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><SparkleIcon small /> Edit before saving</h3>
            <textarea placeholder='"Make this vegan", "Double the portions", "Add more garlic"' value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={2}
              className="w-full resize-none rounded-lg border border-line bg-elevated px-3 py-2 text-sm focus:border-[#e67e22] focus:outline-none" />
            <button onClick={handleEdit} disabled={editing || !editPrompt.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:bg-elevated disabled:opacity-50">
              {editing ? <><Spinner /> Updating...</> : "Apply Changes"}
            </button>
          </div>

          {/* Ingredients */}
          <div>
            <h3 className="mb-3 text-lg font-semibold" style={{ fontFamily: "Georgia, serif" }}>Ingredients</h3>
            <ul className="space-y-2">
              {recipe.ingredients.map((ing, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#e67e22]" />
                  <span><strong>{ing.amount} {ing.unit}</strong> {ing.name}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Instructions */}
          <div>
            <h3 className="mb-3 text-lg font-semibold" style={{ fontFamily: "Georgia, serif" }}>Instructions</h3>
            <ol className="space-y-3">
              {recipe.instructions.map((inst) => (
                <li key={inst.step} className="flex gap-3 text-sm">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e67e22] text-xs font-bold text-white">{inst.step}</span>
                  <p>{inst.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

/** What the import actually used, so a caption-only guess never passes for a watched video. */
function ImportSummary({ info }: { info: ImportInfo }) {
  const { source, evidence, confidence, assumptions } = info;
  return (
    <div className="space-y-2 rounded-lg border border-line bg-elevated p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">From {source.platformLabel}</span>
        {source.author && <span className="text-ink-muted">· {source.author}</span>}
        {source.url && (
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-[#e67e22] hover:underline">Open post ↗</a>
        )}
        {confidence && (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${confidence === "high" ? "bg-emerald-500/10 text-emerald-400" : confidence === "medium" ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"}`}>
            {confidence} confidence
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Evidence on={evidence.watchedVideo} yes="Watched the video" no="Didn't watch the video" />
        <Evidence on={evidence.readCaption} yes="Read the caption" no="No caption" />
        {evidence.creatorPage && <Evidence on yes="Used the creator's written recipe" no="" />}
      </div>
      {assumptions.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-ink-muted hover:text-ink">
            Guessed {assumptions.length} detail{assumptions.length === 1 ? "" : "s"} — check before saving
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-muted">
            {assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function Evidence({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return on ? (
    <span className="rounded-full bg-[#e67e22]/10 px-2 py-0.5 text-xs text-[#e67e22]">✓ {yes}</span>
  ) : (
    <span className="rounded-full bg-panel px-2 py-0.5 text-xs text-ink-faint">{no}</span>
  );
}

function sourceNote(info: ImportInfo): string {
  const { source } = info;
  if (!source.url) return "Imported from an uploaded video.";
  return `Imported from ${source.platformLabel}${source.author ? ` (${source.author})` : ""}: ${source.url}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read that video."));
    reader.readAsDataURL(file);
  });
}

/* ── Icons ─────────────────────────────────────────────────────── */
function ArrowLeftIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>; }
function LinkIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>; }
function SparkleIcon({ white, small }: { white?: boolean; small?: boolean }) { const s = small ? "h-4 w-4" : "h-6 w-6"; return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke={white ? "white" : "#e67e22"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={s}><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /></svg>; }
function ChefIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8"><path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.646-7.544 6 6 0 0 0-11.162 0A4 4 0 0 0 2.32 14.58c.46.217.68.593.68 1.06V20a1 1 0 0 0 1 1z" /><path d="M6 17h12" /></svg>; }
function ImageIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10 text-ink-faint/30"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>; }
function Spinner() { return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />; }
