"use client";

import { useState, useEffect, useMemo } from "react";
import { useCookbook } from "../CookbookGenie";
import { RecipeTagChips } from "../RecipeTagChips";
import { toggleStar, type Profile } from "../social";

interface Cookbook {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  updated_at: string;
}

interface Recipe {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  prep_time: number | null;
  cook_time: number | null;
  servings: number | null;
  calories: number | null;
  protein_tags: string[] | null;
  meal_type_tags: string[] | null;
  cuisine_tags: string[] | null;
  dietary_tags: string[] | null;
}

interface Props {
  id: string;
}

export function CookbookView({ id }: Props) {
  const { sb, user, navigate } = useCookbook();
  const [cookbook, setCookbook] = useState<Cookbook | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [activeFilters, setActiveFilters] = useState<{ category: string; tag: string }[]>([]);
  const [author, setAuthor] = useState<Profile | null>(null);
  const [starCount, setStarCount] = useState(0);
  const [starred, setStarred] = useState(false);

  const isOwner = cookbook?.owner_id === user?.id;

  const fetchData = async () => {
    const [cbRes, recRes, starsRes] = await Promise.all([
      sb.from("cookbooks").select("*").eq("id", id).single(),
      sb.from("recipes").select("*").eq("cookbook_id", id).order("position", { ascending: true }),
      sb.from("cookbook_stars").select("*").eq("cookbook_id", id),
    ]);
    setCookbook(cbRes.data);
    setRecipes(recRes.data || []);
    const stars = (starsRes.data as any[]) || [];
    setStarCount(stars.length);
    setStarred(!!user && stars.some((s) => s.user_id === user.id));
    if (cbRes.data?.owner_id) {
      const { data: prof } = await sb.from("profiles").select("*").eq("user_id", cbRes.data.owner_id).maybeSingle();
      setAuthor(prof);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [id]);

  const handleStar = async () => {
    if (!user) return;
    const was = starred;
    setStarred(!was);
    setStarCount((n) => n + (was ? -1 : 1));
    await toggleStar(sb, id, user.id, was);
  };

  const allTags = useMemo(() => {
    const p = new Set<string>(), m = new Set<string>(), c = new Set<string>();
    recipes.forEach((r) => {
      (r.protein_tags || []).forEach((t) => p.add(t));
      (r.meal_type_tags || []).forEach((t) => m.add(t));
      (r.cuisine_tags || []).forEach((t) => c.add(t));
    });
    return { protein: [...p], meal_type: [...m], cuisine: [...c] };
  }, [recipes]);

  const hasTags = allTags.protein.length + allTags.meal_type.length + allTags.cuisine.length > 0;

  const filtered = recipes.filter((r) => {
    const matchSearch = r.title.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (!activeFilters.length) return true;
    return activeFilters.every((f) => {
      if (f.category === "protein") return (r.protein_tags || []).includes(f.tag);
      if (f.category === "meal_type") return (r.meal_type_tags || []).includes(f.tag);
      if (f.category === "cuisine") return (r.cuisine_tags || []).includes(f.tag);
      return true;
    });
  });

  const handleRename = async () => {
    if (!newName.trim()) return;
    await sb.from("cookbooks").update({ name: newName.trim() }).eq("id", id);
    setCookbook((c) => c ? { ...c, name: newName.trim() } : c);
    setIsRenaming(false);
  };

  const handleDelete = async () => {
    await sb.from("cookbooks").delete().eq("id", id);
    navigate({ page: "dashboard" });
  };

  const handleDeleteRecipe = async (recipeId: string) => {
    await sb.from("recipes").delete().eq("id", recipeId);
    setRecipes((prev) => prev.filter((r) => r.id !== recipeId));
  };

  const handleShareEmail = async () => {
    if (!shareEmail.trim() || !user) return;
    await sb.from("cookbook_shares").insert({
      cookbook_id: id, shared_by: user.id, shared_with_email: shareEmail.trim(), access_level: "copy",
    });
    setShareEmail("");
  };

  const handleShareLink = async () => {
    if (!user) return;
    const token = crypto.randomUUID();
    await sb.from("cookbook_shares").insert({
      cookbook_id: id, shared_by: user.id, share_link_token: token, access_level: "copy",
    });
    setShareLink(`${window.location.origin}/apps/cookbook-genie?shared=${token}`);
  };

  const handleDuplicate = async () => {
    if (!cookbook || !user) return;
    const { data: newCb } = await sb.from("cookbooks").insert({
      name: `${cookbook.name} (Copy)`, description: cookbook.description, owner_id: user.id,
    }).select().single();
    if (!newCb) return;
    if (recipes.length > 0) {
      const copies = recipes.map((r) => ({
        cookbook_id: newCb.id, title: r.title, description: r.description,
        image_url: r.image_url, prep_time: r.prep_time, cook_time: r.cook_time,
        servings: r.servings, calories: r.calories, dietary_tags: r.dietary_tags,
      }));
      await sb.from("recipes").insert(copies);
    }
    navigate({ page: "cookbook", id: newCb.id });
  };

  const toggleFilter = (cat: string, tag: string) => {
    setActiveFilters((prev) => {
      const exists = prev.some((f) => f.category === cat && f.tag === tag);
      return exists ? prev.filter((f) => !(f.category === cat && f.tag === tag)) : [...prev, { category: cat, tag }];
    });
  };

  if (loading) {
    return <div className="mx-auto max-w-5xl space-y-4"><div className="h-8 w-64 animate-pulse rounded bg-elevated" /><div className="h-48 animate-pulse rounded-xl bg-elevated" /></div>;
  }

  if (!cookbook) {
    return (
      <div className="py-20 text-center">
        <p className="text-ink-muted">Cookbook not found</p>
        <button onClick={() => navigate({ page: "dashboard" })} className="mt-2 text-[#e67e22] hover:underline">Go back</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <button onClick={() => navigate({ page: "dashboard" })} className="mb-6 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeftIcon /> Back to cookbooks
      </button>

      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          {isRenaming ? (
            <div className="flex items-center gap-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-2xl font-bold focus:border-[#e67e22] focus:outline-none"
                style={{ fontFamily: "Georgia, serif" }} />
              <button onClick={handleRename} className="text-green-400 hover:text-green-300"><CheckIcon /></button>
              <button onClick={() => setIsRenaming(false)} className="text-ink-muted hover:text-ink"><XIcon /></button>
            </div>
          ) : (
            <h1 className="text-3xl font-bold" style={{ fontFamily: "Georgia, serif" }}>{cookbook.name}</h1>
          )}
          {cookbook.description && <p className="mt-1 text-ink-muted">{cookbook.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
            {author && (
              <button onClick={() => navigate({ page: "profile", userId: cookbook.owner_id })}
                className="flex items-center gap-1.5 text-ink-muted hover:text-ink">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e67e22]/10 text-[9px] font-semibold text-[#e67e22]">
                  {author.display_name ? author.display_name.slice(0, 2).toUpperCase() : "??"}
                </span>
                by {author.display_name}
              </button>
            )}
            <span>{recipes.length} recipes</span>
            <span>Updated {new Date(cookbook.updated_at).toLocaleDateString()}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handleStar} disabled={!user}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              starred ? "bg-[#f4c430]/15 text-[#f4c430]" : "border border-line text-ink-muted hover:bg-elevated hover:text-ink"
            }`}>
            <StarIcon filled={starred} /> {starCount}
          </button>
          {!isOwner && (
            <button onClick={handleDuplicate} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">Duplicate</button>
          )}
          {isOwner && (
            <>
              <button onClick={() => { setNewName(cookbook.name); setIsRenaming(true); }}
                className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">Rename</button>
              <button onClick={() => setShareOpen(true)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">Share</button>
              <button onClick={() => setShowDelete(true)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-red-400 hover:bg-elevated">Delete</button>
            </>
          )}
        </div>
      </div>

      {/* Search + Create */}
      <div className="mb-6 flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon />
          <input placeholder="Search recipes..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line bg-elevated py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none" />
        </div>
        {isOwner && (
          <button onClick={() => navigate({ page: "create-recipe", cookbookId: id })}
            className="flex items-center gap-2 rounded-lg bg-[#e67e22] px-4 py-2 text-sm font-medium text-white hover:bg-[#d35400]">
            <PlusIcon /> Create Recipe
          </button>
        )}
      </div>

      {/* Tag filters */}
      {hasTags && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {activeFilters.length > 0 && (
            <button onClick={() => setActiveFilters([])} className="rounded-full border border-line px-2 py-1 text-xs text-ink-muted hover:bg-elevated">
              Clear filters ×
            </button>
          )}
          <RecipeTagChips proteinTags={allTags.protein} mealTypeTags={allTags.meal_type} cuisineTags={allTags.cuisine}
            size="sm" onTagClick={toggleFilter} activeFilters={activeFilters} />
        </div>
      )}

      {/* Recipe grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <button
              key={r.id}
              onClick={() => navigate({ page: "recipe", id: r.id, cookbookId: id })}
              className="group overflow-hidden rounded-xl border border-line bg-panel text-left transition-all hover:border-[#e67e22]/30 hover:shadow-lg"
            >
              {r.image_url ? (
                <img src={r.image_url} alt={r.title} className="h-36 w-full object-cover" />
              ) : (
                <div className="flex h-36 items-center justify-center bg-elevated"><UtensilIcon /></div>
              )}
              <div className="p-4">
                <h3 className="font-semibold group-hover:text-[#e67e22] transition-colors" style={{ fontFamily: "Georgia, serif" }}>
                  {r.title}
                </h3>
                {r.description && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{r.description}</p>}
                <div className="mt-3 flex items-center gap-3 text-xs text-ink-faint">
                  {(r.prep_time || r.cook_time) && <span>{(r.prep_time || 0) + (r.cook_time || 0)} min</span>}
                  {r.servings && <span>{r.servings} servings</span>}
                  {r.calories && <span>{r.calories} cal</span>}
                </div>
                <RecipeTagChips proteinTags={r.protein_tags || []} mealTypeTags={r.meal_type_tags || []} cuisineTags={r.cuisine_tags || []} />
              </div>
              {isOwner && (
                <div className="px-4 pb-3">
                  <span onClick={(e) => { e.stopPropagation(); handleDeleteRecipe(r.id); }}
                    className="cursor-pointer text-xs text-red-400 hover:underline">Delete</span>
                </div>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="py-20 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e67e22]/10"><UtensilIcon large /></div>
          <h2 className="mb-2 text-xl font-semibold" style={{ fontFamily: "Georgia, serif" }}>No recipes yet</h2>
          <p className="mb-6 text-ink-muted">{isOwner ? "Create your first recipe with AI" : "This cookbook is empty"}</p>
          {isOwner && (
            <button onClick={() => navigate({ page: "create-recipe", cookbookId: id })}
              className="inline-flex items-center gap-2 rounded-lg bg-[#e67e22] px-4 py-2 text-sm font-medium text-white hover:bg-[#d35400]">
              <PlusIcon /> Create Recipe
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {showDelete && (
        <Modal onClose={() => setShowDelete(false)}>
          <h3 className="mb-2 text-lg font-semibold">Delete &quot;{cookbook.name}&quot;?</h3>
          <p className="mb-4 text-sm text-ink-muted">This will permanently delete this cookbook and all its recipes.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowDelete(false)} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-elevated">Cancel</button>
            <button onClick={handleDelete} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700">Delete</button>
          </div>
        </Modal>
      )}

      {/* Share modal */}
      {shareOpen && (
        <Modal onClose={() => { setShareOpen(false); setShareLink(null); setLinkCopied(false); }}>
          <h3 className="mb-1 text-lg font-semibold">Share &quot;{cookbook.name}&quot;</h3>
          <p className="mb-4 text-sm text-ink-muted">Recipients can view and duplicate this cookbook.</p>

          <div className="mb-4 space-y-3">
            <h4 className="text-sm font-medium">Share via link</h4>
            {!shareLink ? (
              <button onClick={handleShareLink} className="w-full rounded-lg bg-[#e67e22] px-3 py-2 text-sm font-medium text-white hover:bg-[#d35400]">
                Generate Shareable Link
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input value={shareLink} readOnly className="flex-1 rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs text-ink" />
                <button onClick={() => { navigator.clipboard.writeText(shareLink); setLinkCopied(true); }}
                  className="rounded-lg border border-line px-2 py-1.5 text-sm hover:bg-elevated">
                  {linkCopied ? "✓" : "Copy"}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium">Share via email</h4>
            <input placeholder="Enter email address" type="email" value={shareEmail} onChange={(e) => setShareEmail(e.target.value)}
              className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none" />
            <button onClick={handleShareEmail} disabled={!shareEmail.trim()}
              className="w-full rounded-lg bg-[#e67e22] px-3 py-2 text-sm font-medium text-white hover:bg-[#d35400] disabled:opacity-50">
              Share
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-line bg-panel p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/* ── Icons ──────────────────────────────────────────────────────── */
function ArrowLeftIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>; }
function PlusIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M5 12h14" /><path d="M12 5v14" /></svg>; }
function CheckIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M20 6 9 17l-5-5" /></svg>; }
function XIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>; }
function SearchIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>; }
function UtensilIcon({ large }: { large?: boolean }) { const s = large ? "h-8 w-8" : "h-8 w-8"; return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${s} text-ink-faint/30`}><path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" /><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7" /><path d="m2.1 21.8 6.4-6.3" /><path d="m19 5-7 7" /></svg>; }
function StarIcon({ filled }: { filled: boolean }) { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? "#f4c430" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.29a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></svg>; }
