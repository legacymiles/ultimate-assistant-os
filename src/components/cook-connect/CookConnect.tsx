"use client";

// Cook Connect — the app shell: which backend is in play, who is signed in,
// where in the app we are, and who else is online right now.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";
import { getCookBackend } from "@/lib/cook-connect/client";
import type { Profile } from "@/lib/cook-connect/types";
import { CookShell } from "./CookShell";
import { AuthView } from "./views/AuthView";
import { ExploreView } from "./views/ExploreView";
import { ProfileView } from "./views/ProfileView";
import { CookbooksView } from "./views/CookbooksView";
import { CookbookView } from "./views/CookbookView";
import { RecipeView } from "./views/RecipeView";
import { RecipeEditorView } from "./views/RecipeEditorView";
import { NewCookbookView } from "./views/NewCookbookView";
import { PlayView } from "./views/PlayView";
import { SpadesRoom } from "./play/SpadesRoom";
import { ChessRoom } from "./play/ChessRoom";
import { LeaderboardsView } from "./views/LeaderboardsView";
import { JournalView } from "./views/JournalView";
import { SharedWithMeView } from "./views/SharedWithMeView";
import { Loading, Notice } from "./ui";

export type Route =
  | { page: "explore" }
  | { page: "profile"; userId: string }
  | { page: "cookbooks" }
  | { page: "cookbook"; id: string }
  | { page: "recipe"; id: string; cookbookId: string }
  | { page: "new-recipe"; cookbookId: string }
  | { page: "new-cookbook" }
  | { page: "play" }
  | { page: "spades"; matchId: string }
  | { page: "chess"; matchId: string }
  | { page: "leaderboards" }
  | { page: "journal" }
  | { page: "shared" };

/** The five destinations the nav rail offers. */
export const NAV_PAGES = ["explore", "cookbooks", "play", "leaderboards"] as const;

interface CookContextValue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any;
  isLocal: boolean;
  userId: string | null;
  profile: Profile | null;
  route: Route;
  navigate: (route: Route) => void;
  back: () => void;
  canGoBack: boolean;
  onlineIds: Set<string>;
  notify: (message: string) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<CookContextValue>(null!);
export const useCook = () => useContext(Ctx);

export function CookConnect() {
  const { sb, isLocal } = useMemo(() => getCookBackend(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  // Play is home: it carries the lobby and the activity feed together.
  const [history, setHistory] = useState<Route[]>([{ page: "play" }]);
  const [notice, setNotice] = useState<string | null>(null);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  const route = history[history.length - 1];

  const navigate = useCallback((next: Route) => {
    setHistory((prev) => [...prev, next]);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const back = useCallback(() => {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  /**
   * Make sure this account has a Cook Connect profile. Supabase auth is shared
   * with the rest of the hub, so an account can exist without one — including
   * every account created before this app did.
   */
  const ensureProfile = useCallback(async (id: string, email: string | null) => {
    const { data } = await sb.from("profiles").select("*").eq("id", id).maybeSingle();
    if (data) { setProfile(data as Profile); return; }

    const base = (email?.split("@")[0] ?? "cook").toLowerCase().replace(/[^a-z0-9_]/g, "") || "cook";
    const { data: taken } = await sb.from("profiles").select("handle");
    const used = new Set(((taken ?? []) as { handle: string }[]).map((r) => r.handle));
    let handle = base.slice(0, 20);
    let n = 2;
    while (used.has(handle)) handle = `${base.slice(0, 18)}${n++}`;

    const { data: created } = await sb.from("profiles").insert({
      id,
      handle,
      display_name: email?.split("@")[0]?.replace(/\b\w/g, (c: string) => c.toUpperCase()) ?? "Member",
    }).select("*").single();
    if (created) setProfile(created as Profile);
  }, [sb]);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const { data } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (data) setProfile(data as Profile);
  }, [sb, userId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await sb.auth.getSession();
      const user = data?.session?.user ?? null;
      if (!alive) return;
      setUserId(user?.id ?? null);
      if (user) await ensureProfile(user.id, user.email ?? null);
      setReady(true);
    })();

    const { data: sub } = sb.auth.onAuthStateChange(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (_event: string, session: any) => {
        const user = session?.user ?? null;
        setUserId(user?.id ?? null);
        if (user) void ensureProfile(user.id, user.email ?? null);
        else setProfile(null);
      },
    );
    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [sb, ensureProfile]);

  // Who is online, app-wide. Drives the green dots and the challenge rail.
  useEffect(() => {
    if (!userId) return;
    const channel = sb.channel("cook:presence", { config: { presence: { key: userId } } });
    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") void channel.track({ at: Date.now() });
      });
    return () => { sb.removeChannel(channel); };
  }, [sb, userId]);

  const signOut = useCallback(async () => {
    await sb.auth.signOut();
    setHistory([{ page: "play" }]);
  }, [sb]);

  const value: CookContextValue = {
    sb, isLocal, userId, profile, route, navigate, back,
    canGoBack: history.length > 1, onlineIds,
    notify: setNotice, refreshProfile, signOut,
  };

  if (!ready) {
    return (
      <div className="cc flex min-h-screen items-center justify-center">
        <Loading label="Opening Cook Connect" />
      </div>
    );
  }

  if (!userId || !profile) {
    return (
      <Ctx.Provider value={value}>
        <div className="cc min-h-screen">
          <AuthView />
          {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
        </div>
      </Ctx.Provider>
    );
  }

  return (
    <Ctx.Provider value={value}>
      <CookShell>{renderRoute(route)}</CookShell>
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
    </Ctx.Provider>
  );
}

function renderRoute(route: Route) {
  switch (route.page) {
    case "explore": return <ExploreView />;
    case "profile": return <ProfileView userId={route.userId} />;
    case "cookbooks": return <CookbooksView />;
    case "cookbook": return <CookbookView cookbookId={route.id} />;
    case "recipe": return <RecipeView recipeId={route.id} cookbookId={route.cookbookId} />;
    case "new-recipe": return <RecipeEditorView cookbookId={route.cookbookId} />;
    case "new-cookbook": return <NewCookbookView />;
    case "play": return <PlayView />;
    case "spades": return <SpadesRoom matchId={route.matchId} />;
    case "chess": return <ChessRoom matchId={route.matchId} />;
    case "leaderboards": return <LeaderboardsView />;
    case "journal": return <JournalView />;
    case "shared": return <SharedWithMeView />;
  }
}
