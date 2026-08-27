"use client";

import { useState, useEffect } from "react";
import { useCookbook } from "../CookbookGenie";
import { CookbookCard } from "../CookbookCard";
import {
  loadStarCounts, loadUserStars, loadCookbookMeta, toggleStar, toggleFollow, type Profile,
} from "../social";

interface Cookbook { id: string; name: string; description: string | null; owner_id: string; privacy: string }

interface Props { userId: string }

export function ProfileView({ userId }: Props) {
  const { sb, user, profile: myProfile, navigate } = useCookbook();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cookbooks, setCookbooks] = useState<Cookbook[]>([]);
  const [starCounts, setStarCounts] = useState<Map<string, number>>(new Map());
  const [myStars, setMyStars] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<Map<string, { cover: string | null; count: number }>>(new Map());
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  const isSelf = user?.id === userId;

  const load = async () => {
    const [prof, cbs, stars, meta_, mine, follows] = await Promise.all([
      sb.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      isSelf
        ? sb.from("cookbooks").select("*").eq("owner_id", userId)
        : sb.from("cookbooks").select("*").eq("owner_id", userId).eq("privacy", "public"),
      loadStarCounts(sb),
      loadCookbookMeta(sb),
      user ? loadUserStars(sb, user.id) : Promise.resolve(new Set<string>()),
      sb.from("follows").select("*"),
    ]);
    setProfile(prof.data);
    setCookbooks((cbs.data as Cookbook[]) || []);
    setStarCounts(stars);
    setMeta(meta_);
    setMyStars(mine);
    const followRows = (follows.data as any[]) || [];
    setFollowers(followRows.filter((f) => f.following_id === userId).length);
    setFollowing(followRows.filter((f) => f.follower_id === userId).length);
    setIsFollowing(!!user && followRows.some((f) => f.follower_id === user.id && f.following_id === userId));
    setLoading(false);
  };

  useEffect(() => { load(); }, [userId]);

  const handleFollow = async () => {
    if (!user || isSelf) return;
    const was = isFollowing;
    setIsFollowing(!was);
    setFollowers((n) => n + (was ? -1 : 1));
    await toggleFollow(sb, user.id, userId, was);
  };

  const handleStar = async (id: string) => {
    if (!user) return;
    const starred = myStars.has(id);
    setMyStars((prev) => { const n = new Set(prev); starred ? n.delete(id) : n.add(id); return n; });
    setStarCounts((prev) => { const n = new Map(prev); n.set(id, (n.get(id) || 0) + (starred ? -1 : 1)); return n; });
    await toggleStar(sb, id, user.id, starred);
  };

  if (loading) {
    return <div className="mx-auto max-w-4xl space-y-4"><div className="h-32 animate-pulse rounded-xl bg-elevated" /><div className="h-48 animate-pulse rounded-xl bg-elevated" /></div>;
  }
  if (!profile) {
    return <div className="py-20 text-center text-ink-muted">Profile not found.</div>;
  }

  const initials = profile.display_name ? profile.display_name.slice(0, 2).toUpperCase() : "??";

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="mb-8 rounded-2xl border border-line bg-panel p-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#e67e22]/15 text-2xl font-bold text-[#e67e22]">{initials}</div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold" style={{ fontFamily: "Georgia, serif" }}>{profile.display_name}</h1>
            {profile.username && <p className="text-sm text-ink-muted">@{profile.username}</p>}
            {profile.bio && <p className="mt-2 text-sm text-ink">{profile.bio}</p>}
            <div className="mt-3 flex items-center gap-5 text-sm">
              <span><strong>{cookbooks.length}</strong> <span className="text-ink-muted">cookbooks</span></span>
              <span><strong>{followers}</strong> <span className="text-ink-muted">followers</span></span>
              <span><strong>{following}</strong> <span className="text-ink-muted">following</span></span>
            </div>
          </div>
          {!isSelf && user && (
            <button onClick={handleFollow}
              className={`rounded-lg px-5 py-2 text-sm font-medium transition-colors ${
                isFollowing ? "border border-line text-ink hover:bg-elevated" : "bg-[#e67e22] text-white hover:bg-[#d35400]"
              }`}>
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}
          {isSelf && (
            <span className="rounded-lg border border-line px-4 py-2 text-sm text-ink-muted">This is you</span>
          )}
        </div>
      </div>

      <h2 className="mb-4 text-lg font-semibold" style={{ fontFamily: "Georgia, serif" }}>
        {isSelf ? "Your cookbooks" : "Public cookbooks"}
      </h2>

      {cookbooks.length ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cookbooks.map((cb) => (
            <CookbookCard
              key={cb.id}
              cookbook={cb}
              author={profile}
              cover={meta.get(cb.id)?.cover}
              recipeCount={meta.get(cb.id)?.count || 0}
              starCount={starCounts.get(cb.id) || 0}
              starred={myStars.has(cb.id)}
              canStar={!!user}
              onOpen={() => navigate({ page: "cookbook", id: cb.id })}
              onStar={() => handleStar(cb.id)}
            />
          ))}
        </div>
      ) : (
        <div className="py-16 text-center text-ink-muted">No public cookbooks yet.</div>
      )}
    </div>
  );
}
