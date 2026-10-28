"use client";

// Cook Connect — the app shell: which backend is in play, who is signed in,
// where in the app we are, and who else is online right now.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";
import { getCookBackend, isSchemaMissing, SCHEMA_MISSING_MESSAGE } from "@/lib/cook-connect/client";
import type { Profile } from "@/lib/cook-connect/types";
import { HOME_PAGE, landingSide, parseSide, type Side } from "@/lib/cook-connect/sides";
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
import { GroupView } from "./views/GroupView";
import { SharedWithMeView } from "./views/SharedWithMeView";
import { FeedView } from "./views/FeedView";
import { SettingsView } from "./views/SettingsView";
import { readPersonal } from "@/lib/cook-connect/personal";
import { Loading, Notice } from "./ui";

export type Route =
  | { page: "explore" }
  | { page: "feed" }
  | { page: "settings" }
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
  | { page: "group"; id: string }
  | { page: "shared" };

/** One step of history: the screen, and which half of the app it was on. */
interface Step { route: Route; side: Side }

const SIDE_KEY = "cook-connect:side";

const homeStep = (side: Side): Step => ({ route: { page: HOME_PAGE[side] } as Route, side });

function rememberedSide(): Side {
  if (typeof window === "undefined") return "cookbook";
  try { return parseSide(window.localStorage.getItem(SIDE_KEY)); } catch { return "cookbook"; }
}

interface CookContextValue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any;
  isLocal: boolean;
  userId: string | null;
  profile: Profile | null;
  route: Route;
  /** Which half of the app is showing: Cookbook or Connect. */
  side: Side;
  /** Flip halves — back to wherever you last were on that side. */
  setSide: (side: Side) => void;
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
  // Two apps in one: each side has its own home, and you open on the side you
  // used last on this device.
  const [history, setHistory] = useState<Step[]>(() => [homeStep(rememberedSide())]);
  const [notice, setNotice] = useState<string | null>(null);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  // Set when Supabase is configured but the `cook` schema is not reachable.
  const [schemaMissing, setSchemaMissing] = useState(false);

  const { route, side } = history[history.length - 1];

  // Remember the side for next time (a per-device convenience, so storage).
  useEffect(() => {
    try { window.localStorage.setItem(SIDE_KEY, side); } catch { /* private mode */ }
  }, [side]);

  /** A screen that belongs to one side takes you there; a shared one stays put. */
  const navigate = useCallback((next: Route) => {
    setHistory((prev) => {
      const current = prev[prev.length - 1].side;
      return [...prev, { route: next, side: landingSide(next.page, current) }];
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  /** The big toggle. Lands where you left that side, or on its home. */
  const setSide = useCallback((next: Side) => {
    setHistory((prev) => {
      if (prev[prev.length - 1].side === next) {
        // Tapping the side you are on takes you to its front door.
        return [...prev, homeStep(next)];
      }
      const last = [...prev].reverse().find((step) => step.side === next);
      return [...prev, last ?? homeStep(next)];
    });
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
    const { data, error } = await sb.from("profiles").select("*").eq("id", id).maybeSingle();
    // Every screen reads this table, so if it is unreachable the whole app is.
    // Saying so beats rendering a convincingly empty app.
    if (isSchemaMissing(error)) { setSchemaMissing(true); return; }
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

  /**
   * A share link lands here as ?share=<token>. Claim it once, open the
   * cookbook, and take the token out of the address bar so a reload or a
   * back button does not try to claim it again.
   */
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    const token = new URLSearchParams(window.location.search).get("share");
    if (!token) return;

    void (async () => {
      const { redeemShare } = await import("@/lib/cook-connect/shares");
      const cookbookId = await redeemShare(sb, userId, token);
      const url = new URL(window.location.href);
      url.searchParams.delete("share");
      window.history.replaceState({}, "", url.toString());

      if (cookbookId) {
        setNotice("That cookbook is yours to read now — it's under Shared with you.");
        navigate({ page: "cookbook", id: cookbookId });
      } else {
        setNotice("That share link has expired, or somebody else claimed it first.");
      }
    })();
  }, [sb, userId, navigate]);

  // Settings › "Open the app on": once per sign-in, land on the chosen half.
  useEffect(() => {
    if (!userId) return;
    const { openOn } = readPersonal(userId).settings;
    if (openOn !== "last") setHistory([homeStep(openOn)]);
  }, [userId]);

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
    setHistory([homeStep(rememberedSide())]);
  }, [sb]);

  const value: CookContextValue = {
    sb, isLocal, userId, profile, route, side, setSide, navigate, back,
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

  if (schemaMissing) {
    return (
      <div className="cc flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-[34rem] rounded-[var(--cc-radius)] border border-[var(--cc-line)] bg-[var(--cc-panel)] p-5">
          <h1 className="text-[18px] font-bold tracking-tight">One step left</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">
            {SCHEMA_MISSING_MESSAGE}
          </p>
          <ol className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">
            <li>
              <span className="cc-num mr-1.5 font-semibold text-[var(--cc-ember)]">1</span>
              Run both migrations in the Supabase SQL editor.
            </li>
            <li>
              <span className="cc-num mr-1.5 font-semibold text-[var(--cc-ember)]">2</span>
              Settings &rarr; Data API &rarr; Exposed schemas &rarr; add{" "}
              <code className="rounded bg-[var(--cc-panel-2)] px-1 py-0.5 font-mono text-[12px] text-[var(--cc-ink)]">cook</code>.
            </li>
            <li>
              <span className="cc-num mr-1.5 font-semibold text-[var(--cc-ember)]">3</span>
              Reload this page.
            </li>
          </ol>
          <p className="mt-3 border-t border-[var(--cc-line-soft)] pt-3 text-[12px] leading-relaxed text-[var(--cc-ink-faint)]">
            Step 2 is easy to miss. Without it PostgREST rejects every request with PGRST106 before it
            looks at the tables, so the app cannot tell a missing schema from an empty one.
          </p>
        </div>
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
    case "feed": return <FeedView />;
    case "settings": return <SettingsView />;
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
    case "group": return <GroupView groupId={route.id} />;
    case "shared": return <SharedWithMeView />;
  }
}
