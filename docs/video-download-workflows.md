# Video download workflows

Any post link → the actual video file. Used by Dance Studio's "Video URL" import
(and the Dance Vault wall's "Cache clip locally"). Code: `src/lib/social-import/videoDownload.ts`
(workflows) and `src/lib/social-import/ytdlp.ts` (the yt-dlp runner).

Each site tries its strategies in order and stops at the first real video. The
import response carries a `trail` of every attempt, shown in the UI under
"What was tried".

| Site | Workflow | Verified 2026-09-13 (anonymous, no cookies) |
| --- | --- | --- |
| TikTok | tikwm mirror → yt-dlp → cobalt | ✅ tikwm, ~6 s |
| YouTube (watch, Shorts, youtu.be) | yt-dlp → cobalt | ✅ yt-dlp, ~5 s |
| Instagram (reels, posts) | yt-dlp → cobalt → page og:video | ✅ public reel via yt-dlp, ~9 s |
| Facebook (reels, videos, fb.watch) | yt-dlp → cobalt → page og:video | ✅ public reel via yt-dlp, ~7 s |
| X / Twitter | FxTwitter API → yt-dlp → cobalt | ✅ FxTwitter, ~3 s |
| Pinterest | yt-dlp → page og:video → cobalt | not tested |
| Any other page | page og:video → yt-dlp (~1,800 sites) | direct .mp4 ✅ |

Verified from a home connection. Sites rate-limit datacenter IPs (Vercel) harder,
YouTube especially ("Sign in to confirm you're not a bot") — that is what the
cookie settings below are for.

## The tools

- **yt-dlp** — [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp). Nothing to
  install: if `YTDLP_PATH` isn't set and `yt-dlp` isn't on PATH, the server downloads the
  official standalone binary for its OS from the pinned GitHub release, checks it against
  that release's `SHA2-256SUMS`, caches it in the temp dir, and runs it. On Vercel that is
  a ~40 MB download on a cold instance.
- **FxTwitter** — [github.com/FixTweet/FxTwitter](https://github.com/FixTweet/FxTwitter). Free, no key.
- **tikwm** — free TikTok mirror, no key.
- **cobalt** — [github.com/imputnet/cobalt](https://github.com/imputnet/cobalt). Optional
  fallback, only if you run your own instance (the public one forbids other projects).

## Settings (all optional)

| Variable | What it does |
| --- | --- |
| `YTDLP_COOKIES_INSTAGRAM` | Cookies from a logged-in browser, for private / login-only posts. Netscape cookies.txt text, or the same text base64-encoded (easier to paste into Vercel). |
| `YTDLP_COOKIES_FACEBOOK` / `_YOUTUBE` / `_TIKTOK` / `_X` / `_PINTEREST` | Same, per site. `…_FILE` variants take a file path instead. |
| `YTDLP_PATH` | Use your own yt-dlp install. |
| `YTDLP_VERSION` | Pin a different yt-dlp release tag (default `2026.08.19`). |
| `YTDLP_AUTO_DOWNLOAD=0` | Never download the binary. |
| `COBALT_API_URL`, `COBALT_API_KEY` | Your cobalt instance. |

Export cookies with a browser extension such as "Get cookies.txt LOCALLY", using a
throwaway account where possible — a cookie file is a logged-in session.

Downloading from these sites can breach their terms of service; use it for videos you
have the right to use.
