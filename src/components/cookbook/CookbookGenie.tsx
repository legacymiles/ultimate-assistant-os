"use client";

import { useState, useEffect, useMemo, createContext, useContext, useCallback } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getLocalCookbookClient } from "./localClient";
import { CookbookLayout } from "./CookbookLayout";
import { Dashboard } from "./views/Dashboard";
import { DiscoverView } from "./views/DiscoverView";
import { LeaderboardView } from "./views/LeaderboardView";
import { ProfileView } from "./views/ProfileView";
import { CookbookView } from "./views/CookbookView";
import { RecipeView } from "./views/RecipeView";
import { CreateRecipeView } from "./views/CreateRecipeView";
import { NewCookbookView } from "./views/NewCookbookView";
import { FavoritesView } from "./views/FavoritesView";
import { SharedWithMeView } from "./views/SharedWithMeView";
import { AuthView } from "./views/AuthView";

export type Route =
  | { page: "dashboard" }
  | { page: "discover" }
  | { page: "leaderboard" }
  | { page: "profile"; userId: string }
  | { page: "cookbook"; id: string }
  | { page: "create-recipe"; cookbookId: string }
  | { page: "recipe"; id: string; cookbookId?: string }
  | { page: "new-cookbook" }
  | { page: "favorites" }
  | { page: "shared" }
  | { page: "login" }
  | { page: "signup" };

interface Profile {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

interface CookbookCtx {
  sb: SupabaseClient;
  user: User | null;
  profile: Profile | null;
  isLocal: boolean;
  navigate: (r: Route) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<CookbookCtx>(null!);
export const useCookbook = () => useContext(Ctx);

export function CookbookGenie() {
  // Prefer real Supabase; otherwise run entirely in-browser (local demo mode).
  const supabase = getSupabaseBrowserClient();
  const isLocal = !supabase;
  const sb = useMemo(
    () => supabase ?? (getLocalCookbookClient() as unknown as SupabaseClient),
    [supabase],
  );
  const [route, setRoute] = useState<Route>({ page: "login" });
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const navigate = useCallback((r: Route) => setRoute(r), []);

  useEffect(() => {
    const fetchProfile = async (uid: string) => {
      const { data } = await sb
        .from("profiles")
        .select("id, display_name, username, avatar_url")
        .eq("user_id", uid)
        .maybeSingle();
      setProfile(data);
    };

    const { data: { subscription } } = sb.auth.onAuthStateChange(async (_ev, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user.id);
        setRoute((r) => (r.page === "login" || r.page === "signup" ? { page: "dashboard" } : r));
      } else {
        setProfile(null);
        setRoute({ page: "login" });
      }
      setLoading(false);
    });

    sb.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user.id);
        // Resolve a share link if present: ?shared=<token>
        const token = new URLSearchParams(window.location.search).get("shared");
        if (token) {
          // Redeeming is one server-side call rather than a select-then-update.
          // The old pair needed a policy that let any user read every share row
          // and rewrite any unclaimed one; holding the token is the actual
          // authorisation, and only a function argument can carry that.
          const { data: cookbookId } = await sb.rpc("redeem_cookbook_share", {
            _token: token,
          });
          if (cookbookId) {
            setRoute({ page: "cookbook", id: cookbookId as string });
            setLoading(false);
            return;
          }
        }
        setRoute({ page: "dashboard" });
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [sb]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#e67e22] border-t-transparent" />
      </div>
    );
  }

  const signOut = async () => {
    await sb.auth.signOut();
    setUser(null);
    setProfile(null);
    setRoute({ page: "login" });
  };

  if (route.page === "login" || route.page === "signup") {
    if (!user) {
      return (
        <Ctx.Provider value={{ sb, user, profile, isLocal, navigate, signOut }}>
          <AuthView mode={route.page} />
        </Ctx.Provider>
      );
    }
    setRoute({ page: "dashboard" });
  }

  if (!user) {
    setRoute({ page: "login" });
    return null;
  }

  const renderView = () => {
    switch (route.page) {
      case "dashboard":
        return <Dashboard />;
      case "discover":
        return <DiscoverView />;
      case "leaderboard":
        return <LeaderboardView />;
      case "profile":
        return <ProfileView userId={route.userId} />;
      case "cookbook":
        return <CookbookView id={route.id} />;
      case "create-recipe":
        return <CreateRecipeView cookbookId={route.cookbookId} />;
      case "recipe":
        return <RecipeView id={route.id} cookbookId={route.cookbookId} />;
      case "new-cookbook":
        return <NewCookbookView />;
      case "favorites":
        return <FavoritesView />;
      case "shared":
        return <SharedWithMeView />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Ctx.Provider value={{ sb, user, profile, isLocal, navigate, signOut }}>
      <CookbookLayout currentPage={route.page}>{renderView()}</CookbookLayout>
    </Ctx.Provider>
  );
}
