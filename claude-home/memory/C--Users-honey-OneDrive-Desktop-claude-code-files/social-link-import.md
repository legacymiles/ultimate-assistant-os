---
name: social-link-import
description: Paste-a-social-link → AI watches the video → structured record. Built into Cookbook Genie (2026-09-13) as a reusable lib + the social-link-import skill; which platforms work anonymously
metadata: 
  node_type: memory
  type: project
  originSessionId: b116370f-3f51-4719-86c4-15bccebccf25
  modified: 2026-09-13T15:00:28.141Z
---

Built 2026-09-13. The user wants "import from a TikTok/Instagram/Facebook link" automations in
**multiple apps**, so it's a reusable lib, not cookbook-only code:
`src/lib/social-import/` (platform, safeFetch, jsonld, resolve, understand), with the
cookbook-specific parts in `src/lib/cookbook/recipe.ts`,
`src/app/api/cookbook/import-from-link/route.ts`, and a "From a video link" tab (the default
tab) in `CreateRecipeView.tsx`. The custom skill `~/.claude/skills/social-link-import` holds
the how-to and the verified platform facts. Use it for the next app.

Load-bearing facts:
- A video model **watches** the post: `google/gemini-3.8-flash` via OpenRouter `video_url`
  (YouTube URL or base64 mp4). Sent only when the provider is OpenRouter; the gateway's video
  support is unverified. `AI_VIDEO_MODEL` overrides the model.
- TikTok works (oEmbed caption + tikwm.com mp4). YouTube works (URL passed straight to
  Gemini). **Instagram and Facebook are login-walled anonymously**, so the UI falls back to
  paste caption / upload video. Don't promise otherwise.
- Source is saved in the existing `recipes.notes` column ("Imported from TikTok (author):
  url"), so **no migration**. RecipeView renders it as a "Watch the original" link.
- Uploads over 3 MB go through the `recipe-images` Storage bucket (Vercel's 4.5 MB body
  cap); local demo falls back to sending the file inline.
- The route guards against SSRF on every redirect hop; private and localhost links return 400.

Verified end to end on preview port 3219 (`cookbook-import-preview-3219` in launch.json):
TikTok → "Baked Feta Pasta" with the video watched and high confidence; YouTube Short
watched; Instagram → 422 needsHelp.

Related: [[cookbook-genie-app]], [[hub-ai-provider]], [[soundprint-app]]
