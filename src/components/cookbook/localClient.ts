"use client";

// ---------------------------------------------------------------------------
// Local demo backend for Cookbook Genie.
//
// When Supabase is not configured (no NEXT_PUBLIC_SUPABASE_* env), the app
// falls back to this in-browser client. It implements the small subset of the
// Supabase JS API that the cookbook views use — a PostgREST-style query
// builder, an auth shim, and a storage shim — all backed by localStorage.
//
// The goal is drop-in compatibility: every view keeps calling `sb.from(...)`,
// `sb.auth.*` and `sb.storage.*` exactly as it would against Supabase, so this
// file is the ONLY thing that differs between "real" and "demo" mode.
// ---------------------------------------------------------------------------

import { recipeImageUrl } from "./imageGen";

type Row = Record<string, any>;
type Result = { data: any; error: any };
type DB = Record<string, Row[]>;

const DB_KEY = "cookbook_genie_local_db_v1";
const AUTH_KEY = "cookbook_genie_local_auth_v1";

function loadDB(): DB {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(DB_KEY) || "{}"); } catch { return {}; }
}
function saveDB(db: DB) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* quota — keep in-memory */ }
}
function uuid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}${Date.now()}`;
}
function nowIso() { return new Date().toISOString(); }

// Stable per-email user id so data survives sign-out / sign-in with same email.
function userIdForEmail(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  const hex = h.toString(16).padStart(8, "0");
  return `local-${hex}-0000-4000-8000-000000000000`;
}

/* ── Query builder ─────────────────────────────────────────────── */

class QueryBuilder implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private filters: [string, any][] = [];
  private negFilters: [string, any][] = [];
  private inFilters: [string, any[]][] = [];
  private orFilter: string | null = null;
  private orderCol: string | null = null;
  private orderAsc = true;
  private _single = false;
  private _maybe = false;
  private returnRows = false;
  private payload: any = null;
  private joinTable: string | null = null;

  constructor(private table: string) {}

  select(cols?: string) {
    if (this.op !== "insert" && this.op !== "update" && this.op !== "delete") this.op = "select";
    else this.returnRows = true;
    if (cols) {
      const m = cols.match(/([a-z_]+)\s*\(/i);
      if (m) this.joinTable = m[1];
    }
    return this;
  }
  insert(payload: any) { this.op = "insert"; this.payload = payload; return this; }
  update(payload: any) { this.op = "update"; this.payload = payload; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, val: any) { this.filters.push([col, val]); return this; }
  neq(col: string, val: any) { this.negFilters.push([col, val]); return this; }
  in(col: string, vals: any[]) { this.inFilters.push([col, vals]); return this; }
  or(expr: string) { this.orFilter = expr; return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orderCol = col; this.orderAsc = opts?.ascending !== false; return this; }
  single() { this._single = true; return this; }
  maybeSingle() { this._maybe = true; return this; }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private matches(r: Row): boolean {
    if (!this.filters.every(([c, v]) => r[c] === v)) return false;
    if (!this.negFilters.every(([c, v]) => r[c] !== v)) return false;
    if (!this.inFilters.every(([c, vals]) => vals.includes(r[c]))) return false;
    if (this.orFilter) {
      const preds = this.orFilter.split(",").map((s) => s.split("."));
      return preds.some(([c, , v]) => String(r[c]) === v);
    }
    return true;
  }

  private async run(): Promise<Result> {
    const db = loadDB();
    const rows = (db[this.table] ||= []);

    if (this.op === "insert") {
      const arr = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = arr.map((p) => {
        const row: Row = { id: uuid(), created_at: nowIso(), updated_at: nowIso(), ...p };
        if (!row.id) row.id = uuid();
        rows.push(row);
        return row;
      });
      saveDB(db);
      if (this.returnRows) return { data: this._single ? inserted[0] : inserted, error: null };
      return { data: null, error: null };
    }

    let result = rows.filter((r) => this.matches(r));

    if (this.op === "update") {
      result.forEach((r) => Object.assign(r, this.payload, { updated_at: nowIso() }));
      saveDB(db);
      return { data: null, error: null };
    }
    if (this.op === "delete") {
      db[this.table] = rows.filter((r) => !result.includes(r));
      saveDB(db);
      return { data: null, error: null };
    }

    // select
    if (this.joinTable) {
      const fk = this.joinTable.replace(/s$/, "") + "_id";
      const related = db[this.joinTable] || [];
      result = result.map((r) => ({ ...r, [this.joinTable!]: related.find((x) => x.id === r[fk]) || null }));
    }
    if (this.orderCol) {
      const col = this.orderCol;
      result = [...result].sort((a, b) => {
        const av = a[col], bv = b[col];
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this._single || this._maybe) {
      const first = result[0] ?? null;
      const error = this._single && !this._maybe && !first ? { message: "No rows found", code: "PGRST116" } : null;
      return { data: first, error };
    }
    return { data: result, error: null };
  }
}

/* ── Auth shim ─────────────────────────────────────────────────── */

interface AuthState { user: { id: string; email: string } | null; signedOut: boolean }
type AuthCb = (event: string, session: any) => void;

function loadAuth(): AuthState {
  if (typeof window === "undefined") return { user: null, signedOut: false };
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "") as AuthState; } catch { return { user: null, signedOut: false }; }
}
function saveAuth(a: AuthState) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch { /* noop */ }
}

const authCallbacks: AuthCb[] = [];

function ensureProfile(userId: string, email: string, bio?: string) {
  const db = loadDB();
  const profiles = (db.profiles ||= []);
  if (!profiles.some((p) => p.user_id === userId)) {
    const name = email.split("@")[0].replace(/\b\w/g, (c) => c.toUpperCase());
    profiles.push({
      id: uuid(), user_id: userId, display_name: name,
      username: email.split("@")[0], avatar_url: null, bio: bio ?? null,
      created_at: nowIso(), updated_at: nowIso(),
    });
    saveDB(db);
  }
}

// A helper to build a recipe row with a free Pollinations photo.
function mkRecipe(
  cookbookId: string, position: number,
  title: string, description: string,
  dietary: string[], protein: string[], meal: string[], cuisine: string[],
): Row {
  return {
    id: uuid(), cookbook_id: cookbookId, title, description,
    ingredients: [
      { name: "main ingredient", amount: "2", unit: "cups" },
      { name: "aromatics", amount: "2", unit: "tbsp" },
      { name: "seasoning", amount: "1", unit: "tsp" },
      { name: "fresh garnish", amount: "2", unit: "tbsp" },
    ],
    instructions: [
      { step: 1, text: "Prepare and measure all ingredients before you begin." },
      { step: 2, text: "Cook the main components over medium-high heat until done." },
      { step: 3, text: "Season to taste, combine everything, and finish with the garnish." },
      { step: 4, text: "Plate and serve immediately." },
    ],
    prep_time: 15, cook_time: 20, servings: 4, calories: 420,
    dietary_tags: dietary, protein_tags: protein, meal_type_tags: meal, cuisine_tags: cuisine,
    image_url: recipeImageUrl(title, description),
    plating_style: "modern minimalist", lighting_style: "bright natural daylight",
    notes: null, position, created_at: nowIso(), updated_at: nowIso(),
  };
}

// The signed-in user's own starter cookbook (public so it shows up in Discover).
function seedUserCookbook(userId: string) {
  const db = loadDB();
  const cookbooks = (db.cookbooks ||= []);
  if (cookbooks.some((c) => c.owner_id === userId)) return;

  const cbId = uuid();
  cookbooks.push({
    id: cbId, owner_id: userId, name: "My Weeknight Dinners",
    description: "Quick, satisfying meals for busy evenings.", privacy: "public",
    color_theme: null, cover_image_url: null, created_at: nowIso(), updated_at: nowIso(),
  });
  const recipes = (db.recipes ||= []);
  recipes.push(
    mkRecipe(cbId, 0, "Garlic Butter Chicken", "Juicy pan-seared chicken in a rich garlic butter sauce.",
      ["high-protein", "gluten-free"], ["chicken"], ["dinner"], ["American"]),
    mkRecipe(cbId, 1, "Veggie Stir-Fry Noodles", "Colorful vegetables and noodles in a savory sauce.",
      ["vegetarian"], ["tofu"], ["dinner"], ["Asian"]),
  );
  saveDB(db);
}

// Seeds a small community of demo members so Discover, profiles and the
// leaderboards are populated out of the box (single-browser demo mode).
const MEMBERS = [
  {
    key: "aiko", name: "Aiko Tanaka", username: "aikotanaka", bio: "Ramen obsessive from Tokyo. 🍜",
    cookbook: "Tokyo Noodle Bar", cbDesc: "Slurp-worthy ramen and noodle bowls.",
    recipes: [
      ["Tonkotsu Ramen", "Rich pork-bone broth with springy noodles and chashu.", [], ["pork"], ["dinner"], ["Japanese"]],
      ["Cold Soba Noodles", "Chilled buckwheat noodles with a savory dipping sauce.", ["vegetarian"], [], ["lunch"], ["Japanese"]],
    ],
  },
  {
    key: "marco", name: "Marco Rossi", username: "marcorossi", bio: "Nonna-approved Italian home cooking. 🍝",
    cookbook: "Cucina di Nonna", cbDesc: "Classic Italian comfort food from my grandmother's kitchen.",
    recipes: [
      ["Spaghetti Carbonara", "Silky egg-and-pancetta pasta, no cream.", ["high-protein"], ["eggs"], ["dinner"], ["Italian"]],
      ["Margherita Pizza", "Blistered crust, San Marzano tomato and fresh mozzarella.", ["vegetarian"], [], ["dinner"], ["Italian"]],
    ],
  },
  {
    key: "priya", name: "Priya Sharma", username: "priyacooks", bio: "Spice-forward vegetarian Indian food. 🌶️",
    cookbook: "Spice Route", cbDesc: "Bold vegetarian curries and street food.",
    recipes: [
      ["Chana Masala", "Chickpeas simmered in a fragrant tomato-onion masala.", ["vegan", "high-protein"], ["chickpeas"], ["dinner"], ["Indian"]],
      ["Paneer Tikka", "Charred marinated paneer skewers.", ["vegetarian"], ["paneer"], ["dinner"], ["Indian"]],
    ],
  },
  {
    key: "sofia", name: "Sofia Morales", username: "sofiaeats", bio: "Bright, fresh Mexican flavors. 🌮",
    cookbook: "Mercado", cbDesc: "Tacos, salsas and everything fresh.",
    recipes: [
      ["Al Pastor Tacos", "Marinated pork with pineapple on warm corn tortillas.", [], ["pork"], ["dinner"], ["Mexican"]],
      ["Fresh Guacamole", "Creamy avocado, lime, cilantro and a little heat.", ["vegan"], [], ["snack"], ["Mexican"]],
    ],
  },
] as const;

function seedSocialWorld() {
  const db = loadDB();
  const profiles = (db.profiles ||= []);
  if (profiles.some((p) => p.username === "aikotanaka")) return; // already seeded

  const cookbooks = (db.cookbooks ||= []);
  const recipes = (db.recipes ||= []);
  const stars = (db.cookbook_stars ||= []);
  const follows = (db.follows ||= []);
  const shares = (db.cookbook_shares ||= []);
  const cities = (db.favorite_cities ||= []);
  const restaurants = (db.favorite_restaurants ||= []);

  const id = (k: string) => userIdForEmail(`${k}@cookbook.local`);
  const cbId: Record<string, string> = {};

  for (const m of MEMBERS) {
    const uid = id(m.key);
    profiles.push({
      id: uuid(), user_id: uid, display_name: m.name, username: m.username,
      avatar_url: null, bio: m.bio, created_at: nowIso(), updated_at: nowIso(),
    });
    const cid = uuid();
    cbId[m.key] = cid;
    cookbooks.push({
      id: cid, owner_id: uid, name: m.cookbook, description: m.cbDesc,
      privacy: "public", color_theme: null, cover_image_url: null,
      created_at: nowIso(), updated_at: nowIso(),
    });
    m.recipes.forEach((r, i) =>
      recipes.push(mkRecipe(cid, i, r[0] as string, r[1] as string,
        [...(r[2] as readonly string[])], [...(r[3] as readonly string[])],
        [...(r[4] as readonly string[])], [...(r[5] as readonly string[])])),
    );
  }

  const star = (cbKey: string, byKey: string) =>
    stars.push({ id: uuid(), cookbook_id: cbId[cbKey], user_id: id(byKey), created_at: nowIso() });

  // Aiko is the star of the community; Sofia close behind.
  star("aiko", "marco"); star("aiko", "priya"); star("aiko", "sofia");
  star("sofia", "marco"); star("sofia", "aiko"); star("sofia", "priya");
  star("marco", "aiko"); star("marco", "sofia");
  star("priya", "sofia");

  // Shares boost the leaderboard score.
  shares.push(
    { id: uuid(), cookbook_id: cbId["aiko"], shared_by: id("aiko"), share_link_token: uuid(), access_level: "copy", created_at: nowIso() },
    { id: uuid(), cookbook_id: cbId["aiko"], shared_by: id("aiko"), share_link_token: uuid(), access_level: "copy", created_at: nowIso() },
  );

  const follow = (fromKey: string, toKey: string) =>
    follows.push({ id: uuid(), follower_id: id(fromKey), following_id: id(toKey), created_at: nowIso() });
  follow("aiko", "marco"); follow("priya", "aiko"); follow("sofia", "marco"); follow("marco", "aiko");

  // City restaurants — multiple members favorite the same places so the
  // per-city leaderboard has real rankings.
  const addResto = (ownerKey: string, cityName: string, name: string, cuisine: string, rating: number) => {
    const owner = id(ownerKey);
    let city = cities.find((c) => c.user_id === owner && c.name === cityName);
    if (!city) {
      city = { id: uuid(), user_id: owner, name: cityName, country: null, notes: null, created_at: nowIso(), updated_at: nowIso() };
      cities.push(city);
    }
    restaurants.push({ id: uuid(), user_id: owner, city_id: city.id, name, cuisine_type: cuisine, rating, notes: null, created_at: nowIso(), updated_at: nowIso() });
  };
  addResto("aiko", "Tokyo", "Ichiran Ramen", "Ramen", 5);
  addResto("aiko", "Tokyo", "Sukiyabashi Jiro", "Sushi", 5);
  addResto("aiko", "Tokyo", "Afuri", "Ramen", 4);
  addResto("marco", "Tokyo", "Ichiran Ramen", "Ramen", 4);
  addResto("marco", "New York", "Katz's Delicatessen", "Deli", 5);
  addResto("marco", "New York", "Lucali", "Pizza", 5);
  addResto("priya", "New York", "Katz's Delicatessen", "Deli", 4);
  addResto("priya", "Paris", "Le Comptoir", "French", 5);
  addResto("sofia", "Paris", "Le Comptoir", "French", 4);
  addResto("sofia", "Paris", "Septime", "French", 5);
  addResto("sofia", "New York", "Lucali", "Pizza", 4);

  saveDB(db);
}

function seedDemoData(userId: string) {
  seedSocialWorld();
  seedUserCookbook(userId);
}

function makeSession(user: { id: string; email: string }) {
  return { user, access_token: "local", token_type: "bearer" };
}

const auth = {
  onAuthStateChange(cb: AuthCb) {
    authCallbacks.push(cb);
    return { data: { subscription: { unsubscribe() { const i = authCallbacks.indexOf(cb); if (i >= 0) authCallbacks.splice(i, 1); } } } };
  },
  async getSession() {
    const state = loadAuth();
    if (state.signedOut) return { data: { session: null }, error: null };
    if (state.user) return { data: { session: makeSession(state.user) }, error: null };
    // First visit → provision a guest so the demo is immediately usable.
    const user = { id: userIdForEmail("guest@cookbook.local"), email: "guest@cookbook.local" };
    ensureProfile(user.id, user.email);
    seedDemoData(user.id);
    saveAuth({ user, signedOut: false });
    return { data: { session: makeSession(user) }, error: null };
  },
  async signInWithPassword({ email }: { email: string; password: string }) {
    const user = { id: userIdForEmail(email), email };
    ensureProfile(user.id, user.email);
    seedDemoData(user.id);
    saveAuth({ user, signedOut: false });
    authCallbacks.forEach((cb) => cb("SIGNED_IN", makeSession(user)));
    return { error: null };
  },
  async signUp({ email, options }: { email: string; password: string; options?: { data?: { display_name?: string } } }) {
    const user = { id: userIdForEmail(email), email };
    ensureProfile(user.id, user.email);
    if (options?.data?.display_name) {
      const db = loadDB();
      const p = (db.profiles || []).find((x) => x.user_id === user.id);
      if (p) { p.display_name = options.data.display_name; saveDB(db); }
    }
    seedDemoData(user.id);
    saveAuth({ user, signedOut: false });
    authCallbacks.forEach((cb) => cb("SIGNED_IN", makeSession(user)));
    return { error: null };
  },
  async resetPasswordForEmail() { return { error: null }; },
  async updateUser() { return { error: null }; },
  async signOut() {
    saveAuth({ user: null, signedOut: true });
    authCallbacks.forEach((cb) => cb("SIGNED_OUT", null));
    return { error: null };
  },
};

/* ── Storage shim ──────────────────────────────────────────────── */

const fileMap = new Map<string, string>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

const storage = {
  from(_bucket: string) {
    return {
      async upload(name: string, body: any, opts?: { contentType?: string }) {
        try {
          let dataUrl: string;
          if (body instanceof Blob) {
            dataUrl = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(r.result as string);
              r.onerror = reject;
              r.readAsDataURL(body);
            });
          } else {
            const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
            const ct = opts?.contentType || "image/png";
            dataUrl = `data:${ct};base64,${bytesToBase64(bytes)}`;
          }
          fileMap.set(name, dataUrl);
          return { error: null };
        } catch (e) {
          return { error: e };
        }
      },
      getPublicUrl(name: string) {
        return { data: { publicUrl: fileMap.get(name) ?? name } };
      },
    };
  },
};

/* ── Public factory ────────────────────────────────────────────── */

let instance: any = null;

export function getLocalCookbookClient() {
  if (!instance) {
    instance = {
      __local: true,
      from: (table: string) => new QueryBuilder(table),
      auth,
      storage,
    };
  }
  return instance;
}
