# Cookies — the only real unlock

Vimeo, many Facebook posts, and anything on a private account are not blocking
you. They are asking who you are, and a signed-out program has no answer. No
user-agent string, mirror or proxy changes that. Cookies do, every time.

**Instagram is not in that list.** Public reels and posts download with no
cookies at all — see `platforms.md`. Reach for cookies on Instagram only for a
private account, or when you are being rate limited after a run of downloads.

There are two ways to supply them. Prefer the first.

## 1. Straight from your browser (nothing written to disk)

```bash
node scripts/grab.mjs "<url>" --cookies-from-browser chrome
```

Accepts `chrome`, `firefox`, `edge`, `brave`, `opera`, `vivaldi`, `safari`,
`chromium`. Narrow it when you have several profiles:

```bash
--cookies-from-browser "chrome:Profile 2"
```

To make it the default for every run, set it once:

```bash
# PowerShell, this session
$env:YTDLP_COOKIES_FROM_BROWSER = "chrome"
```

Two things that catch people out:

- **Chrome must be fully closed on Windows.** Recent Chrome encrypts its cookie
  store so only the running browser can read it; with Chrome open you get a
  decryption error, not a login error. Quit it (check the tray) and retry.
- **Firefox does not need to be closed**, which makes it the easier choice if
  you live in Chrome.

## 2. A cookies.txt file

Better for a server, a container, or anywhere there is no browser to read.

1. Install a cookie exporter — "Get cookies.txt LOCALLY" is the usual one, and
   the "LOCALLY" matters: it does the export in the browser and uploads
   nothing.
2. Sign in to the site, open a post, click the extension, export.
3. Point at the file:

```bash
node scripts/grab.mjs "<url>" --cookies ./facebook-cookies.txt
```

Or set it per site so it is picked up automatically:

```
YTDLP_COOKIES_FACEBOOK_FILE=C:/keys/facebook-cookies.txt
YTDLP_COOKIES_INSTAGRAM_FILE=C:/keys/instagram-cookies.txt
```

**In the hub**, the server-side equivalents are `YTDLP_COOKIES_FACEBOOK` and
`YTDLP_COOKIES_INSTAGRAM` in `.env.local` — the file's *contents*, or the same
text base64-encoded, which is easier to paste into a Vercel env var. See
`src/lib/social-import/ytdlp.ts` (`cookiesFor`).

## Treat these as credentials

An exported cookies.txt is a live session for that account. Anyone holding it is
signed in as you, without a password and usually without tripping 2FA.

- Never commit one. Add `*cookies*.txt` to `.gitignore` before you export.
- Never paste one into a chat, an issue, or a log.
- Prefer `--cookies-from-browser`, which keeps them in memory and writes nothing.
- If one leaks, sign out of all sessions on that site — that invalidates it.
- Consider a throwaway account that follows nothing and posts nothing. It can
  see public posts just as well, and it is the only version of this that costs
  nothing if it leaks.

## When cookies still are not enough

Rate limiting looks like a wall but is not. If a site starts refusing a session
that worked a minute ago, you are being throttled — wait, then use
`--sleep-requests 2` to space things out. Hammering it is how a real account
gets flagged.

If a post is genuinely private, or in a group or close-friends list your account
cannot see, there is nothing to fix. Open it in a browser and save the video
yourself, or ask whoever shared it. `grab.mjs` exits **2** for exactly this
case, so a script can tell the difference between "I need credentials" and "this
is broken".
