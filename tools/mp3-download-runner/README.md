# MP3 Download runner

Makes the YouTube half of [MP3 Download](../../src/app/apps/mp3-download) work **from the live
site**, from your phone, from anywhere.

## Why this exists

yt-dlp is a program on your PC. Vercel has no such binary and never will, so on the deployed site
that source is simply dark. Rather than pretend otherwise, the site hands the work over: it queues
a job, this program picks it up, runs yt-dlp here, and sends the finished file back.

Nothing listens on a port. This only ever makes outbound requests, so it works behind any router
with nothing forwarded and no tunnel.

## Setup, once

1. **Install yt-dlp** if you have not:

   ```
   pip install -U yt-dlp
   ```

   (or `winget install yt-dlp.yt-dlp`). ffmpeg is what turns the download into an MP3 — without it
   you get the original audio format instead.

2. **Get a token.** Open MP3 Download on the hub → the **Your PC** tab → *Create a token*. It is
   shown once.

3. **Configure.** Copy `.env.example` to `.env` and paste the token into `HUB_TOKEN`.

## Running it

Double-click **`start-runner.cmd`**, or:

```
npm run runner
```

Leave the window open. It prints which yt-dlp it found, then waits. The app's **Your PC** tab turns
green within a few seconds.

`npm run runner:once` takes a single job and exits — handy for checking the setup.

## What happens to a download

1. You press Download on a YouTube row, or paste a link, on the live site.
2. The site queues a job and the page says it is waiting on your PC.
3. This runner claims it within a few seconds and runs yt-dlp.
4. Small files come back through the site; anything over 8 MB goes straight to Supabase Storage
   through a one-time signed link, because a deployed function body caps at 4.5 MB.
5. Your browser downloads it, named from the track you confirmed.

## When something is wrong

| What you see | What it means |
|---|---|
| `No HUB_TOKEN` | `.env` is missing or empty — step 2 and 3 above. |
| `The hub rejected this token` | The token was replaced. Make a new one in **Your PC**. |
| `yt-dlp was not found` | Install it, or put the full path in `YTDLP_PATH`. pip installs it to `%APPDATA%\Python\Python3xx\Scripts`, which Windows does **not** put on PATH. |
| `NO ffmpeg` in the startup line | Downloads still work, but audio arrives in its original format instead of MP3. |
| The job fails with a 403 | YouTube throttling. The runner already retries with a fresh extraction; trying again usually works. |

## Rights

This fetches what you point it at. The app labels every YouTube row *rights not verified* because
YouTube grants no redistribution right for most videos — download what you are entitled to.
