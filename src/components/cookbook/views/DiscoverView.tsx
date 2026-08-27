"use client";

import { useState, useEffect, useMemo } from "react";
import { useCookbook } from "../CookbookGenie";
import { CookbookCard } from "../CookbookCard";
import {
  loadProfiles, loadStarCounts, loadUserStars, loadCookbookMeta, toggleStar, type Profile,
} from "../social";

interface Cookbook {
  id: string; name: string; description: string | null; owner_id: string;
  privacy: string; created_at: string;
}

export function DiscoverView() {
  const { sb, user, navigate } = useCookbook();
  const [cookbooks, setCookbooks] = useState<Cookbook[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [starCounts, setStarCounts] = useState<Map<string, number>>(new Map());
  const [myStars, setMyStars] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<Map<string, { cover: string | null; count: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"popular" | "recent">("popular");
  const [search, setSearch] = useState("");

  const load = async () => {
    const [{ data }, profs, stars, meta_, mine] = await Promise.all([
      sb.from("cookbooks").select("*").eq("privacy", "public").order("created_at", { ascending: false }),
      loadProfiles(sb),
      loadStarCounts(sb),
      loadCookbookMeta(sb),
      user ? loadUserStars(sb, user.id) : Promise.resolve(new Set<string>()),
    ]);
    setCookbooks((data as Cookbook[]) || []);
    setProfiles(profs);
    setStarCounts(stars);
    setMeta(meta_);
    setMyStars(mine);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleStar = async (id: string) => {
    if (!user) return;
    const starred = myStars.has(id);
    // optimistic
    setMyStars((prev) => { const n = new Set(prev); starred ? n.delete(id) : n.add(id); return n; });
    setStarCounts((prev) => { const n = new Map(prev); n.set(id, (n.get(id) || 0) + (starred ? -1 : 1)); return n; });
    await toggleStar(sb, id, user.id, starred);
  };

  const shown = useMemo(() => {
    let list = cookbooks.filter((c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (profiles.get(c.owner_id)?.display_name || "").toLowerCase().includes(search.toLowerCase()),
    );
    if (sort === "popular") {
      list = [...list].sort((a, b) => (starCounts.get(b.id) || 0) - (starCounts.get(a.id) || 0));
    }
    return list;
  }, [cookbooks, profiles, starCounts, sort, search]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold" style={{ fontFamily: "Georgia, serif" }}>Discover</h1>
        <p className="mt-1 text-ink-muted">Explore cookbooks shared by the community</p>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon />
          <input placeholder="Search cookbooks or chefs..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line bg-elevated py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none" />
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-panel p-1">
          {(["popular", "recent"] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${sort === s ? "bg-[#e67e22] text-white" : "text-ink-muted hover:text-ink"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-64 animate-pulse rounded-xl bg-elevated" />)}
        </div>
      ) : shown.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((cb) => (
            <CookbookCard
              key={cb.id}
              cookbook={cb}
              author={profiles.get(cb.owner_id)}
              cover={meta.get(cb.id)?.cover}
              recipeCount={meta.get(cb.id)?.count || 0}
              starCount={starCounts.get(cb.id) || 0}
              starred={myStars.has(cb.id)}
              canStar={!!user}
              onOpen={() => navigate({ page: "cookbook", id: cb.id })}
              onStar={() => handleStar(cb.id)}
              onAuthor={() => navigate({ page: "profile", userId: cb.owner_id })}
            />
          ))}
        </div>
      ) : (
        <div className="py-20 text-center text-ink-muted">No public cookbooks found.</div>
      )}
    </div>
  );
}

function SearchIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>;
}
