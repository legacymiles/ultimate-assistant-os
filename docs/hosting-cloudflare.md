# Hosting: Cloudflare

The site moved off Vercel on 2026-11-07. It now runs as a **Cloudflare Worker**, built by the
**OpenNext** adapter (`@opennextjs/cloudflare`), which turns a normal `next build` into something
Cloudflare can run. Nothing about how you write code changes: `npm run dev` is still `next dev`.

Older comments in the code still say Vercel. Where they describe the **AI Gateway** they are
still right — that is an API this code calls, not the host. Where they describe **deployment**,
this file wins.

## What was actually verified

Built and run in the real `workerd` runtime on this machine on 2026-11-07, not just configured:

| Checked | Result |
|---|---|
| `opennextjs-cloudflare build` | Worker written to `.open-next/worker.js` |
| Bundle size against the 64 MiB limit | **34.8 MiB** uncompressed, 6.1 MiB gzipped |
| Bindings resolve | `ASSETS` and `WORKER_SELF_REFERENCE` both bind |
| Pages render | `/`, `/apps/projects-timeline`, `/apps/cook-connect`, `/legal/privacy` — all `200` |
| A server route accepts a write | `POST /api/site-errors/report` → `202` |
| Method guards still work | `GET` on that same route → `405` |
| Worker log | no errors, no `[unenv] not implemented`, no cross-request I/O complaint |

Not verified here, because it needs the owner's account: the deploy itself, and the environment
variables once they are set.

## The files that make it work

| File | What it does |
|---|---|
| `wrangler.jsonc` | Names the Worker and turns on the Node.js APIs. Every line is commented |
| `open-next.config.ts` | How the adapter packages the build. Deliberately bare |
| `public/_headers` | Caches Next's fingerprinted static files forever |
| `next.config.mjs` | Calls `initOpenNextCloudflareForDev()` so `next dev` sees the same bindings |
| `.dev.vars` | Local-only values for `npm run cf:preview`. Gitignored, never committed |

## Commands

| Doing | Run |
|---|---|
| Normal development (unchanged) | `npm run dev` |
| Run the **real Worker runtime** on this machine | `npm run cf:preview` |
| Build without deploying, to check size and errors | `npm run cf:build` |
| Deploy from this machine | `npm run cf:deploy` |
| Regenerate binding types after editing `wrangler.jsonc` | `npm run cf:typegen` |

**Use `npm run cf:preview` before every deploy.** `npm run dev` is Node, and the deployed site is
`workerd`. They are not the same, and preview is where the difference shows up.

## First-time setup (needs the owner's Cloudflare account)

1. **Workers Paid, $5/month.** Not optional — see *What this costs* below.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Connect to Git →
   `legacymiles/ultimate-assistant-os`**, build command `npx opennextjs-cloudflare build`,
   deploy command `npx opennextjs-cloudflare deploy`.
3. **Add the environment variables.** Workers do not read `.env.local`. Every name in
   `.env.example` that the site actually needs has to be added in
   *Settings → Variables and Secrets*. Anything secret (`SUPABASE_SERVICE_ROLE_KEY`,
   `OPENROUTER_API_KEY`, the VAPID keys) must be a **Secret**, not a plain variable.
   Limits: 128 variables, 5 KB each.
4. **Disconnect the Vercel GitHub integration**, or every pull request keeps showing a failing
   Vercel check that means nothing.

## What this costs

**The free plan cannot run this site.** Cloudflare allows **10ms of CPU per request** on Workers
Free, and their own docs say server-rendering typically uses 10–20ms. Workers Paid is **$5/month**
and gives 30 seconds of CPU per request by default, raisable to 5 minutes with
`"limits": { "cpu_ms": … }` in `wrangler.jsonc`.

Worth knowing: **CPU time is not wall-clock time.** Waiting on Supabase or an AI model costs no
CPU, and HTTP requests have no wall-clock limit at all. The `export const maxDuration = …` lines
throughout the API routes are a Vercel setting; they do nothing here and are harmless.

## What does not work here, and why

Cloudflare Workers are not a computer. There is no shell, and the filesystem is a small virtual
one: `/tmp` is writable but wiped after each request, and everything else is read-only.

**Routes that shell out are dead on Cloudflare.** `node:child_process` exists but is a stub that
does nothing. That covers:

| Route or feature | Needs | Where it still works |
|---|---|---|
| MP3 Download, video-from-a-link | `yt-dlp` | The owner's PC, through In Queue |
| Music Creator's MP3 conversion | `ffmpeg` | The owner's PC |
| Video Studio Arena's local engines | `ffmpeg`, Python | The owner's PC |

This is **not a new loss**. These already could not run on Vercel's serverless; the pattern this
repo uses is to hand the job to the PC as an In Queue request (`docs/SYSTEMS.md` › In Queue) and
let Claude Code finish it. Anything new that needs a real machine goes the same way.

