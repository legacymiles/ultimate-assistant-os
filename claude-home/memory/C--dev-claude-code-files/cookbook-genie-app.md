---
name: cookbook-genie-app
description: "Cookbook Genie — AI recipe cookbook app at /apps/cookbook-genie, ported from legacymiles/chef-whisperer-hub"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2c4b9490-ce1c-4fd3-8e9f-cff9343c7a10
  modified: 2026-09-13T20:22:04.052Z
---

Cookbook Genie is a **social AI cookbook platform** at `/apps/cookbook-genie`, originally ported from the Lovable/Vite repo `github.com/legacymiles/chef-whisperer-hub` (original brand "CookBook AI"), then redesigned into a social app. Self-contained Next.js client app with internal state-based routing (no react-router).

**Social features (added):** Discover feed of public cookbooks, star (like) cookbooks, follow users, user profiles (`ProfileView`), a **global cookbook leaderboard** (score = stars + shares) and a **per-city restaurant leaderboard** (aggregates everyone's `favorite_restaurants` by city name → fan count + avg rating), all in `LeaderboardView`. Shared helpers in `social.ts` (loadProfiles/StarCounts/ShareCounts/CookbookMeta, toggleStar/Follow) and a reusable `CookbookCard.tsx`. New tables: `cookbook_stars`, `follows`; `profiles.bio`; cookbook `privacy` now `public|private` (default public).

**Image generation:** uses **Pollinations.ai** (`imageGen.ts` → `recipeImageUrl()`) — FREE, no API key, returns an https URL stored directly as `image_url` (no upload). The "Generate/Regenerate Image" button works in both modes. The old `/api/cookbook/generate-recipe-image` route is now unused.

**Structure:** `src/components/cookbook/CookbookGenie.tsx` (auth + router + context), `CookbookLayout.tsx` (sidebar/topbar), `RecipeTagChips.tsx`, `CookbookCard.tsx`, `social.ts`, `imageGen.ts`, and `views/` (Auth, Dashboard, Discover, Leaderboard, Profile, NewCookbook, CookbookView, CreateRecipeView, RecipeView, FavoritesView, SharedWithMeView). Recipe-text + auto-tag API routes under `src/app/api/cookbook/` still use the Vercel AI Gateway with an **offline heuristic fallback**.

**Backend:** Supabase (auth + tables: profiles, cookbooks, cookbook_stars, follows, recipes, recipe_versions, cookbook_shares, favorite_cities/restaurants/dishes). Full schema with RLS (public cookbooks discoverable, world-readable stars/follows and cities/restaurants for leaderboards, private dishes) + storage bucket in `supabase/cookbook-genie-schema.sql` — run it in the Supabase SQL editor. Reuses `getSupabaseBrowserClient()` + `NEXT_PUBLIC_SUPABASE_*` env.

**Local demo mode (key detail):** when Supabase isn't configured, `localClient.ts` provides an in-browser Supabase-compatible client (query builder + auth + storage over localStorage) so the app is fully live with a "Local demo" badge. It **seeds a social world** (`seedSocialWorld`): 4 demo members (Aiko/Marco/Priya/Sofia) with public cookbooks, recipes (Pollinations images), stars, follows, and city restaurants, plus the guest's own public cookbook — so Discover, leaderboards and profiles are populated out of the box. To reset the demo, clear localStorage keys `cookbook_genie_local_db_v1` / `cookbook_genie_local_auth_v1`. Verified in-browser: Discover, both leaderboards, profile+follow, star, and Pollinations image generation all work.

**RLS gotcha (2026-09-13):** never `.insert(...).select()` on `cookbooks`. The SELECT policy used `can_view_cookbook(id)` (a STABLE fn re-querying the table), which can't see the row inside INSERT…RETURNING → "new row violates row-level security policy". Inserts now make the id client-side (`crypto.randomUUID()`), and migration `20260913000000_cookbooks_select_sees_new_row.sql` checks owner/public on the row's own columns. Local demo mode can't reproduce RLS bugs.

**Design:** warm orange `#e67e22` accent, Georgia serif headings, on the hub's dark theme tokens (canvas/panel/elevated/ink). Catalog entry added in `src/lib/catalog.ts` (slug `cookbook-genie`, status live, iconStyle waves, hue [28,45]). Optional env for real AI: `AI_GATEWAY_API_KEY`, `AI_IMAGE_MODEL` (e.g. openai/gpt-image-1).
