# cobalt — the hub's second link-to-video engine

Every app here that imports from a pasted link — Cook Connect's recipe import,
Dance Studio, Smart Shot — goes through `src/lib/social-import/videoDownload.ts`,
which tries engines in order until one produces a real video file.

**yt-dlp is the first engine.** [cobalt](https://github.com/imputnet/cobalt) is
the second. The reason to have both is that they are independent
implementations of the same job: when a site ships a change that breaks one,
the other usually still works, and a paste-a-link feature that fails for a week
is a feature people stop trusting.

It is entirely optional. With `COBALT_API_URL` unset the ladder skips it and
nothing else changes.

## Install

```
tools\cobalt\install.cmd              fetch and build it (once)
tools\cobalt\install-autostart.cmd    start it now, and at every login
```

Then in `.env.local`:

```
COBALT_API_URL=http://localhost:42030/
```

That is the whole wiring. No app needs a code change — they all already read it.

To run it in a visible window instead of hidden, use `start.cmd`.
`uninstall-autostart.cmd` removes the Startup shortcut and stops whatever holds
the port.

## What is where

| | |
|---|---|
| `install.mjs` | clones cobalt into `app/` and builds it |
| `start.cmd` | run it in a window |
| `start-hidden.vbs` | run it with no window, logging to `out/cobalt.log` |
| `install-autostart.cmd` | Startup shortcut + start now + health check |
| `app/` | the clone — **gitignored**, not vendored |
| `out/cobalt.log` | where the hidden process writes — **gitignored** |

The source is cloned rather than committed because it is someone else's
repository on its own release schedule, and vendoring it would pull a second
lockfile into this one. Re-running `install.cmd` fast-forwards the clone.

## Port 42030

Cobalt's own default is 9000, which collides with too much. 42030 sits with the
hub's other local services (Studio renderer 42010, Jarvis bridge 42020).

`API_URL` is written into `app/api/.env` by the installer and must match what
callers use — cobalt signs its own tunnel URLs with it, so changing one without
the other produces links that fail verification.

## Checking on it

```bash
curl -s http://localhost:42030/
```

Returns its version and every service it supports. If it does not answer, read
`out/cobalt.log`; a hidden process writes nowhere else.

## The public instance is not an option

`api.cobalt.tools` answers `error.api.auth.jwt.missing` and advertises a
Cloudflare Turnstile sitekey — the token comes from solving that challenge. Its
own API docs say hosted instances are "not intended to be used in other projects
without explicit permission." Using cobalt.tools by hand in a browser is fine
and works well; for anything automated, this is the supported path.

## It is not a way around sign-in

cobalt has its own `cookies.json` for the same reason yt-dlp has `--cookies`.
Measured 2026-09-27: on a Facebook post that yt-dlp could not read, cobalt
returned `error.api.fetch.empty` — both engines agreed the post needs an
account. What cobalt buys is a second implementation, not an exemption.

The full picture of which sites need what lives in the `link-to-video` skill
(`skills/link-to-video/references/`).
