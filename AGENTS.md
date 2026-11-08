# AGENTS.md — read this before you touch anything

This is the contract for any AI tool, agent or harness working in this repository:
Claude Code, Codex, Cursor, Copilot, Gemini CLI, Devin, Jules, or a script someone wrote
this afternoon. Claude Code also reads [`CLAUDE.md`](CLAUDE.md), which goes far deeper;
this file is the part that is true for everyone, and it is short on purpose.

---

## 1. What this repository is

**One Next.js 15 application** — the **Ultimate Assistant OS** — a hub that holds
**40 apps as routes inside itself**.

```
/                     the hub: an animated carousel of every app
/apps/<slug>          one app, e.g. /apps/jarvis, /apps/projects-timeline
/api/<folder>         that app's server routes
```

It is **not** a monorepo. There are no workspaces, no sub-packages, no separate
deployments, no microservices. `npm install` once at the root and every one of the 40
apps is running.

The full inventory is [`docs/apps/README.md`](docs/apps/README.md), generated from
[`src/lib/catalog.ts`](src/lib/catalog.ts), which is the **single source of truth** for
what the hub contains. Read that file before you form any opinion about what this site is.

### What fooled the tools that came before you

A harness was handed this repo and rebuilt **only Projects Timeline**, because three
separate signals told it that was the whole project: the root `README.md` was titled
"Projects Timeline", `package.json` was named `projects-timeline`, and the site's own
`<title>` said it too. All three were corrected on 2026-11-07. So:

1. **Projects Timeline is ONE app** (`/apps/projects-timeline`), not this project. If
   your copy of `README.md` is titled "Projects Timeline", or `package.json` is named
   `projects-timeline`, **you are on a stale commit — `git fetch` and read `main`.**
2. **The hub is the thing at `/`.** It is a carousel of all 40 apps. A rebuild that
   produces one app's dashboard is not this site, however good that dashboard is.
3. **`src/app/apps/` has more directories than the catalog has entries** (53 vs 40).
   That is correct and intentional: the catalog is the list of apps the hub *advertises
   as tiles*; some routes are sub-pages, studio homes, or reached from inside another
   app. Never delete a route because it is not in the catalog, and never conclude an app
   is missing because its directory is absent from a tile list.

### The rule that follows

> **Do not recreate this site. Clone it and run it.**

If you were asked to "rebuild", "recreate", "port" or "reproduce" this website, the
correct action is `git clone` → `npm ci` → `npm run dev`. Scaffolding a fresh Next.js
app and writing pages that resemble the screenshots produces something that is not this
site and never converges on it: there are ~5,200 tracked files, 259 test files, 40 apps
and several hundred API routes. Rebuild from scratch only if a human says so in those
words.

---

## 2. Build it

No key, no account, no database. Internet only to install.

```bash
git clone https://github.com/legacymiles/ultimate-assistant-os.git
cd ultimate-assistant-os
npm ci
npm run dev           # http://localhost:3000
```

```bash
npm run build && npm start    # production build
```

**Requirements**

| | |
|---|---|
| Node | **>= 22.11**. Pinned in `.nvmrc` (24) and `package.json` `engines`. Next itself would take 20, but the check scripts import the app's TypeScript directly through Node's own type stripping, which needs 22.11+. Verified on 24.14. |
| Package manager | **npm**, with the committed `package-lock.json`. Use `npm ci`, not `npm install`, so the lockfile decides. Do not switch to pnpm, yarn or bun. |
| OS | Developed on Windows, deployed on Linux. Both work; nothing here is Windows-only. |
| Env vars | **None required.** See §3. |
| Network | Needed for `npm ci` and nothing else. **`npm run build` fetches nothing** — every webfont is committed (§6), so the build runs in a fully offline or egress-filtered sandbox. Verified by building with all outbound HTTP(S) pointed at a dead proxy. |
| Disk | ~2.5 GB of `node_modules` (Three.js, Cesium, ffmpeg-static). This is expected. |

**If `npm ci` or the build fails, that is a bug in this repository — report it.** It is
not a signal to delete the lockfile, downgrade a dependency, change the framework or
start over. Check your Node version first, then say what broke.

### Checks you can run

```bash
npm test                        # 259 vitest files, 3,831 tests, no keys needed
npx vitest run src/lib/<area>   # one area
npm run check:apps              # docs/apps/README.md still matches the catalog
npm run check:fonts             # every declared webfont is committed
npm run check:router            # AI router table vs OpenRouter (hits the network)
```

### Did it work?

A rebuild or a change is only correct if all of these hold:

- `npm run build` exits 0.
- `/` renders the hub carousel, not a 404 and not a default Next.js page.
- Every `/apps/<slug>` route in [`docs/apps/README.md`](docs/apps/README.md) answers.
  Two of them answer with a **redirect** rather than a page — `/apps/ea-world` and
  `/apps/ea-lab` both go to `/apps/trading-studio`, on purpose (§6). A 307 there is
  correct; a 404 is not.
- `npm test` passes.
- No page shows a blank white screen. A crash must land in `app/error.tsx` /
  `app/global-error.tsx` (`CrashScreen`) with a plain-English message.

---

## 3. Environment variables

`.env.example` is the complete list. **Every single one is optional**, and this is a
deliberate design property of the repo, not an accident:

- With **no** `.env.local` the whole hub runs in **local demo mode** — data goes to
  `localStorage` or to files beside the project, AI features fall back to built-in
  offline analyzers, and media features show an explanatory panel instead of failing.
- Each key switches **one** capability from demo to real. `.env.example` documents what
  each one buys, what it costs, and what happens without it.

So:

