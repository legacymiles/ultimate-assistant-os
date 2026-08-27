"use client";

import { useState, useRef } from "react";
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

interface Props { cookbookId: string }

export function CreateRecipeView({ cookbookId }: Props) {
  const { sb, navigate } = useCookbook();
  const fileRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recipe, setRecipe] = useState<RecipeData | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [genImage, setGenImage] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [plating, setPlating] = useState("modern minimalist");
  const [lighting, setLighting] = useState("bright natural daylight");
  const [error, setError] = useState<string | null>(null);

  // Free image generation via Pollinations — the <img> loads the URL directly.
  const generateImage = (r: RecipeData, seed = Math.floor(Math.random() * 1_000_000)) => {
    setGenImage(true);
    setImageUrl(recipeImageUrl(r.title, r.description, plating, lighting, seed));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setRecipe(null);
    setImageUrl(null);
    setError(null);
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

  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={() => navigate({ page: "cookbook", id: cookbookId })} className="mb-6 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeftIcon /> Back to cookbook
      </button>

      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#e67e22]/10"><SparkleIcon /></div>
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Georgia, serif" }}>Create Recipe</h1>
          <p className="text-sm text-ink-muted">Describe what you want to cook and AI will create the recipe</p>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">{error}</div>}

      <div className="mb-8 space-y-3">
        <textarea
          placeholder='Describe your recipe... e.g. "A quick 30-minute chicken stir-fry with vegetables, high protein, gluten-free"'
          value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
          className="w-full resize-none rounded-lg border border-line bg-elevated px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none"
        />
        <button onClick={handleGenerate} disabled={generating || !prompt.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#e67e22] px-4 py-2.5 font-medium text-white hover:bg-[#d35400] disabled:opacity-50">
          {generating ? <><Spinner /> Generating recipe...</> : <><SparkleIcon white /> Generate Recipe</>}
        </button>
      </div>

      {generating && (
        <div className="py-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl bg-[#e67e22]/10"><ChefIcon /></div>
          <p className="text-ink-muted">Our AI chef is creating your recipe...</p>
        </div>
      )}

      {recipe && !generating && (
        <div className="space-y-6 rounded-xl border border-line bg-panel p-6">
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
            <button onClick={() => generateImage(recipe)} disabled={genImage} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">Regenerate</button>
            <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">Upload Image</button>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
          </div>

          <div className="flex items-start justify-between">
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

/* ── Icons ─────────────────────────────────────────────────────── */
function ArrowLeftIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>; }
function SparkleIcon({ white, small }: { white?: boolean; small?: boolean }) { const s = small ? "h-4 w-4" : "h-6 w-6"; return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke={white ? "white" : "#e67e22"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={s}><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /></svg>; }
function ChefIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8"><path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.646-7.544 6 6 0 0 0-11.162 0A4 4 0 0 0 2.32 14.58c.46.217.68.593.68 1.06V20a1 1 0 0 0 1 1z" /><path d="M6 17h12" /></svg>; }
function ImageIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10 text-ink-faint/30"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>; }
function Spinner() { return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />; }
