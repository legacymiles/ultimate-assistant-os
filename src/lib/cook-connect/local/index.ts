"use client";

// Assembles the demo backend into something shaped like a Supabase client:
// `from`, `auth`, `channel` and `removeChannel`. Everything above this
// directory is written against that shape and never branches on which one
// it got.

import { scopedKey } from "@/lib/sync/identity";
import { QueryBuilder, loadDB, saveDB, uuid, nowIso, userIdForEmail, type Row } from "./db";
import { LocalChannel, removeLocalChannel } from "./realtime";
import { seedDemoWorld, seedGuest } from "./seed";

const AUTH_KEY = "cook_connect_local_auth_v1";

interface LocalUser { id: string; email: string }
interface AuthState { user: LocalUser | null; signedOut: boolean }
type AuthCallback = (event: string, session: unknown) => void;

function loadAuth(): AuthState {
  if (typeof window === "undefined") return { user: null, signedOut: false };
  try {
    return JSON.parse(localStorage.getItem(scopedKey(AUTH_KEY)) || "") as AuthState;
  } catch {
    return { user: null, signedOut: false };
  }
}

function saveAuth(state: AuthState) {
  try { localStorage.setItem(scopedKey(AUTH_KEY), JSON.stringify(state)); } catch { /* private mode */ }
}

const callbacks: AuthCallback[] = [];

/** A handle from an email, deduplicated against the handles already taken. */
function handleFor(email: string, taken: Set<string>): string {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "cook";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

function ensureProfile(user: LocalUser, displayName?: string) {
  const db = loadDB();
  const profiles = (db.profiles ||= []) as Row[];
  const existing = profiles.find((p) => p.id === user.id);
  if (existing) {
    if (displayName) { existing.display_name = displayName; saveDB(db); }
    return;
  }
  const taken = new Set(profiles.map((p) => String(p.handle)));
  const name = displayName
    || user.email.split("@")[0].replace(/\b\w/g, (c) => c.toUpperCase());
  profiles.push({
    id: user.id,
    handle: handleFor(user.email, taken),
    display_name: name,
    avatar_url: null,
    bio: null,
    city: null,
    created_at: nowIso(),
  });
  saveDB(db);
}

function provision(user: LocalUser, displayName?: string) {
  seedDemoWorld();
  ensureProfile(user, displayName);
  const profile = (loadDB().profiles ?? []).find((p) => p.id === user.id);
  seedGuest(user.id, String(profile?.display_name ?? "You"));
}

const makeSession = (user: LocalUser) => ({ user, access_token: "local", token_type: "bearer" });

const auth = {
  onAuthStateChange(cb: AuthCallback) {
    callbacks.push(cb);
    return {
      data: {
        subscription: {
          unsubscribe() {
            const i = callbacks.indexOf(cb);
            if (i >= 0) callbacks.splice(i, 1);
          },
        },
      },
    };
  },

  async getSession() {
    const state = loadAuth();
    if (state.signedOut) return { data: { session: null }, error: null };
    if (state.user) {
      provision(state.user);
      return { data: { session: makeSession(state.user) }, error: null };
    }
    // First visit: provision a guest so the demo is usable straight away.
    const user = { id: userIdForEmail(demoGuestEmail), email: demoGuestEmail };
    provision(user, "You");
    saveAuth({ user, signedOut: false });
    return { data: { session: makeSession(user) }, error: null };
  },

  async getUser() {
    const state = loadAuth();
    return { data: { user: state.signedOut ? null : state.user }, error: null };
  },

  async signInWithPassword({ email }: { email: string; password: string }) {
    const user = { id: userIdForEmail(email), email };
    provision(user);
    saveAuth({ user, signedOut: false });
    callbacks.forEach((cb) => cb("SIGNED_IN", makeSession(user)));
    return { data: { user }, error: null };
  },

  async signUp({ email, options }: {
    email: string;
    password: string;
    options?: { data?: { display_name?: string } };
  }) {
    const user = { id: userIdForEmail(email), email };
    provision(user, options?.data?.display_name);
    saveAuth({ user, signedOut: false });
    callbacks.forEach((cb) => cb("SIGNED_IN", makeSession(user)));
    return { data: { user }, error: null };
  },

  async signOut() {
    saveAuth({ user: null, signedOut: true });
    callbacks.forEach((cb) => cb("SIGNED_OUT", null));
    return { error: null };
  },
};

const demoGuestEmail = "guest@cookconnect.local";

export interface CookClient {
  __local?: true;
  from: (table: string) => QueryBuilder;
  auth: typeof auth;
  channel: (name: string, config?: { config?: { presence?: { key?: string } } }) => LocalChannel;
  removeChannel: (channel: LocalChannel) => void;
}

let instance: CookClient | null = null;

export function getLocalCookClient(): CookClient {
  if (!instance) {
    instance = {
      __local: true,
      from: (table: string) => new QueryBuilder(table),
      auth,
      channel: (name, config) => new LocalChannel(name, config?.config),
      removeChannel: removeLocalChannel,
    };
  }
  return instance;
}

/** Wipes the demo world. Offered in settings so a stale seed is recoverable. */
export function resetLocalDemo() {
  try {
    localStorage.removeItem(scopedKey("cook_connect_local_db_v1"));
    localStorage.removeItem(scopedKey(AUTH_KEY));
  } catch { /* private mode */ }
}

export { uuid, nowIso };
