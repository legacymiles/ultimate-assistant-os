# What actually works, per site

Measured 2026-09-27 on Windows, from a home connection, **signed out**, with
**yt-dlp 2026.08.19** (the current stable release that day) and **curl_cffi
0.16.3** installed.

Treat every row as perishable. Extractors break when a site ships a change and
get fixed within days, so a "no" here is a snapshot, not a verdict.

**Read the method note at the bottom before adding a "no" of your own.** The
first version of this file claimed Instagram was impossible without cookies.
That was wrong, and it was wrong because it was measured against a reel id that
had been invented for a test rather than copied from a real post. Instagram
answers "no such post" and "you are not signed in" with the *same* empty
response, so a made-up URL looks exactly like a login wall.

## Anonymous, no cookies

| Site | Works | Route | Notes |
|---|---|---|---|
| YouTube | yes | yt-dlp | Shorts, live replays, `youtu.be`. Needs a JS runtime — `grab.mjs` hands it Node. |
| TikTok | yes | yt-dlp | **Only with `curl_cffi`.** Without it: "Unexpected response from webpage request". tikwm mirror is the fallback and needs nothing. |
| **Instagram** | **yes** | yt-dlp, cobalt | Reels and posts, no cookies. Verified by downloading four real reels. Cookies still help for rate limits and private accounts. |
| Dailymotion | yes | yt-dlp | **Only with `curl_cffi`.** |
| Facebook | **per post** | yt-dlp, cobalt | See below. |
| Vimeo | no | — | "The web client only works when logged-in." Cookies required. |
| X / Twitter | route alive | yt-dlp → fxtwitter | `api.fxtwitter.com` answered 200; not re-verified on a live video post that day. |
| Rumble | unconfirmed | — | HTTP 403 on the one URL tried, which may simply be dead. |

Not re-measured that day and previously working: Reddit, Twitch clips,
Pinterest, Threads, Bluesky, Tumblr, SoundCloud. yt-dlp covers ~1,800 sites, so
for anything unlisted the realistic default is "try it, it probably works".

## Facebook is walled per post, not per site

Two equally public Facebook videos, fetched the same way seconds apart:

- `facebook.com/watch/?v=10155529876156509` — `playable_url` present in the
  HTML, extracted fine by both yt-dlp and cobalt.
- `facebook.com/buzzfeedtasty/videos/…/2145565432362761/` — 527 KB of HTML with
  no video data anywhere, on every URL shape (`/videos/`, `/watch/?v=`,
  `/reel/`, `/video.php?v=`). yt-dlp reports `Cannot parse data`.

So a Facebook link either works outright or needs cookies, and nothing in
between moves it. `curl_cffi` does not help; nor does a browser user-agent.

This is why `Cannot parse data` should be read as "needs login" on Facebook —
the site never says "log in" to a program, it serves a page with the video
removed. **Note that Instagram's empty response does *not* carry the same
meaning**, since a non-existent post produces it too.

## Facebook's decoy page

An anonymous request for `facebook.com/watch/?v=<id>` returns HTTP 200 carrying
the Video *landing page's* Open Graph tags — `og:description` = "Video is the
place to enjoy videos and shows together", `og:url` = `facebook.com/watch/`.
Nothing about the post.

Anything reading og tags will treat that boilerplate as the caption. Guard by
requiring the post's id to appear in `og:url` first. The hub does this in
`src/lib/social-import/resolve.ts` (`servedTheWrongPage`).

## Codecs

`grab.mjs` ranks H.264 above everything and gets it on Instagram, TikTok,
YouTube and Dailymotion. **Facebook currently returns VP9 in an mp4 container**
because the only renditions whose codec it declares are VP9 — the progressive
`hd`/`sd` files state no codec at all and so cannot be preferred. The container
is always mp4; the codec is best-effort. If a downstream tool needs H.264
specifically, re-encode.

## How to measure a site properly

Get a URL you know is live, rather than typing a plausible-looking one — this is
the mistake that produced the wrong Instagram row:

```bash
python -m yt_dlp --flat-playlist --playlist-end 1 --print "%(url)s" "<channel or profile url>"
```

Then test that URL without downloading:

```bash
python -m yt_dlp --no-warnings --no-playlist --skip-download \
  --print "%(id)s | %(title).50s | %(duration)ss | %(ext)s" "<url>"
```

Read the error before concluding anything:

| Error | Means |
|---|---|
| `impersonate` / `impersonation` | install `curl_cffi` |
| `logged-in`, `cookies`, `private` | cookies |
| `Cannot parse data` on Facebook | cookies |
| `empty media response` on Instagram | **check the URL is real first** — then cookies |
| `HTTP Error 404` / `not available` | the post is gone; test a different one |
