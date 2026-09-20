---
name: social-link-import
description: >-
  Add a "paste a social media link → AI builds the thing for you" automation to any app:
  the user pastes a TikTok, Instagram, Facebook, YouTube, X, Pinterest or web link, the
  server fetches the post (caption, author, cover, and the actual video when reachable),
  a video-capable model WATCHES it, and the app gets structured data — a recipe, workout,
  product, travel spot, DIY project, outfit, etc. Use this WHENEVER the user wants to
  import, create, save, or auto-fill something "from a link", "from a TikTok", "from a
  reel", "from a video", "from Instagram/Facebook/YouTube", "paste a link and it makes
  it", "understand the video", "turn this video into a …", or wants a share-sheet /
  link-drop automation in an app. Also trigger when extending an app that already has
  the social-import lib (src/lib/social-import) to a new content type.
---

# Social Link Import

Paste a link → the app watches the post → structured data comes out. The reference
implementation is **Cookbook Genie's "From a video link" tab** in the Assistant OS hub
(`C:\Users\honey\OneDrive\Desktop\claude code files`). Reuse its library; don't rebuild it.

## The pipeline (and why each stage exists)

```
share text ──► parseLink ──► resolveSocialPost ──► understandPost ──► normalize ──► UI review ──► save
               platform      caption, author,      video + caption     app schema    evidence
               detection     cover, video URL,     → JSON via a        + offline     chips, then
                             linked pages          video model         fallback      user saves
```

1. **Parse** — people paste share-sheet text ("Check this out! https://vm.tiktok.com/… 😋"),
   so extract the first URL, then detect the platform. Runs client-side too, for a live
   platform chip.
