# Friends Night Out v2 — Plan 1: Foundation (owner gate, schema, core logic)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it safe to let the public sign up for Friends Night Out: only the owner can reach the rest of the hub, the social tables exist with airtight RLS, and the pure logic (sections, blended stars, area reuse) is built and tested.

**Architecture:** A pure `routeAccess()` / `isOwner()` module decides who may reach each path; `src/middleware.ts` enforces it (public FNO surface, owner-only everything else, fail-closed when no owner is configured). One additive migration adds `fno_*` tables, RLS policies, a stats view and a `fno_leaderboard()` function. Pure TS libs in `src/lib/friends-night-out/` hold the logic later plans build on.

**Tech Stack:** Next.js 15 middleware (edge), `@supabase/ssr` 0.5.2, Postgres/Supabase RLS, vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-friends-night-out-social-design.md`

**This is plan 1 of 4.** Plan 2 = any-city catalogue builder + AI stars. Plan 3 = Explore places / Events / auth screens. Plan 4 = social (copy, follow, leaderboard, profiles, AI guides).

**Spec deviation (deliberate):** `fno_places` is written only by the server (service role) — the add-a-place route validates and inserts. Letting clients insert places directly would let them set their own `ai_stars`. Private notes move to their own `fno_notes` table because RLS cannot hide one column of a readable row.

---

## File map

| File | Responsibility |
|---|---|
| Create `src/lib/hubAccess.ts` | Pure: classify a path (public / token / auth / owner), parse owner list, check owner |
| Create `src/lib/hubAccess.test.ts` | Tests for the above |
| Modify `src/middleware.ts` | Enforce owner-only hub; FNO public; non-owners redirected to FNO |
| Modify `src/app/api/fno/search/route.ts` | AI sweep only for signed-in users (anonymous visitors must not spend AI credit) |
| Create `supabase/migrations/20260919000000_fno_social.sql` | Tables, RLS, trigger, stats view, leaderboard function |
| Create `supabase/tests/fno_rls_check.sql` | Paste-into-SQL-editor RLS check, wrapped in a rolled-back transaction |
| Regenerate `supabase/all-schemas.sql` | Via `scripts/build-all-schemas.sh` |
| Create `src/lib/friends-night-out/sections.ts` (+ `.test.ts`) | Section ids/labels; test that they match the migration's check constraint |
| Create `src/lib/friends-night-out/stars.ts` (+ `.test.ts`) | Blended AI + community stars |
| Create `src/lib/friends-night-out/areas.ts` (+ `.test.ts`) | Reuse an existing city area or build a new one |
| Modify `.env.example`, `.env.local` | `HUB_OWNER_EMAILS=` line |

---

### Task 1: Route access rules (pure)

**Files:**
- Create: `src/lib/hubAccess.ts`
- Test: `src/lib/hubAccess.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/hubAccess.test.ts
import { describe, expect, it } from "vitest";
import { isOwner, parseOwnerEmails, routeAccess, PUBLIC_HOME } from "./hubAccess";

const TOKEN = new Set(["/api/dashboard/inbox/push"]);

describe("routeAccess", () => {
  it("makes the FNO page and its API public", () => {
    expect(routeAccess("/apps/friends-night-out", TOKEN)).toBe("public");
    expect(routeAccess("/apps/friends-night-out/anything", TOKEN)).toBe("public");
    expect(routeAccess("/api/fno/search", TOKEN)).toBe("public");
    expect(routeAccess("/api/fno", TOKEN)).toBe("public");
  });

  it("does not match look-alike prefixes", () => {
    expect(routeAccess("/apps/friends-night-outage", TOKEN)).toBe("owner");
    expect(routeAccess("/api/fnox/secret", TOKEN)).toBe("owner");
  });

  it("keeps token paths exact-match only", () => {
    expect(routeAccess("/api/dashboard/inbox/push", TOKEN)).toBe("token");
    expect(routeAccess("/api/dashboard/inbox/push/x", TOKEN)).toBe("owner");
  });

  it("treats login and auth callback as auth routes", () => {
    expect(routeAccess("/login", TOKEN)).toBe("auth");
    expect(routeAccess("/auth/callback", TOKEN)).toBe("auth");
  });

  it("makes everything else owner-only", () => {
    for (const p of ["/", "/apps/std-safe", "/apps/dashboard", "/api/skills/scan", "/api/ai/chat"]) {
      expect(routeAccess(p, TOKEN)).toBe("owner");
    }
  });

  it("exposes the public home path", () => {
    expect(PUBLIC_HOME).toBe("/apps/friends-night-out");
  });
});

