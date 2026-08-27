"use client";

import { useState, useEffect, useRef } from "react";
import { useCookbook } from "../CookbookGenie";
import { RecipeTagChips } from "../RecipeTagChips";
import { recipeImageUrl } from "../imageGen";

interface Ingredient { name: string; amount: string; unit: string }
interface Instruction { step: number; text: string }

interface Recipe {
  id: string;
  cookbook_id: string;
  title: string;
  description: string | null;
  ingredients: Ingredient[] | null;
  instructions: Instruction[] | null;
  prep_time: number | null;
  cook_time: number | null;
  servings: number | null;
  calories: number | null;
  dietary_tags: string[] | null;
  protein_tags: string[] | null;
  meal_type_tags: string[] | null;
  cuisine_tags: string[] | null;
  image_url: string | null;
  plating_style: string | null;
  lighting_style: string | null;
  created_at: string;
  updated_at: string;
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

interface Props { id: string; cookbookId?: string }

export function RecipeView({ id, cookbookId }: Props) {
  const { sb, user, navigate } = useCookbook();
  const fileRef = useRef<HTMLInputElement>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [cbName, setCbName] = useState<string>("");
  const [cbId, setCbId] = useState<string | null>(cookbookId ?? null);
  const [loading, setLoading] = useState(true);
  const [multiplier, setMultiplier] = useState(1);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [genImage, setGenImage] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [plating, setPlating] = useState("modern minimalist");
  const [lighting, setLighting] = useState("bright natural daylight");

  const isOwner = ownerId === user?.id;

  const fetchRecipe = async () => {
    const { data } = await sb.from("recipes").select("*").eq("id", id).single();
    if (data) {
      setRecipe(data as Recipe);
      setCbId(data.cookbook_id);
      if (data.plating_style) setPlating(data.plating_style);
      if (data.lighting_style) setLighting(data.lighting_style);
      const { data: cb } = await sb.from("cookbooks").select("owner_id, name").eq("id", data.cookbook_id).single();
      if (cb) { setOwnerId(cb.owner_id); setCbName(cb.name); }
    }
    setLoading(false);
  };

  useEffect(() => { fetchRecipe(); }, [id]);

  const ingredients = recipe?.ingredients || [];
  const instructions = recipe?.instructions || [];
  const baseServings = recipe?.servings || 4;

  const scale = (amount: string) => {
    const n = parseFloat(amount);
    if (isNaN(n)) return amount;
    const s = n * multiplier;
    return s % 1 === 0 ? s.toString() : s.toFixed(1);
  };

  const handleEdit = async () => {
    if (!editPrompt.trim() || !recipe) return;
    setEditing(true);
    try {
      const res = await fetch("/api/cookbook/generate-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit", editInstruction: editPrompt.trim(),
          recipe: {
            title: recipe.title, description: recipe.description, ingredients, instructions,
            prep_time: recipe.prep_time, cook_time: recipe.cook_time, servings: recipe.servings,
            calories: recipe.calories, dietary_tags: recipe.dietary_tags,
          },
        }),
      });
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      const { change_summary, visual_change, ...rd } = data;
      await sb.from("recipes").update({
        title: rd.title, description: rd.description, ingredients: rd.ingredients,
        instructions: rd.instructions, prep_time: rd.prep_time, cook_time: rd.cook_time,
        servings: rd.servings, calories: rd.calories, dietary_tags: rd.dietary_tags,
      }).eq("id", id);
      setEditOpen(false);
      setEditPrompt("");
      await fetchRecipe();
      if (visual_change) handleRegenerateImage();
    } catch { /* noop */ }
    finally { setEditing(false); }
  };

  // Free image generation via Pollinations — store the URL directly (no upload).
  const handleRegenerateImage = async () => {
    if (!recipe) return;
    setGenImage(true);
    try {
      const url = recipeImageUrl(recipe.title, recipe.description || "", plating, lighting, Math.floor(Math.random() * 1_000_000));
      await sb.from("recipes").update({ image_url: url, plating_style: plating, lighting_style: lighting }).eq("id", id);
      await fetchRecipe();
    } catch { setGenImage(false); }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) return;
    setUploading(true);
    try {
      const fileName = `${crypto.randomUUID()}.${file.name.split(".").pop()}`;
      const { error } = await sb.storage.from("recipe-images").upload(fileName, file, { contentType: file.type });
      if (!error) {
        const url = sb.storage.from("recipe-images").getPublicUrl(fileName).data.publicUrl;
        await sb.from("recipes").update({ image_url: url }).eq("id", id);
        await fetchRecipe();
      }
    } catch { /* noop */ }
    finally { setUploading(false); }
  };

  if (loading) {
    return <div className="mx-auto max-w-3xl space-y-4"><div className="h-8 w-64 animate-pulse rounded bg-elevated" /><div className="h-64 animate-pulse rounded-xl bg-elevated" /></div>;
  }

  if (!recipe) {
    return (
      <div className="py-20 text-center">
        <p className="text-ink-muted">Recipe not found</p>
        <button onClick={() => navigate({ page: "dashboard" })} className="mt-2 text-[#e67e22] hover:underline">Go back</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={() => navigate(cbId ? { page: "cookbook", id: cbId } : { page: "dashboard" })} className="mb-6 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeftIcon /> Back to {cbName || "cookbooks"}
      </button>

      {/* Hero image */}
      <div className="relative mb-6">
        {recipe.image_url ? (
          <img
            src={recipe.image_url}
            alt={recipe.title}
            className="h-64 w-full rounded-xl object-cover"
            onLoad={() => setGenImage(false)}
            onError={() => setGenImage(false)}
          />
        ) : !genImage && !uploading ? (
          <div className="flex h-48 w-full items-center justify-center rounded-xl bg-elevated"><UtensilIcon /></div>
        ) : (
          <div className="h-64 w-full rounded-xl bg-elevated" />
        )}
        {(genImage || uploading) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-elevated/80 backdrop-blur-sm">
            <Spinner /><p className="text-sm text-ink-muted">{uploading ? "Uploading image..." : "Generating new image..."}</p>
          </div>
        )}
      </div>

      {/* Image controls (owner) */}
      {isOwner && (
        <div className="mb-6 flex flex-wrap gap-3">
          <select value={plating} onChange={(e) => setPlating(e.target.value)} className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-sm focus:border-[#e67e22] focus:outline-none">
            {PLATING.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
          <select value={lighting} onChange={(e) => setLighting(e.target.value)} className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-sm focus:border-[#e67e22] focus:outline-none">
            {LIGHTING.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
          </select>
          <button onClick={handleRegenerateImage} disabled={genImage} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">
            {recipe.image_url ? "Regenerate" : "Generate Image"}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">Upload Image</button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
        </div>
      )}

      {/* Title + actions */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex-1">
          <h1 className="text-3xl font-bold" style={{ fontFamily: "Georgia, serif" }}>{recipe.title}</h1>
          {recipe.description && <p className="mt-2 text-ink-muted">{recipe.description}</p>}
        </div>
        {isOwner && (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditOpen(!editOpen)} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">Edit with AI</button>
            <button onClick={() => window.print()} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">Print</button>
          </div>
        )}
      </div>

      <RecipeTagChips proteinTags={recipe.protein_tags || []} mealTypeTags={recipe.meal_type_tags || []} cuisineTags={recipe.cuisine_tags || []} size="md" />

      {(recipe.dietary_tags || []).length > 0 && (
        <div className="mb-6 mt-2 flex flex-wrap gap-2">
          {(recipe.dietary_tags || []).map((t) => <span key={t} className="rounded-full bg-[#e67e22]/10 px-2.5 py-1 text-xs font-medium text-[#e67e22]">{t}</span>)}
        </div>
      )}

      {/* Stats */}
      <div className="mb-8 mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Prep", value: `${recipe.prep_time || 0} min` },
          { label: "Cook", value: `${recipe.cook_time || 0} min` },
          { label: "Servings", value: Math.round(baseServings * multiplier) },
          { label: "Calories", value: recipe.calories || "—" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2 rounded-lg border border-line bg-panel p-3">
            <div>
              <p className="text-xs text-ink-muted">{s.label}</p>
              <p className="text-sm font-semibold">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Serving slider */}
      <div className="mb-8 rounded-lg border border-line bg-panel p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Adjust servings</span>
          <span className="text-sm font-semibold text-[#e67e22]">{Math.round(baseServings * multiplier)} servings</span>
        </div>
        <input type="range" min={0.5} max={4} step={0.5} value={multiplier} onChange={(e) => setMultiplier(parseFloat(e.target.value))}
          className="w-full accent-[#e67e22]" />
      </div>

      {/* AI edit panel */}
      {editOpen && (
        <div className="mb-8 space-y-3 rounded-xl border border-[#e67e22]/30 bg-[#e67e22]/5 p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><SparkleIcon /> Edit with AI</h3>
            <button onClick={() => setEditOpen(false)} className="text-ink-muted hover:text-ink"><XIcon /></button>
          </div>
          <textarea placeholder='"Make this vegan", "Double the portions", "Add more garlic"' value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={2}
            className="w-full resize-none rounded-lg border border-line bg-elevated px-3 py-2 text-sm focus:border-[#e67e22] focus:outline-none" />
          <button onClick={handleEdit} disabled={editing || !editPrompt.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#e67e22] px-3 py-2 text-sm font-medium text-white hover:bg-[#d35400] disabled:opacity-50">
            {editing ? <><Spinner /> Updating recipe...</> : "Apply Changes"}
          </button>
        </div>
      )}

      {/* Ingredients + Instructions */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-4 text-xl font-semibold" style={{ fontFamily: "Georgia, serif" }}>Ingredients</h2>
          <ul className="space-y-2">
            {ingredients.map((ing, i) => (
              <li key={i} className="flex cursor-pointer items-center gap-3 text-sm" onClick={() => {
                setChecked((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
              }}>
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked.has(i) ? "border-[#e67e22] bg-[#e67e22]" : "border-line"}`}>
                  {checked.has(i) && <CheckMini />}
                </span>
                <span className={checked.has(i) ? "text-ink-faint line-through" : ""}>
                  <strong>{scale(ing.amount)} {ing.unit}</strong> {ing.name}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="mb-4 text-xl font-semibold" style={{ fontFamily: "Georgia, serif" }}>Instructions</h2>
          <ol className="space-y-4">
            {instructions.map((inst) => (
              <li key={inst.step} className="flex gap-3 text-sm">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e67e22] text-xs font-bold text-white">{inst.step}</span>
                <p className="leading-relaxed">{inst.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-8 flex items-center gap-4 border-t border-line pt-6 text-xs text-ink-faint">
        <span>Created {new Date(recipe.created_at).toLocaleDateString()}</span>
        <span>Updated {new Date(recipe.updated_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────── */
function ArrowLeftIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>; }
function XIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>; }
function SparkleIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /></svg>; }
function UtensilIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-12 w-12 text-ink-faint/30"><path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" /><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7" /><path d="m2.1 21.8 6.4-6.3" /><path d="m19 5-7 7" /></svg>; }
function CheckMini() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><path d="M20 6 9 17l-5-5" /></svg>; }
function Spinner() { return <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#e67e22] border-t-transparent" />; }
