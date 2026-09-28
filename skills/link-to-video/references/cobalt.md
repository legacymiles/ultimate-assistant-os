# cobalt as a second extractor

[cobalt](https://github.com/imputnet/cobalt) is an independent downloader with
its own extractors for ~20 services. It is worth running next to yt-dlp for one
reason: when a site ships a change, the two rarely break on the same day, so
whichever still works covers the other.

Verified 2026-09-27 against a local instance — TikTok, YouTube, Facebook and
Instagram all returned real mp4 bytes.

## You cannot use the public instance from code

`api.cobalt.tools` answers `error.api.auth.jwt.missing` and advertises a
Cloudflare Turnstile sitekey — the JWT comes from solving that challenge. Their
own API docs are explicit:

> hosted api instances (such as `api.cobalt.tools`) use bot protection and are
> **not** intended to be used in other projects without explicit permission.

So: **cobalt.tools in a browser is fine and works well** for one-off downloads —
that is what it is for. For anything automated, run your own. There is no third
option, and working around the challenge is neither allowed nor something this
skill will do.

## Running your own, without Docker

cobalt's API is a plain Node service. Node ≥ 18.17 and pnpm are all it needs.

```bash
git clone --depth 1 https://github.com/imputnet/cobalt
cd cobalt
pnpm install --config.manage-package-manager-versions=false --filter @imput/cobalt-api
printf 'API_URL=http://localhost:9000/\nAPI_PORT=9000\n' > api/.env
cd api && node src/cobalt
```

The `--config.manage-package-manager-versions=false` matters on a machine with a
newer pnpm: the repo pins pnpm 9.6.0 and the auto-switch fails with `ENOENT`
looking for a pnpm that was never installed. That flag tells pnpm to use the one
you have.

`API_URL` is the only required variable. Three native build scripts get skipped
(`ffmpeg-static`, `isolated-vm`, `syscall-napi`) and nothing above needed them.

Confirm it is alive — the response lists every service it supports:

```bash
curl -s http://localhost:9000/
```

With Docker instead, it is `docker compose up -d` from a compose file based on
their example.

## Using it

```bash
node scripts/grab.mjs "<url>" --cobalt http://localhost:9000/
```

Or set `COBALT_API_URL` once and every run picks it up. `grab.mjs` tries yt-dlp
first and falls through to cobalt, so a configured instance costs nothing until
yt-dlp fails.

**In the hub**, `src/lib/social-import/videoDownload.ts` already reads
`COBALT_API_URL` (and `COBALT_API_KEY`) and already has cobalt in the ladder for
every platform. Setting that one variable in `.env.local` turns it on for Cook
Connect, Dance Studio and everything else — no code change.

## It is not a way around sign-in

cobalt ships a `cookies.json` mechanism for exactly the same reason yt-dlp has
`--cookies`: some services will not show a signed-out visitor anything. Put the
file next to `docker-compose.yml` (or point `COOKIE_PATH` at it).

Where a post genuinely needs an account, cobalt needs one too. What it buys you
is a second implementation, not an exemption.

## Keeping it running

It is a long-lived local service, so if you want it always available, give it
the same treatment as the other `tools/` helpers in this repo — a startup task
rather than a terminal you remember to open. Left unmanaged it simply will not
be there when something falls through to it, and the fallback silently reports
"no instance".
