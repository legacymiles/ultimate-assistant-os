---
name: link-to-video
description: Download the actual video file from any link — YouTube, TikTok, Instagram, Facebook, X/Twitter, Reddit, Vimeo, Twitch, Snapchat, Threads, Pinterest, LinkedIn, Dailymotion and ~1,800 other sites — and get its caption, author, duration and thumbnail with it. Use this WHENEVER someone pastes a social link and wants the video, the mp4, the audio, or the post's text: "download this TikTok", "save this reel", "grab the mp4", "rip this video", "get me that Instagram clip", "pull the audio off this YouTube link", "import this post". Also use it whenever a pipeline needs the video BEHIND a link — feeding a clip to a video model, an editor, a transcriber or a vision model; building an import-from-link feature; or fixing one that returns nothing. Above all, reach for this when a link "doesn't work", downloads an HTML page instead of a video, returns a login wall, or silently produces a generic page's text instead of the post's — those have specific, known causes and fixes.
---

# Link to video

One link in, one video file out, with the post's caption and author attached.

Nearly every "this link doesn't work" is one of three things, and they need
opposite responses — so identify which one you have before changing anything.

## Start here

```bash
node scripts/grab.mjs "<link or pasted share text>" --out ./downloads
```

It takes whatever the share sheet produced ("look at this 😋 https://… !!"),
finds the URL, picks the right strategy for that site, and prints the saved
file path on stdout. Metadata goes to stderr, so `FILE=$(node scripts/grab.mjs "$url")`
works in a pipeline.

Useful flags: `--json` (full metadata as JSON), `--audio` (mp3 instead of
video), `--max-height 720`, `--max-bytes 20000000`, `--cookies-from-browser chrome`,
`--cobalt <url>` (second engine), `--check` (report the toolchain and exit).

On a machine that has never done this before, run `node scripts/setup.mjs`
first — it names what is missing and offers to install it.

Everything lands in an **.mp4 container**, and H.264 inside it wherever the
site offers one — measured on Instagram, TikTok, YouTube and Dailymotion.
Facebook is the exception today and returns VP9. Container is a guarantee;
codec is best-effort, because a site that publishes only VP9 leaves nothing to
prefer.

That preference is ranked (`-S vcodec:h264`) rather than filtered
(`-f [vcodec^=avc1]`), and the distinction is load-bearing — see `formatFor`'s
note in the script. A filter excludes any format that does not *declare* its
codec or height, and on Instagram and Facebook the progressive H.264 files
declare neither while the VP9 DASH streams declare both. Filtering therefore
selects the worse codec, which is exactly what it did before it was measured.

## Before blaming a site, run the preflight

```bash
node scripts/grab.mjs --check
```

This is worth doing the first time on any machine, because two of the three
common failures are local and masquerade as the site blocking you:

- **yt-dlp "not installed"** is usually wrong. `pip` puts `yt-dlp.exe` in a
  per-user Scripts directory that Windows does not add to PATH, so `which
  yt-dlp` finds nothing while `python -m yt_dlp` works fine. The script already
  searches those places; `--check` tells you which one it found.
- **Impersonation missing** breaks specific sites and nothing else. Without
  `curl_cffi`, yt-dlp cannot copy a real browser's TLS fingerprint, and sites
  that fingerprint refuse it. Measured on this machine 2026-09-27: TikTok and
  Dailymotion both failed outright, and both succeeded the moment it was
  installed. Nothing in the error says "install curl_cffi" — TikTok just says
  "Unexpected response from webpage request", which reads like a ban.

  ```bash
  python -m pip install --user "yt-dlp[default,curl-cffi]"
  ```

## The three kinds of failure

**1. The toolchain is incomplete.** See above. Symptom: one or two sites fail
while the rest are fine. Fix it locally; do not add fallbacks.

**2. The site wants to know who you are.** Vimeo and many Facebook posts return
nothing to an anonymous program no matter how you ask. There is no user-agent
trick and no mirror that fixes this — cookies are the only answer. Read
`references/cookies.md`; it is a two-minute job.

Recognising it matters because the errors do not say "log in":

| What you see | Site | What it means |
|---|---|---|
| `Cannot parse data` | Facebook | the page came back with the video stripped out |
| `The web client only works when logged-in` | Vimeo | says it plainly |
| `Unexpected response from webpage request` | TikTok | usually missing `curl_cffi`, not a wall |
| `Instagram sent an empty media response` | Instagram | **check the URL is real before concluding anything** |

That last row is a trap worth internalising. Instagram is *not* generally
walled — public reels and posts download fine with no cookies at all. But it
answers "no such post" and "you are not signed in" with the same empty
response, so testing a URL you typed rather than copied makes a working site
look permanently blocked. This skill's own platform notes shipped that exact
wrong conclusion once. Confirm the link opens in a browser before believing the
error.

`grab.mjs` already makes this call for you and exits **2** with a plain-English
sentence when cookies are what's needed (exit **1** is any other failure), so a
script can branch on it.

**3. The site is serving a decoy.** This one is dangerous because it looks like
success. Facebook answers a request for one specific post with its own Video
landing page: HTTP 200, real-looking Open Graph tags, `og:description` =
"Video is the place to enjoy videos and shows together", `og:url` =
`facebook.com/watch/`. Anything that trusts those tags gets boilerplate that
reads exactly like a caption, and a model downstream will confidently write
something from it.

If you are reading tags off a page yourself, require the post's id to survive
into `og:url` before believing any of them. `grab.mjs` avoids this by never
trusting tags in the first place.

## Per-site facts

