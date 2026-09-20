# Platform facts — what an anonymous server can get

Verified 2026-09-13 from a residential Windows machine with curl, and end-to-end through the
Cookbook Genie import route. Re-run the probes before relying on anything older than a few
months.

## TikTok — works (caption + video)

```bash
curl -s "https://www.tiktok.com/oembed?url=https://www.tiktok.com/@butterworthdasyrup/video/7484033605795204394"
```
`title` is the full caption (flattened, no line breaks), plus `author_name` and
`thumbnail_url`.

```bash
curl -s "https://www.tikwm.com/api/?url=https://www.tiktok.com/@butterworthdasyrup/video/7484033605795204394"
```
`code: 0`, `data.content_desc` is the caption as an array of lines (best for
one-ingredient-per-line recipes), `data.play` is a direct mp4 (5.9 MB for 54 s,
`video/mp4`, no headers needed), plus `data.duration`, `data.cover` and
`data.author.nickname`. Free third-party mirror, roughly 1 req/s. Treat it as best effort.

TikTok's own page embeds `__UNIVERSAL_DATA_FOR_REHYDRATION__` with `playAddr`/`downloadAddr`,
but the CDN needs the page's session cookies. Not worth it while the mirror works.

## YouTube — works (no download needed)

- oEmbed: `https://www.youtube.com/oembed?url=<watch url>&format=json` gives title, author
  and thumbnail
- Description: the watch page HTML has `"shortDescription":"…"` (a JSON-escaped string)
- Duration: `"lengthSeconds":"…"`
- Thumbnail: `https://i.ytimg.com/vi/<id>/hqdefault.jpg` exists for every video, Shorts
  included (maxresdefault does not)
- Video: pass `https://www.youtube.com/watch?v=<id>` straight to Gemini as `video_url`

## Instagram — blocked anonymously

All returned a login wall with no caption and no `og:*` tags:
- `https://www.instagram.com/reel/<code>/` (browser UA, Googlebot UA, facebookexternalhit UA)
- `/embed/` and `/embed/captioned/`

The official oEmbed needs a Meta app token. The practical fallbacks are the user pasting the
caption, or uploading the saved video. `yt-dlp` can sometimes do it with browser cookies,
but only locally, not on Vercel.

## Facebook — treat like Instagram

It usually needs a login. Try `og:description` and `og:video`, and fall back to paste or
upload.

## Video understanding — OpenRouter

List models that accept video or audio input:
```bash
curl -s https://openrouter.ai/api/v1/models | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const x of JSON.parse(s).data){const i=x.architecture?.input_modalities||[];if(i.includes('video'))console.log(x.id,i.join(','))}})"
```

Request shape that worked:
```json
{ "model": "google/gemini-3.8-flash",
  "response_format": { "type": "json_object" },
  "messages": [{ "role": "user", "content": [
    { "type": "text", "text": "…caption + task + JSON shape…" },
    { "type": "video_url", "video_url": { "url": "https://www.youtube.com/watch?v=itDfMqkxNI0" } }
  ]}]}
```
The `url` can also be `data:video/mp4;base64,<…>`. Measured cost: YouTube Short about
$0.003, 54 s TikTok about $0.005. Gemini picked up spoken amounts and on-screen actions,
and noticed the creator saying "lime" while holding a lemon.

Vercel AI Gateway: video input not verified. Its language models declared no audio input
as of 2026-07.