2. **Resolve** — gather every public signal: caption, author, cover, a direct video URL,
   schema.org JSON-LD, and pages linked from the caption (creators write "full recipe:
   https://…", and that page usually has exact amounts). Never throws for an unavailable
   source; appends a plain sentence to `trail` instead.
3. **Understand** — send the video itself to a model that accepts video, with the caption
   as text. Fall back to cover image + caption, then caption only.
4. **Normalize** — coerce model output into the app's exact storage shape. Keep a non-AI
   fallback (structured data → caption heuristic) so the feature works with no key.
5. **Review** — show what was actually used ("Watched the video ✓ / Read the caption ✓"),
   a confidence level, and the details the model had to guess. Let the user edit, then
   save. **Never auto-save** — a caption-only guess must not pass for a watched video.
6. **Keep the source** — store the original URL with the record ("Imported from TikTok
   (author): url") so the user can get back to the video.

## Reusable library (copy these into a new Next.js app)

| File | Role | App-specific? |
|---|---|---|
| `src/lib/social-import/platform.ts` | `parseLink`, `firstUrl`, `PLATFORM_LABEL`, `youTubeId`, `isSocialHost` | no — pure, client-safe |
| `src/lib/social-import/safeFetch.ts` | SSRF-guarded fetch (every redirect hop), capped byte reads, `fetchImageDataUrl` | no |
| `src/lib/social-import/jsonld.ts` | JSON-LD extraction (`@graph` aware), meta tags, `htmlToText` | no |
| `src/lib/social-import/resolve.ts` | `resolveSocialPost(link)` → `SocialPost` | no |
| `src/lib/social-import/understand.ts` | `understandPost({post, system, task, uploadDataUrl, imageDataUrl})` | no — caller supplies task + JSON shape |
| `src/lib/cookbook/recipe.ts` | `normalizeRecipe`, `recipeFromStructured`, `recipeFromCaption` | **yes** — the example to imitate |
| `src/app/api/cookbook/import-from-link/route.ts` | orchestration + response contract | **yes** |
| `src/components/cookbook/views/CreateRecipeView.tsx` | link tab, fallbacks, evidence summary | **yes** |

`understand.ts` imports `@/lib/ai/provider` (`aiEndpoint`, `DEFAULT_MODEL`). In another app,
provide an equivalent that returns `{ url, key, provider }` for an OpenAI-compatible
`/chat/completions` endpoint.

## Adding it to a new app — steps

1. **Copy the five `social-import` files.** Add tests next to them (copy
   `social-import.test.ts`).
2. **Define the target shape** as a JSON schema string, like `RECIPE_JSON_SCHEMA`, plus a
   `normalizeX(p: any)` that coerces types and drops empty rows.
3. **Write the task prompt.** Pattern that works:
   - name the thing by its real name, never the caption's hook or joke
   - use amounts/facts stated in speech, on-screen text, caption, or linked page, and treat
     the creator's structured data as authoritative
   - when something is shown but never stated, estimate it **and list it in `assumptions`**
   - include an escape hatch: `"is_<thing>": false` when the post isn't one
   - add `"confidence": "high"|"medium"|"low"` and `"assumptions": string[]`
4. **Write the route** from the cookbook one: resolve → merge pasted caption and uploaded
   video → 422 with `needsHelp: true` when nothing is readable → `understandPost` → normalize
   → non-AI fallback → return
   `{ data, source, coverDataUrl, evidence, confidence, assumptions, trail }`.
   `runtime = "nodejs"`, `maxDuration = 300`.
5. **Pick the non-AI fallback** for the domain: schema.org type (`Recipe`, `Product`,
   `HowTo`, `Event`, `Place`, `ExercisePlan`…) via `findByType`, then a caption heuristic.
6. **Build the UI**: a link input with a live platform chip; "Link won't open? Paste the
   caption or upload the video" (auto-opens on `needsHelp`); staged progress text;
   an evidence summary; an edit-before-save step; the source URL saved on the record.
7. **Verify with real links** (see the checklist below). Not with mocks only.

## Hard-won facts

Details and re-check commands are in `references/platform-facts.md`. Re-verify anything older
than a few months: platforms change these routes without notice.

- **TikTok** — public oEmbed returns the full caption. `tikwm.com/api/?url=` (a free
  third-party mirror, ~1 req/s) returns the caption *with line breaks* plus a direct mp4.
  TikTok's own `playAddr` needs session cookies.
- **YouTube** — no download needed. Gemini accepts a YouTube URL as a `video_url` part.
  The description lives in the watch page's `"shortDescription"`.
- **Instagram and Facebook** — every anonymous route returns a login wall (page, embed,
  `/embed/captioned`, Googlebot and facebookexternalhit UAs). Plan for it: paste caption or
  upload video. Don't promise it silently works.
- **Video models** — on OpenRouter, `google/gemini-3.8-flash` takes `video_url` with a
  YouTube URL or a `data:video/mp4;base64,…` URL, and hears the audio. A 54 s TikTok cost
  about $0.005. Video through the Vercel AI Gateway was not verified, so send video only
  when the provider is OpenRouter. No gateway LLM takes raw audio.
- **Upload size** — Vercel rejects function bodies over 4.5 MB, and base64 adds a third.
  Send small files inline; upload bigger ones to Storage first and pass the public https
  URL. Cap uploads at 20 MB.
- **Signed CDN covers expire** (TikTok's do). Fetch the cover server-side and return it as
  a data URL, so saving it later still works.
- **SSRF** — the server fetches user-supplied URLs *and* links found inside captions.
  Resolve DNS and block private, loopback, link-local and mapped addresses on **every
  redirect hop**. Test `http://169.254.169.254/` and `http://localhost/` and expect a 400.

## Verification checklist

- [ ] Unit tests: link parsing from share text, look-alike hosts, YouTube id shapes,
      private-IP blocking, JSON-LD in `@graph`, the caption heuristic on a real caption
- [ ] A real TikTok link: `evidence.watchedVideo === true`, title is the dish name, amounts
      match the caption
- [ ] A real YouTube Short: video watched, cover returned
- [ ] A real Instagram reel: 422, `needsHelp`, friendly message
- [ ] Private and localhost links: 400
- [ ] In a browser: paste → import → evidence chips → save → record shows the source link
- [ ] With no AI key: a caption that lists ingredients still imports (low confidence)
