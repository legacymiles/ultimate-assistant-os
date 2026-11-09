# Ultimate Assistant OS

**One Next.js 15 application that holds 40 apps as routes inside itself.**

An AI, media and automation hub: `/` is an animated carousel of every app, and each app
lives at `/apps/<slug>` with its own server routes under `/api/`. Not a monorepo — one
`npm install`, one dev server, one deployment, 40 apps.

Built with **Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Three.js ·
Supabase**, deployed on Vercel. Dark-first, mobile-first.

> **Building this with an AI tool or agent?** Read [`AGENTS.md`](AGENTS.md) first. It is
> the short, portable contract: what this repo is, how to build it, and what "correct"
> looks like. Claude Code should also read [`CLAUDE.md`](CLAUDE.md).

---

## Quick start

```bash
git clone https://github.com/legacymiles/ultimate-assistant-os.git
cd ultimate-assistant-os
npm ci
npm run dev
```

Open <http://localhost:3000>.

**No configuration is required.** With no `.env.local` at all, the whole hub runs in
**local demo mode**: data persists to `localStorage` or to files beside the project, AI
features fall back to built-in offline analyzers, and anything that needs a GPU or a paid
service explains itself in place instead of failing. Every key in `.env.example` is
optional and switches exactly one capability from demo to real.

```bash
npm run build && npm start    # production build
npm test                      # 259 vitest files, 3,831 tests, no keys needed
```

The build fetches nothing. Every webfont is committed under `public/fonts/` and read with
`next/font/local`, so `npm run build` works with no network at all — internet is needed
only to install.

**Node >= 22.11** (pinned in `.nvmrc` and `engines`; verified on 24.14). Use `npm ci` so
the committed `package-lock.json` decides the tree — not pnpm, yarn or bun.
`node_modules` lands around 2.5 GB, because Three.js, Cesium and a static ffmpeg build
are in there.

---

## The apps

**[`docs/apps/README.md`](docs/apps/README.md)** is the full inventory — every app, its
route, and one line on what it does. It is generated from
[`src/lib/catalog.ts`](src/lib/catalog.ts), the single source of truth for the hub:

```bash
npm run apps:index     # regenerate after editing the catalog
npm run check:apps     # fail if the two have drifted
```

Adding an app = adding one object to `PROJECTS` in `src/lib/catalog.ts`. Everything else
in the hub is derived from it.

A few highlights of what is in there: **Jarvis** (memory, folders, photos, lists,
calendar, Record), **Music Video Studio** (a song drives the cut), **Smart Shot Videos**
(a full production sheet before a frame renders), **God's Eye View** (~24,000 public
cameras on a globe), **Client Review** (clients request website edits on their own site),
**Projects Timeline** (project intelligence — [docs](docs/apps/projects-timeline.md)),
**App Builder**, **Personas Studio**, **Trading Studio**.

`src/app/apps/` holds more directories than the catalog has entries. That is intentional:
the catalog is the list of apps the hub advertises as tiles, while some routes are
sub-pages or studio homes reached from inside another app.

---

## Layout

```
src/
  app/
    page.tsx                 the hub carousel
    layout.tsx, globals.css  dark-first Tailwind v4 theme tokens
    apps/<slug>/page.tsx     one app's page
    api/<folder>/            that app's server routes
    login/, auth/callback/   shared auth (Supabase mode)
    error.tsx, global-error.tsx
  components/<folder>/       an app's UI
  lib/
    catalog.ts               single source of truth for the hub
    fonts/index.ts           every webface, via next/font/local (files: public/fonts)
    ai/provider.ts           every AI call goes through here
    <folder>/                an app's logic + types, with *.test.ts beside it
  middleware.ts              session refresh + auth gating
supabase/migrations/         schema, RLS, storage buckets
supabase/all-schemas.sql     generated: every migration concatenated
scripts/                     checks, generators, sync and setup tools
docs/apps/                   what each app is
next.config.mjs              redirects, rewrites, file tracing
vercel.json                  which branches may deploy
```

Folder names are usually the app's slug, but not always — [`CLAUDE.md`](CLAUDE.md) has
the exception table.

---

## Configuration

Copy `.env.example` to `.env.local` and set only what you want. The file documents each
key: what it enables, what it costs, and what happens without it. A few rules:

- `NEXT_PUBLIC_*` is compiled into the browser bundle. **Never** put that prefix on a
  secret — `SUPABASE_SERVICE_ROLE_KEY` above all, which bypasses row-level security.
- `HUB_OWNER_EMAILS` gates the private hub. Unset means nobody gets in; set it **before**
  deploying.
- On a deployed host the filesystem is read-only, so features that fall back to writing
  files next to the project (STD Safe, Recall Lists, Dances history) need either
  `SUPABASE_SERVICE_ROLE_KEY` or their `*_DATA_DIR` pointed at a mounted volume.

### Supabase (optional)

With `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set, the hub switches
from local demo mode to Postgres-backed storage, authentication and file storage.

1. Create a project at <https://supabase.com>.
2. Apply the schema — every app's tables, indexes, `updated_at` triggers, **row-level
   security** scoped to each owner, private storage buckets with policies, and `app_state`
   for cross-device sync of the local-first apps.

   With a database credential:

   ```bash
   export SUPABASE_ACCESS_TOKEN=...   # supabase.com/dashboard/account/tokens
   export SUPABASE_DB_PASSWORD=...    # chosen when the project was created
   npx supabase db push
   ```

   Without one, paste [`supabase/all-schemas.sql`](supabase/all-schemas.sql) into the
   **SQL Editor** — it is every migration concatenated, regenerated by
   `scripts/build-all-schemas.sh`. Both paths are idempotent and safe to re-run.
3. Set the two keys in `.env.local` and restart `npm run dev`. The hub now requires
   sign-in at `/login` and persists to Postgres; `src/middleware.ts` gates access and
   refreshes sessions, and is a no-op in local mode.

---

## Deploying

Vercel, from GitHub `main`. `vercel.json` enables deployments for `main` and `jarvis/*`
only — every other branch is off on purpose, to control build spend. Environment
variables go in the hosting environment, never in a committed file. See
[`docs/vercel-cost-controls.md`](docs/vercel-cost-controls.md).

---

## House rules

The standing build checklist, in short:

- **Never a white page.** Every crash goes through the error boundary and is logged
  (`src/lib/site-errors/`); every error a user can see is in plain English.
- **Tests live beside the code** they test and run with no keys: `npm test`.
- **Mobile matters.** Every app is used on a phone.
- **One home per thing.** Before creating a folder, check the layout above — the place
  almost certainly already exists.

More: [`AGENTS.md`](AGENTS.md) (for tools) · [`CLAUDE.md`](CLAUDE.md) (deep detail) ·
[`DESIGN.md`](DESIGN.md) (design language) · [`PRODUCT.md`](PRODUCT.md) (product intent).