`references/platforms.md` holds what was actually measured, per site, with the
date — which sites work anonymously, which need cookies, and which need a
fallback other than yt-dlp. **Read it before telling anyone a site is
impossible**, and re-measure rather than trusting the table, because extractors
break and get fixed constantly. The file explains how to re-measure in one
command.

Two orderings in the script are measured rather than obvious, and are worth
keeping:

- **TikTok** falls back to the `tikwm.com` mirror. yt-dlp's TikTok extractor is
  among the most frequently broken, and the mirror has outlived several of
  those breakages — it also needs no `curl_cffi`.
- **X/Twitter** falls back to `api.fxtwitter.com`, which reads a public post's
  media with no API key.

## Setting a machine up

```bash
node scripts/setup.mjs             # what is missing, and the exact fix
node scripts/setup.mjs --install   # install the Python side for me
```

This is the one place that knows the whole toolchain, so nobody has to remember
four separate things. It reports yt-dlp, impersonation, ffmpeg and cobalt, and
exits non-zero when something required is missing — usable as a preflight in a
script.

## A second engine: cobalt

When a site does break, the fastest real fix is a different implementation.
[cobalt](https://github.com/imputnet/cobalt) is one, and `grab.mjs` falls
through to it:

```bash
node scripts/grab.mjs "<url>" --cobalt http://localhost:42030/
```

It has to be an instance you run — `api.cobalt.tools` is behind a Turnstile
challenge and its docs rule out third-party use. `references/cobalt.md` has the
non-Docker install and the one pnpm flag you will otherwise trip over.

**In the Ultimate Assistant OS hub it is already installed**: `tools/cobalt`
(`install.cmd`, then `install-autostart.cmd` to start it at login) with
`COBALT_API_URL=http://localhost:42030/` in `.env.local`. Every app picks it up
with no code change.

Be honest about what it is: a second implementation, not an exemption from
sign-in. It has its own `cookies.json` for the same reason yt-dlp has
`--cookies`, and on a Facebook post yt-dlp could not read, cobalt agreed it
needed an account.

## Adding link import to an app

The thing users want is almost never "a video file" — it is *the post, turned
into whatever this app stores*: a recipe, a workout, a product, a travel spot.
That splits cleanly, and keeping the split is what lets the next app reuse this
instead of rebuilding it.

**In the hub, do not call `grab.mjs`.** The server-side equivalent already
lives in `src/lib/social-import/` and is deliberately app-agnostic:

| | |
|---|---|
| `resolve.ts` | link → caption, author, thumbnail, page metadata (`resolveSocialPost`) |
| `videoDownload.ts` | link → the video file (`downloadVideo`: yt-dlp → cobalt → og:video) |
| `understand.ts` | post + your prompt → structured JSON, with a model that actually watches the video (`understandPost`) |
| `ytdlp.ts` | binary resolution, cookies, and fetching a checksummed release on a host where nothing is pre-installed — which is what makes this work on Vercel |

A new app's route is thin, because all three shared pieces are doing the work:
resolve the link, download the video when the page gave none, hand both to
`understandPost` with a task describing *your* JSON shape, and normalise the
result. `src/app/api/cookbook/import-from-link/route.ts` is the worked example —
roughly 150 lines, most of it the recipe-specific prompt.

Three things that route learned the hard way, worth copying rather than
rediscovering:

- **Surface the trail.** Every step appends a plain sentence to `post.trail`.
  Showing it turns "import failed" into "Facebook only shows this to logged-in
  accounts", which is the difference between a dead end and a next step.
- **Degrade, never 500.** No AI key, no video, a private post — each should
  produce something editable plus an honest note. The caption alone is often
  enough.
- **Do not trust page metadata.** See the decoy section above.

If a third app needs this, that is the moment to lift the shared half of that
route into `src/lib/social-import/` and leave only the prompt and the
normaliser in each app — not before, because two examples is when the shape of
the abstraction is actually visible.

## Keeping it working

yt-dlp is a maintained arms race against sites that change weekly, so a site
that broke yesterday is often fixed already:

```bash
python -m pip install --user --upgrade "yt-dlp[default,curl-cffi]"
```

If the stable release still fails on one site, the nightly build usually carries
the fix days earlier (`--pre`). Before concluding a site is impossible, upgrade
and re-test — that resolves more reports than any code change.

## Using it from code

Import it rather than shelling out when you are inside a JS/TS project:

```js
import { grab, detect } from "./scripts/grab.mjs";
const got = await grab(link, { outDir, maxHeight: 1080, maxBytes: 20e6 });
// → { file, title, caption, author, durationSec, width, height, thumbnail, via, trail }
```

`got.trail` is the list of what was tried and what each attempt said. Surface it
in any UI that can fail — "Facebook hides that post from anyone who isn't
logged in" is actionable in a way that "import failed" never is.

**In the Ultimate Assistant OS hub**, this already exists server-side as
`src/lib/social-import/` — `videoDownload.ts` (`downloadVideo()`: the same
ladder), `ytdlp.ts` (binary resolution, cookies, and it will fetch a checksummed
release on a host where nothing is pre-installed, which is what makes it work on
Vercel), and `resolve.ts` (page metadata, with the Facebook decoy guard). Wire a
new hub feature to those instead of copying this script in. `grab.mjs` is the
standalone twin for terminal work and for projects outside the hub.

## Two things to be straight about

Downloading from these sites can breach their terms of service, and a
downloaded video is still the creator's. Use it for content you have the right
to use, and keep the author and source URL that `grab.mjs` returns — they cost
nothing to carry and they are what makes attribution possible later.

Cookies are live credentials to the account they came from. Treat an exported
`cookies.txt` like a password: never commit it, and prefer
`--cookies-from-browser` so nothing is written to disk at all.
