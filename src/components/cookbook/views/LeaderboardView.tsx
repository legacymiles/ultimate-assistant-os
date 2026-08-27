"use client";

import { useState, useEffect, useMemo } from "react";
import { useCookbook } from "../CookbookGenie";
import { loadProfiles, loadStarCounts, loadShareCounts, loadCookbookMeta, type Profile } from "../social";

interface Cookbook { id: string; name: string; owner_id: string; privacy: string }

export function LeaderboardView() {
  const [tab, setTab] = useState<"cookbooks" | "restaurants">("cookbooks");

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#e67e22]/10"><TrophyIcon /></div>
        <div>
          <h1 className="text-3xl font-bold" style={{ fontFamily: "Georgia, serif" }}>Leaderboards</h1>
          <p className="text-sm text-ink-muted">The most-loved cookbooks and restaurants on Cookbook Genie</p>
        </div>
      </div>

      <div className="mb-6 flex gap-1 rounded-lg border border-line bg-panel p-1">
        {(["cookbooks", "restaurants"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? "bg-[#e67e22] text-white" : "text-ink-muted hover:text-ink"}`}>
            {t === "cookbooks" ? "Top Cookbooks" : "Top Restaurants"}
          </button>
        ))}
      </div>

      {tab === "cookbooks" ? <CookbookBoard /> : <RestaurantBoard />}
    </div>
  );
}

/* ── Global cookbook leaderboard (stars + shares) ──────────────── */

function CookbookBoard() {
  const { sb, navigate } = useCookbook();
  const [rows, setRows] = useState<{ cb: Cookbook; author?: Profile; stars: number; shares: number; score: number; cover: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data }, profs, stars, shares, meta] = await Promise.all([
        sb.from("cookbooks").select("*").eq("privacy", "public"),
        loadProfiles(sb), loadStarCounts(sb), loadShareCounts(sb), loadCookbookMeta(sb),
      ]);
      const list = ((data as Cookbook[]) || []).map((cb) => {
        const s = stars.get(cb.id) || 0;
        const sh = shares.get(cb.id) || 0;
        return { cb, author: profs.get(cb.owner_id), stars: s, shares: sh, score: s + sh, cover: meta.get(cb.id)?.cover ?? null };
      }).sort((a, b) => b.score - a.score);
      setRows(list);
      setLoading(false);
    })();
  }, []);

  if (loading) return <Loading />;
  if (!rows.length) return <div className="py-16 text-center text-ink-muted">No cookbooks yet.</div>;

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.cb.id} className="flex items-center gap-4 rounded-xl border border-line bg-panel p-3 transition-colors hover:border-[#e67e22]/30">
          <RankBadge rank={i + 1} />
          <button onClick={() => navigate({ page: "cookbook", id: r.cb.id })} className="shrink-0">
            {r.cover ? <img src={r.cover} alt="" className="h-14 w-14 rounded-lg object-cover" /> : <div className="h-14 w-14 rounded-lg bg-elevated" />}
          </button>
          <div className="min-w-0 flex-1">
            <button onClick={() => navigate({ page: "cookbook", id: r.cb.id })}
              className="block max-w-full truncate text-left font-semibold hover:text-[#e67e22]" style={{ fontFamily: "Georgia, serif" }}>
              {r.cb.name}
            </button>
            <button onClick={() => navigate({ page: "profile", userId: r.cb.owner_id })}
              className="block max-w-full truncate text-left text-xs text-ink-muted hover:text-ink">
              by {r.author?.display_name || "Unknown"}
            </button>
          </div>
          <div className="flex items-center gap-4 pr-1 text-sm">
            <span className="flex items-center gap-1 text-[#f4c430]"><StarIcon /> {r.stars}</span>
            <span className="hidden items-center gap-1 text-ink-muted sm:flex"><ShareIcon /> {r.shares}</span>
            <span className="w-10 text-right font-bold text-[#e67e22]">{r.score}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Per-city restaurant leaderboard (favorites + rating) ──────── */

function RestaurantBoard() {
  const { sb } = useCookbook();
  const [cities, setCities] = useState<any[]>([]);
  const [restaurants, setRestaurants] = useState<any[]>([]);
  const [city, setCity] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [c, r] = await Promise.all([
        sb.from("favorite_cities").select("*"),
        sb.from("favorite_restaurants").select("*"),
      ]);
      setCities(c.data || []);
      setRestaurants(r.data || []);
      setLoading(false);
    })();
  }, []);

  // city_id -> city name, and the distinct set of city names.
  const cityNameById = useMemo(() => {
    const m = new Map<string, string>();
    cities.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [cities]);

  const cityNames = useMemo(() => {
    const set = new Set<string>();
    cities.forEach((c) => set.add(c.name));
    return [...set].sort();
  }, [cities]);

  useEffect(() => { if (!city && cityNames.length) setCity(cityNames[0]); }, [cityNames]);

  const ranked = useMemo(() => {
    const grouped = new Map<string, { name: string; cuisine: string; count: number; total: number }>();
    restaurants.forEach((r) => {
      if (cityNameById.get(r.city_id) !== city) return;
      const g = grouped.get(r.name) || { name: r.name, cuisine: r.cuisine_type || "", count: 0, total: 0 };
      g.count += 1;
      g.total += r.rating || 0;
      if (!g.cuisine && r.cuisine_type) g.cuisine = r.cuisine_type;
      grouped.set(r.name, g);
    });
    return [...grouped.values()]
      .map((g) => ({ ...g, avg: g.count ? g.total / g.count : 0 }))
      .sort((a, b) => b.count - a.count || b.avg - a.avg);
  }, [restaurants, cityNameById, city]);

  if (loading) return <Loading />;
  if (!cityNames.length) return <div className="py-16 text-center text-ink-muted">No cities yet. Add favorites to build the leaderboard.</div>;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <label className="text-sm text-ink-muted">City</label>
        <select value={city} onChange={(e) => setCity(e.target.value)}
          className="rounded-lg border border-line bg-elevated px-3 py-2 text-sm focus:border-[#e67e22] focus:outline-none">
          {cityNames.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {ranked.length ? (
        <div className="space-y-2">
          {ranked.map((r, i) => (
            <div key={r.name} className="flex items-center gap-4 rounded-xl border border-line bg-panel p-3">
              <RankBadge rank={i + 1} />
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#e67e22]/10"><StoreIcon /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.name}</p>
                {r.cuisine && <span className="rounded-full bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">{r.cuisine}</span>}
              </div>
              <div className="flex items-center gap-4 pr-1 text-sm">
                <span className="flex items-center gap-1 text-[#f4c430]"><StarIcon /> {r.avg.toFixed(1)}</span>
                <span className="text-ink-muted">{r.count} {r.count === 1 ? "fan" : "fans"}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-16 text-center text-ink-muted">No restaurants in {city} yet.</div>
      )}
    </div>
  );
}

/* ── Bits ──────────────────────────────────────────────────────── */

function RankBadge({ rank }: { rank: number }) {
  const cls = rank === 1 ? "bg-[#f4c430] text-black" : rank === 2 ? "bg-[#c0c0c0] text-black" : rank === 3 ? "bg-[#cd7f32] text-white" : "bg-elevated text-ink-muted";
  return <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${cls}`}>{rank}</span>;
}
function Loading() {
  return <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-elevated" />)}</div>;
}
function TrophyIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>; }
function StarIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#f4c430" stroke="#f4c430" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.29a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></svg>; }
function ShareIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" /></svg>; }
function StoreIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" /><path d="M2 7h20" /></svg>; }