describe("owner list", () => {
  it("parses a comma list, trimmed and lower-cased, dropping blanks", () => {
    expect(parseOwnerEmails(" A@x.com, b@Y.com ,,")).toEqual(["a@x.com", "b@y.com"]);
    expect(parseOwnerEmails(undefined)).toEqual([]);
    expect(parseOwnerEmails("")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(isOwner("A@X.com", ["a@x.com"])).toBe(true);
  });

  it("fails closed: no owners configured means nobody is owner", () => {
    expect(isOwner("a@x.com", [])).toBe(false);
  });

  it("rejects missing email", () => {
    expect(isOwner(undefined, ["a@x.com"])).toBe(false);
    expect(isOwner("", ["a@x.com"])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hubAccess.test.ts`
Expected: FAIL — `Failed to resolve import "./hubAccess"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/hubAccess.ts
// ---------------------------------------------------------------------------
// Who may reach which path.
//
// The hub used to let ANY signed-in Supabase user through, which was fine while
// the owner was the only account. Friends Night Out is now a public app with
// open sign-up, so a stranger's account must reach FNO and nothing else.
//
// Fail-closed: with HUB_OWNER_EMAILS unset nobody is the owner, so a missing env
// var locks the private apps rather than opening them to every sign-up.
// ---------------------------------------------------------------------------

export type RouteAccess = "public" | "token" | "auth" | "owner";

/** Where a signed-in non-owner is sent. */
export const PUBLIC_HOME = "/apps/friends-night-out";

const PUBLIC_PREFIXES = [PUBLIC_HOME, "/api/fno"];
const AUTH_PREFIXES = ["/login", "/auth"];

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function routeAccess(path: string, tokenPaths: ReadonlySet<string>): RouteAccess {
  if (tokenPaths.has(path)) return "token";
  if (PUBLIC_PREFIXES.some((p) => underPrefix(path, p))) return "public";
  if (AUTH_PREFIXES.some((p) => underPrefix(path, p))) return "auth";
  return "owner";
}

export function parseOwnerEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwner(email: string | undefined | null, owners: readonly string[]): boolean {
  if (!email) return false;
  return owners.includes(email.trim().toLowerCase());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hubAccess.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hubAccess.ts src/lib/hubAccess.test.ts
git commit -m "Hub access: pure owner/public route rules"
```

---

### Task 2: Enforce owner-only hub in middleware

**Files:**
- Modify: `src/middleware.ts` (the block from `// ----- Token-authenticated ingest` to the end of `middleware()`)

- [ ] **Step 1: Add the import and owner list at the top of `src/middleware.ts`**

After the existing `import { APP_GATES, constantTimeEqual, gateHash } from "@/lib/appGate";` add:

```ts
import { PUBLIC_HOME, isOwner, parseOwnerEmails, routeAccess } from "@/lib/hubAccess";

/** Emails allowed into the private hub. Unset = nobody (fail-closed). */
const OWNER_EMAILS = parseOwnerEmails(process.env.HUB_OWNER_EMAILS);
```

- [ ] **Step 2: Replace the body from the token check to the end of `middleware()`**

Replace everything from the line `if (TOKEN_AUTH_PATHS.has(path)) return NextResponse.next();` through the final `return setUidCookie(response, user?.id ?? null);` with:

```ts
  const access = routeAccess(path, TOKEN_AUTH_PATHS);
  if (access === "token") return NextResponse.next();

  // ----- Supabase session refresh + login gate ----------------------------
  if (!supabaseConfigured) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const owner = isOwner(user?.email, OWNER_EMAILS);
  const isApi = path.startsWith("/api");

  // Friends Night Out is public: anyone may browse, signed in or not. The
  // session is still refreshed so a signed-in visitor stays signed in.
  if (access === "public") return setUidCookie(response, user?.id ?? null);

  if (access === "auth") {
    if (user && path.startsWith("/login")) {
      const url = request.nextUrl.clone();
      url.pathname = owner ? "/" : PUBLIC_HOME;
      return setUidCookie(NextResponse.redirect(url), user.id);
    }
    return setUidCookie(response, user?.id ?? null);
  }

  // ----- Owner-only: the rest of the hub ---------------------------------
  if (!user) {
    // An API call gets a status it can act on. Redirecting it to /login would
    // hand fetch() a 200 and a page of HTML, which every caller here would try
    // to parse as JSON and report as a confusing failure.
    if (isApi) {
      return setUidCookie(
        NextResponse.json({ error: "Sign in to use this endpoint." }, { status: 401 }),
        null,
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return setUidCookie(NextResponse.redirect(url), null);
  }
  if (!owner) {
    // A Friends Night Out member (or anyone who signed up) is not the owner.
    // They get FNO and nothing else — never STD Safe, Dashboard, the AI proxy.
    if (isApi) {
      return setUidCookie(
        NextResponse.json({ error: "This endpoint is private." }, { status: 403 }),
        user.id,
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = PUBLIC_HOME;
    url.search = "";
    return setUidCookie(NextResponse.redirect(url), user.id);
  }
  return setUidCookie(response, user.id);
}
```

(The per-app password gate loop above it is unchanged. The old `isAuthRoute` / `isApi` declarations are replaced by the ones above — delete the originals.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors in `src/middleware.ts` or `src/lib/hubAccess.ts`.

- [ ] **Step 4: Add the env line**

Append to `.env.example` (below the Supabase block):

```
# Emails allowed into the private hub (comma-separated). Unset = nobody:
# every signed-in account is sent to Friends Night Out. Set this BEFORE deploying.
HUB_OWNER_EMAILS=
```

Append the same blank `HUB_OWNER_EMAILS=` line to `.env.local` and show the owner that exact line to paste their login email into (house rule: never fill it in for them).

- [ ] **Step 5: Verify in the preview (real click path)**

Start the existing preview server for the hub (`.claude/launch.json`), with `HUB_OWNER_EMAILS` blank locally:
1. Open `/apps/friends-night-out` signed out → page renders (not redirected to `/login`).
2. `fetch('/api/fno/geocode?q=Columbus')` from the page console → 200.
3. Open `/apps/std-safe` signed out → redirected to `/login`.
4. `fetch('/api/skills/scan')` signed out → 401.

(Signed-in owner/non-owner checks happen in Task 8 once the owner has set the env var — Claude may not enter credentials.)

- [ ] **Step 6: Commit**

```bash
git add src/middleware.ts .env.example
git commit -m "Hub: owner-only private apps, Friends Night Out public"
```

---

### Task 3: Anonymous visitors don't trigger the AI sweep

**Files:**
- Modify: `src/app/api/fno/search/route.ts`

- [ ] **Step 1: Add the session check**

Add imports at the top:

```ts
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
```

Add this helper above `export async function POST`:

```ts
/**
 * The AI sweep spends the owner's OpenRouter credit. With FNO public, an
 * anonymous visitor must not be able to trigger it. Local demo mode (no
 * Supabase) has no accounts at all, so it keeps the sweep.
 */
async function mayUseAi(): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;
  const sb = await getSupabaseServerClient();
  if (!sb) return true;
  const { data } = await sb.auth.getUser();
  return Boolean(data.user);
}
```

- [ ] **Step 2: Use it in the ctx**

In `POST`, change the `skipAiSweep` line in the `ctx` object from:

```ts
    skipAiSweep: body.skipAiSweep,
```
to:
```ts
    skipAiSweep: body.skipAiSweep || !(await mayUseAi()),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/fno/search/route.ts
git commit -m "FNO: AI sweep only for signed-in visitors"
```

---

### Task 4: Sections

**Files:**
- Create: `src/lib/friends-night-out/sections.ts`
- Test: `src/lib/friends-night-out/sections.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/friends-night-out/sections.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SECTIONS, isSectionId, sectionLabel } from "./sections";

describe("sections", () => {
  it("has the five approved sections in order", () => {
    expect(SECTIONS.map((s) => s.label)).toEqual([
      "Parks and outside",
      "Fun",
      "Unique gems",
      "Kids",
      "Food",
    ]);
  });

  it("validates ids", () => {
    expect(isSectionId("gems")).toBe(true);
    expect(isSectionId("nightlife")).toBe(false);
    expect(isSectionId(3)).toBe(false);
  });

  it("labels ids", () => {
    expect(sectionLabel("parks")).toBe("Parks and outside");
  });

  it("matches the database check constraint", () => {
    const sql = readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/20260919000000_fno_social.sql"),
      "utf8",
    );
    const m = sql.match(/section\s+text not null check \(section in \(([^)]*)\)\)/);
    expect(m).not.toBeNull();
    const dbIds = m![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(dbIds).toEqual(SECTIONS.map((s) => s.id));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/friends-night-out/sections.test.ts`
Expected: FAIL — cannot resolve `./sections`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/friends-night-out/sections.ts
// The Explore places sections. Add or rename here AND in the fno_places
// check constraint (supabase/migrations/*_fno_social.sql) — a test keeps the
// two in step.
export const SECTIONS = [
  { id: "parks", label: "Parks and outside" },
  { id: "fun", label: "Fun" },
  { id: "gems", label: "Unique gems" },
  { id: "kids", label: "Kids" },
  { id: "food", label: "Food" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export function isSectionId(x: unknown): x is SectionId {
  return typeof x === "string" && SECTIONS.some((s) => s.id === x);
}

export function sectionLabel(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)!.label;
}
```

- [ ] **Step 4: Run test** — the constraint test still fails until Task 7 creates the migration. Run: `npx vitest run src/lib/friends-night-out/sections.test.ts -t "validates|labels|approved"` → PASS (3). The full file passes after Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/lib/friends-night-out/sections.ts src/lib/friends-night-out/sections.test.ts
git commit -m "FNO: section ids for Explore places"
```

---

### Task 5: Blended stars

**Files:**
- Create: `src/lib/friends-night-out/stars.ts`
- Test: `src/lib/friends-night-out/stars.test.ts`

Rule (spec §1): AI counts as 3 votes. `value = (ai*3 + sum) / (3 + n)`. With no AI rating, community stars appear only once there are ≥ 3 ratings.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/friends-night-out/stars.test.ts
import { describe, expect, it } from "vitest";
import { blendedStars } from "./stars";

describe("blendedStars", () => {
  it("is the AI rating when nobody has rated", () => {
    expect(blendedStars({ aiStars: 4, ratingCount: 0, ratingSum: 0 })).toEqual({
      value: 4, rounded: 4, source: "ai",
    });
  });

  it("weights AI as three votes", () => {
    // (3*3 + 5+5+5) / 6 = 4
    expect(blendedStars({ aiStars: 3, ratingCount: 3, ratingSum: 15 })).toEqual({
      value: 4, rounded: 4, source: "blend",
    });
  });

  it("lets ten ratings mostly decide", () => {
    // (2*3 + 50) / 13 = 4.307… → 4.3
    const s = blendedStars({ aiStars: 2, ratingCount: 10, ratingSum: 50 });
    expect(s.value).toBe(4.3);
    expect(s.rounded).toBe(4);
  });

  it("uses community only when there is no AI rating and 3+ ratings", () => {
    expect(blendedStars({ aiStars: null, ratingCount: 3, ratingSum: 13 })).toEqual({
      value: 4.3, rounded: 4, source: "community",
    });
  });

  it("returns none below three ratings with no AI", () => {
    expect(blendedStars({ aiStars: null, ratingCount: 2, ratingSum: 10 })).toEqual({
      value: null, rounded: null, source: "none",
    });
  });

  it("clamps to 1..5", () => {
    expect(blendedStars({ aiStars: 9, ratingCount: 0, ratingSum: 0 }).value).toBe(5);
    expect(blendedStars({ aiStars: 0, ratingCount: 0, ratingSum: 0 }).value).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/friends-night-out/stars.test.ts`
Expected: FAIL — cannot resolve `./stars`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/friends-night-out/stars.ts
// AI rates every place first; community ratings pull it up or down. The AI
// counts as AI_PRIOR_WEIGHT votes, so a handful of ratings nudge it and ten or
// so mostly decide it.
export const AI_PRIOR_WEIGHT = 3;
export const MIN_COMMUNITY_RATINGS = 3;

export interface StarInput {
  aiStars: number | null;
  ratingCount: number;
  ratingSum: number;
}

export interface Stars {
  /** One decimal, for the detail panel. */
  value: number | null;
  /** Whole star, for filtering and the table. */
  rounded: number | null;
  source: "ai" | "blend" | "community" | "none";
}

const clamp = (n: number) => Math.min(5, Math.max(1, n));
const oneDecimal = (n: number) => Math.round(n * 10) / 10;

function stars(raw: number, source: Stars["source"]): Stars {
  const value = oneDecimal(clamp(raw));
  return { value, rounded: Math.round(value), source };
}

export function blendedStars({ aiStars, ratingCount, ratingSum }: StarInput): Stars {
  if (aiStars != null) {
    if (ratingCount === 0) return stars(aiStars, "ai");
    return stars((aiStars * AI_PRIOR_WEIGHT + ratingSum) / (AI_PRIOR_WEIGHT + ratingCount), "blend");
  }
  if (ratingCount >= MIN_COMMUNITY_RATINGS) return stars(ratingSum / ratingCount, "community");
  return { value: null, rounded: null, source: "none" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/friends-night-out/stars.test.ts`
Expected: PASS (6).

- [ ] **Step 5: Commit**

```bash
git add src/lib/friends-night-out/stars.ts src/lib/friends-night-out/stars.test.ts
git commit -m "FNO: blended AI + community stars"
```

---

### Task 6: City area reuse

**Files:**
- Create: `src/lib/friends-night-out/areas.ts`
- Test: `src/lib/friends-night-out/areas.test.ts`

Rule (spec §1): reuse an area when its center is within 10 mi of the user's center AND the user's circle fits inside the built circle (`distance + radius <= builtRadius`). Among candidates, pick the nearest center.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/friends-night-out/areas.test.ts
import { describe, expect, it } from "vitest";
import { findReusableArea } from "./areas";

// Columbus, OH and a point ~5.5 mi north of it.
const COLUMBUS = { id: "cbus", lat: 39.9612, lon: -82.9988, builtRadiusMi: 30 };
const NORTH = { lat: 40.0412, lon: -82.9988 };

describe("findReusableArea", () => {
  it("reuses when the user's circle fits inside the built one", () => {
    expect(findReusableArea([COLUMBUS], NORTH, 15)?.id).toBe("cbus");
  });

  it("builds new when the radius spills outside", () => {
    expect(findReusableArea([COLUMBUS], NORTH, 28)).toBeNull();
  });

  it("builds new when the center is more than 10 mi away", () => {
    const far = { lat: 40.1612, lon: -82.9988 }; // ~13.8 mi
    expect(findReusableArea([{ ...COLUMBUS, builtRadiusMi: 50 }], far, 5)).toBeNull();
  });

  it("picks the nearest qualifying area", () => {
    const near = { id: "near", lat: 40.0312, lon: -82.9988, builtRadiusMi: 30 };
    expect(findReusableArea([COLUMBUS, near], NORTH, 10)?.id).toBe("near");
  });

  it("returns null with no areas", () => {
    expect(findReusableArea([], NORTH, 10)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/friends-night-out/areas.test.ts`
Expected: FAIL — cannot resolve `./areas`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/friends-night-out/areas.ts
// A city catalogue is built once per area and shared. A new user reuses an
// existing area when they are close to its center and their radius fits inside
// what was built; otherwise a new area is built for them.
import { distanceMi } from "./geo";
import type { Coords } from "./types";

export const AREA_REUSE_MAX_CENTER_MI = 10;

export interface AreaLike extends Coords {
  id: string;
  builtRadiusMi: number;
}

export function findReusableArea<A extends AreaLike>(
  areas: readonly A[],
  center: Coords,
  radiusMi: number,
): A | null {
  let best: A | null = null;
  let bestD = Infinity;
  for (const a of areas) {
    const d = distanceMi(a, center);
    if (d > AREA_REUSE_MAX_CENTER_MI) continue;
    if (d + radiusMi > a.builtRadiusMi) continue;
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/friends-night-out/areas.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/friends-night-out/areas.ts src/lib/friends-night-out/areas.test.ts
git commit -m "FNO: shared city area reuse rule"
```

---

### Task 7: Database schema, RLS and leaderboard

**Files:**
- Create: `supabase/migrations/20260919000000_fno_social.sql`
- Create: `supabase/tests/fno_rls_check.sql`
- Regenerate: `supabase/all-schemas.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Friends Night Out v2 — shared city catalogues + social layer.
--
-- Public sign-up: every table here is RLS-on. Catalogue tables (areas, places,
-- events) are world-readable and written ONLY by the server with the service
-- role. User tables are written only by their owner, through their own session.
-- Leaderboard and rating aggregates are exposed through a security-definer
-- view/function so individual ratings stay private.
-- Additive and idempotent: safe to run twice.
-- ============================================================================

create table if not exists public.fno_areas (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,
  lat             double precision not null,
  lon             double precision not null,
  built_radius_mi numeric not null check (built_radius_mi between 1 and 50),
  status          text not null default 'building' check (status in ('building','ready','failed')),
  last_built_at   timestamptz,
  last_active_at  timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create table if not exists public.fno_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users (id) on delete cascade,
  handle        text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name  text not null check (char_length(display_name) between 1 and 60),
  home_area_id  uuid references public.fno_areas (id) on delete set null,
  radius_mi     numeric not null default 15 check (radius_mi between 5 and 50),
  is_public     boolean not null default true,
  is_ai_guide   boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint fno_profiles_kind check (
    (is_ai_guide and user_id is null) or (not is_ai_guide and user_id is not null)
  )
);

create table if not exists public.fno_places (
  id                 uuid primary key default gen_random_uuid(),
  area_id            uuid not null references public.fno_areas (id) on delete cascade,
  name               text not null,
  address            text,
  lat                double precision not null,
  lon                double precision not null,
  section            text not null check (section in ('parks','fun','gems','kids','food')),
  ai_stars           smallint check (ai_stars between 1 and 5),
  ai_reason          text,
  stars_estimated    boolean not null default false,
  hook               text,
  price_tier         text check (price_tier in ('free','$','$$','$$$')),
  photo_url          text,
  sources            jsonb not null default '[]'::jsonb,
  osm_id             text,
  original_finder_id uuid references public.fno_profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (area_id, osm_id)
);
create index if not exists fno_places_area_idx on public.fno_places (area_id);

create table if not exists public.fno_events (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.fno_areas (id) on delete cascade,
  title       text not null,
  description text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  frequency   text not null default 'once' check (frequency in ('once','weekly','monthly','yearly','other')),
  event_type  text,
  venue_name  text,
  address     text,
  lat         double precision,
  lon         double precision,
  url         text,
  price_tier  text check (price_tier in ('free','$','$$','$$$')),
  sources     jsonb not null default '[]'::jsonb,
  dedupe_key  text not null,
  created_at  timestamptz not null default now(),
  unique (area_id, dedupe_key)
);
create index if not exists fno_events_area_starts_idx on public.fno_events (area_id, starts_at);

create table if not exists public.fno_list_items (
  profile_id     uuid not null references public.fno_profiles (id) on delete cascade,
  place_id       uuid not null references public.fno_places (id) on delete cascade,
  copied_from_id uuid references public.fno_profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (profile_id, place_id),
  constraint fno_list_items_no_self_copy check (copied_from_id is distinct from profile_id)
);
create index if not exists fno_list_items_from_idx on public.fno_list_items (copied_from_id);
create index if not exists fno_list_items_place_idx on public.fno_list_items (place_id);

create table if not exists public.fno_notes (
  profile_id uuid not null references public.fno_profiles (id) on delete cascade,
  place_id   uuid not null references public.fno_places (id) on delete cascade,
  body       text not null check (char_length(body) <= 2000),
  is_public  boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (profile_id, place_id)
);

create table if not exists public.fno_ratings (
  profile_id uuid not null references public.fno_profiles (id) on delete cascade,
  place_id   uuid not null references public.fno_places (id) on delete cascade,
  stars      smallint not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (profile_id, place_id)
);

create table if not exists public.fno_follows (
  follower_id uuid not null references public.fno_profiles (id) on delete cascade,
  followee_id uuid not null references public.fno_profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint fno_follows_not_self check (follower_id <> followee_id)
);
create index if not exists fno_follows_followee_idx on public.fno_follows (followee_id);

create table if not exists public.fno_saved_events (
  profile_id uuid not null references public.fno_profiles (id) on delete cascade,
  event_id   uuid not null references public.fno_events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, event_id)
);

-- ----- helper: the caller's profile id ------------------------------------
create or replace function public.fno_my_profile_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.fno_profiles where user_id = auth.uid()
$$;
revoke all on function public.fno_my_profile_id() from public;
grant execute on function public.fno_my_profile_id() to anon, authenticated;

-- ----- a copy must come from a list that actually has the place -----------
create or replace function public.fno_list_items_check_source()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.copied_from_id is not null and not exists (
    select 1 from public.fno_list_items
    where profile_id = new.copied_from_id and place_id = new.place_id
  ) then
    raise exception 'copied_from profile does not have this place' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists fno_list_items_check_source on public.fno_list_items;
create trigger fno_list_items_check_source
  before insert on public.fno_list_items
  for each row execute function public.fno_list_items_check_source();

-- ----- RLS -----------------------------------------------------------------
alter table public.fno_areas        enable row level security;
alter table public.fno_profiles     enable row level security;
alter table public.fno_places       enable row level security;
alter table public.fno_events       enable row level security;
alter table public.fno_list_items   enable row level security;
alter table public.fno_notes        enable row level security;
alter table public.fno_ratings      enable row level security;
alter table public.fno_follows      enable row level security;
alter table public.fno_saved_events enable row level security;

-- Catalogue: world-readable; no write policy = service role only.
drop policy if exists fno_areas_read on public.fno_areas;
create policy fno_areas_read on public.fno_areas for select using (true);
drop policy if exists fno_places_read on public.fno_places;
create policy fno_places_read on public.fno_places for select using (true);
drop policy if exists fno_events_read on public.fno_events;
create policy fno_events_read on public.fno_events for select using (true);

-- Profiles: public ones readable by all; your own always. Users can never
-- create or become an AI guide.
drop policy if exists fno_profiles_read on public.fno_profiles;
create policy fno_profiles_read on public.fno_profiles for select
  using (is_public or user_id = auth.uid());
drop policy if exists fno_profiles_insert on public.fno_profiles;
create policy fno_profiles_insert on public.fno_profiles for insert
  with check (user_id = auth.uid() and not is_ai_guide);
drop policy if exists fno_profiles_update on public.fno_profiles;
create policy fno_profiles_update on public.fno_profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and not is_ai_guide);
drop policy if exists fno_profiles_delete on public.fno_profiles;
create policy fno_profiles_delete on public.fno_profiles for delete
  using (user_id = auth.uid());

-- List items: readable if yours or the owner's profile is public.
drop policy if exists fno_list_items_read on public.fno_list_items;
create policy fno_list_items_read on public.fno_list_items for select using (
  profile_id = public.fno_my_profile_id()
  or exists (select 1 from public.fno_profiles p where p.id = profile_id and p.is_public)
);
drop policy if exists fno_list_items_insert on public.fno_list_items;
create policy fno_list_items_insert on public.fno_list_items for insert
  with check (profile_id = public.fno_my_profile_id());
drop policy if exists fno_list_items_delete on public.fno_list_items;
create policy fno_list_items_delete on public.fno_list_items for delete
  using (profile_id = public.fno_my_profile_id());

-- Notes: public notes readable by all (only on public profiles); private only yours.
drop policy if exists fno_notes_read on public.fno_notes;
create policy fno_notes_read on public.fno_notes for select using (
  profile_id = public.fno_my_profile_id()
  or (is_public and exists (select 1 from public.fno_profiles p where p.id = profile_id and p.is_public))
);
drop policy if exists fno_notes_write on public.fno_notes;
create policy fno_notes_write on public.fno_notes for all
  using (profile_id = public.fno_my_profile_id())
  with check (profile_id = public.fno_my_profile_id());

-- Ratings: only your own rows; aggregates via fno_place_stats.
drop policy if exists fno_ratings_own on public.fno_ratings;
create policy fno_ratings_own on public.fno_ratings for all
  using (profile_id = public.fno_my_profile_id())
  with check (profile_id = public.fno_my_profile_id());

-- Follows: the graph is public; you can only follow/unfollow as yourself.
drop policy if exists fno_follows_read on public.fno_follows;
create policy fno_follows_read on public.fno_follows for select using (true);
drop policy if exists fno_follows_insert on public.fno_follows;
create policy fno_follows_insert on public.fno_follows for insert
  with check (follower_id = public.fno_my_profile_id());
drop policy if exists fno_follows_delete on public.fno_follows;
create policy fno_follows_delete on public.fno_follows for delete
  using (follower_id = public.fno_my_profile_id());

-- Saved events: yours only.
drop policy if exists fno_saved_events_own on public.fno_saved_events;
create policy fno_saved_events_own on public.fno_saved_events for all
  using (profile_id = public.fno_my_profile_id())
  with check (profile_id = public.fno_my_profile_id());

-- ----- aggregates ----------------------------------------------------------
-- Runs as the view owner, so it can count private rows; it exposes only counts.
create or replace view public.fno_place_stats as
select
  p.id                       as place_id,
  coalesce(r.n, 0)::int      as rating_count,
  coalesce(r.s, 0)::int      as rating_sum,
  coalesce(l.n, 0)::int      as list_count
from public.fno_places p
left join (select place_id, count(*) n, sum(stars) s from public.fno_ratings group by place_id) r
  on r.place_id = p.id
left join (select place_id, count(*) n from public.fno_list_items group by place_id) l
  on l.place_id = p.id;
grant select on public.fno_place_stats to anon, authenticated;

-- Leaderboard (spec §3): +1 per copy from your list, +0.5 per add of a place
-- you originally found (by anyone but you), +3 per follower. Only actions by
-- verified-email accounts count. p_since = null → all time.
create or replace function public.fno_leaderboard(
  p_area uuid, p_since timestamptz default null, p_limit int default 50
)
returns table (
  profile_id uuid, handle text, display_name text, is_ai_guide boolean,
  copies bigint, finder_adds bigint, followers bigint, score numeric
)
language sql stable security definer set search_path = public as $$
  with verified as (
    select pr.id from public.fno_profiles pr
    join auth.users u on u.id = pr.user_id
    where u.email_confirmed_at is not null
  ),
  c as (
    select li.copied_from_id as pid, count(*) as n
    from public.fno_list_items li join verified v on v.id = li.profile_id
    where li.copied_from_id is not null and (p_since is null or li.created_at >= p_since)
    group by 1
  ),
  f as (
    select pl.original_finder_id as pid, count(*) as n
    from public.fno_list_items li
    join verified v on v.id = li.profile_id
    join public.fno_places pl on pl.id = li.place_id
    where pl.original_finder_id is not null
      and li.profile_id <> pl.original_finder_id
      and (p_since is null or li.created_at >= p_since)
    group by 1
  ),
  fo as (
    select fw.followee_id as pid, count(*) as n
    from public.fno_follows fw join verified v on v.id = fw.follower_id
    where (p_since is null or fw.created_at >= p_since)
    group by 1
  )
  select pr.id, pr.handle, pr.display_name, pr.is_ai_guide,
         coalesce(c.n, 0), coalesce(f.n, 0), coalesce(fo.n, 0),
         coalesce(c.n, 0) + 0.5 * coalesce(f.n, 0) + 3 * coalesce(fo.n, 0)
  from public.fno_profiles pr
  left join c  on c.pid  = pr.id
  left join f  on f.pid  = pr.id
  left join fo on fo.pid = pr.id
  where pr.home_area_id = p_area and pr.is_public
  order by 8 desc, pr.created_at asc
  limit least(greatest(p_limit, 1), 100)
$$;
revoke all on function public.fno_leaderboard(uuid, timestamptz, int) from public;
grant execute on function public.fno_leaderboard(uuid, timestamptz, int) to anon, authenticated;
```

- [ ] **Step 2: Run the sections constraint test**

Run: `npx vitest run src/lib/friends-night-out/sections.test.ts`
Expected: PASS (4).

- [ ] **Step 3: Write the RLS check script**

```sql
-- supabase/tests/fno_rls_check.sql
-- Paste into the Supabase SQL Editor AFTER the migration. Everything runs in a
-- transaction that is rolled back, so it leaves no data behind. Each check
-- raises an exception on failure; success ends with the notice 'FNO RLS OK'.
begin;

-- Two fake auth users (rolled back at the end).
insert into auth.users (id, email, email_confirmed_at, aud, role)
values ('00000000-0000-0000-0000-00000000000a', 'a@test.local', now(), 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-00000000000b', 'b@test.local', now(), 'authenticated', 'authenticated');

insert into public.fno_areas (id, label, lat, lon, built_radius_mi, status)
values ('00000000-0000-0000-0000-0000000000a1', 'Test', 40, -83, 25, 'ready');
insert into public.fno_places (id, area_id, name, lat, lon, section, ai_stars)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Speakeasy', 40, -83, 'gems', 5);

-- Act as user A.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

insert into public.fno_profiles (user_id, handle, display_name, home_area_id)
values ('00000000-0000-0000-0000-00000000000a', 'user_a', 'A', '00000000-0000-0000-0000-0000000000a1');

do $$ begin
  -- A cannot create an AI guide.
  begin
    insert into public.fno_profiles (user_id, handle, display_name, is_ai_guide)
    values (null, 'fake_guide', 'Fake', true);
    raise exception 'FAIL: user created an AI guide';
  exception when insufficient_privilege or check_violation then null; end;

  -- A cannot write the catalogue.
  begin
    insert into public.fno_places (area_id, name, lat, lon, section, ai_stars)
    values ('00000000-0000-0000-0000-0000000000a1', 'Fake', 40, -83, 'fun', 5);
    raise exception 'FAIL: user wrote fno_places';
  exception when insufficient_privilege then null; end;

  -- A can add a place to their own list, rate it, write a private note.
  insert into public.fno_list_items (profile_id, place_id)
  values (public.fno_my_profile_id(), '00000000-0000-0000-0000-0000000000c1');
  insert into public.fno_ratings (profile_id, place_id, stars)
  values (public.fno_my_profile_id(), '00000000-0000-0000-0000-0000000000c1', 4);
  insert into public.fno_notes (profile_id, place_id, body)
  values (public.fno_my_profile_id(), '00000000-0000-0000-0000-0000000000c1', 'secret note');
end $$;

-- Act as user B.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
insert into public.fno_profiles (user_id, handle, display_name, home_area_id)
values ('00000000-0000-0000-0000-00000000000b', 'user_b', 'B', '00000000-0000-0000-0000-0000000000a1');

do $$
declare a_id uuid;
begin
  select id into a_id from public.fno_profiles where handle = 'user_a';

  -- B cannot see A's private note or rating.
  if exists (select 1 from public.fno_notes where profile_id = a_id) then
    raise exception 'FAIL: B read A''s private note';
  end if;
  if exists (select 1 from public.fno_ratings where profile_id = a_id) then
    raise exception 'FAIL: B read A''s rating';
  end if;

  -- B cannot write into A's list.
  begin
    insert into public.fno_list_items (profile_id, place_id)
    values (a_id, '00000000-0000-0000-0000-0000000000c1');
    raise exception 'FAIL: B wrote A''s list';
  exception when insufficient_privilege then null; end;

  -- B cannot follow as A.
  begin
    insert into public.fno_follows (follower_id, followee_id)
    values (a_id, public.fno_my_profile_id());
    raise exception 'FAIL: B followed as A';
  exception when insufficient_privilege then null; end;

  -- B can see A's public list, copy from it, and follow A.
  if not exists (select 1 from public.fno_list_items where profile_id = a_id) then
    raise exception 'FAIL: B cannot see A''s public list';
  end if;
  insert into public.fno_list_items (profile_id, place_id, copied_from_id)
  values (public.fno_my_profile_id(), '00000000-0000-0000-0000-0000000000c1', a_id);
  insert into public.fno_follows (follower_id, followee_id) values (public.fno_my_profile_id(), a_id);

  -- Stats view exposes the rating aggregate but not who rated.
  if (select rating_count from public.fno_place_stats
      where place_id = '00000000-0000-0000-0000-0000000000c1') <> 1 then
    raise exception 'FAIL: stats view rating_count';
  end if;

  -- Leaderboard: A has 1 copy + 3 for the follower = 4.
  if (select score from public.fno_leaderboard('00000000-0000-0000-0000-0000000000a1')
      where handle = 'user_a') <> 4 then
    raise exception 'FAIL: leaderboard score for A';
  end if;

  raise notice 'FNO RLS OK';
end $$;

rollback;
```

- [ ] **Step 4: Regenerate the combined schema**

Run: `bash scripts/build-all-schemas.sh`
Expected: `supabase/all-schemas.sql` now contains `MIGRATION: 20260919000000_fno_social.sql`.
Verify: `grep -c "fno_leaderboard" supabase/all-schemas.sql` → ≥ 1.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260919000000_fno_social.sql supabase/tests/fno_rls_check.sql supabase/all-schemas.sql
git commit -m "FNO v2: social schema, RLS, stats view, leaderboard function"
```

---

### Task 8: Owner hand-off, deploy and verify

Claude has no Supabase DB credential and may not enter passwords, so these steps are the owner's; Claude prepares them and verifies from the outside.

- [ ] **Step 1: Full test run**

Run: `npx vitest run src/lib/hubAccess.test.ts src/lib/friends-night-out`
Expected: all PASS.

- [ ] **Step 2: Owner sets the env var BEFORE pushing**

Show the owner the `.env.local` line `HUB_OWNER_EMAILS=` and ask them to:
1. Paste their hub login email after `=` in `.env.local`.
2. Add the same `HUB_OWNER_EMAILS` value in Vercel → Project `ultimate-assistant-os` → Settings → Environment Variables (Production, Preview, Development).

Do not push until they confirm — with it unset, production fails closed and the owner is sent to Friends Night Out instead of their hub.

- [ ] **Step 3: Owner applies the SQL**

`Set-Clipboard` the migration (`Get-Content supabase/migrations/20260919000000_fno_social.sql -Raw | Set-Clipboard`), owner pastes into Supabase SQL Editor → Run. Then clipboard `supabase/tests/fno_rls_check.sql`, owner runs it; expected output notice: `FNO RLS OK`. Any `FAIL:` message → stop and fix before continuing.

- [ ] **Step 4: Push (auto-deploys)**

```bash
git push origin main
```

- [ ] **Step 5: Verify from outside (no credentials)**

After ~90 s:
- `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://ultimate-assistant-os.vercel.app/apps/friends-night-out` → `200` (not a redirect to /login).
- `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://ultimate-assistant-os.vercel.app/apps/std-safe` → `307 …/login`.
- `curl -s -w "%{http_code}\n" -o /dev/null https://ultimate-assistant-os.vercel.app/api/skills/scan` → `401`.

- [ ] **Step 6: Owner click-path check**

Ask the owner to: sign in normally → hub home loads (owner). Then, in a private window, create a throwaway account on `/login` → they land on Friends Night Out, and typing `/apps/std-safe` sends them back to Friends Night Out.

- [ ] **Step 7: Update memory**

Update `friends-night-out-app.md` and `hub-deployment-supabase.md` memories: owner gate (`HUB_OWNER_EMAILS`, fail-closed, `src/lib/hubAccess.ts`), FNO public surface, `fno_*` tables applied (or pending), and that plans 2–4 follow in `docs/superpowers/plans/`.