**Routes that read committed files at request time come back empty — but they do not crash.**
`next.config.mjs` has an `outputFileTracingIncludes` block that copies `CLAUDE.md`, `aios/**`,
`skills/**` and the Record extension next to certain routes. That is a Vercel mechanism. On
Cloudflare only files that are part of the *module bundle* are readable.

Measured in the local Workers runtime: `/api/skills/scan` answers `200` with
`{"available":false,"skills":[]}` — it reports the capability as missing rather than erroring,
which is the repo's own rule. Expect the same from `/api/jarvis/**`, `/api/new-jarvis/queue`,
`/api/jarvis/record/extension` and `/api/h3-lab/skills`.

So the Skills Library's "scan the folders" view is empty on the live site. **The skill store
behind the `jarvis-memory` connector is unaffected**, and that is the copy every device syncs
from. If one of these should show real content, import it as a module instead of reading it off
disk, the way `src/lib/timeline/app-docs.json` already does.

**Writes to disk still fall back to Postgres**, which was already true: `src/lib/server/docStore.ts`
and `blobStore.ts` use Supabase whenever `SUPABASE_SERVICE_ROLE_KEY` is set, and local files only
when it isn't. Keep that key set in Cloudflare and nothing changes.

## Two mentions of Vercel that were changed, and two that were left

Changed, because the host moved underneath them:

- **The "how to set up a key" walk-through** ended by telling the owner to paste the key into
  Vercel. It now says Cloudflare, and says to add it as a **Secret**
  (`HOST_STEP` in `src/lib/new-jarvis/keySetup.ts`).
- **MP3 Download's "can I run yt-dlp here?" check** only knew about Vercel and AWS. On Cloudflare
  it would have believed it was on a real machine and tried to launch yt-dlp, failing with
  something unreadable instead of the honest "this happens on your PC" message. It now also
  recognises the Workers runtime (`isServerless` in `src/lib/mp3-download/ytdlp.ts`).

Left alone, on purpose:

- **`vercelProject` in Client Review** is where a *client's* site is hosted, not where this one
  is. Clients' sites are their own.
- **`AI_GATEWAY_API_KEY` / `VERCEL_OIDC_TOKEN`** in `src/lib/ai/provider.ts`. The Vercel AI
  Gateway is the fallback *API*, not the host. The OIDC token was issued by Vercel's own build,
  so it no longer appears — set `AI_GATEWAY_API_KEY` if the fallback is wanted. OpenRouter is the
  default and is unaffected.

## If a deploy fails on fonts

**This one is not about Cloudflare.** It was already happening, and it would have failed on
Vercel in exactly the same way.

`fonts.googleapis.com` normally answers with static file URLs ending in `.woff2`. About one
request in a hundred comes back with its dynamic form instead:

```
https://fonts.gstatic.com/l/font?kit=…&skey=…&v=v22
```

`next/font/google` finishes by reading the file extension off the end of that URL, so the
dynamic form makes it crash with **`TypeError: Cannot read properties of null (reading '1')`**,
naming whichever font happened to lose. This build asks for about twenty font files, so a build
failed roughly half the time.

Nothing here can stop Google choosing that form, and it chooses per request, so
`npm run build` now runs `scripts/build-retry.mjs`: it runs `next build`, and retries **only**
on that exact signature, up to three times. Every other failure exits immediately, so a real
compile error still fails fast.

**The permanent fix is to stop fetching fonts at build time**: download the ten families once and
load them with `next/font/local`. That also makes builds work with no network at all. It touches
every `next/font/google` import, so it has been left as its own piece of work.

## If something breaks after a deploy

- **"Cannot perform I/O on behalf of a different request"** — a Supabase client was made once and
  reused by a later request. Four server files keep one in a module-level variable
  (`src/lib/server/docStore.ts`, `blobStore.ts`, `src/lib/cook-connect/client.ts`,
  `src/lib/friends-night-out/catalog/store.ts`). The fix is to build the client inside the
  request instead of caching it. This did not appear in preview, so it is a watch item, not a
  known bug.
- **"[unenv] … is not implemented yet"** — a Node API that Cloudflare stubs. Find the caller and
  give it a path that does not need it.
- **The Worker is too big** — the limit is **64 MiB uncompressed** (the 3 MiB figure in OpenNext's
  own troubleshooting page is out of date; Cloudflare's limits page is the one to trust).
  `npx wrangler deploy --dry-run` prints the real number without deploying. **Measured on
  2026-11-07: 34.8 MiB uncompressed (6.1 MiB gzipped) — a little over half the limit.** Worth
  re-checking before adding a large dependency.
- **Site errors still report themselves.** The in-app crash log (Jarvis › More › Work ›
  Site errors) works unchanged, and Cloudflare keeps its own logs because `observability` is on.