- **Never block on a missing key.** "I cannot build this without credentials" is wrong here.
- **Never invent values** to make something look like it works.
- `NEXT_PUBLIC_*` is compiled into the browser bundle. Never add that prefix to a
  secret — `SUPABASE_SERVICE_ROLE_KEY` especially, which bypasses row-level security.
- Copy to `.env.local` (gitignored). Never commit a filled-in env file.

---

## 4. Where things live

| Need | Go to |
|---|---|
| **What apps exist** | [`docs/apps/README.md`](docs/apps/README.md) ← generated · source `src/lib/catalog.ts` |
| Add an app to the hub | one object in `src/lib/catalog.ts` `PROJECTS`, then `npm run apps:index` |
| An app's page | `src/app/apps/<slug>/page.tsx` |
| An app's UI | `src/components/<folder>/` |
| An app's logic, types, tests | `src/lib/<folder>/`, with `*.test.ts` beside the code |
| An app's server routes | `src/app/api/<folder>/` |
| Webfonts | `public/fonts/` (committed woff2) declared in `src/lib/fonts/index.ts` |
| Build config, redirects, rewrites, file tracing | `next.config.mjs` |
| Deploy config | `vercel.json` |
| Every AI call | `src/lib/ai/provider.ts` |
| Database schema | `supabase/` |
| Design language | [`DESIGN.md`](DESIGN.md) |
| Product intent | [`PRODUCT.md`](PRODUCT.md) |
| Deep per-app detail, folder-name exceptions, conventions | [`CLAUDE.md`](CLAUDE.md) |

`<folder>` is usually the slug, but not for every app. `CLAUDE.md` has the exception
table. Look it up rather than guessing — a guess creates a second home for something
that already has one.

---

## 5. Deploying

Vercel, project-linked, from GitHub `main`.

- `vercel.json` enables deployments for `main` and `jarvis/*` **only**; every other
  branch is off, on purpose, to control build spend. Do not widen that pattern.
- Set env vars in the hosting environment, not in a committed file.
- One thing genuinely breaks on a host that does not break locally: features that fall
  back to **writing files next to the project** (STD Safe, Recall Lists, Dances
  history). A deployed filesystem is read-only, so those need either
  `SUPABASE_SERVICE_ROLE_KEY` or their `*_DATA_DIR` pointed at a mounted volume.
  `.env.example` says which per feature.

---

## 6. Gotchas that have each cost someone an afternoon

- **Webfonts are committed, and must never be fetched at build time again.** All ten
  families (JetBrains Mono, Oxanium, Syne, Inter, Space Grotesk, Chakra Petch, Archivo
  Black, Instrument Serif, Geist, Geist Mono) live as `latin`-subset woff2 files in
  [`public/fonts/`](public/fonts) — about 355 KB — and are declared once in
  [`src/lib/fonts/index.ts`](src/lib/fonts/index.ts) with `next/font/local`. One home,
  one declaration site: `public/fonts/` is where the repo already kept its first two
  self-hosted faces, so do not start a second font folder.

  This used to be `next/font/google` in eleven files, which fetched Google *while
  compiling*. It failed about half the time, with an error that never mentioned fonts or
  the network and instead named a random app page:

  ```
  An error occurred in `next/font`.
  TypeError: Cannot read properties of null (reading '1')
      at .../@next/font/dist/google/loader.js
  > Build failed because of webpack errors
  ```

  Measured 2026-11-07: three failures and three passes on identical commits, in a
  pristine clone as readily as in a working checkout. If you ever see that error again,
  something reintroduced `next/font/google` — find it and move the face into
  `src/lib/fonts` instead.

  Adding a face: add it to [`scripts/fetch-fonts.mjs`](scripts/fetch-fonts.mjs), run
  `npm run fonts:fetch`, commit the woff2, then declare it in `src/lib/fonts/index.ts`.
  `npm run check:fonts` fails if a declared file is missing, and CI runs it.
- **Two dev servers must never share `.next`.** It corrupts the directory — `EINVAL
  readlink`, then blanket 500s. Use `NEXT_DIST_DIR=.next-preview npm run dev -- -p 3210`,
  or `npm run dev:preview`, for a second one.
- **`npm run build` runs a `prebuild` step** (`scripts/timeline-log.mjs --quiet-fail`).
  It is designed to fail silently and never block a build. If it ever does block one,
  that is a bug.
- **`src/app/apps/ea-world/page.tsx` and `src/app/apps/ea-lab/` are deliberately absent**
  from the repo; `next.config.mjs` redirects both routes into `/apps/trading-studio`.
  Do not "fix" this by creating those files — it blocks the owner's pull.
- **`public/pod-play-connect/` is a prebuilt Vite SPA**, served through a rewrite. Its
  source lives in another repo. Do not try to build it from here.
- **`docs/apps/README.md` is generated.** Edit `src/lib/catalog.ts` and re-run the
  script; a hand-edit will be overwritten and `--check` will fail in the meantime.

---

## 7. Working in this repo

- **`main` is the truth.** Before building on top of anything, `git fetch` and confirm
  you are not behind. Several checkouts of this repo exist on the owner's machine on
  different branches with different app counts; an app that looks missing is almost
  always a stale checkout rather than a deleted app.
- **One home per thing.** Before creating a new folder — `notes/`, `utils/`, another
  `docs/` — check §4. The row almost certainly already exists.
- **Tests live beside the code** they test, and run with no keys. Keep it that way.
- **Never a white page.** Every crash goes through the error boundary and gets logged
  (`src/lib/site-errors/`). Every error a user can see is in plain English.
- **Mobile matters.** Every app is used on a phone. Check narrow widths.
