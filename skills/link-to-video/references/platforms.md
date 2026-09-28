# What actually works, per site

Measured 2026-09-27 on Windows, from a home connection, signed out, with
**yt-dlp 2026.08.19** (the current stable release that day) and **curl_cffi
0.16.3** installed.

Treat every row as perishable. Extractors break when a site ships a change and
get fixed within days, so a "no" here is a snapshot, not a verdict. Re-measure
before you tell anyone something is impossible — the command is at the bottom.

## Anonymous (no cookies)

| Site | Works | Route | Notes |
|---|---|---|---|
| YouTube | yes | yt-dlp | Shorts, live replays and `youtu.be` all fine. Needs a JS runtime — `grab.mjs` passes it Node. |
| TikTok | yes | yt-dlp | **Only with `curl_cffi`.** Without it: "Unexpected response from webpage request". `tikwm.com` mirror is the fallback and needs nothing. |
| Dailymotion | yes | yt-dlp | **Only with `curl_cffi`.** Without it the error names impersonation outright. |
| Facebook | **per post** | yt-dlp | See below — this is the subtle one. |
| Instagram | no | — | Signed-out gets an empty media response. Cookies, always. |
| Vimeo | no | — | "The web client only works when logged-in." |
| X / Twitter | route alive | fxtwitter | `api.fxtwitter.com` answered 200 on a user lookup; not re-verified on a live video post that day. yt-dlp is tried first. |
| Rumble | no | — | HTTP 403 on the URL tested; that URL may simply be dead. Unconfirmed either way. |

Not re-measured that day, and previously working: Reddit, Twitch clips,
Pinterest, Threads, Bluesky, Tumblr, SoundCloud. yt-dlp covers ~1,800 sites, so
the realistic default for anything not listed is "try it, it probably works".

## Facebook is walled per post, not per site

This is the finding worth carrying, because it makes Facebook look randomly
broken.

Two equally public Facebook videos, fetched the same way seconds apart:

- `facebook.com/watch/?v=10155529876156509` — the HTML contains `playable_url`,
  and yt-dlp extracted it fine.
- `facebook.com/buzzfeedtasty/videos/…/2145565432362761/` — 527 KB of HTML with
  no video data anywhere, on any URL shape (`/videos/`, `/watch/?v=`, `/reel/`,
  `/video.php?v=`). yt-dlp reports `Cannot parse data`.

So a Facebook link either works outright or needs cookies, and nothing in
between will move it. `curl_cffi` does not help; neither does a browser
user-agent. This is also why yt-dlp's `Cannot parse data` should be read as
"needs login" on Facebook and Instagram specifically — those sites never say
"log in" to a program, they just serve a page with the video removed.

## Facebook's decoy page

Separately: an anonymous request for `facebook.com/watch/?v=<id>` returns HTTP
200 with the Video *landing page's* Open Graph tags —
`og:description` = "Video is the place to enjoy videos and shows together",
`og:url` = `facebook.com/watch/`. Nothing about the post.

Anything that reads og tags will treat that boilerplate as the caption. Guard by
requiring the post's id to appear in `og:url` before trusting the tags. The hub
does this in `src/lib/social-import/resolve.ts` (`servedTheWrongPage`).

## Re-measuring

One site, without downloading anything:

```bash
python -m yt_dlp --no-warnings --no-playlist --skip-download \
  --print "%(id)s | %(title).50s | %(duration)ss | %(ext)s" "<url>"
```

A current, definitely-live URL for a site, which avoids the trap of testing a
dead link and concluding the site is blocked:

```bash
python -m yt_dlp --flat-playlist --playlist-end 1 --print "%(url)s" "<channel or profile url>"
```

Then feed that URL to the first command. Read the error carefully before
concluding anything: `impersonate` means install `curl_cffi`, `logged-in` /
`empty media response` / `cookies` means cookies, and `Cannot parse data` on
Facebook or Instagram means cookies too.
